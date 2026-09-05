# ARTHA

**Your Financial Memory** — a personal financial memory and AI financial control layer for Indian students and young professionals.

> Prototype / demo. All financial data shown in demo mode is **synthetic**. ARTHA does not access any live bank account, does not intercept UPI, and its AI never performs financial arithmetic.

---

## 1. Problem

Money moves through many channels at once — bank, UPI, cards, cash, Razorpay, investments — and nobody remembers all of it. Balances "feel" wrong, duplicate charges go unnoticed, fees leak silently, and nobody can answer *"why is my balance ₹5,000 short?"* with facts.

## 2. Solution

ARTHA is one place that **captures, organises and understands** a person's complete financial life:

- **Quick Record** — capture any money movement in under 5 seconds.
- **Unified Financial Memory** — every record, every source, one ledger.
- **Financial Control Engine** — deterministic code computes balances, coverage and exceptions.
- **Ask ARTHA** — natural-language questions (English / Hindi / voice) answered from engine facts.

Core principle: **financial truth = deterministic code; AI = explanation.**

## 3. Key Features

| Area | What it does |
|---|---|
| Home | Recorded vs expected balance, coverage %, money in/out, potential blind spot, upcoming commitments, insights, swipeable weekly story |
| Quick Record | Amount · Paid/Received · What for · Category · Account · Reference · Note — saving instantly updates every metric |
| Money | Filterable ledger (All / Bank / UPI / Card / Cash / Razorpay) with record-level control status and one-tap smart categorisation |
| Financial Control | Coverage, records analyzed, explained, exceptions, findings by severity, exception cards → drill-in sheet |
| Exception detail | What happened · Why flagged · Related transactions · Financial impact · Recommended action · AI explanation · one-tap fixes |
| Upcoming | Upcoming payments, recurring, loans, money I owe, money owed to me |
| Ask ARTHA | Suggested questions, chat, English/Hindi, voice input (en-IN / hi-IN) where supported |
| Reminders | In-app reminders for commitments due within 24h or overdue — Mark paid (recurring items roll forward) / Snooze 1 day |
| Exception history | Every resolved finding is logged with the fix applied ("Resolved" section on Control) |
| Category insights | Last 30 days vs previous 30 days per category, deterministic bars (Money → Insights) |
| Statement import | Paste CSV or pick a .csv; columns auto-detected (date, narration, debit/credit or amount, reference); duplicates skipped; preview then import |

## 4. Architecture

```
Expo (React Native / Web)  ──HTTPS──▶  FastAPI backend  ──▶  MongoDB
        frontend/                      backend/server.py       (accounts, transactions, commitments)
                                            │
                                            ├── engine.py   deterministic financial truth
                                            ├── ai.py       Claude explanation layer (server-side only)
                                            └── seed.py     synthetic demo dataset
```

- The client never talks to Claude. It calls `/api/ask`, `/api/control/findings/{id}/explain`, `/api/transactions/{id}/suggest-category`; the server holds the key.
- Findings (blind spots) are computed on every read from the raw records — nothing is cached or stored, so a fix is reflected everywhere immediately.

## 5. Deterministic Financial Control Engine (`backend/engine.py`)

All numbers come from code, never from the model:

- **Recorded balance** = opening balance + net of *all* recorded transactions.
- **Expected balance** = opening balance + net of *explained* transactions (everything not `unclassified`).
- **Unexplained difference** = recorded − expected (the net effect of unclassified records).
- **Money in / money out / category totals** (internal `Transfer` moves excluded).
- **Record-level control status** — every record gets exactly one state: `explained`, `warning` (only low-severity findings) or `exception` (medium/high finding).
- **Coverage** — `explained + affected_records == records_analyzed`, `coverage_pct = explained / total × 100` (1 dp). A record touched by several findings counts **once**.
- **Exception findings** are kept separate from affected records (e.g. 105 analyzed = 97 explained + 8 affected, across 6 findings).
- Finding types: unexplained balance difference, possible duplicate (grouped), fee needing review, uncategorized payment, payment without description. Confidence is **heuristic** (`high / medium / low`) and labelled as such.
- **Commitments** — 7-day / 30-day totals, owed by me / owed to me, discretionary = recorded balance − 7-day commitments, affordability checks.
- **Weekly story** — templated narrative per rolling week.
- `deterministic_answer()` answers every Ask ARTHA intent without any model.

## 6. AI / Claude Layer (`backend/ai.py`)

- Model: Claude Sonnet via the Emergent universal LLM key (server-side only).
- Claude receives the already-computed facts plus a deterministic draft answer and only **rewrites/explains**. It is instructed to reuse numbers verbatim, never invent transactions, balances, commitments or dates, and to use cautious wording ("possible duplicate", "unexplained difference").
- Every AI call has a deterministic fallback. If the key is missing or the call fails, the app keeps working and the UI labels the answer as deterministic.

## 7. Synthetic Demo Data (`backend/seed.py`)

140 synthetic records (≈105 in the last 30 days plus a previous-month slice for comparisons) across 6 accounts (HDFC Savings, SBI Savings, PhonePe UPI, HDFC Credit Card, Cash Wallet, Razorpay Test) and categories including food, groceries, travel, rent, shopping, subscriptions, utilities, education, entertainment, transfers, salary, fees, investments, health. Planted, documented anomalies:

- **A.** ₹5,000 unclassified payment on HDFC → sole cause of the ₹5,000 unexplained difference (₹49,344 recorded / ₹54,344 expected).
- **B/C.** Two possible-duplicate groups (Amazon Pay ₹899 ×2, Uber ₹185 ×2).
- **D.** ₹350 card fee with no description.
- **E.** "Payment to XYZ" ₹1,240 uncategorized (smart-categorisation target).
- **F.** ₹1,500 transfer without description.
- Commitments include one overdue (Wi-Fi bill) and one due tomorrow (Electricity bill) to demo reminders.

The dataset seeds automatically on first start when the database is empty; the ↻ button on Home re-seeds it.

## 8. Hindi + Voice

- English ⇄ हिन्दी toggle (persisted). UI labels, suggested questions, finding texts, insights and Ask ARTHA answers switch language; amounts stay identical.
- Voice input uses the Web Speech API (`en-IN` / `hi-IN`) as a progressive enhancement. When unsupported, ARTHA shows a clean fallback message; typing always works.

## 9. Tech Stack

- **Frontend:** Expo SDK 57 · Expo Router · React Query · react-native-vector-icons · TypeScript
- **Backend:** FastAPI · Motor (async MongoDB) · Pydantic v2 · emergentintegrations (Claude) · razorpay (test mode, mocked when no keys)
- **Database:** MongoDB

## 10. How to Run

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # fill in values
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend (new terminal)
cd frontend
yarn install
cp .env.example .env            # EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
yarn start                      # press w for web, or scan the QR in Expo Go

# Backend tests (backend must be reachable at EXPO_PUBLIC_BACKEND_URL)
cd backend && pytest
```

## 11. Environment Variables

| File | Variable | Required | Purpose |
|---|---|---|---|
| `backend/.env` | `MONGO_URL` | yes | MongoDB connection string |
| `backend/.env` | `DB_NAME` | yes | Database name |
| `backend/.env` | `EMERGENT_LLM_KEY` | no | Claude access (server-side). Empty → deterministic mode |
| `backend/.env` | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | no | Razorpay test mode. Empty → mock adapter |
| `frontend/.env` | `EXPO_PUBLIC_BACKEND_URL` | yes | Backend base URL (public, no secrets) |

Templates: `backend/.env.example`, `frontend/.env.example`.

## 12. Security Notes

- No Anthropic/Claude key exists in the frontend, the bundle, `app.json` or any public env var. Only `EXPO_PUBLIC_BACKEND_URL` is shipped to the client.
- `.env` files are git-ignored; only `.env.example` templates are committed.
- All inputs are validated with Pydantic (amount > 0, category whitelist, bounded question length).
- This prototype has no authentication and is single-user by design; do not deploy it publicly with real data.

## 13. Demo Flow

1. Open **Home** — recorded ₹49,344 vs expected ₹54,344, coverage 92.4%, potential blind spot ₹5,000.
2. Tap **Potential Blind Spot → Investigate** — the exception sheet opens: what happened, why flagged, the unclassified ₹5,000 record, impact, action.
3. Optionally type what it was for / tap **Suggest category → Accept** — the finding resolves and every number updates.
4. **Ask ARTHA:** "Why is my balance ₹5,000 short?" → "What payments are coming up?" → "Can I afford ₹2,000 today?"
5. Toggle **हिन्दी** and ask "अगले हफ़्ते मुझे कितने पैसे चाहिए होंगे?"
6. **Record Money** — save a payment and watch balance, money out, coverage and story update.

No code changes are needed during the demo.

## 14. Limitations

- Demo data is synthetic; there is no bank, UPI or card connectivity.
- Single user, no authentication, no encryption at rest beyond what MongoDB provides.
- Finding confidence is heuristic, not a calibrated probability.
- Voice input depends on browser Web Speech support (best on Chrome).
- Razorpay is test mode / mock only.

## 15. Future Scope

- Consent-based account aggregator / bank statement imports.
- UPI transaction ingestion where permitted.
- Reminders for upcoming commitments; richer analytics.
- Family financial spaces and small-business finance.
- Authentication (e.g. Google sign-in) and multi-user data isolation.
