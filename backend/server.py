"""
ARTHA API — FastAPI + MongoDB.

Routes only. Financial truth lives in engine.py (deterministic), Claude explanation in
ai.py, and the synthetic demo dataset in seed.py. Claude is called ONLY from this
server; no API key is ever shipped to the client.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")  # must run before importing ai.py (reads EMERGENT_LLM_KEY)

from fastapi import APIRouter, Depends, FastAPI, HTTPException  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

import ai  # noqa: E402
import auth  # noqa: E402
from engine import TEXT, as_dt, build_facts, category_comparison, dashboard_insights, next_due_date, weekly_story  # noqa: E402
from importer import parse_statement  # noqa: E402
from models import (  # noqa: E402
    CATEGORIES, DEMO_USER_ID, Account, AccountCreate, AskRequest, Commitment, CommitmentCreate,
    ImportCommitRequest, ImportPreviewRequest, LangRequest, OrderReq, Resolution, Transaction,
    TransactionCreate, TransactionPatch,
)
from seed import build_demo_dataset  # noqa: E402

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("artha")

def _init_db():
    if MONGO_URL.startswith("mongomock://") or os.environ.get("USE_MOCK_MONGO") == "1":
        logger.info("Using in-memory MongoDB mock (mongomock_motor)")
        import mongomock_motor
        c = mongomock_motor.AsyncMongoMockClient()
        return c, c[DB_NAME]
    try:
        from pymongo import MongoClient
        MongoClient(MONGO_URL, serverSelectionTimeoutMS=800).admin.command("ping")
        logger.info("Connected to MongoDB at %s", MONGO_URL)
        c = AsyncIOMotorClient(MONGO_URL)
        return c, c[DB_NAME]
    except Exception as e:
        logger.warning("Live MongoDB not reachable at %s (%s); using in-memory mongomock_motor", MONGO_URL, e)
        import mongomock_motor
        c = mongomock_motor.AsyncMongoMockClient()
        return c, c[DB_NAME]

client, db = _init_db()

# Razorpay test-mode client with mock fallback (no real money moves in either mode)
try:
    import razorpay
    RZP_CLIENT = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET else None
except Exception:
    RZP_CLIENT = None


# ---------------------------------------------------------------------------
# data access
# ---------------------------------------------------------------------------
def _strip(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _fetch_all(uid: str):
    accounts = [_strip(d) async for d in db.accounts.find({"user_id": uid})]
    txs = [_strip(d) async for d in db.transactions.find({"user_id": uid}).sort("date", -1)]
    coms = [_strip(d) async for d in db.commitments.find({"user_id": uid}).sort("due_date", 1)]
    return accounts, txs, coms


async def _facts(uid: str, lang: str = "en") -> dict:
    accounts, txs, coms = await _fetch_all(uid)
    return build_facts(accounts, txs, coms, lang)


UID = Depends(auth.user_id_of)


_seed_lock = asyncio.Lock()


async def seed_demo(uid: str = DEMO_USER_ID, reset: bool = True) -> dict:
    async with _seed_lock:  # concurrent seed calls must not double the dataset
        if reset:
            await reset_all(uid)
        accounts, txs, coms = build_demo_dataset()
        await db.accounts.insert_many([{**a.model_dump(), "user_id": uid} for a in accounts])
        await db.transactions.insert_many([{**t.model_dump(), "user_id": uid} for t in txs])
        await db.commitments.insert_many([{**c.model_dump(), "user_id": uid} for c in coms])
    return {"ok": True, "accounts": len(accounts), "transactions": len(txs), "commitments": len(coms)}


async def reset_all(uid: str):
    for coll in (db.accounts, db.transactions, db.commitments, db.resolutions):
        await coll.delete_many({"user_id": uid})


async def _log_resolutions(uid: str, before: list, fix: str, detail: str = ""):
    """Exception history: any finding present before a mutation and gone after it was resolved by that fix."""
    after_ids = {f["id"] for f in (await _facts(uid))["findings"]}
    for f in before:
        if f["id"] in after_ids:
            continue
        res = Resolution(user_id=uid, finding_id=f["id"], kind=f["kind"], severity=f["severity"], amount=f["amount"],
                         account_name=f["account_name"], related=f["related"], fix=fix, fix_detail=detail)
        await db.resolutions.insert_one(res.model_dump())


@asynccontextmanager
async def lifespan(_: FastAPI):
    auth.configure(db, seed_demo)
    await auth.ensure_indexes()
    # Demo mode: the shared demo account always has the synthetic dataset available.
    if await db.accounts.count_documents({"user_id": DEMO_USER_ID}) == 0:
        await seed_demo(DEMO_USER_ID, reset=False)
        logger.info("Demo dataset seeded (all records synthetic)")
    yield
    client.close()


app = FastAPI(title="ARTHA API", lifespan=lifespan)
api = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# health / meta
# ---------------------------------------------------------------------------
@api.get("/")
async def root():
    return {"service": "ARTHA", "ok": True}


@api.get("/health")
async def health():
    return {"ok": True, "claude": ai.claude_available(), "razorpay": "test" if RZP_CLIENT else "mock", "demo_mode": True}


@api.get("/categories")
async def categories():
    return CATEGORIES


# ---------------------------------------------------------------------------
# accounts
# ---------------------------------------------------------------------------
@api.get("/accounts")
async def list_accounts(uid: str = UID):
    return [_strip(d) async for d in db.accounts.find({"user_id": uid})]


@api.post("/accounts")
async def create_account(body: AccountCreate, uid: str = UID):
    a = Account(**body.model_dump(), user_id=uid)
    await db.accounts.insert_one(a.model_dump())
    return a.model_dump()


# ---------------------------------------------------------------------------
# transactions
# ---------------------------------------------------------------------------
@api.get("/transactions")
async def list_transactions(source: Optional[str] = None, limit: int = 500, uid: str = UID):
    facts = await _facts(uid)
    status = facts["record_status"]
    txs = facts["transactions"]
    if source and source != "All":
        txs = [t for t in txs if t.get("source") == source]
    return [{**t, "control_status": status.get(t["id"], "explained")} for t in txs[:limit]]


@api.post("/transactions")
async def create_transaction(body: TransactionCreate, uid: str = UID):
    if not await db.accounts.find_one({"id": body.account_id, "user_id": uid}):
        raise HTTPException(404, "Account not found")
    data = body.model_dump()
    data["date"] = data.get("date") or datetime.now(timezone.utc)
    data["category"] = data["category"] if data["category"] in CATEGORIES else "Uncategorized"
    data["description"] = (data.get("description") or "").strip()
    # A record with neither category nor description cannot be attributed → unclassified.
    data["status"] = "unclassified" if data["category"] == "Uncategorized" and not data["description"] else "cleared"
    t = Transaction(**data, user_id=uid)
    await db.transactions.insert_one(t.model_dump())
    return t.model_dump()


@api.patch("/transactions/{tx_id}")
async def update_transaction(tx_id: str, body: TransactionPatch, uid: str = UID):
    doc = await db.transactions.find_one({"id": tx_id, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Transaction not found")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "category" in patch and patch["category"] not in CATEGORIES:
        raise HTTPException(422, "Unknown category")
    merged = {**doc, **patch}
    # Classifying an unclassified record (category or description) clears it.
    if merged.get("status") == "unclassified" and (merged.get("category") != "Uncategorized" or (merged.get("description") or "").strip()):
        patch["status"] = "cleared"
    before = (await _facts(uid))["findings"]
    await db.transactions.update_one({"id": tx_id}, {"$set": patch})
    if patch.get("review") == "not_duplicate":
        fix, detail = "kept_both", ""
    elif patch.get("review") == "accepted":
        fix, detail = "marked_reviewed", ""
    elif "category" in patch:
        fix, detail = "categorised", patch["category"]
    else:
        fix, detail = "described", patch.get("description", "")
    await _log_resolutions(uid, before, fix, detail)
    return _strip(await db.transactions.find_one({"id": tx_id}))


@api.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str, uid: str = UID):
    before = (await _facts(uid))["findings"]
    res = await db.transactions.delete_one({"id": tx_id, "user_id": uid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Transaction not found")
    was_dup = any(f["kind"] == "possible_duplicate" and tx_id in f["transaction_ids"] for f in before)
    await _log_resolutions(uid, before, "removed_copy" if was_dup else "record_deleted")
    return {"ok": True}


@api.post("/transactions/{tx_id}/suggest-category")
async def suggest_category(tx_id: str, body: LangRequest, uid: str = UID):
    doc = await db.transactions.find_one({"id": tx_id, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Transaction not found")
    return await ai.suggest_category(_strip(doc), body.language)


# ---------------------------------------------------------------------------
# commitments
# ---------------------------------------------------------------------------
@api.get("/commitments")
async def list_commitments(kind: Optional[str] = None, uid: str = UID):
    q = {"user_id": uid}
    if kind:
        q["kind"] = kind
    return [_strip(d) async for d in db.commitments.find(q).sort("due_date", 1)]


@api.post("/commitments")
async def create_commitment(body: CommitmentCreate, uid: str = UID):
    c = Commitment(**body.model_dump(), user_id=uid)
    await db.commitments.insert_one(c.model_dump())
    return c.model_dump()


@api.post("/commitments/{cid}/pay")
async def pay_commitment(cid: str, uid: str = UID):
    doc = await db.commitments.find_one({"id": cid, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Commitment not found")
    now = datetime.now(timezone.utc)
    if doc["frequency"] == "one-time":
        patch = {"status": "paid", "last_paid_at": now, "snooze_until": None}
    else:  # recurring: roll forward to the next occurrence
        patch = {"due_date": next_due_date(as_dt(doc["due_date"]), doc["frequency"]), "last_paid_at": now, "snooze_until": None}
    await db.commitments.update_one({"id": cid}, {"$set": patch})
    return _strip(await db.commitments.find_one({"id": cid}))


@api.post("/commitments/{cid}/snooze")
async def snooze_commitment(cid: str, days: int = 1, uid: str = UID):
    doc = await db.commitments.find_one({"id": cid, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Commitment not found")
    until = datetime.now(timezone.utc) + timedelta(days=max(1, min(days, 30)))
    await db.commitments.update_one({"id": cid}, {"$set": {"snooze_until": until}})
    return _strip(await db.commitments.find_one({"id": cid}))


@api.delete("/commitments/{cid}")
async def delete_commitment(cid: str, uid: str = UID):
    res = await db.commitments.delete_one({"id": cid, "user_id": uid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Commitment not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# engine read-outs
# ---------------------------------------------------------------------------
@api.get("/dashboard")
async def dashboard(lang: str = "en", uid: str = UID):
    lang = "hi" if lang == "hi" else "en"
    facts = await _facts(uid, lang)
    up = facts["upcoming"]
    return {
        "balances": facts["balances"],
        "coverage": facts["coverage"],
        "upcoming_week_total": up["week_total"],
        "discretionary": up["discretionary"],
        "upcoming_preview": up["week_items"][:3],
        "top_finding": facts["findings"][0] if facts["findings"] else None,
        "insights": dashboard_insights(facts, lang),
        "reminders": facts["reminders"],
        "story": weekly_story(facts["transactions"], lang),
        "data_context": "demo_synthetic",
    }


@api.get("/control")
async def control(lang: str = "en", uid: str = UID):
    facts = await _facts(uid, "hi" if lang == "hi" else "en")
    return {"coverage": facts["coverage"], "findings": facts["findings"]}


@api.get("/control/findings/{finding_id}")
async def finding_detail(finding_id: str, lang: str = "en", uid: str = UID):
    facts = await _facts(uid, "hi" if lang == "hi" else "en")
    f = next((x for x in facts["findings"] if x["id"] == finding_id), None)
    if not f:
        raise HTTPException(404, "Finding not found (it may have been resolved)")
    return f


@api.post("/control/findings/{finding_id}/explain")
async def explain_finding(finding_id: str, body: LangRequest, uid: str = UID):
    facts = await _facts(uid, body.language)
    f = next((x for x in facts["findings"] if x["id"] == finding_id), None)
    if not f:
        raise HTTPException(404, "Finding not found (it may have been resolved)")
    return await ai.explain_finding(f, facts, body.language)


@api.get("/control/history")
async def control_history(lang: str = "en", limit: int = 50, uid: str = UID):
    lang = "hi" if lang == "hi" else "en"
    cur = db.resolutions.find({"user_id": uid}).sort("resolved_at", -1).limit(limit)
    return [{**_strip(d), "title": TEXT[d["kind"]][lang]["title"]} async for d in cur]


@api.get("/insights/categories")
async def insights_categories(uid: str = UID):
    accounts, txs, _ = await _fetch_all(uid)
    return category_comparison(txs)


@api.post("/import/preview")
async def import_preview(body: ImportPreviewRequest, uid: str = UID):
    if not await db.accounts.find_one({"id": body.account_id, "user_id": uid}):
        raise HTTPException(404, "Account not found")
    parsed = parse_statement(body.csv_text)
    if parsed["error"]:
        raise HTTPException(422, parsed["error"])
    existing = [_strip(d) async for d in db.transactions.find({"user_id": uid, "account_id": body.account_id})]
    refs = {t["reference"] for t in existing if t.get("reference")}
    sigs = {(as_dt(t["date"]).date().isoformat(), round(float(t["amount"]), 2), (t.get("description") or "").strip().lower()) for t in existing}
    seen_refs: set = set()
    for r in parsed["rows"]:
        r["duplicate"] = False
        if r["error"]:
            continue
        sig = (r["date"][:10], round(r["amount"], 2), r["description"].strip().lower())
        if (r["reference"] and (r["reference"] in refs or r["reference"] in seen_refs)) or sig in sigs:
            r["duplicate"] = True
        if r["reference"]:
            seen_refs.add(r["reference"])
    rows = parsed["rows"]
    return {
        "columns": parsed["columns"],
        "rows": rows,
        "summary": {
            "total": len(rows),
            "importable": sum(1 for r in rows if not r["error"] and not r["duplicate"]),
            "duplicates": sum(1 for r in rows if r["duplicate"]),
            "errors": sum(1 for r in rows if r["error"]),
        },
    }


@api.post("/import/commit")
async def import_commit(body: ImportCommitRequest, uid: str = UID):
    acc = await db.accounts.find_one({"id": body.account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Account not found")
    docs = []
    for r in body.rows:
        category = r.category if r.category in CATEGORIES else "Uncategorized"
        desc = r.description.strip()
        docs.append(Transaction(
            user_id=uid, account_id=body.account_id, amount=r.amount, type=r.type, category=category, description=desc,
            date=r.date, source=acc["type"], reference=r.reference or None,
            status="unclassified" if category == "Uncategorized" and not desc else "cleared",
        ).model_dump())
    if docs:
        await db.transactions.insert_many(docs)
    return {"ok": True, "imported": len(docs)}


@api.get("/story")
async def story(lang: str = "en", uid: str = UID):
    facts = await _facts(uid)
    return weekly_story(facts["transactions"], "hi" if lang == "hi" else "en")


@api.get("/facts")
async def get_facts(lang: str = "en", uid: str = UID):
    return await _facts(uid, "hi" if lang == "hi" else "en")


# ---------------------------------------------------------------------------
# Ask ARTHA (Claude behind the server; deterministic fallback always available)
# ---------------------------------------------------------------------------
@api.post("/ask")
async def ask_artha(body: AskRequest, uid: str = UID):
    facts = await _facts(uid, body.language)
    return await ai.ask(facts, body.question, body.language)


# ---------------------------------------------------------------------------
# demo data
# ---------------------------------------------------------------------------
@api.post("/seed")
async def seed(reset: bool = True, uid: str = UID):
    if uid != DEMO_USER_ID:
        raise HTTPException(403, "Demo data can only be loaded into the demo account")
    return await seed_demo(uid, reset)


@api.post("/reset")
async def reset_data(uid: str = UID):
    await reset_all(uid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Razorpay (test mode / mock) — kept server-side
# ---------------------------------------------------------------------------
@api.post("/payments/order")
async def create_order(body: OrderReq, uid: str = UID):
    receipt = body.receipt or f"artha-{int(datetime.now(timezone.utc).timestamp())}"
    if RZP_CLIENT is None:
        return {"key_id": "mock_key", "order": {"id": f"mock_order_{receipt}", "amount": body.amount, "currency": body.currency, "status": "created"}, "mock": True}
    order = dict(RZP_CLIENT.order.create(data={"amount": body.amount, "currency": body.currency, "receipt": receipt[:40], "notes": {"source": "artha_test"}}))
    return {"key_id": RAZORPAY_KEY_ID, "order": order, "mock": False}


@api.get("/razorpay/status")
async def rzp_status(uid: str = UID):
    return {"mode": "test" if RZP_CLIENT else "mock"}


app.include_router(api)
app.include_router(auth.router, prefix="/api")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

