"""ARTHA backend tests - deterministic engine + Claude explainer."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://memory-wallet-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _seed(session):
    """Seed DB once for the module."""
    r = session.post(f"{API}/seed", timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["accounts"] == 6
    assert body["transactions"] >= 100
    assert body["commitments"] == 7
    return body


# ---------- Health ----------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------- Seed idempotency ----------
class TestSeed:
    def test_seed_repeatable(self, session):
        r = session.post(f"{API}/seed", timeout=60)
        assert r.status_code == 200
        assert r.json()["accounts"] == 6
        assert r.json()["commitments"] == 7


# ---------- Dashboard: planted mystery ----------
class TestDashboard:
    def test_dashboard_shape_and_mystery(self, session):
        r = session.get(f"{API}/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("balances", "coverage", "upcoming_preview", "top_blind_spot", "insights"):
            assert k in d
        b = d["balances"]
        assert "current_balance" in b and "expected_balance" in b and "difference" in b
        # Planted demo mystery: HDFC observed is ₹5,000 short
        assert b["difference"] == -5000, f"expected -5000, got {b['difference']}"
        assert d["top_blind_spot"] is not None
        assert d["top_blind_spot"]["severity"] == "high"


# ---------- Transactions ----------
class TestTransactions:
    def test_list_all(self, session):
        r = session.get(f"{API}/transactions", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 100

    def test_filter_upi(self, session):
        r = session.get(f"{API}/transactions", params={"source": "UPI"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all(t["source"] == "UPI" for t in data)

    def test_create_transaction_and_balance_updates(self, session):
        # Get baseline expected balance
        d0 = session.get(f"{API}/dashboard").json()["balances"]["expected_balance"]
        # Fetch an account id
        accs = session.get(f"{API}/accounts").json()
        acc_id = accs[0]["id"]
        payload = {
            "account_id": acc_id,
            "amount": 250.0,
            "type": "paid",
            "category": "Food",
            "description": "TEST_pytest coffee",
            "source": "UPI",
        }
        r = session.post(f"{API}/transactions", json=payload, timeout=15)
        assert r.status_code == 200
        created = r.json()
        assert created["amount"] == 250.0
        tx_id = created["id"]

        # Verify appears in list
        lst = session.get(f"{API}/transactions").json()
        assert any(t["id"] == tx_id for t in lst)

        # Balance should decrease by 250
        d1 = session.get(f"{API}/dashboard").json()["balances"]["expected_balance"]
        assert round(d0 - d1, 2) == 250.0

        # Cleanup
        session.delete(f"{API}/transactions/{tx_id}")


# ---------- Control (blind spots) ----------
class TestControl:
    def test_control_has_high_5000_balance_mismatch(self, session):
        r = session.get(f"{API}/control", timeout=30)
        assert r.status_code == 200
        c = r.json()
        assert "coverage" in c and "blind_spots" in c
        assert isinstance(c["blind_spots"], list) and len(c["blind_spots"]) > 0
        found = [
            s for s in c["blind_spots"]
            if s["kind"] == "balance_mismatch" and s["severity"] == "high" and int(s["amount"]) == 5000
        ]
        assert found, f"No ₹5000 high-severity balance_mismatch found: {c['blind_spots']}"


# ---------- Commitments ----------
class TestCommitments:
    def test_list(self, session):
        r = session.get(f"{API}/commitments", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 7
        kinds = {c["kind"] for c in data}
        for expected in ("upcoming", "recurring", "loan", "owed_by_me", "owed_to_me"):
            assert expected in kinds, f"missing kind {expected}"

    def test_create_commitment(self, session):
        payload = {
            "name": "TEST_pytest commitment",
            "amount": 500,
            "due_date": "2026-12-31T00:00:00Z",
            "frequency": "one-time",
            "category": "Personal",
            "kind": "upcoming",
        }
        r = session.post(f"{API}/commitments", json=payload, timeout=15)
        assert r.status_code == 200
        c = r.json()
        assert c["name"] == "TEST_pytest commitment"
        # Cleanup
        session.delete(f"{API}/commitments/{c['id']}")


# ---------- Ask ARTHA (Claude via emergent LLM key) ----------
class TestAsk:
    def test_ask_5000_shortfall_english(self, session):
        r = session.post(f"{API}/ask_once", json={"question": "Why am I 5000 short?", "language": "en"}, timeout=90)
        assert r.status_code == 200
        ans = r.json().get("answer", "")
        assert ans and len(ans) > 20
        # Must reference 5000
        assert "5,000" in ans or "5000" in ans, f"Answer missing 5000 reference: {ans}"

    def test_ask_hindi_devanagari(self, session):
        r = session.post(f"{API}/ask_once", json={"question": "मेरा बैलेंस क्यों कम है?", "language": "hi"}, timeout=90)
        assert r.status_code == 200
        ans = r.json().get("answer", "")
        assert ans
        # Contains Devanagari
        assert any("\u0900" <= ch <= "\u097F" for ch in ans), f"No Devanagari in: {ans}"

    def test_ask_affordability(self, session):
        r = session.post(f"{API}/ask_once", json={"question": "Can I afford 2000 today?", "language": "en"}, timeout=90)
        assert r.status_code == 200
        ans = r.json().get("answer", "").lower()
        assert ans
        assert "afford" in ans or "discretionary" in ans or "budget" in ans or "2,000" in ans or "2000" in ans


# ---------- Razorpay status ----------
class TestRazorpay:
    def test_status(self, session):
        r = session.get(f"{API}/razorpay/status", timeout=15)
        assert r.status_code == 200
        assert r.json()["mode"] in ("mock", "test")
