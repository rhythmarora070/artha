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
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")  # must run before importing ai.py (reads EMERGENT_LLM_KEY)

from fastapi import APIRouter, FastAPI, HTTPException  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

import ai  # noqa: E402
from engine import build_facts, dashboard_insights, weekly_story  # noqa: E402
from models import (  # noqa: E402
    CATEGORIES, DEMO_USER_ID, Account, AccountCreate, AskRequest, Commitment, CommitmentCreate,
    LangRequest, OrderReq, Transaction, TransactionCreate, TransactionPatch,
)
from seed import build_demo_dataset  # noqa: E402

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("artha")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

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


async def _fetch_all():
    accounts = [_strip(d) async for d in db.accounts.find({"user_id": DEMO_USER_ID})]
    txs = [_strip(d) async for d in db.transactions.find({"user_id": DEMO_USER_ID}).sort("date", -1)]
    coms = [_strip(d) async for d in db.commitments.find({"user_id": DEMO_USER_ID}).sort("due_date", 1)]
    return accounts, txs, coms


async def _facts(lang: str = "en") -> dict:
    accounts, txs, coms = await _fetch_all()
    return build_facts(accounts, txs, coms, lang)


_seed_lock = asyncio.Lock()


async def seed_demo(reset: bool = True) -> dict:
    async with _seed_lock:  # concurrent seed calls must not double the dataset
        if reset:
            await reset_all()
        accounts, txs, coms = build_demo_dataset()
        await db.accounts.insert_many([a.model_dump() for a in accounts])
        await db.transactions.insert_many([t.model_dump() for t in txs])
        await db.commitments.insert_many([c.model_dump() for c in coms])
    return {"ok": True, "accounts": len(accounts), "transactions": len(txs), "commitments": len(coms)}


async def reset_all():
    await db.accounts.delete_many({"user_id": DEMO_USER_ID})
    await db.transactions.delete_many({"user_id": DEMO_USER_ID})
    await db.commitments.delete_many({"user_id": DEMO_USER_ID})


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Demo mode: load the synthetic dataset automatically when the database is empty.
    if await db.accounts.count_documents({"user_id": DEMO_USER_ID}) == 0:
        await seed_demo(reset=False)
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
async def list_accounts():
    return [_strip(d) async for d in db.accounts.find({"user_id": DEMO_USER_ID})]


@api.post("/accounts")
async def create_account(body: AccountCreate):
    a = Account(**body.model_dump())
    await db.accounts.insert_one(a.model_dump())
    return a.model_dump()


# ---------------------------------------------------------------------------
# transactions
# ---------------------------------------------------------------------------
@api.get("/transactions")
async def list_transactions(source: Optional[str] = None, limit: int = 500):
    facts = await _facts()
    status = facts["record_status"]
    txs = facts["transactions"]
    if source and source != "All":
        txs = [t for t in txs if t.get("source") == source]
    return [{**t, "control_status": status.get(t["id"], "explained")} for t in txs[:limit]]


@api.post("/transactions")
async def create_transaction(body: TransactionCreate):
    if not await db.accounts.find_one({"id": body.account_id, "user_id": DEMO_USER_ID}):
        raise HTTPException(404, "Account not found")
    data = body.model_dump()
    data["date"] = data.get("date") or datetime.now(timezone.utc)
    data["category"] = data["category"] if data["category"] in CATEGORIES else "Uncategorized"
    data["description"] = (data.get("description") or "").strip()
    # A record with neither category nor description cannot be attributed → unclassified.
    data["status"] = "unclassified" if data["category"] == "Uncategorized" and not data["description"] else "cleared"
    t = Transaction(**data)
    await db.transactions.insert_one(t.model_dump())
    return t.model_dump()


@api.patch("/transactions/{tx_id}")
async def update_transaction(tx_id: str, body: TransactionPatch):
    doc = await db.transactions.find_one({"id": tx_id, "user_id": DEMO_USER_ID})
    if not doc:
        raise HTTPException(404, "Transaction not found")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "category" in patch and patch["category"] not in CATEGORIES:
        raise HTTPException(422, "Unknown category")
    merged = {**doc, **patch}
    # Classifying an unclassified record (category or description) clears it.
    if merged.get("status") == "unclassified" and (merged.get("category") != "Uncategorized" or (merged.get("description") or "").strip()):
        patch["status"] = "cleared"
    await db.transactions.update_one({"id": tx_id}, {"$set": patch})
    return _strip(await db.transactions.find_one({"id": tx_id}))


@api.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str):
    res = await db.transactions.delete_one({"id": tx_id, "user_id": DEMO_USER_ID})
    if res.deleted_count == 0:
        raise HTTPException(404, "Transaction not found")
    return {"ok": True}


@api.post("/transactions/{tx_id}/suggest-category")
async def suggest_category(tx_id: str, body: LangRequest):
    doc = await db.transactions.find_one({"id": tx_id, "user_id": DEMO_USER_ID})
    if not doc:
        raise HTTPException(404, "Transaction not found")
    return await ai.suggest_category(_strip(doc), body.language)


# ---------------------------------------------------------------------------
# commitments
# ---------------------------------------------------------------------------
@api.get("/commitments")
async def list_commitments(kind: Optional[str] = None):
    q = {"user_id": DEMO_USER_ID}
    if kind:
        q["kind"] = kind
    return [_strip(d) async for d in db.commitments.find(q).sort("due_date", 1)]


@api.post("/commitments")
async def create_commitment(body: CommitmentCreate):
    c = Commitment(**body.model_dump())
    await db.commitments.insert_one(c.model_dump())
    return c.model_dump()


@api.delete("/commitments/{cid}")
async def delete_commitment(cid: str):
    res = await db.commitments.delete_one({"id": cid, "user_id": DEMO_USER_ID})
    if res.deleted_count == 0:
        raise HTTPException(404, "Commitment not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# engine read-outs
# ---------------------------------------------------------------------------
@api.get("/dashboard")
async def dashboard(lang: str = "en"):
    lang = "hi" if lang == "hi" else "en"
    facts = await _facts(lang)
    up = facts["upcoming"]
    return {
        "balances": facts["balances"],
        "coverage": facts["coverage"],
        "upcoming_week_total": up["week_total"],
        "discretionary": up["discretionary"],
        "upcoming_preview": up["week_items"][:3],
        "top_finding": facts["findings"][0] if facts["findings"] else None,
        "insights": dashboard_insights(facts, lang),
        "story": weekly_story(facts["transactions"], lang),
        "data_context": "demo_synthetic",
    }


@api.get("/control")
async def control(lang: str = "en"):
    facts = await _facts("hi" if lang == "hi" else "en")
    return {"coverage": facts["coverage"], "findings": facts["findings"]}


@api.get("/control/findings/{finding_id}")
async def finding_detail(finding_id: str, lang: str = "en"):
    facts = await _facts("hi" if lang == "hi" else "en")
    f = next((x for x in facts["findings"] if x["id"] == finding_id), None)
    if not f:
        raise HTTPException(404, "Finding not found (it may have been resolved)")
    return f


@api.post("/control/findings/{finding_id}/explain")
async def explain_finding(finding_id: str, body: LangRequest):
    facts = await _facts(body.language)
    f = next((x for x in facts["findings"] if x["id"] == finding_id), None)
    if not f:
        raise HTTPException(404, "Finding not found (it may have been resolved)")
    return await ai.explain_finding(f, facts, body.language)


@api.get("/story")
async def story(lang: str = "en"):
    facts = await _facts()
    return weekly_story(facts["transactions"], "hi" if lang == "hi" else "en")


@api.get("/facts")
async def get_facts(lang: str = "en"):
    return await _facts("hi" if lang == "hi" else "en")


# ---------------------------------------------------------------------------
# Ask ARTHA (Claude behind the server; deterministic fallback always available)
# ---------------------------------------------------------------------------
@api.post("/ask")
async def ask_artha(body: AskRequest):
    facts = await _facts(body.language)
    return await ai.ask(facts, body.question, body.language)


# ---------------------------------------------------------------------------
# demo data
# ---------------------------------------------------------------------------
@api.post("/seed")
async def seed(reset: bool = True):
    return await seed_demo(reset)


@api.post("/reset")
async def reset_data():
    await reset_all()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Razorpay (test mode / mock) — kept server-side
# ---------------------------------------------------------------------------
@api.post("/payments/order")
async def create_order(body: OrderReq):
    receipt = body.receipt or f"artha-{int(datetime.now(timezone.utc).timestamp())}"
    if RZP_CLIENT is None:
        return {"key_id": "mock_key", "order": {"id": f"mock_order_{receipt}", "amount": body.amount, "currency": body.currency, "status": "created"}, "mock": True}
    order = dict(RZP_CLIENT.order.create(data={"amount": body.amount, "currency": body.currency, "receipt": receipt[:40], "notes": {"source": "artha_test"}}))
    return {"key_id": RAZORPAY_KEY_ID, "order": order, "mock": False}


@api.get("/razorpay/status")
async def rzp_status():
    return {"mode": "test" if RZP_CLIENT else "mock"}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

