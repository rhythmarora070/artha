"""
ARTHA Deterministic Financial Control Engine.

Every financial number the product shows comes from this module:
balances, money in/out, unexplained difference, record-level control status,
coverage, exception findings, commitments, discretionary amount, affordability,
category totals and the weekly story. No LLM is involved anywhere in this file.

Terminology
-----------
recorded balance   = opening balance + net of ALL recorded transactions
expected balance   = opening balance + net of EXPLAINED transactions
                     (records that are not "unclassified")
unexplained diff   = recorded - expected  (= net effect of unclassified records)

Record-level control status (each record gets exactly ONE):
  explained  - no findings touch the record
  warning    - only low-severity findings touch the record
  exception  - at least one medium/high-severity finding touches the record

Coverage invariant:  explained + affected_records == records_analyzed
                     affected_records = warning + exception records
A record may appear in several findings but is only counted once.
"""
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
DUPLICATE_WINDOW_H = 48
MATERIAL_FEE = 200
MATERIAL_NO_DESC = 1000


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def as_dt(v) -> datetime:
    if isinstance(v, str):
        v = datetime.fromisoformat(v.replace("Z", "+00:00"))
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v


def inr(n: float) -> str:
    n = round(float(n))
    s = f"{abs(n):,}"
    # Indian grouping (12,34,567)
    if abs(n) >= 100000:
        digits = str(abs(n))
        last3 = digits[-3:]
        rest = digits[:-3]
        parts = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        s = ",".join(parts + [last3])
    return f"{'-' if n < 0 else ''}₹{s}"


def signed_delta(tx: dict) -> float:
    t = tx["type"]
    amt = float(tx["amount"])
    if t in ("paid", "fee", "transfer"):
        return -amt
    if t in ("received", "refund"):
        return amt
    return 0.0


def is_unclassified(tx: dict) -> bool:
    return tx.get("status") == "unclassified"


def is_uncategorized(tx: dict) -> bool:
    return (tx.get("category") or "Uncategorized") == "Uncategorized"


def tx_brief(tx: dict) -> dict:
    return {
        "id": tx["id"],
        "date": as_dt(tx["date"]).isoformat(),
        "description": tx.get("description") or "",
        "amount": float(tx["amount"]),
        "type": tx["type"],
        "category": tx.get("category") or "Uncategorized",
        "source": tx.get("source"),
        "status": tx.get("status", "cleared"),
        "reference": tx.get("reference") or "",
    }


# ---------------------------------------------------------------------------
# balances
# ---------------------------------------------------------------------------
def compute_balances(accounts: list, txs: list) -> dict:
    net_all = defaultdict(float)
    net_explained = defaultdict(float)
    unclassified_count = defaultdict(int)
    for tx in txs:
        d = signed_delta(tx)
        net_all[tx["account_id"]] += d
        if is_unclassified(tx):
            unclassified_count[tx["account_id"]] += 1
        else:
            net_explained[tx["account_id"]] += d

    per_account = []
    recorded = expected = 0.0
    for a in accounts:
        opening = float(a.get("opening_balance") or 0)
        rec = opening + net_all[a["id"]]
        exp = opening + net_explained[a["id"]]
        per_account.append({
            "id": a["id"],
            "name": a["name"],
            "type": a["type"],
            "opening_balance": opening,
            "recorded_balance": round(rec, 2),
            "expected_balance": round(exp, 2),
            "difference": round(rec - exp, 2),
            "unclassified_count": unclassified_count[a["id"]],
        })
        recorded += rec
        expected += exp

    # Category "Transfer" = movement between the user's own accounts; excluded from
    # money in/out so internal moves are not counted as spending or income.
    external = [t for t in txs if (t.get("category") or "") != "Transfer"]
    money_in = sum(float(t["amount"]) for t in external if t["type"] in ("received", "refund"))
    money_out = sum(float(t["amount"]) for t in external if t["type"] in ("paid", "fee", "transfer"))
    internal_transfers = sum(float(t["amount"]) for t in txs if (t.get("category") or "") == "Transfer" and t["type"] in ("paid", "transfer"))

    cat_out = defaultdict(float)
    for t in external:
        if t["type"] in ("paid", "fee", "transfer"):
            cat_out[t.get("category") or "Uncategorized"] += float(t["amount"])
    category_totals = sorted(
        ({"category": k, "amount": round(v, 2)} for k, v in cat_out.items()),
        key=lambda x: -x["amount"],
    )

    return {
        "recorded_balance": round(recorded, 2),
        "expected_balance": round(expected, 2),
        "difference": round(recorded - expected, 2),
        "money_in": round(money_in, 2),
        "money_out": round(money_out, 2),
        "internal_transfers": round(internal_transfers, 2),
        "accounts": per_account,
        "category_totals": category_totals,
    }


# ---------------------------------------------------------------------------
# findings (exception findings) — deliberately cautious language
# ---------------------------------------------------------------------------
TEXT = {
    "unexplained_difference": {
        "en": {
            "title": "Unexplained balance difference",
            "what": "Recorded balance on {account} is {diff_abs} {direction} than the expected balance.",
            "why": "{n} unclassified record(s) totalling {diff_abs} have no category or description, so ARTHA cannot explain what this money was for.",
            "impact": "Expected {expected} vs recorded {recorded}. Until classified, {diff_abs} of activity is a potential financial blind spot.",
            "action": "Open the related record(s), add what they were for, and pick a category. The difference will clear automatically.",
        },
        "hi": {
            "title": "बैलेंस में अस्पष्ट अंतर",
            "what": "{account} का दर्ज बैलेंस अनुमानित बैलेंस से {diff_abs} {direction} है।",
            "why": "{n} अवर्गीकृत रिकॉर्ड (कुल {diff_abs}) में कोई श्रेणी या विवरण नहीं है, इसलिए ARTHA नहीं बता सकता कि यह पैसा किस लिए था।",
            "impact": "अनुमानित {expected} बनाम दर्ज {recorded}। वर्गीकृत होने तक {diff_abs} की गतिविधि एक संभावित ब्लाइंड स्पॉट है।",
            "action": "संबंधित रिकॉर्ड खोलें, बताएं कि यह किस लिए था, और श्रेणी चुनें। अंतर अपने आप ठीक हो जाएगा।",
        },
    },
    "possible_duplicate": {
        "en": {
            "title": "Possible duplicate",
            "what": "{n} similar records of {each} ({type}) on {account} within {hours} hours.",
            "why": "Same account, same amount and same direction close together. This may be a genuine repeat purchase — ARTHA cannot confirm it is a duplicate.",
            "impact": "If one copy is wrong, {each} of money out is overstated.",
            "action": "Compare the records. Keep both if the purchase really happened twice, otherwise remove the extra copy.",
        },
        "hi": {
            "title": "संभावित डुप्लिकेट",
            "what": "{account} पर {hours} घंटे के भीतर {each} ({type}) के {n} समान रिकॉर्ड।",
            "why": "एक ही खाता, एक ही राशि और एक ही दिशा, कम समय में। यह वास्तविक दोहराई गई खरीद भी हो सकती है — ARTHA इसकी पुष्टि नहीं कर सकता।",
            "impact": "अगर एक प्रति गलत है, तो खर्च {each} ज़्यादा दिख रहा है।",
            "action": "रिकॉर्ड की तुलना करें। अगर खरीद सच में दो बार हुई तो दोनों रखें, नहीं तो अतिरिक्त प्रति हटाएँ।",
        },
    },
    "unexpected_fee": {
        "en": {
            "title": "Fee needs review",
            "what": "A fee of {amount} was charged on {account}{desc}.",
            "why": "Fees without a clear description are a common source of silent money leaks.",
            "impact": "{amount} left your money without an explained reason.",
            "action": "Check the statement for this fee. Mark it as reviewed if it is legitimate, or dispute it.",
        },
        "hi": {
            "title": "शुल्क की जाँच ज़रूरी",
            "what": "{account} पर {amount} का शुल्क लगा{desc}।",
            "why": "बिना स्पष्ट विवरण वाले शुल्क अक्सर चुपचाप पैसे कटने का कारण होते हैं।",
            "impact": "{amount} बिना स्पष्ट कारण के आपके खाते से गए।",
            "action": "स्टेटमेंट में यह शुल्क जाँचें। सही हो तो 'जाँचा गया' चिह्नित करें, नहीं तो विवाद दर्ज करें।",
        },
    },
    "uncategorized": {
        "en": {
            "title": "Uncategorized payment",
            "what": "{amount} for \"{desc}\" has no category.",
            "why": "Without a category ARTHA cannot include this in spending analysis or budgets.",
            "impact": "Category totals understate one of your categories by {amount}.",
            "action": "Pick a category — ARTHA can suggest one.",
        },
        "hi": {
            "title": "अवर्गीकृत भुगतान",
            "what": "\"{desc}\" के लिए {amount} की कोई श्रेणी नहीं है।",
            "why": "बिना श्रेणी के ARTHA इसे खर्च विश्लेषण या बजट में शामिल नहीं कर सकता।",
            "impact": "आपकी किसी एक श्रेणी का कुल {amount} कम दिख रहा है।",
            "action": "एक श्रेणी चुनें — ARTHA सुझाव दे सकता है।",
        },
    },
    "missing_description": {
        "en": {
            "title": "Payment without description",
            "what": "{amount} ({type}) on {account} has no description.",
            "why": "Material outgoing money should say what it was for so it can be recalled later.",
            "impact": "{amount} is categorised but its purpose is not recorded.",
            "action": "Add a short note about what this payment was for.",
        },
        "hi": {
            "title": "बिना विवरण का भुगतान",
            "what": "{account} पर {amount} ({type}) का कोई विवरण नहीं है।",
            "why": "बड़े खर्च का उद्देश्य दर्ज होना चाहिए ताकि बाद में याद रहे।",
            "impact": "{amount} की श्रेणी है, पर उद्देश्य दर्ज नहीं है।",
            "action": "इस भुगतान के बारे में एक छोटी टिप्पणी जोड़ें।",
        },
    },
}

TX_TYPE_LABEL = {
    "en": {"paid": "paid", "received": "received", "transfer": "transfer", "refund": "refund", "fee": "fee"},
    "hi": {"paid": "भुगतान", "received": "प्राप्त", "transfer": "ट्रांसफर", "refund": "रिफंड", "fee": "शुल्क"},
}


def _severity_for_amount(amount: float) -> str:
    if amount >= 3000:
        return "high"
    if amount >= 500:
        return "medium"
    return "low"


def detect_findings(accounts: list, txs: list, balances: dict) -> list:
    """Return exception findings. Each finding references 1..n transaction ids."""
    acc_name = {a["id"]: a["name"] for a in accounts}
    findings = []

    # 1. Unexplained balance difference (one finding per account, linked to its unclassified records)
    for a in balances["accounts"]:
        related = [t for t in txs if t["account_id"] == a["id"] and is_unclassified(t)]
        if not related or abs(a["difference"]) < 1:
            continue
        diff = a["difference"]
        findings.append({
            "id": f"diff-{a['id']}",
            "kind": "unexplained_difference",
            "severity": _severity_for_amount(abs(diff)),
            "confidence": "high",
            "amount": round(abs(diff), 2),
            "account_id": a["id"],
            "account_name": a["name"],
            "transaction_ids": [t["id"] for t in related],
            "params": {
                "account": a["name"],
                "diff_abs": inr(abs(diff)),
                "direction": diff < 0,
                "n": len(related),
                "expected": inr(a["expected_balance"]),
                "recorded": inr(a["recorded_balance"]),
            },
        })

    # 2. Possible duplicates: same account + amount + type within 48h → ONE finding per group
    buckets = defaultdict(list)
    for tx in txs:
        if tx.get("review") == "not_duplicate":
            continue
        buckets[(tx["account_id"], round(float(tx["amount"]), 2), tx["type"])].append(tx)
    for (acc_id, amount, ttype), group in buckets.items():
        if len(group) < 2:
            continue
        group.sort(key=lambda t: as_dt(t["date"]))
        cluster = [group[0]]
        clusters = []
        for t in group[1:]:
            if (as_dt(t["date"]) - as_dt(cluster[-1]["date"])).total_seconds() <= DUPLICATE_WINDOW_H * 3600:
                cluster.append(t)
            else:
                if len(cluster) > 1:
                    clusters.append(cluster)
                cluster = [t]
        if len(cluster) > 1:
            clusters.append(cluster)
        for c in clusters:
            span_h = max(1, round((as_dt(c[-1]["date"]) - as_dt(c[0]["date"])).total_seconds() / 3600))
            same_desc = len({(t.get("description") or "").strip().lower() for t in c}) == 1
            same_ref = len({t.get("reference") or "" for t in c}) == 1 and bool(c[0].get("reference"))
            findings.append({
                "id": "dup-" + "-".join(sorted(t["id"][:8] for t in c)),
                "kind": "possible_duplicate",
                "severity": "medium",
                "confidence": "high" if (same_desc and (same_ref or span_h <= 1)) else "medium",
                "amount": round(amount * len(c), 2),
                "account_id": acc_id,
                "account_name": acc_name.get(acc_id, ""),
                "transaction_ids": [t["id"] for t in c],
                "params": {"n": len(c), "each": inr(amount), "type": ttype, "account": acc_name.get(acc_id, ""), "hours": span_h},
            })

    for tx in txs:
        if tx.get("review") == "accepted" or is_unclassified(tx):
            continue
        amt = float(tx["amount"])
        desc = (tx.get("description") or "").strip()
        # 3. Fees that are material or unexplained
        if tx["type"] == "fee" and (amt >= MATERIAL_FEE or not desc):
            findings.append({
                "id": f"fee-{tx['id']}",
                "kind": "unexpected_fee",
                "severity": "medium" if amt >= MATERIAL_FEE else "low",
                "confidence": "medium",
                "amount": amt,
                "account_id": tx["account_id"],
                "account_name": acc_name.get(tx["account_id"], ""),
                "transaction_ids": [tx["id"]],
                "params": {"amount": inr(amt), "account": acc_name.get(tx["account_id"], ""), "desc": desc},
            })
        # 4. Uncategorized but attributable (has description)
        if is_uncategorized(tx) and desc:
            findings.append({
                "id": f"uncat-{tx['id']}",
                "kind": "uncategorized",
                "severity": "low",
                "confidence": "high",
                "amount": amt,
                "account_id": tx["account_id"],
                "account_name": acc_name.get(tx["account_id"], ""),
                "transaction_ids": [tx["id"]],
                "params": {"amount": inr(amt), "desc": desc},
            })
        # 5. Material outgoing money without any description
        if not desc and tx["type"] in ("paid", "transfer") and amt >= MATERIAL_NO_DESC:
            findings.append({
                "id": f"nodesc-{tx['id']}",
                "kind": "missing_description",
                "severity": "low",
                "confidence": "medium",
                "amount": amt,
                "account_id": tx["account_id"],
                "account_name": acc_name.get(tx["account_id"], ""),
                "transaction_ids": [tx["id"]],
                "params": {"amount": inr(amt), "type": tx["type"], "account": acc_name.get(tx["account_id"], "")},
            })

    findings.sort(key=lambda f: (SEVERITY_RANK[f["severity"]], -f["amount"]))
    return findings


def render_finding(f: dict, txs_by_id: dict, lang: str) -> dict:
    """Attach language-specific text and related records to a finding."""
    tpl = TEXT[f["kind"]][lang]
    p = dict(f["params"])
    if f["kind"] == "unexplained_difference":
        p["direction"] = ("lower" if p["direction"] else "higher") if lang == "en" else ("कम" if p["direction"] else "ज़्यादा")
    if "type" in p:
        p["type"] = TX_TYPE_LABEL[lang].get(p["type"], p["type"])
    if f["kind"] == "unexpected_fee":
        d = p.get("desc")
        p["desc"] = (f' for "{d}"' if lang == "en" else f' ("{d}")') if d else ""
    out = {k: v for k, v in f.items() if k != "params"}
    out.update({
        "title": tpl["title"],
        "what_happened": tpl["what"].format(**p),
        "why_flagged": tpl["why"].format(**p),
        "impact": tpl["impact"].format(**p),
        "action": tpl["action"].format(**p),
        "related": [tx_brief(txs_by_id[i]) for i in f["transaction_ids"] if i in txs_by_id],
    })
    out["reason"] = out["what_happened"]
    return out


# ---------------------------------------------------------------------------
# record-level control status + coverage
# ---------------------------------------------------------------------------
def classify_records(txs: list, findings: list) -> dict:
    worst: dict = {}
    for f in findings:
        for tid in f["transaction_ids"]:
            cur = worst.get(tid)
            if cur is None or SEVERITY_RANK[f["severity"]] < SEVERITY_RANK[cur]:
                worst[tid] = f["severity"]
    status = {}
    for t in txs:
        sev = worst.get(t["id"])
        status[t["id"]] = "explained" if sev is None else ("warning" if sev == "low" else "exception")
    return status


def compute_coverage(txs: list, findings: list, record_status: dict) -> dict:
    total = len(txs)
    explained = sum(1 for s in record_status.values() if s == "explained")
    warning = sum(1 for s in record_status.values() if s == "warning")
    exception = sum(1 for s in record_status.values() if s == "exception")
    affected = warning + exception
    assert explained + affected == total, "coverage invariant violated"
    return {
        "records_analyzed": total,
        "explained": explained,
        "affected_records": affected,
        "warning_records": warning,
        "exception_records": exception,
        "exception_findings": len(findings),
        "coverage_pct": round(explained / total * 100.0, 1) if total else 100.0,
        "high": sum(1 for f in findings if f["severity"] == "high"),
        "medium": sum(1 for f in findings if f["severity"] == "medium"),
        "low": sum(1 for f in findings if f["severity"] == "low"),
    }


# ---------------------------------------------------------------------------
# commitments / affordability
# ---------------------------------------------------------------------------
def compute_upcoming(coms: list, recorded_balance: float) -> dict:
    now = datetime.now(timezone.utc)
    week = now + timedelta(days=7)
    month = now + timedelta(days=30)
    week_items, all_items = [], []
    week_total = month_total = owed_by_me = owed_to_me = 0.0
    for c in coms:
        if c["status"] == "paid":
            continue
        amt = float(c["amount"])
        if c["kind"] == "owed_to_me":
            owed_to_me += amt
            continue
        if c["kind"] == "owed_by_me":
            owed_by_me += amt
        due = as_dt(c["due_date"])
        all_items.append(c)
        if due <= week:
            week_items.append(c)
            week_total += amt
        if due <= month:
            month_total += amt
    return {
        "week_total": round(week_total, 2),
        "month_total": round(month_total, 2),
        "owed_by_me": round(owed_by_me, 2),
        "owed_to_me": round(owed_to_me, 2),
        "discretionary": round(recorded_balance - week_total, 2),
        "week_items": week_items,
        "all_items": all_items,
    }


def affordability(facts: dict, amount: float) -> dict:
    up = facts["upcoming"]
    b = facts["balances"]
    disc = up["discretionary"]
    return {
        "amount": amount,
        "recorded_balance": b["recorded_balance"],
        "week_commitments": up["week_total"],
        "discretionary": disc,
        "remaining_after": round(disc - amount, 2),
        "affordable": amount <= disc,
    }


def extract_amount(question: str) -> Optional[float]:
    m = re.search(r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)", question.lower())
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# weekly story
# ---------------------------------------------------------------------------
WEEK_LABELS = {
    "en": ["This week", "Last week", "2 weeks ago", "3 weeks ago"],
    "hi": ["इस हफ़्ते", "पिछले हफ़्ते", "2 हफ़्ते पहले", "3 हफ़्ते पहले"],
}


def weekly_story(txs: list, lang: str) -> list:
    now = datetime.now(timezone.utc)
    weeks = []
    for i in range(4):
        end = now - timedelta(days=7 * i)
        start = end - timedelta(days=7)
        items = [t for t in txs if start < as_dt(t["date"]) <= end]
        outs = [t for t in items if t["type"] in ("paid", "fee", "transfer")]
        ins = [t for t in items if t["type"] in ("received", "refund")]
        money_out = sum(float(t["amount"]) for t in outs)
        money_in = sum(float(t["amount"]) for t in ins)
        cats = defaultdict(float)
        for t in outs:
            cats[t.get("category") or "Uncategorized"] += float(t["amount"])
        top_cat = max(cats.items(), key=lambda kv: kv[1]) if cats else None
        biggest = max(outs, key=lambda t: float(t["amount"])) if outs else None
        label = WEEK_LABELS[lang][i]
        if not items:
            narrative = "No recorded activity." if lang == "en" else "कोई दर्ज गतिविधि नहीं।"
        elif lang == "en":
            narrative = f"{label} you spent {inr(money_out)} across {len(outs)} records"
            if top_cat:
                narrative += f", mostly on {top_cat[0]} ({inr(top_cat[1])})"
            narrative += "."
            if biggest:
                narrative += f" Biggest: {biggest.get('description') or 'unnamed payment'} {inr(float(biggest['amount']))}."
            if money_in:
                narrative += f" Money in: {inr(money_in)}."
        else:
            narrative = f"{label} आपने {len(outs)} लेन-देन में {inr(money_out)} खर्च किए"
            if top_cat:
                narrative += f", सबसे ज़्यादा {top_cat[0]} पर ({inr(top_cat[1])})"
            narrative += "।"
            if biggest:
                narrative += f" सबसे बड़ा खर्च: {biggest.get('description') or 'बिना नाम'} {inr(float(biggest['amount']))}।"
            if money_in:
                narrative += f" आमदनी: {inr(money_in)}।"
        weeks.append({
            "label": label,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "money_in": round(money_in, 2),
            "money_out": round(money_out, 2),
            "net": round(money_in - money_out, 2),
            "records": len(items),
            "top_category": top_cat[0] if top_cat else None,
            "top_category_amount": round(top_cat[1], 2) if top_cat else 0,
            "biggest": tx_brief(biggest) if biggest else None,
            "narrative": narrative,
        })
    return weeks


# ---------------------------------------------------------------------------
# facts bundle
# ---------------------------------------------------------------------------
def build_facts(accounts: list, txs: list, coms: list, lang: str = "en") -> dict:
    balances = compute_balances(accounts, txs)
    raw_findings = detect_findings(accounts, txs, balances)
    record_status = classify_records(txs, raw_findings)
    coverage = compute_coverage(txs, raw_findings, record_status)
    txs_by_id = {t["id"]: t for t in txs}
    findings = [render_finding(f, txs_by_id, lang) for f in raw_findings]
    upcoming = compute_upcoming(coms, balances["recorded_balance"])
    return {
        "accounts": accounts,
        "transactions": txs,
        "commitments": coms,
        "balances": balances,
        "findings": findings,
        "record_status": record_status,
        "coverage": coverage,
        "upcoming": upcoming,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def dashboard_insights(facts: dict, lang: str) -> list:
    b, cov, up = facts["balances"], facts["coverage"], facts["upcoming"]
    top = facts["findings"][0] if facts["findings"] else None
    out = []
    if lang == "hi":
        if top:
            out.append(f"{inr(top['amount'])} की गतिविधि अभी अस्पष्ट है ({top['title']})।")
        if up["week_total"] > 0:
            out.append(f"अगले 7 दिनों में {inr(up['week_total'])} के भुगतान देय हैं।")
        if cov["coverage_pct"] >= 95:
            out.append("आपकी वित्तीय कवरेज उत्कृष्ट है।")
        elif cov["coverage_pct"] < 80:
            out.append("वित्तीय कवरेज कम है — अपवादों की जाँच करें।")
        return out
    if top:
        out.append(f"{inr(top['amount'])} of activity is currently unexplained ({top['title'].lower()}).")
    if up["week_total"] > 0:
        out.append(f"{inr(up['week_total'])} of commitments are due in the next 7 days.")
    if cov["coverage_pct"] >= 95:
        out.append("Your financial coverage is excellent.")
    elif cov["coverage_pct"] < 80:
        out.append("Your financial coverage is low — investigate the exceptions.")
    return out


# ---------------------------------------------------------------------------
# deterministic answers for Ask ARTHA (used as fallback AND as Claude's draft)
# ---------------------------------------------------------------------------
def _due_label(c: dict, lang: str) -> str:
    d = as_dt(c["due_date"])
    return d.strftime("%d %b")


def deterministic_answer(facts: dict, question: str, lang: str) -> dict:
    """Return {intent, answer}. Every number comes from facts."""
    q = question.lower()
    b, up, cov = facts["balances"], facts["upcoming"], facts["coverage"]
    findings = facts["findings"]
    hi = lang == "hi"
    amount = extract_amount(question)

    def has(*keys):
        return any(k in q for k in keys)

    # 1. affordability
    if amount and has("afford", "kharch", "spend", "खर्च", "buy", "खरीद"):
        a = affordability(facts, amount)
        if hi:
            verdict = "हाँ, यह आपके विवेकाधीन बजट में है।" if a["affordable"] else "सावधान — यह आपके विवेकाधीन बजट से ज़्यादा है।"
            ans = (f"दर्ज बैलेंस {inr(a['recorded_balance'])} − अगले 7 दिनों की प्रतिबद्धताएँ {inr(a['week_commitments'])} "
                   f"= विवेकाधीन {inr(a['discretionary'])}। {inr(amount)} खर्च करने के बाद {inr(a['remaining_after'])} बचेंगे। {verdict}")
        else:
            verdict = "Yes, this fits within your discretionary amount." if a["affordable"] else "Careful — this exceeds your discretionary amount."
            ans = (f"Recorded balance {inr(a['recorded_balance'])} − commitments due in the next 7 days {inr(a['week_commitments'])} "
                   f"= discretionary {inr(a['discretionary'])}. After spending {inr(amount)} you would have {inr(a['remaining_after'])} left. {verdict}")
        return {"intent": "affordability", "answer": ans, "facts": a}

    # 2. next week need
    if has("next week", "अगले हफ़्ते", "अगले सप्ताह", "need", "चाहिए", "how much will i"):
        items = up["week_items"]
        lines = [f"{c['name']} {inr(c['amount'])} ({_due_label(c, lang)})" for c in items]
        if hi:
            ans = f"अगले 7 दिनों में आपको {inr(up['week_total'])} चाहिए होंगे" + (": " + ", ".join(lines) if lines else "") + "।"
            ans += f" इसके बाद आपका विवेकाधीन बैलेंस {inr(up['discretionary'])} रहेगा।"
        else:
            ans = f"You will need {inr(up['week_total'])} over the next 7 days" + (": " + ", ".join(lines) if lines else "") + "."
            ans += f" That leaves a discretionary balance of {inr(up['discretionary'])}."
        return {"intent": "next_week", "answer": ans}

    # 3. upcoming payments
    if has("coming up", "upcoming", "payments", "due", "भुगतान", "आने वाले", "देय"):
        items = up["all_items"][:6]
        lines = [f"{c['name']} {inr(c['amount'])} ({_due_label(c, lang)})" for c in items]
        if hi:
            ans = f"आगामी प्रतिबद्धताएँ: " + ("; ".join(lines) if lines else "कोई नहीं") + f"। अगले 7 दिनों में कुल {inr(up['week_total'])}, 30 दिनों में {inr(up['month_total'])}।"
        else:
            ans = "Upcoming commitments: " + ("; ".join(lines) if lines else "none") + f". Next 7 days total {inr(up['week_total'])}; next 30 days {inr(up['month_total'])}."
        return {"intent": "upcoming", "answer": ans}

    # 4. shortfall / difference
    if has("short", "difference", "missing", "कम", "अंतर", "gap", "5,000", "5000", "why"):
        diff = b["difference"]
        top = next((f for f in findings if f["kind"] == "unexplained_difference"), None)
        if top:
            rel = "; ".join(f"{r['description'] or ('unnamed' if not hi else 'बिना नाम')} {inr(r['amount'])} · {as_dt(r['date']).strftime('%d %b')} · {r['source']}" for r in top["related"])
            if hi:
                ans = (f"दर्ज बैलेंस {inr(b['recorded_balance'])} है और अनुमानित बैलेंस {inr(b['expected_balance'])} — अंतर {inr(abs(diff))}। "
                       f"कारण: {top['account_name']} पर {len(top['related'])} अवर्गीकृत रिकॉर्ड ({rel})। "
                       f"यह पैसा दर्ज है, पर ARTHA नहीं जानता कि यह किस लिए था। इसे वर्गीकृत करें और अंतर ठीक हो जाएगा।")
            else:
                ans = (f"Recorded balance is {inr(b['recorded_balance'])} vs expected {inr(b['expected_balance'])} — a difference of {inr(abs(diff))}. "
                       f"Cause: {len(top['related'])} unclassified record(s) on {top['account_name']} ({rel}). "
                       f"The money is recorded, but ARTHA does not know what it was for. Classify it and the difference clears.")
        else:
            ans = ("दर्ज और अनुमानित बैलेंस मेल खाते हैं — कोई अस्पष्ट अंतर नहीं।" if hi
                   else "Recorded and expected balances match — there is no unexplained difference right now.")
        return {"intent": "shortfall", "answer": ans}

    # 5. unexplained / exceptions
    if has("unexplained", "exception", "flag", "अस्पष्ट", "अपवाद", "blind", "suspicious", "duplicate", "डुप्लिकेट"):
        top5 = findings[:5]
        lines = [f"[{f['severity'].upper()}] {f['title']} — {inr(f['amount'])}" for f in top5]
        if hi:
            ans = (f"{cov['records_analyzed']} में से {cov['explained']} रिकॉर्ड समझाए गए, {cov['affected_records']} प्रभावित ({cov['exception_findings']} निष्कर्ष)। "
                   + ("; ".join(lines) if lines else "कोई अपवाद नहीं।"))
        else:
            ans = (f"{cov['explained']} of {cov['records_analyzed']} records are explained; {cov['affected_records']} affected records across {cov['exception_findings']} findings. "
                   + ("; ".join(lines) if lines else "No exceptions."))
        return {"intent": "exceptions", "answer": ans}

    # 6. where did money go
    if has("where", "went", "go ", "spent", "spending", "कहाँ", "गए", "खर्च"):
        cats = b["category_totals"][:4]
        lines = [f"{c['category']} {inr(c['amount'])}" for c in cats]
        if hi:
            ans = f"कुल खर्च {inr(b['money_out'])}, आमदनी {inr(b['money_in'])}। सबसे बड़े खर्च: " + ", ".join(lines) + "।"
        else:
            ans = f"Money out {inr(b['money_out'])} against money in {inr(b['money_in'])}. Top categories: " + ", ".join(lines) + "."
        return {"intent": "spending", "answer": ans}

    # default summary
    top = findings[0] if findings else None
    if hi:
        ans = f"दर्ज बैलेंस {inr(b['recorded_balance'])}, अनुमानित {inr(b['expected_balance'])}। अगले 7 दिनों में {inr(up['week_total'])} देय। वित्तीय कवरेज {cov['coverage_pct']}%।"
        if top:
            ans += f" शीर्ष निष्कर्ष: {top['title']} {inr(top['amount'])}।"
    else:
        ans = f"Recorded balance {inr(b['recorded_balance'])}, expected {inr(b['expected_balance'])}. {inr(up['week_total'])} due in the next 7 days. Financial coverage {cov['coverage_pct']}%."
        if top:
            ans += f" Top finding: {top['title']} {inr(top['amount'])}."
    return {"intent": "summary", "answer": ans}


# ---------------------------------------------------------------------------
# deterministic category suggestion (fallback when Claude is unavailable)
# ---------------------------------------------------------------------------
KEYWORD_CATEGORIES = [
    (("zomato", "swiggy", "dinner", "lunch", "dhaba", "restaurant", "cafe", "coffee", "chai", "tea"), "Food"),
    (("blinkit", "grocery", "bigbasket", "zepto", "dmart"), "Groceries"),
    (("uber", "ola", "metro", "auto", "bus", "cab", "fuel", "petrol"), "Transport"),
    (("irctc", "train", "flight", "indigo", "hotel", "trip"), "Travel"),
    (("rent", "landlord"), "Rent"),
    (("amazon", "myntra", "flipkart", "shopping", "store"), "Shopping"),
    (("netflix", "spotify", "prime", "hotstar", "subscription"), "Subscription"),
    (("electricity", "water bill", "jio", "airtel", "recharge", "broadband", "gas bill"), "Utilities"),
    (("udemy", "coursera", "course", "tuition", "college", "exam"), "Education"),
    (("bookmyshow", "movie", "concert", "game"), "Entertainment"),
    (("transfer", "sent to", "payment to", "neft", "imps"), "Transfer"),
    (("salary", "payroll"), "Salary"),
    (("fee", "charge", "penalty"), "Fees"),
    (("sip", "mutual fund", "zerodha", "groww", "stocks"), "Investment"),
    (("pharmacy", "doctor", "hospital", "gym", "apollo"), "Health"),
]


def rule_based_category(tx: dict) -> dict:
    text = f"{tx.get('description') or ''} {tx.get('note') or ''} {tx.get('reference') or ''}".lower()
    for keys, cat in KEYWORD_CATEGORIES:
        if any(k in text for k in keys):
            return {"category": cat, "rationale": f"Matched keyword for {cat}.", "source": "rules"}
    if tx["type"] == "fee":
        return {"category": "Fees", "rationale": "Record type is fee.", "source": "rules"}
    if tx["type"] in ("received", "refund"):
        return {"category": "Income", "rationale": "Incoming money.", "source": "rules"}
    if tx["type"] == "transfer":
        return {"category": "Transfer", "rationale": "Record type is transfer.", "source": "rules"}
    return {"category": "Personal", "rationale": "No strong signal; defaulting to Personal.", "source": "rules"}
