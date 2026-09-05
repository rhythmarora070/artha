"""Pydantic models shared by the API, engine and seed."""
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

DEMO_USER_ID = "demo-user"

SourceType = Literal["Bank", "UPI", "Card", "Cash", "Razorpay", "Investment"]
TxType = Literal["paid", "received", "transfer", "refund", "fee"]
# "unclassified" = the record exists but cannot be attributed to anything (no category, no description).
TxStatus = Literal["cleared", "pending", "unclassified"]
# Optional human review outcome that silences a finding once the user confirms it.
ReviewType = Literal["not_duplicate", "accepted"]

CATEGORIES = [
    "Food", "Groceries", "Dining", "Transport", "Travel", "Rent", "Shopping", "Subscription",
    "Utilities", "Bills", "Education", "Entertainment", "Transfer", "Salary", "Freelance",
    "Income", "Fees", "Investment", "Health", "Personal", "Uncategorized",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Account(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    name: str
    type: SourceType
    opening_balance: float = 0.0
    created_at: datetime = Field(default_factory=_now)


class AccountCreate(BaseModel):
    name: str
    type: SourceType
    opening_balance: float = 0.0


class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    account_id: str
    amount: float = Field(gt=0)
    type: TxType
    category: str = "Uncategorized"
    description: str = ""
    date: datetime = Field(default_factory=_now)
    source: SourceType
    reference: Optional[str] = None
    status: TxStatus = "cleared"
    note: Optional[str] = None
    review: Optional[ReviewType] = None


class TransactionCreate(BaseModel):
    account_id: str
    amount: float = Field(gt=0, le=10_000_000)
    type: TxType
    category: str = "Uncategorized"
    description: str = ""
    date: Optional[datetime] = None
    source: SourceType
    reference: Optional[str] = None
    note: Optional[str] = None


class TransactionPatch(BaseModel):
    category: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TxStatus] = None
    note: Optional[str] = None
    review: Optional[ReviewType] = None


class Commitment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    name: str
    amount: float = Field(gt=0)
    due_date: datetime
    frequency: Literal["one-time", "monthly", "weekly", "yearly"] = "monthly"
    category: str = "General"
    kind: Literal["upcoming", "recurring", "loan", "owed_by_me", "owed_to_me"] = "upcoming"
    status: Literal["pending", "paid"] = "pending"
    snooze_until: Optional[datetime] = None
    last_paid_at: Optional[datetime] = None


class CommitmentCreate(BaseModel):
    name: str
    amount: float = Field(gt=0)
    due_date: datetime
    frequency: Literal["one-time", "monthly", "weekly", "yearly"] = "monthly"
    category: str = "General"
    kind: Literal["upcoming", "recurring", "loan", "owed_by_me", "owed_to_me"] = "upcoming"


Lang = Literal["en", "hi"]


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    language: Lang = "en"


class LangRequest(BaseModel):
    language: Lang = "en"


class OrderReq(BaseModel):
    amount: int = Field(gt=0)  # paise
    currency: str = "INR"
    receipt: Optional[str] = None


class ImportPreviewRequest(BaseModel):
    account_id: str
    csv_text: str = Field(min_length=1, max_length=2_000_000)


class ImportRow(BaseModel):
    date: datetime
    description: str = ""
    amount: float = Field(gt=0)
    type: TxType
    reference: Optional[str] = None
    category: str = "Uncategorized"


class ImportCommitRequest(BaseModel):
    account_id: str
    rows: list[ImportRow] = Field(max_length=5000)


class Resolution(BaseModel):
    """History entry: a finding ARTHA caught that the user resolved."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = DEMO_USER_ID
    finding_id: str
    kind: str
    severity: str
    amount: float
    account_name: str = ""
    related: list[dict] = []
    fix: Literal["categorised", "described", "kept_both", "removed_copy", "marked_reviewed", "record_deleted"]
    fix_detail: str = ""
    resolved_at: datetime = Field(default_factory=_now)
