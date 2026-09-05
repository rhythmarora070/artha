"""
ARTHA synthetic demo dataset.

All financial records in demo mode are synthetic. Nothing here comes from a real
bank, UPI provider or card network. The dataset is deterministic (seeded RNG) and
plants a small, documented set of anomalies so the Financial Control demo is
repeatable:

  A. ₹5,000 unclassified payment on HDFC Savings (status "unclassified", no
     category, no description). This is the ONLY unclassified record, so it is the
     sole cause of the "unexplained balance difference" of ₹5,000:
        expected balance = recorded balance + ₹5,000.
  B. Possible duplicate: Amazon Pay ₹899 twice, 3 minutes apart (PhonePe UPI).
  C. Possible duplicate: Uber ride ₹185 twice, 40 minutes apart (PhonePe UPI).
  D. Fee needing review: ₹350 card fee with no description.
  E. Uncategorized payment with a description ("Payment to XYZ" ₹1,240) — target for
     smart categorisation.
  F. ₹1,500 transfer without any description.

The HDFC opening balance is derived so the total recorded balance lands on the
documented demo figure (₹49,344 recorded / ₹54,344 expected).
"""
import random
from datetime import datetime, timedelta, timezone
from typing import List

from engine import signed_delta
from models import Account, Commitment, Transaction

TARGET_RECORDED_BALANCE = 49_344.0
TARGET_RECORD_COUNT = 105


def build_demo_dataset(now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    rng = random.Random(42)

    accounts = [
        Account(name="HDFC Savings", type="Bank", opening_balance=0.0),  # derived below
        Account(name="SBI Savings", type="Bank", opening_balance=5000.0),
        Account(name="PhonePe UPI", type="UPI", opening_balance=15000.0),
        Account(name="HDFC Credit Card", type="Card", opening_balance=0.0),
        Account(name="Cash Wallet", type="Cash", opening_balance=3000.0),
        Account(name="Razorpay Test", type="Razorpay", opening_balance=0.0),
    ]
    hdfc, sbi, phonepe, card, cash, rzp = (a.id for a in accounts)

    def d(days_ago: int, hour: int = 12, minute: int | None = None) -> datetime:
        return (now - timedelta(days=days_ago)).replace(hour=hour, minute=rng.randint(0, 59) if minute is None else minute, second=0, microsecond=0)

    txs: List[Transaction] = []

    def add(**k):
        txs.append(Transaction(**k))

    # --- income -------------------------------------------------------------
    add(account_id=hdfc, amount=45000, type="received", category="Salary", description="Monthly salary", date=d(28, 9), source="Bank", reference="SAL-0825")
    add(account_id=sbi, amount=8000, type="received", category="Freelance", description="Freelance design payment", date=d(22, 15), source="Bank", reference="FRL-114")
    add(account_id=rzp, amount=500, type="received", category="Income", description="Razorpay test payment order_1", date=d(5, 11), source="Razorpay", reference="rzp_test_1")
    add(account_id=rzp, amount=1500, type="received", category="Income", description="Razorpay test payment order_2", date=d(3, 16), source="Razorpay", reference="rzp_test_2")

    # --- fixed living costs ---------------------------------------------------
    add(account_id=hdfc, amount=12000, type="paid", category="Rent", description="House rent", date=d(27, 10), source="Bank", reference="RENT-AUG")
    add(account_id=hdfc, amount=1499, type="paid", category="Utilities", description="Electricity bill", date=d(15, 19), source="Bank")
    add(account_id=phonepe, amount=299, type="paid", category="Utilities", description="Jio recharge", date=d(13, 8), source="UPI")
    add(account_id=phonepe, amount=420, type="paid", category="Utilities", description="Water bill", date=d(19, 12), source="UPI")
    add(account_id=hdfc, amount=999, type="paid", category="Subscription", description="Netflix", date=d(10, 7), source="Bank", reference="NETFLIX")
    add(account_id=phonepe, amount=119, type="paid", category="Subscription", description="Spotify", date=d(12, 7), source="UPI")
    add(account_id=card, amount=1499, type="paid", category="Subscription", description="Amazon Prime annual", date=d(24, 20), source="Card")

    # --- education / entertainment / travel / health ---------------------------
    add(account_id=card, amount=1299, type="paid", category="Education", description="Udemy course", date=d(21, 21), source="Card")
    add(account_id=hdfc, amount=3999, type="paid", category="Education", description="Coursera certificate", date=d(25, 11), source="Bank")
    add(account_id=phonepe, amount=600, type="paid", category="Entertainment", description="BookMyShow tickets", date=d(9, 18), source="UPI")
    add(account_id=card, amount=1450, type="paid", category="Travel", description="IRCTC train ticket", date=d(17, 22), source="Card", reference="PNR-4471")
    add(account_id=phonepe, amount=780, type="paid", category="Travel", description="Ola outstation", date=d(16, 6), source="UPI")
    add(account_id=phonepe, amount=1500, type="paid", category="Health", description="Gym membership", date=d(26, 7), source="UPI")
    add(account_id=phonepe, amount=340, type="paid", category="Health", description="Apollo pharmacy", date=d(7, 20), source="UPI")

    # --- transfers / investments ----------------------------------------------
    add(account_id=hdfc, amount=5000, type="transfer", category="Investment", description="SIP - HDFC Mutual Fund", date=d(20, 9), source="Bank", reference="SIP-01")
    add(account_id=hdfc, amount=2000, type="transfer", category="Investment", description="Zerodha stocks", date=d(11, 10), source="Bank", reference="ZRD-8812")
    add(account_id=hdfc, amount=3000, type="transfer", category="Transfer", description="Transfer to SBI", date=d(23, 12), source="Bank", reference="IMPS-3301")
    add(account_id=sbi, amount=3000, type="received", category="Transfer", description="Transfer from HDFC", date=d(23, 12), source="Bank", reference="IMPS-3301")
    add(account_id=hdfc, amount=4000, type="transfer", category="Transfer", description="Cash withdrawal", date=d(18, 13), source="Bank")
    add(account_id=cash, amount=4000, type="received", category="Transfer", description="ATM withdrawal", date=d(18, 13), source="Cash")
    add(account_id=hdfc, amount=118, type="fee", category="Fees", description="ATM withdrawal fee", date=d(18, 13), source="Bank")

    # --- shopping (card) --------------------------------------------------------
    for amt, desc, days in [(2499, "Amazon order", 4), (3200, "Myntra shopping", 8), (699, "Bookstore", 14), (1899, "Gift for Priya", 19), (4500, "Croma headphones", 26)]:
        add(account_id=card, amount=amt, type="paid", category="Shopping", description=desc, date=d(days, 19), source="Card")
    add(account_id=card, amount=1299, type="refund", category="Shopping", description="Myntra return", date=d(6, 12), source="Card", reference="RFND-M1")

    # --- food / groceries / transport (UPI + cash) --------------------------------
    food = [("Zomato order", 250), ("Swiggy dinner", 320), ("Blinkit groceries", 450), ("Chai with friends", 60), ("Local dhaba", 180), ("Cafe coffee", 210), ("Domino's", 399)]
    for i in range(16):
        desc, amt = food[i % len(food)]
        add(account_id=phonepe, amount=amt + (i // len(food)) * 10, type="paid", category="Groceries" if "groceries" in desc.lower() else "Food",
            description=desc, date=d(1 + (i * 7) % 27, 13 + i % 8), source="UPI")
    transport = [("Uber ride", 240), ("Metro top-up", 200), ("Auto fare", 80), ("Fuel", 1200)]
    for i in range(8):
        desc, amt = transport[i % len(transport)]
        add(account_id=phonepe, amount=amt + (i // len(transport)) * 15, type="paid", category="Transport", description=desc, date=d(2 + (i * 5) % 26, 9 + i % 6), source="UPI")
    for i, (desc, amt) in enumerate([("Tea stall", 20), ("Vada pav", 40), ("Auto tip", 30), ("Snacks", 90), ("Newspaper", 25), ("Coconut water", 50)]):
        add(account_id=cash, amount=amt, type="paid", category="Food" if desc != "Auto tip" else "Transport", description=desc, date=d(1 + i * 4, 17), source="Cash")

    # --- planted anomalies (documented in module docstring) -----------------------
    # A. the ₹5,000 unclassified payment — sole cause of the unexplained difference
    add(account_id=hdfc, amount=5000, type="paid", category="Uncategorized", description="", date=d(6, 14, 5), source="Bank", reference="", status="unclassified")
    # B. possible duplicate — Amazon Pay ₹899 twice, 3 minutes apart
    dup_at = d(9, 20, 12)
    add(account_id=phonepe, amount=899, type="paid", category="Shopping", description="Amazon Pay", date=dup_at, source="UPI", reference="AMZ-D1")
    add(account_id=phonepe, amount=899, type="paid", category="Shopping", description="Amazon Pay", date=dup_at + timedelta(minutes=3), source="UPI", reference="AMZ-D1")
    # C. possible duplicate — Uber ₹185 twice, 40 minutes apart
    uber_at = d(3, 22, 10)
    add(account_id=phonepe, amount=185, type="paid", category="Transport", description="Uber ride", date=uber_at, source="UPI")
    add(account_id=phonepe, amount=185, type="paid", category="Transport", description="Uber ride", date=uber_at + timedelta(minutes=40), source="UPI")
    # D. fee needing review — ₹350 on the card, no description
    add(account_id=card, amount=350, type="fee", category="Fees", description="", date=d(14, 3, 0), source="Card")
    # E. uncategorized but attributable — smart categorisation target
    add(account_id=hdfc, amount=1240, type="paid", category="Uncategorized", description="Payment to XYZ", date=d(11, 16), source="Bank", reference="UPI-99231")
    # F. material transfer without description
    add(account_id=sbi, amount=1500, type="transfer", category="Transfer", description="", date=d(8, 11), source="Bank")

    # --- filler: small everyday records, guarded against accidental duplicates -----
    filler = [("Coffee", 95), ("Local shop", 130), ("Metro", 55), ("Grocery run", 265), ("Bus fare", 35), ("Stationery", 145), ("Juice", 70), ("Parking", 40)]
    i = 0
    while len(txs) < TARGET_RECORD_COUNT:
        desc, base = filler[i % len(filler)]
        amt = base + (i // len(filler)) * 3
        acc = [phonepe, cash, card, hdfc][i % 4]
        src = {phonepe: "UPI", cash: "Cash", card: "Card", hdfc: "Bank"}[acc]
        date = d(1 + (i * 3) % 29, 8 + i % 10)
        clash = any(t.account_id == acc and t.amount == amt and t.type == "paid" and abs((t.date - date).total_seconds()) <= 48 * 3600 for t in txs)
        if not clash:
            add(account_id=acc, amount=amt, type="paid", category="Transport" if desc in ("Metro", "Bus fare", "Parking") else ("Groceries" if desc == "Grocery run" else "Food"),
                description=desc, date=date, source=src)
        i += 1

    # Derive HDFC opening so total recorded balance == documented demo figure.
    net_all = sum(signed_delta(t.model_dump()) for t in txs)
    other_openings = sum(a.opening_balance for a in accounts[1:])
    accounts[0].opening_balance = round(TARGET_RECORDED_BALANCE - other_openings - net_all, 2)

    commitments = [
        Commitment(name="Rent", amount=12000, due_date=now + timedelta(days=5), frequency="monthly", category="Housing", kind="upcoming"),
        Commitment(name="Laptop EMI", amount=4200, due_date=now + timedelta(days=10), frequency="monthly", category="EMI", kind="loan"),
        Commitment(name="Netflix", amount=999, due_date=now + timedelta(days=18), frequency="monthly", category="Subscription", kind="recurring"),
        Commitment(name="Spotify", amount=119, due_date=now + timedelta(days=14), frequency="monthly", category="Subscription", kind="recurring"),
        Commitment(name="Gym membership", amount=1500, due_date=now + timedelta(days=22), frequency="monthly", category="Health", kind="recurring"),
        Commitment(name="Rahul (dinner split)", amount=350, due_date=now + timedelta(days=3), frequency="one-time", category="Personal", kind="owed_to_me"),
        Commitment(name="Mom (borrowed)", amount=2000, due_date=now + timedelta(days=30), frequency="one-time", category="Personal", kind="owed_by_me"),
    ]
    return accounts, txs, commitments
