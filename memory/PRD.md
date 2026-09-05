# ARTHA — Your Financial Memory

## Vision
An **AI Financial Control Layer** for Indian students and young professionals. ARTHA is one place where users capture, organize and understand their complete financial life across bank accounts, UPI, cards, cash, Razorpay, and investments.

**Core principle:** "Whatever happens to your money, ARTHA remembers it."

## MVP Scope (shipped)
- **Home dashboard** — hero card with Current vs Expected balance, Money In/Out, Coverage %, Blind Spot amount, upcoming preview, insight strip, Record Money + Ask ARTHA CTAs
- **Quick Record** modal — notes-app inspired capture: Amount, Paid/Received, Description, Category chips, Account chips, Reference. Save in <5 sec.
- **Money screen** — filterable ledger (All / Bank / UPI / Card / Cash / Razorpay) with tinted category icons
- **Financial Control screen** — coverage score (records analyzed = explained + exceptions, coverage from the same counts), severity strip (findings), exception cards → drill-in sheet (what happened / why flagged / related transactions / impact / action / AI explanation) with one-tap fixes (suggest+accept category, add description, keep-both, remove copy, mark reviewed)
- **Weekly Story** — swipeable 4-week recap cards on Home (deterministic narrative, en/hi)
- **Commitment Reminders** — in-app only; due within 24h / overdue commitments surface on Home + Upcoming with Mark paid (recurring roll forward) and Snooze 1 day
- **Exception History** — resolved findings logged (`resolutions` collection) with the fix applied; "Resolved" section at the bottom of Control
- **Category Insights** — last 30 days vs previous 30 days per category (deterministic bars) behind an "Insights" toggle on Money
- **Statement Import** — paste CSV / pick .csv → column auto-detection → preview (duplicates by reference or date+amount+description, unreadable rows) → import; rule-based categorisation
- **Smart categorisation** — Claude suggests a category for Uncategorized records (rule-based fallback), one-tap accept (Money screen + exception sheet)
- **Upcoming** — segmented control (Upcoming / Recurring / Loans / I owe / Owed to me), total + list
- **Ask ARTHA** — suggested question chips, chat with Claude Sonnet 5, browser voice mic (en-IN / hi-IN)
- **English ⇄ हिन्दी** toggle everywhere (persisted in AsyncStorage)
- **Synthetic data seed** — 140 transactions (≈105 in the last 30 days + previous-month slice) across 6 accounts, 9 commitments (incl. one overdue + one due tomorrow for reminders), planted anomalies (₹5,000 mystery, duplicates, unclassified, unexpected fees)

## Architecture
- **Frontend:** Expo Router + React Query + Reanimated. Theme in `src/theme.ts` (moss green palette).
- **Backend:** FastAPI + MongoDB — `server.py` (routes), `engine.py` (deterministic truth), `ai.py` (Claude layer, server-side only), `seed.py` (synthetic data), `models.py`
- **Deterministic financial engine** computes ALL numbers. Record-level status model (explained / warning / exception) → `explained + affected_records == records_analyzed`; `exception_findings` tracked separately; duplicates grouped into one finding. Recorded balance (all records) vs expected balance (explained records) → unexplained difference = net of unclassified records. Internal `Transfer` category excluded from money in/out.
- **AI:** Emergent Universal LLM Key → `claude-sonnet-5` via `emergentintegrations`, non-streaming; receives facts + deterministic draft; every AI call has a deterministic fallback (`source` field tells the UI which one answered)
- **Razorpay:** test-mode client + mock adapter fallback; secrets server-side only.

## Data model
- `accounts` — id, name, type, opening_balance, observed_balance
- `transactions` — id, account_id, amount, type, category, description, date, source, reference, status
- `commitments` — id, name, amount, due_date, frequency, kind, status
- Blind spots are computed on the fly, not stored.

## Key backend routes (`/api/*`)
- `GET /dashboard?lang`, `/control?lang`, `/control/findings/{id}?lang`, `/story?lang`, `/facts`, `/health`, `/categories`
- `GET/POST /accounts`, `/transactions` (+ `PATCH/DELETE /transactions/{id}`, `POST /transactions/{id}/suggest-category`), `/commitments`
- `POST /commitments/{id}/pay`, `POST /commitments/{id}/snooze?days=1`, `GET /control/history?lang`, `GET /insights/categories`, `POST /import/preview`, `POST /import/commit`
- `POST /ask` (non-streaming; `{answer, intent, source}`), `POST /control/findings/{id}/explain`
- `POST /seed`, `POST /reset`
- `POST /payments/order`, `GET /razorpay/status`

## Demo story built-in
Recorded balance ₹49,344 vs expected ₹54,344. The only unclassified record (₹5,000 HDFC payment, no category/description) is the sole cause → HIGH "Unexplained balance difference" linked to that record. Classifying it clears the difference. Wording never claims a "missing transaction" or live bank data; Home shows "Based on recorded and imported financial activity · demo data is synthetic".

## GitHub readiness (done)
README.md (15 sections), backend/.env.example, frontend/.env.example, .gitignore covers .env/.expo/logs; no secrets in client code; backend tests: `backend/tests/test_artha_backend.py` (16 tests).
