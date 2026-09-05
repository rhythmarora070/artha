"""
ARTHA - AI Financial Control Layer / Personal Financial Memory
Backend: FastAPI + MongoDB + Claude (Emergent LLM Key) + Razorpay Test Mode

Architectural principle: Financial truth (arithmetic, balances, matching, blind
spot detection, coverage metrics) is deterministic. Claude only explains it.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import hashlib
import hmac
import json
import random
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta
from collections import defaultdict

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Emergent LLM chat
try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
except Exception:  # pragma: no cover
    LlmChat = None
    UserMessage = None
    TextDelta = None
    StreamDone = None

# Razorpay Test Mode (mock adapter fallback)
try:
    import razorpay
    RZP_CLIENT = (
        razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
        if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
        else None
    )
except Exception:
    RZP_CLIENT = None
RZP_MOCK = RZP_CLIENT is None

DEMO_USER_ID = "demo-user"

app = FastAPI(title="ARTHA API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("artha")


# ============================================================================
# MODELS
# ============================================================================
SourceType = Literal["Bank", "UPI", "Card", "Cash", "Razorpay", "Investment"]
TxType = Literal["paid", "received", "transfer", "refund", "fee"]
TxStatus = Literal["cleared", "pending", "duplicate", "unclassified", "flagged"]


class Account(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    name: str
    type: SourceType
    opening_balance: float = 0.0
    observed_balance: Optional[float] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AccountCreate(BaseModel):
    name: str
    type: SourceType
    opening_balance: float = 0.0
    observed_balance: Optional[float] = None


class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    account_id: str
    amount: float
    type: TxType
    category: str = "Uncategorized"
    description: str = ""
    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source: SourceType
    reference: Optional[str] = None
    status: TxStatus = "cleared"
    note: Optional[str] = None


class TransactionCreate(BaseModel):
    account_id: str
    amount: float
    type: TxType
    category: str = "Uncategorized"
    description: str = ""
    date: Optional[datetime] = None
    source: SourceType
    reference: Optional[str] = None
    note: Optional[str] = None


class Commitment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    name: str
    amount: float
    due_date: datetime
    frequency: Literal["one-time", "monthly", "weekly", "yearly"] = "monthly"
    category: str = "General"
    kind: Literal["upcoming", "recurring", "loan", "owed_by_me", "owed_to_me"] = "upcoming"
    status: Literal["pending", "paid", "overdue"] = "pending"


class CommitmentCreate(BaseModel):
    name: str
    amount: float
    due_date: datetime
    frequency: Literal["one-time", "monthly", "weekly", "yearly"] = "monthly"
    category: str = "General"
    kind: Literal["upcoming", "recurring", "loan", "owed_by_me", "owed_to_me"] = "upcoming"


class AskRequest(BaseModel):
    question: str
    language: Literal["en", "hi"] = "en"


# ============================================================================
# HELPERS
# ============================================================================
def _strip_id(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _fetch_all():
    accounts = [_strip_id(d) async for d in db.accounts.find({"user_id": DEMO_USER_ID})]
    txs = [_strip_id(d) async for d in db.transactions.find({"user_id": DEMO_USER_ID}).sort("date", -1)]
    coms = [_strip_id(d) async for d in db.commitments.find({"user_id": DEMO_USER_ID}).sort("due_date", 1)]
    return accounts, txs, coms


# ============================================================================
# DETERMINISTIC FINANCIAL ENGINE
# ============================================================================
def _tx_signed_delta(tx: dict) -> float:
    """Net effect on account balance."""
    t = tx["type"]
    amt = float(tx["amount"])
    if t in ("paid", "fee", "transfer"):
        return -amt
    if t in ("received", "refund"):
        return amt
    return 0.0


def compute_balances(accounts: list, txs: list) -> dict:
    by_acc = defaultdict(float)
    for tx in txs:
        by_acc[tx["account_id"]] += _tx_signed_delta(tx)

    tracked = 0.0
    expected = 0.0
    observed = 0.0
    per_account = []
    for a in accounts:
        opening = float(a.get("opening_balance") or 0)
        net = by_acc[a["id"]]
        this_expected = opening + net
        this_observed = a.get("observed_balance")
        per_account.append({
            "id": a["id"],
            "name": a["name"],
            "type": a["type"],
            "opening_balance": opening,
            "expected_balance": round(this_expected, 2),
            "observed_balance": this_observed,
            "difference": round((this_observed - this_expected), 2) if this_observed is not None else None,
        })
        expected += this_expected
        tracked += this_expected
        if this_observed is not None:
            observed += float(this_observed)
        else:
            observed += this_expected

    money_in = sum(float(t["amount"]) for t in txs if t["type"] in ("received", "refund"))
    money_out = sum(float(t["amount"]) for t in txs if t["type"] in ("paid", "fee", "transfer"))

    return {
        "current_balance": round(observed, 2),
        "expected_balance": round(expected, 2),
        "tracked_balance": round(tracked, 2),
        "difference": round(observed - expected, 2),
        "money_in": round(money_in, 2),
        "money_out": round(money_out, 2),
        "accounts": per_account,
    }


def detect_blind_spots(accounts: list, txs: list, balances: dict) -> list:
    """Deterministic anomaly detection. Careful language: 'potential', 'possible'."""
    spots = []
    now = datetime.now(timezone.utc)

    # 1. Balance mismatch per account
    for a in balances["accounts"]:
        diff = a.get("difference")
        if diff is not None and abs(diff) >= 100:
            severity = "high" if abs(diff) >= 3000 else "medium"
            spots.append({
                "id": f"bal-{a['id']}",
                "kind": "balance_mismatch",
                "amount": abs(diff),
                "severity": severity,
                "confidence": 0.9,
                "title": "Unexplained balance difference",
                "reason": f"Observed balance on {a['name']} differs from expected by ₹{abs(diff):,.0f}.",
                "account_id": a["id"],
                "transaction_id": None,
            })

    # 2. Duplicates: same account + amount + type within 48h
    buckets = defaultdict(list)
    for tx in txs:
        key = (tx["account_id"], round(float(tx["amount"]), 2), tx["type"])
        buckets[key].append(tx)
    for key, group in buckets.items():
        if len(group) < 2:
            continue
        group.sort(key=lambda t: t["date"])
        for i in range(1, len(group)):
            d1 = group[i - 1]["date"]
            d2 = group[i]["date"]
            if isinstance(d1, str):
                d1 = datetime.fromisoformat(d1.replace("Z", "+00:00"))
            if isinstance(d2, str):
                d2 = datetime.fromisoformat(d2.replace("Z", "+00:00"))
            if abs((d2 - d1).total_seconds()) <= 48 * 3600:
                spots.append({
                    "id": f"dup-{group[i]['id']}",
                    "kind": "possible_duplicate",
                    "amount": float(group[i]["amount"]),
                    "severity": "medium",
                    "confidence": 0.7,
                    "title": "Possible duplicate transaction",
                    "reason": f"Two similar ₹{group[i]['amount']:,.0f} {group[i]['type']} entries within 48 hours.",
                    "account_id": group[i]["account_id"],
                    "transaction_id": group[i]["id"],
                })

    # 3. Unclassified / uncategorized transactions
    for tx in txs:
        if tx.get("category") in ("Uncategorized", "", None) or tx.get("status") == "unclassified":
            if float(tx["amount"]) >= 500:  # only flag material ones
                spots.append({
                    "id": f"unc-{tx['id']}",
                    "kind": "unclassified",
                    "amount": float(tx["amount"]),
                    "severity": "low",
                    "confidence": 0.6,
                    "title": "Unclassified transaction",
                    "reason": f"₹{tx['amount']:,.0f} on {tx.get('description') or 'unnamed'} is uncategorized.",
                    "account_id": tx["account_id"],
                    "transaction_id": tx["id"],
                })

    # 4. Missing description on material outgoing
    for tx in txs:
        if not tx.get("description") and tx["type"] in ("paid", "transfer") and float(tx["amount"]) >= 1000:
            spots.append({
                "id": f"nodesc-{tx['id']}",
                "kind": "missing_description",
                "amount": float(tx["amount"]),
                "severity": "low",
                "confidence": 0.5,
                "title": "Payment with no description",
                "reason": f"₹{tx['amount']:,.0f} outgoing has no description.",
                "account_id": tx["account_id"],
                "transaction_id": tx["id"],
            })

    # de-dupe by id
    seen = set()
    unique = []
    for s in spots:
        if s["id"] in seen:
            continue
        seen.add(s["id"])
        unique.append(s)
    unique.sort(key=lambda s: ({"high": 0, "medium": 1, "low": 2}[s["severity"]], -s["amount"]))
    return unique


def compute_coverage(txs: list, spots: list) -> dict:
    total = len(txs)
    flagged_tx_ids = {s.get("transaction_id") for s in spots if s.get("transaction_id")}
    explained = total - len(flagged_tx_ids)
    high = sum(1 for s in spots if s["severity"] == "high")
    med = sum(1 for s in spots if s["severity"] == "medium")
    low = sum(1 for s in spots if s["severity"] == "low")
    coverage = (explained / total * 100.0) if total else 100.0
    return {
        "records_analyzed": total,
        "explained": explained,
        "exceptions": len(spots),
        "coverage_pct": round(coverage, 1),
        "high": high,
        "medium": med,
        "low": low,
    }


def compute_upcoming(coms: list) -> dict:
    now = datetime.now(timezone.utc)
    week = now + timedelta(days=7)
    upcoming_week = []
    upcoming_all = []
    total_week = 0.0
    for c in coms:
        due = c["due_date"]
        if isinstance(due, str):
            due = datetime.fromisoformat(due.replace("Z", "+00:00"))
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        if c["status"] == "paid":
            continue
        if c["kind"] in ("owed_to_me",):
            continue
        upcoming_all.append(c)
        if due <= week:
            upcoming_week.append(c)
            total_week += float(c["amount"])
    return {"week_total": round(total_week, 2), "week_items": upcoming_week, "all_items": upcoming_all}


async def build_facts() -> dict:
    accounts, txs, coms = await _fetch_all()
    balances = compute_balances(accounts, txs)
    spots = detect_blind_spots(accounts, txs, balances)
    coverage = compute_coverage(txs, spots)
    upcoming = compute_upcoming(coms)
    return {
        "accounts": accounts,
        "transactions": txs,
        "commitments": coms,
        "balances": balances,
        "blind_spots": spots,
        "coverage": coverage,
        "upcoming": upcoming,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================================
# API - CORE DATA
# ============================================================================
@api.get("/")
async def root():
    return {"service": "ARTHA", "ok": True}


@api.get("/accounts")
async def list_accounts():
    return [_strip_id(d) async for d in db.accounts.find({"user_id": DEMO_USER_ID})]


@api.post("/accounts")
async def create_account(body: AccountCreate):
    a = Account(**body.model_dump())
    await db.accounts.insert_one(a.model_dump())
    return a.model_dump()


@api.get("/transactions")
async def list_transactions(source: Optional[str] = None, limit: int = 500):
    q = {"user_id": DEMO_USER_ID}
    if source and source != "All":
        q["source"] = source
    cur = db.transactions.find(q).sort("date", -1).limit(limit)
    return [_strip_id(d) async for d in cur]


@api.post("/transactions")
async def create_transaction(body: TransactionCreate):
    data = body.model_dump()
    if not data.get("date"):
        data["date"] = datetime.now(timezone.utc)
    t = Transaction(**data)
    await db.transactions.insert_one(t.model_dump())
    return t.model_dump()


@api.patch("/transactions/{tx_id}")
async def update_transaction(tx_id: str, body: dict):
    body.pop("_id", None)
    body.pop("id", None)
    await db.transactions.update_one({"id": tx_id, "user_id": DEMO_USER_ID}, {"$set": body})
    doc = await db.transactions.find_one({"id": tx_id})
    return _strip_id(doc) if doc else {}


@api.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str):
    await db.transactions.delete_one({"id": tx_id, "user_id": DEMO_USER_ID})
    return {"ok": True}


@api.get("/commitments")
async def list_commitments(kind: Optional[str] = None):
    q = {"user_id": DEMO_USER_ID}
    if kind:
        q["kind"] = kind
    return [_strip_id(d) async for d in db.commitments.find(q).sort("due_date", 1)]


@api.post("/commitments")
async def create_commitment(body: CommitmentCreate):
    c = Commitment(**body.model_dump())
    await db.commitments.insert_one(c.model_dump())
    return c.model_dump()


@api.delete("/commitments/{cid}")
async def delete_commitment(cid: str):
    await db.commitments.delete_one({"id": cid, "user_id": DEMO_USER_ID})
    return {"ok": True}


# ============================================================================
# API - FINANCIAL ENGINE READOUTS
# ============================================================================
@api.get("/dashboard")
async def dashboard():
    facts = await build_facts()
    b = facts["balances"]
    cov = facts["coverage"]
    up = facts["upcoming"]
    top_spot = facts["blind_spots"][0] if facts["blind_spots"] else None
    insights = []
    if top_spot:
        insights.append(f"₹{top_spot['amount']:,.0f} is currently unexplained ({top_spot['title'].lower()}).")
    if up["week_total"] > 0:
        insights.append(f"₹{up['week_total']:,.0f} of commitments are due in the next 7 days.")
    if cov["coverage_pct"] >= 95:
        insights.append("Your financial coverage is excellent.")
    elif cov["coverage_pct"] < 80:
        insights.append("Your financial coverage is low — investigate exceptions.")
    return {
        "balances": b,
        "coverage": cov,
        "upcoming_week_total": up["week_total"],
        "upcoming_preview": up["week_items"][:3],
        "top_blind_spot": top_spot,
        "insights": insights,
    }


@api.get("/control")
async def control():
    facts = await build_facts()
    return {"coverage": facts["coverage"], "blind_spots": facts["blind_spots"]}


@api.get("/facts")
async def get_facts():
    return await build_facts()


# ============================================================================
# API - CLAUDE ASK ARTHA
# ============================================================================
def _facts_summary_for_llm(facts: dict) -> str:
    b = facts["balances"]
    cov = facts["coverage"]
    up = facts["upcoming"]
    lines = [
        "STRUCTURED FINANCIAL FACTS (computed deterministically, do not recalculate):",
        f"- Current (observed) balance: ₹{b['current_balance']:,.2f}",
        f"- Expected balance: ₹{b['expected_balance']:,.2f}",
        f"- Difference (observed − expected): ₹{b['difference']:,.2f}",
        f"- Money in (total received/refunds): ₹{b['money_in']:,.2f}",
        f"- Money out (total paid/fees/transfers): ₹{b['money_out']:,.2f}",
        f"- Records analyzed: {cov['records_analyzed']}, explained: {cov['explained']}, exceptions: {cov['exceptions']}, coverage: {cov['coverage_pct']}%",
        f"- Upcoming commitments in next 7 days total: ₹{up['week_total']:,.2f}",
    ]
    lines.append("\nAccounts:")
    for a in b["accounts"]:
        lines.append(
            f"  * {a['name']} ({a['type']}): expected ₹{a['expected_balance']:,.2f}, observed ₹{a['observed_balance'] if a['observed_balance'] is not None else 'n/a'}, diff ₹{a['difference'] if a['difference'] is not None else 'n/a'}"
        )

    if facts["blind_spots"]:
        lines.append("\nPotential blind spots (already detected deterministically):")
        for s in facts["blind_spots"][:8]:
            lines.append(f"  * [{s['severity'].upper()}] {s['title']}: ₹{s['amount']:,.0f} — {s['reason']}")

    if up["all_items"]:
        lines.append("\nUpcoming commitments:")
        for c in up["all_items"][:8]:
            due = c["due_date"]
            if isinstance(due, datetime):
                due = due.strftime("%d %b")
            lines.append(f"  * {c['name']} ₹{c['amount']:,.0f} due {due} ({c['frequency']})")

    if facts["transactions"]:
        lines.append("\nRecent transactions (most recent first, up to 15):")
        for t in facts["transactions"][:15]:
            d = t["date"]
            if isinstance(d, datetime):
                d = d.strftime("%d %b")
            desc = t.get("description") or "(no description)"
            lines.append(
                f"  * {d} {t['type']} ₹{t['amount']:,.0f} · {desc} · {t.get('category')} · {t.get('source')} · status={t.get('status')}"
            )
    return "\n".join(lines)


def _affordability_hint(facts: dict, question: str) -> Optional[str]:
    """Deterministic affordability computation for 'Can I afford X' style questions."""
    import re
    q = question.lower()
    if not any(k in q for k in ["afford", "kharch", "kar sakta", "spend", "chahiye", "chahiy"]):
        return None
    m = re.search(r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*)", q)
    if not m:
        return None
    try:
        amount = float(m.group(1).replace(",", ""))
    except Exception:
        return None
    b = facts["balances"]
    week = facts["upcoming"]["week_total"]
    discretionary = b["current_balance"] - week
    return (
        f"AFFORDABILITY COMPUTATION (deterministic): current balance ₹{b['current_balance']:,.2f} "
        f"− upcoming 7-day commitments ₹{week:,.2f} = discretionary ₹{discretionary:,.2f}. "
        f"Requested amount ₹{amount:,.2f}. "
        f"{'Within discretionary budget.' if amount <= discretionary else 'Exceeds discretionary budget.'}"
    )


@api.post("/ask")
async def ask_artha(body: AskRequest):
    facts = await build_facts()
    facts_text = _facts_summary_for_llm(facts)
    aff = _affordability_hint(facts, body.question)
    if aff:
        facts_text += "\n\n" + aff

    lang_instr = (
        "Respond in natural, warm Hindi (Devanagari script). Use simple sentences."
        if body.language == "hi"
        else "Respond in clear, warm English. Use simple sentences."
    )

    system = (
        "You are ARTHA, an AI Financial Controller. You are NOT a source of financial truth — "
        "you only explain, summarize and investigate using the STRUCTURED FINANCIAL FACTS below. "
        "NEVER invent balances, transactions, amounts or dates. If information is insufficient, say so. "
        "Use careful language like 'potential blind spot', 'possible duplicate', 'unexplained difference'. "
        "Be concise (3-6 short sentences). Use ₹ for currency. "
        f"{lang_instr}"
    )

    prompt = f"{facts_text}\n\nUSER QUESTION: {body.question}\n\nYour answer:"

    if not EMERGENT_LLM_KEY or LlmChat is None:
        # Deterministic fallback
        return {"answer": _fallback_answer(facts, body.question, body.language), "streamed": False}

    async def event_gen():
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=str(uuid.uuid4()),
            system_message=system,
        ).with_model("anthropic", "claude-sonnet-5")
        try:
            async for ev in chat.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    yield f"data: {json.dumps({'delta': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    yield f"data: {json.dumps({'done': True})}\n\n"
                    break
        except Exception as e:
            logger.exception("Claude stream failed")
            fallback = _fallback_answer(facts, body.question, body.language)
            yield f"data: {json.dumps({'delta': fallback})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _fallback_answer(facts: dict, question: str, lang: str) -> str:
    b = facts["balances"]
    up = facts["upcoming"]
    top = facts["blind_spots"][0] if facts["blind_spots"] else None
    if lang == "hi":
        parts = [
            f"आपका वर्तमान बैलेंस ₹{b['current_balance']:,.0f} है और अनुमानित बैलेंस ₹{b['expected_balance']:,.0f}।",
            f"आगामी 7 दिनों में ₹{up['week_total']:,.0f} के भुगतान निर्धारित हैं।",
        ]
        if top:
            parts.append(f"संभावित ब्लाइंड स्पॉट: {top['title']} ₹{top['amount']:,.0f}।")
        return " ".join(parts)
    parts = [
        f"Your current balance is ₹{b['current_balance']:,.0f} vs an expected ₹{b['expected_balance']:,.0f}.",
        f"You have ₹{up['week_total']:,.0f} in commitments due over the next 7 days.",
    ]
    if top:
        parts.append(f"Top potential blind spot: {top['title']} of ₹{top['amount']:,.0f} — {top['reason']}")
    return " ".join(parts)


# Non-streaming variant (used by testing / fallback UI)
@api.post("/ask_once")
async def ask_once(body: AskRequest):
    facts = await build_facts()
    facts_text = _facts_summary_for_llm(facts)
    aff = _affordability_hint(facts, body.question)
    if aff:
        facts_text += "\n\n" + aff

    lang_instr = (
        "Respond in natural, warm Hindi (Devanagari script)."
        if body.language == "hi"
        else "Respond in clear, warm English."
    )
    system = (
        "You are ARTHA, an AI Financial Controller. Never invent numbers. Use the STRUCTURED FINANCIAL FACTS only. "
        "Be concise (3-6 short sentences). Use ₹ for currency. " + lang_instr
    )
    prompt = f"{facts_text}\n\nUSER QUESTION: {body.question}\n\nYour answer:"

    if not EMERGENT_LLM_KEY or LlmChat is None:
        return {"answer": _fallback_answer(facts, body.question, body.language)}

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=str(uuid.uuid4()),
            system_message=system,
        ).with_model("anthropic", "claude-sonnet-5")
        text = ""
        async for ev in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(ev, TextDelta):
                text += ev.content
            elif isinstance(ev, StreamDone):
                break
        return {"answer": text or _fallback_answer(facts, body.question, body.language)}
    except Exception:
        logger.exception("Claude failed")
        return {"answer": _fallback_answer(facts, body.question, body.language)}


# ============================================================================
# API - SYNTHETIC DATA / SEED
# ============================================================================
@api.post("/seed")
async def seed(reset: bool = True):
    if reset:
        await db.accounts.delete_many({"user_id": DEMO_USER_ID})
        await db.transactions.delete_many({"user_id": DEMO_USER_ID})
        await db.commitments.delete_many({"user_id": DEMO_USER_ID})

    random.seed(42)
    now = datetime.now(timezone.utc)

    # Accounts
    accounts_data = [
        {"name": "HDFC Savings", "type": "Bank", "opening_balance": 25000.0, "observed_balance": None},
        {"name": "SBI Savings", "type": "Bank", "opening_balance": 15000.0, "observed_balance": None},
        {"name": "PhonePe UPI", "type": "UPI", "opening_balance": 0.0, "observed_balance": None},
        {"name": "HDFC Credit Card", "type": "Card", "opening_balance": 0.0, "observed_balance": None},
        {"name": "Cash Wallet", "type": "Cash", "opening_balance": 2000.0, "observed_balance": None},
        {"name": "Razorpay Test", "type": "Razorpay", "opening_balance": 0.0, "observed_balance": None},
    ]
    accounts = [Account(**a) for a in accounts_data]
    for a in accounts:
        await db.accounts.insert_one(a.model_dump())

    hdfc = accounts[0].id
    sbi = accounts[1].id
    phonepe = accounts[2].id
    ccard = accounts[3].id
    cash = accounts[4].id
    rzp = accounts[5].id

    categories_food = ["Food", "Groceries", "Dining"]
    categories_transport = ["Transport", "Fuel", "Cab"]
    categories_personal = ["Personal", "Shopping", "Entertainment"]
    categories_bills = ["Bills", "Utilities", "Subscription"]

    def d(offset_days: int, hour: int = 12) -> datetime:
        return (now - timedelta(days=offset_days)).replace(hour=hour, minute=random.randint(0, 59))

    txs: List[Transaction] = []

    def add(**k):
        txs.append(Transaction(**k))

    # Salary/income
    add(account_id=hdfc, amount=45000, type="received", category="Salary", description="Monthly salary",
        date=d(28), source="Bank", reference="SAL-AUG")
    add(account_id=sbi, amount=8000, type="received", category="Freelance", description="Freelance payment",
        date=d(22), source="Bank")

    # Food / groceries
    for i in range(14):
        add(account_id=phonepe, amount=random.choice([120, 180, 250, 320, 450]),
            type="paid", category=random.choice(categories_food),
            description=random.choice(["Zomato order", "Swiggy dinner", "Blinkit groceries", "Chai with friends", "Local dhaba"]),
            date=d(random.randint(1, 27)), source="UPI")

    # Transport
    for i in range(8):
        add(account_id=phonepe, amount=random.choice([80, 120, 200, 300]),
            type="paid", category=random.choice(categories_transport),
            description=random.choice(["Uber ride", "Metro top-up", "Auto fare", "Fuel"]),
            date=d(random.randint(1, 27)), source="UPI")

    # Shopping
    for i in range(6):
        add(account_id=ccard, amount=random.choice([699, 1299, 2499, 3200, 4500]),
            type="paid", category=random.choice(categories_personal),
            description=random.choice(["Amazon order", "Myntra shopping", "Bookstore", "Gift for Priya"]),
            date=d(random.randint(2, 27)), source="Card")

    # Bills
    add(account_id=hdfc, amount=999, type="paid", category="Subscription",
        description="Netflix", date=d(10), source="Bank", reference="NETFLIX")
    add(account_id=hdfc, amount=1499, type="paid", category="Bills",
        description="Electricity bill", date=d(15), source="Bank")
    add(account_id=phonepe, amount=299, type="paid", category="Subscription",
        description="Spotify", date=d(12), source="UPI")

    # Cash
    for i in range(5):
        add(account_id=cash, amount=random.choice([50, 100, 150, 200]),
            type="paid", category="Food",
            description=random.choice(["Tea stall", "Vada pav", "Auto tip", "Snacks"]),
            date=d(random.randint(1, 20)), source="Cash")

    # Refund
    add(account_id=ccard, amount=1299, type="refund", category="Shopping",
        description="Myntra return", date=d(8), source="Card", reference="RFND-M1")

    # Fee
    add(account_id=hdfc, amount=118, type="fee", category="Bank Fee",
        description="ATM withdrawal fee", date=d(18), source="Bank")

    # Razorpay test-mode transactions
    add(account_id=rzp, amount=500, type="received", category="Income",
        description="Test payment order_1", date=d(5), source="Razorpay", reference="rzp_test_1")
    add(account_id=rzp, amount=1500, type="received", category="Income",
        description="Test payment order_2", date=d(3), source="Razorpay", reference="rzp_test_2")

    # Investments (transfer out)
    add(account_id=hdfc, amount=5000, type="transfer", category="Investment",
        description="SIP - HDFC Mutual Fund", date=d(20), source="Bank", reference="SIP-01")

    # ---- Planted anomalies ----
    # 1. THE ₹5,000 forgotten bank transfer (demo story!)
    add(account_id=hdfc, amount=5000, type="paid", category="Uncategorized",
        description="", date=d(6), source="Bank", reference="", status="unclassified")

    # 2. Duplicate transaction
    dup_date = d(9)
    add(account_id=phonepe, amount=899, type="paid", category="Shopping",
        description="Amazon Pay", date=dup_date, source="UPI", reference="AMZ-D1")
    add(account_id=phonepe, amount=899, type="paid", category="Shopping",
        description="Amazon Pay", date=dup_date + timedelta(minutes=3), source="UPI", reference="AMZ-D1")

    # 3. Unexpected fee
    add(account_id=ccard, amount=350, type="fee", category="Uncategorized",
        description="", date=d(14), source="Card")

    # 4. Unclassified large payment
    add(account_id=hdfc, amount=1240, type="paid", category="Uncategorized",
        description="Payment to XYZ", date=d(11), source="Bank", status="unclassified")

    # Fill to reach >=100 records with more mundane ones
    while len(txs) < 105:
        add(account_id=random.choice([phonepe, hdfc, cash, ccard]),
            amount=random.choice([45, 60, 80, 120, 240, 380]),
            type="paid",
            category=random.choice(categories_food + categories_transport),
            description=random.choice(["Coffee", "Local shop", "Metro", "Grocery run", "Bus fare"]),
            date=d(random.randint(1, 29)),
            source=random.choice(["UPI", "Bank", "Cash", "Card"]))

    for t in txs:
        await db.transactions.insert_one(t.model_dump())

    # Now compute expected balances and set observed_balance with the "forgotten" ₹5,000 gap on HDFC
    all_accs = [_strip_id(d) async for d in db.accounts.find({"user_id": DEMO_USER_ID})]
    all_txs = [_strip_id(d) async for d in db.transactions.find({"user_id": DEMO_USER_ID})]
    bal = compute_balances(all_accs, all_txs)
    for a in bal["accounts"]:
        expected = a["expected_balance"]
        # Plant the demo mystery: HDFC observed is ₹5,000 LESS than expected
        # (user's bank shows less than ARTHA's records predict — there's an
        # unrecorded or misrecorded event). Everything else matches cleanly.
        if a["id"] == hdfc:
            observed = round(expected - 5000, 2)
        else:
            observed = round(expected, 2)
        await db.accounts.update_one({"id": a["id"]}, {"$set": {"observed_balance": observed}})

    # Commitments
    coms = [
        Commitment(name="Rent", amount=12000, due_date=now + timedelta(days=5),
                   frequency="monthly", category="Housing", kind="upcoming"),
        Commitment(name="Laptop EMI", amount=4200, due_date=now + timedelta(days=10),
                   frequency="monthly", category="EMI", kind="loan"),
        Commitment(name="Netflix", amount=999, due_date=now + timedelta(days=18),
                   frequency="monthly", category="Subscription", kind="recurring"),
        Commitment(name="Spotify", amount=299, due_date=now + timedelta(days=14),
                   frequency="monthly", category="Subscription", kind="recurring"),
        Commitment(name="Gym membership", amount=1500, due_date=now + timedelta(days=22),
                   frequency="monthly", category="Health", kind="recurring"),
        Commitment(name="Rahul (dinner split)", amount=350, due_date=now + timedelta(days=3),
                   frequency="one-time", category="Personal", kind="owed_to_me"),
        Commitment(name="Mom (borrowed)", amount=2000, due_date=now + timedelta(days=30),
                   frequency="one-time", category="Personal", kind="owed_by_me"),
    ]
    for c in coms:
        await db.commitments.insert_one(c.model_dump())

    return {"ok": True, "accounts": len(accounts), "transactions": len(txs), "commitments": len(coms)}


@api.post("/reset")
async def reset_data():
    await db.accounts.delete_many({"user_id": DEMO_USER_ID})
    await db.transactions.delete_many({"user_id": DEMO_USER_ID})
    await db.commitments.delete_many({"user_id": DEMO_USER_ID})
    return {"ok": True}


# ============================================================================
# API - RAZORPAY
# ============================================================================
class OrderReq(BaseModel):
    amount: int  # paise
    currency: str = "INR"
    receipt: Optional[str] = None


@api.post("/payments/order")
async def create_order(body: OrderReq):
    receipt = body.receipt or f"artha-{int(datetime.now(timezone.utc).timestamp())}"
    if RZP_MOCK:
        order = {
            "id": f"mock_order_{receipt}",
            "amount": body.amount,
            "currency": body.currency,
            "status": "created",
        }
        return {"key_id": "mock_key", "order": order, "mock": True}
    order = dict(RZP_CLIENT.order.create(data={
        "amount": body.amount, "currency": body.currency, "receipt": receipt[:40],
        "notes": {"source": "artha_test"},
    }))
    return {"key_id": RAZORPAY_KEY_ID, "order": order, "mock": False}


@api.get("/razorpay/status")
async def rzp_status():
    return {"mode": "mock" if RZP_MOCK else "test"}


# ============================================================================
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def _shutdown():
    client.close()
