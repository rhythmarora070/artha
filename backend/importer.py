"""
Bank / UPI statement CSV importer (deterministic).

Detects the common Indian statement layouts by header name:
  date        : date, txn date, transaction date, value date, posting date
  description : description, narration, particulars, details, remarks, transaction remarks
  debit       : debit, withdrawal, withdrawal amt, dr, debit amount
  credit      : credit, deposit, deposit amt, cr, credit amount
  amount      : amount, amt, transaction amount   (+ optional type / dr-cr column)
  reference   : reference, ref no, ref, utr, txn id, transaction id, cheque no, chq no

Rows are returned for preview; nothing is written to the database here.
"""
import csv
import io
import re
from datetime import datetime, timezone
from typing import Optional

from engine import rule_based_category

HEADER_ALIASES = {
    "date": ["date", "txn date", "transaction date", "value date", "posting date", "tran date"],
    "description": ["description", "narration", "particulars", "details", "remarks", "transaction remarks", "desc", "merchant"],
    "debit": ["debit", "withdrawal", "withdrawal amt", "withdrawal amount", "dr", "debit amount", "paid"],
    "credit": ["credit", "deposit", "deposit amt", "deposit amount", "cr", "credit amount", "received"],
    "amount": ["amount", "amt", "transaction amount", "txn amount"],
    "type": ["type", "dr/cr", "cr/dr", "txn type", "transaction type", "dr cr"],
    "reference": ["reference", "ref no", "ref", "ref no.", "utr", "utr no", "txn id", "transaction id", "cheque no", "chq no", "reference no", "ref number"],
}

DATE_FORMATS = ["%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%y", "%d %b %Y", "%d-%b-%Y", "%d %B %Y", "%Y/%m/%d", "%m/%d/%Y", "%d-%b-%y", "%d %b %y"]


def _norm(h: str) -> str:
    return re.sub(r"[^a-z/ ]", "", (h or "").strip().lower()).strip()


def detect_columns(header: list[str]) -> dict:
    found: dict = {}
    normed = [_norm(h) for h in header]
    for role, aliases in HEADER_ALIASES.items():
        for idx, h in enumerate(normed):
            if h in aliases and idx not in found.values():
                found[role] = idx
                break
    return found


def parse_amount(v: str) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip().replace("₹", "").replace("INR", "").replace("Rs.", "").replace("Rs", "").replace(",", "").strip()
    if not s or s in ("-", "—"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    sign = -1 if (neg or s.startswith("-")) else 1
    s = s.lstrip("+-")
    suffix = None
    m = re.match(r"^([\d.]+)\s*(cr|dr)?$", s, re.I)
    if m:
        s, suffix = m.group(1), (m.group(2) or "").lower() or None
    try:
        val = float(s) * sign
    except ValueError:
        return None
    if suffix == "dr":
        val = -abs(val)
    elif suffix == "cr":
        val = abs(val)
    return val


def parse_date(v: str) -> Optional[datetime]:
    s = (v or "").strip()
    if not s:
        return None
    s = re.sub(r"\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$", "", s, flags=re.I)  # drop time part
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).replace(hour=12, tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def parse_statement(csv_text: str) -> dict:
    text = csv_text.lstrip("\ufeff").strip()
    if not text:
        return {"columns": {}, "rows": [], "error": "Empty CSV"}
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = list(csv.reader(io.StringIO(text), dialect))
    reader = [r for r in reader if any(c.strip() for c in r)]
    if len(reader) < 2:
        return {"columns": {}, "rows": [], "error": "Need a header row and at least one data row"}
    header, body = reader[0], reader[1:]
    cols = detect_columns(header)
    if "date" not in cols or ("amount" not in cols and "debit" not in cols and "credit" not in cols):
        return {"columns": cols, "rows": [], "error": "Could not detect a date column and an amount / debit / credit column"}

    rows = []
    for i, r in enumerate(body, start=2):
        def cell(role):
            idx = cols.get(role)
            return r[idx].strip() if idx is not None and idx < len(r) else ""

        date = parse_date(cell("date"))
        description = cell("description")
        reference = cell("reference") or None
        amount: Optional[float] = None
        ttype: Optional[str] = None
        if "debit" in cols or "credit" in cols:
            deb, cred = parse_amount(cell("debit")), parse_amount(cell("credit"))
            if deb:
                amount, ttype = abs(deb), "paid"
            elif cred:
                amount, ttype = abs(cred), "received"
        if amount is None and "amount" in cols:
            a = parse_amount(cell("amount"))
            if a is not None:
                tcol = cell("type").lower()
                if tcol:
                    ttype = "received" if (tcol.startswith("cr") or tcol in ("credit", "received", "in", "deposit")) else "paid"
                elif a < 0:
                    ttype = "paid"
                else:
                    # Unsigned single amount column: assume outflow unless the narration looks like income
                    ttype = "received" if _looks_like_credit(description) else "paid"
                amount = abs(a)
        error = None
        if date is None:
            error = "Unreadable date"
        elif amount is None or amount <= 0:
            error = "Unreadable amount"
        desc_lower = description.lower()
        if ttype == "paid" and any(k in desc_lower for k in ("fee", "charge", "penalty")):
            ttype = "fee"
        cat = rule_based_category({"description": description, "note": "", "reference": reference or "", "type": ttype or "paid"})["category"] if not error else "Uncategorized"
        rows.append({
            "line": i,
            "date": date.isoformat() if date else None,
            "description": description,
            "amount": amount,
            "type": ttype,
            "reference": reference,
            "category": cat,
            "error": error,
        })
    return {"columns": {k: header[v] for k, v in cols.items()}, "rows": rows, "error": None}


def _looks_like_credit(desc: str) -> bool:
    d = desc.lower()
    return any(k in d for k in ("salary", "refund", "credit", "received", "cashback", "interest"))
