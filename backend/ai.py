"""
ARTHA AI layer (Claude Sonnet via Emergent LLM key).

Claude only *explains* facts that the deterministic engine has already computed.
It never performs financial arithmetic. Every function here degrades gracefully to a
deterministic answer when the key is missing or the call fails, so the app never
depends on Claude being available. The API key lives only in backend/.env.
"""
import logging
import os
import uuid
from typing import Optional

from engine import as_dt, deterministic_answer, inr, rule_based_category
from models import CATEGORIES

logger = logging.getLogger("artha.ai")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
MODEL = ("anthropic", "claude-sonnet-5")

try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
except Exception:  # library missing → deterministic mode only
    LlmChat = None
    UserMessage = None


def claude_available() -> bool:
    return bool(EMERGENT_LLM_KEY) and LlmChat is not None


async def _claude(system: str, prompt: str) -> Optional[str]:
    if not claude_available():
        return None
    try:
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=str(uuid.uuid4()), system_message=system).with_model(*MODEL)
        text = await chat.send_message(UserMessage(text=prompt))
        return text.strip() if text and text.strip() else None
    except Exception:
        logger.exception("Claude call failed; using deterministic fallback")
        return None


def _lang_instruction(lang: str) -> str:
    if lang == "hi":
        return ("Respond in simple, natural Hindi (Devanagari) as spoken by a normal Indian user. "
                "Avoid awkward literal translations. Keep ₹ amounts exactly as given.")
    return "Respond in clear, warm, concise English."


SYSTEM_BASE = (
    "You are ARTHA, a personal financial controller. You are NOT a source of financial truth. "
    "All numbers below were computed deterministically by ARTHA's engine — reuse them verbatim, "
    "never recalculate, never invent transactions, balances, commitments or dates. "
    "If the facts do not contain the answer, say so plainly. "
    "Use cautious wording: 'possible duplicate', 'unexplained difference', 'potential blind spot'. "
    "Never claim access to a live bank account. Be concise (3-6 short sentences), finance-controller-like. "
    "Plain text only — no markdown, no bullet symbols, no bold."
)


def facts_summary(facts: dict) -> str:
    b, cov, up = facts["balances"], facts["coverage"], facts["upcoming"]
    lines = [
        "STRUCTURED FINANCIAL FACTS (deterministic — do not recalculate):",
        f"- Recorded balance (all recorded activity): {inr(b['recorded_balance'])}",
        f"- Expected balance (explained activity only): {inr(b['expected_balance'])}",
        f"- Unexplained difference (recorded − expected): {inr(b['difference'])}",
        f"- Money in: {inr(b['money_in'])} · Money out: {inr(b['money_out'])}",
        f"- Records analyzed {cov['records_analyzed']} = explained {cov['explained']} + affected {cov['affected_records']}; "
        f"{cov['exception_findings']} findings; coverage {cov['coverage_pct']}%",
        f"- Commitments due next 7 days: {inr(up['week_total'])} · next 30 days: {inr(up['month_total'])}",
        f"- Discretionary (recorded balance − 7-day commitments): {inr(up['discretionary'])}",
        f"- I owe others: {inr(up['owed_by_me'])} · Owed to me: {inr(up['owed_to_me'])}",
        "Top spending categories: " + ", ".join(f"{c['category']} {inr(c['amount'])}" for c in b["category_totals"][:6]),
        "Accounts:",
    ]
    for a in b["accounts"]:
        lines.append(f"  * {a['name']} ({a['type']}): recorded {inr(a['recorded_balance'])}, expected {inr(a['expected_balance'])}, diff {inr(a['difference'])}")
    if facts["findings"]:
        lines.append("Findings (already detected):")
        for f in facts["findings"][:8]:
            rel = "; ".join(f"{r['description'] or 'unnamed'} {inr(r['amount'])} {as_dt(r['date']).strftime('%d %b')}" for r in f["related"][:3])
            lines.append(f"  * [{f['severity'].upper()}] {f['title']} {inr(f['amount'])} — {f['what_happened']} Related: {rel}")
    if up["all_items"]:
        lines.append("Upcoming commitments:")
        for c in up["all_items"][:8]:
            lines.append(f"  * {c['name']} {inr(c['amount'])} due {as_dt(c['due_date']).strftime('%d %b')} ({c['frequency']}, {c['kind']})")
    lines.append("Recent records (newest first):")
    for t in facts["transactions"][:12]:
        lines.append(f"  * {as_dt(t['date']).strftime('%d %b')} {t['type']} {inr(t['amount'])} · {t.get('description') or '(no description)'} · {t.get('category')} · {t.get('source')}")
    return "\n".join(lines)


async def ask(facts: dict, question: str, lang: str) -> dict:
    draft = deterministic_answer(facts, question, lang)
    prompt = (
        f"{facts_summary(facts)}\n\n"
        f"DETERMINISTIC ANSWER DRAFT (numbers are authoritative): {draft['answer']}\n\n"
        f"USER QUESTION: {question}\n\n"
        "Rewrite the draft as a natural, helpful answer to the question. Keep every number identical."
    )
    text = await _claude(SYSTEM_BASE + " " + _lang_instruction(lang), prompt)
    return {"answer": text or draft["answer"], "intent": draft["intent"], "source": "claude" if text else "deterministic"}


async def explain_finding(finding: dict, facts: dict, lang: str) -> dict:
    fallback = f"{finding['what_happened']} {finding['why_flagged']} {finding['action']}"
    rel = "\n".join(f"  * {r['description'] or '(no description)'} {inr(r['amount'])} {r['type']} on {as_dt(r['date']).strftime('%d %b')} via {r['source']} (category {r['category']})" for r in finding["related"])
    prompt = (
        f"{facts_summary(facts)}\n\nFINDING UNDER INVESTIGATION:\n"
        f"Title: {finding['title']} · severity {finding['severity']} · confidence {finding['confidence']} (heuristic)\n"
        f"What happened: {finding['what_happened']}\nWhy flagged: {finding['why_flagged']}\n"
        f"Impact: {finding['impact']}\nRecommended action: {finding['action']}\nRelated records:\n{rel}\n\n"
        "Explain this finding to the user in plain language: what it is, why it matters, and what to do next. "
        "Do not claim certainty about duplicates or that money is missing."
    )
    text = await _claude(SYSTEM_BASE + " " + _lang_instruction(lang), prompt)
    return {"explanation": text or fallback, "source": "claude" if text else "deterministic"}


async def suggest_category(tx: dict, lang: str) -> dict:
    fallback = rule_based_category(tx)
    prompt = (
        f"Transaction: description='{tx.get('description') or ''}', note='{tx.get('note') or ''}', "
        f"reference='{tx.get('reference') or ''}', amount {inr(float(tx['amount']))}, type {tx['type']}, source {tx.get('source')}.\n"
        f"Allowed categories: {', '.join(c for c in CATEGORIES if c != 'Uncategorized')}.\n"
        "Reply with exactly two lines:\nCATEGORY: <one allowed category>\nWHY: <one short sentence"
        + (" in simple Hindi>" if lang == "hi" else ">")
    )
    text = await _claude("You classify personal-finance records into one allowed category. Never invent details.", prompt)
    if text:
        cat, why = None, ""
        for line in text.splitlines():
            if line.upper().startswith("CATEGORY:"):
                cat = line.split(":", 1)[1].strip().strip(".")
            elif line.upper().startswith("WHY:"):
                why = line.split(":", 1)[1].strip()
        if cat in CATEGORIES and cat != "Uncategorized":
            return {"category": cat, "rationale": why or fallback["rationale"], "source": "claude"}
    return fallback
