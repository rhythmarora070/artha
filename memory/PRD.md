# ARTHA — Your Financial Memory

## Vision
An **AI Financial Control Layer** for Indian students and young professionals. ARTHA is one place where users capture, organize and understand their complete financial life across bank accounts, UPI, cards, cash, Razorpay, and investments.

**Core principle:** "Whatever happens to your money, ARTHA remembers it."

## MVP Scope (shipped)
- **Home dashboard** — hero card with Current vs Expected balance, Money In/Out, Coverage %, Blind Spot amount, upcoming preview, insight strip, Record Money + Ask ARTHA CTAs
- **Quick Record** modal — notes-app inspired capture: Amount, Paid/Received, Description, Category chips, Account chips, Reference. Save in <5 sec.
- **Money screen** — filterable ledger (All / Bank / UPI / Card / Cash / Razorpay) with tinted category icons
- **Financial Control screen** — coverage score, severity strip, list of blind spots with reason + confidence
- **Upcoming** — segmented control (Upcoming / Recurring / Loans / I owe / Owed to me), total + list
- **Ask ARTHA** — suggested question chips, chat with Claude Sonnet 5, browser voice mic (en-IN / hi-IN)
- **English ⇄ हिन्दी** toggle everywhere (persisted in AsyncStorage)
- **Synthetic data seed** — 105 transactions across 6 accounts, 7 commitments, planted anomalies (₹5,000 mystery, duplicates, unclassified, unexpected fees)

## Architecture
- **Frontend:** Expo Router + React Query + Reanimated. Theme in `src/theme.ts` (moss green palette).
- **Backend:** FastAPI + MongoDB (`/app/backend/server.py`)
- **Deterministic financial engine** computes ALL numbers (balances, coverage, blind spots, affordability). Claude only *explains*.
- **AI:** Emergent Universal LLM Key → `claude-sonnet-5` via `emergentintegrations` (streaming + non-streaming)
- **Razorpay:** test-mode client + mock adapter fallback; secrets server-side only.

## Data model
- `accounts` — id, name, type, opening_balance, observed_balance
- `transactions` — id, account_id, amount, type, category, description, date, source, reference, status
- `commitments` — id, name, amount, due_date, frequency, kind, status
- Blind spots are computed on the fly, not stored.

## Key backend routes (`/api/*`)
- `GET /dashboard`, `/control`, `/facts`
- `GET/POST /accounts`, `/transactions`, `/commitments`
- `POST /ask` (streaming SSE) + `POST /ask_once`
- `POST /seed`, `POST /reset`
- `POST /payments/order`, `GET /razorpay/status`

## Demo story built-in
User's HDFC observed balance is ₹5,000 lower than expected. Blind Spot engine flags it (HIGH). Ask ARTHA → Claude uses the structured facts to point at the unclassified ₹5,000 payment.
