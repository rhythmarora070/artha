"""ARTHA backend tests — deterministic engine invariants + API contract."""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _seed(session):
    r = session.post(f"{API}/seed", timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["accounts"] == 6
    assert body["transactions"] >= 100
    assert body["commitments"] == 7
    return body


class TestArtha:
    """One class on purpose: pytest-xdist loadscope keeps these sequential (shared demo state)."""

    def test_root(self, session):
        r = session.get(f"{API}/", timeout=15)
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_health(self, session):
        r = session.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
        assert r.json()["demo_mode"] is True


    def test_explained_plus_affected_equals_total(self, session):
        cov = session.get(f"{API}/control", timeout=30).json()["coverage"]
        assert cov["explained"] + cov["affected_records"] == cov["records_analyzed"]
        assert cov["warning_records"] + cov["exception_records"] == cov["affected_records"]
        assert cov["coverage_pct"] == round(cov["explained"] / cov["records_analyzed"] * 100, 1)
        assert cov["high"] + cov["medium"] + cov["low"] == cov["exception_findings"]

    def test_findings_do_not_double_count_records(self, session):
        d = session.get(f"{API}/control", timeout=30).json()
        touched = set()
        for f in d["findings"]:
            touched.update(f["transaction_ids"])
        assert len(touched) == d["coverage"]["affected_records"]

    def test_duplicates_are_grouped(self, session):
        d = session.get(f"{API}/control", timeout=30).json()
        dups = [f for f in d["findings"] if f["kind"] == "possible_duplicate"]
        assert dups, "expected planted duplicate groups"
        for f in dups:
            assert len(f["related"]) >= 2
            assert f["title"].startswith("Possible")
            assert f["amount"] == pytest.approx(sum(r["amount"] for r in f["related"]))

    def test_5000_difference_is_linked_to_unclassified_record(self, session):
        d = session.get(f"{API}/dashboard", timeout=30).json()
        b = d["balances"]
        assert b["recorded_balance"] == 49344.0
        assert b["expected_balance"] == 54344.0
        assert b["difference"] == -5000.0
        top = d["top_finding"]
        assert top["kind"] == "unexplained_difference" and top["severity"] == "high"
        assert len(top["related"]) == 1 and top["related"][0]["amount"] == 5000.0
        assert "missing transaction" not in top["what_happened"].lower()

    def test_hindi_findings(self, session):
        d = session.get(f"{API}/control?lang=hi", timeout=30).json()
        assert any("\u0900" <= ch <= "\u097F" for ch in d["findings"][0]["title"])

    def test_finding_detail_and_explain(self, session):
        fid = session.get(f"{API}/control", timeout=30).json()["findings"][0]["id"]
        r = session.get(f"{API}/control/findings/{fid}", timeout=30)
        assert r.status_code == 200
        for k in ("what_happened", "why_flagged", "impact", "action", "related", "confidence"):
            assert k in r.json()
        r = session.post(f"{API}/control/findings/{fid}/explain", json={"language": "en"}, timeout=90)
        assert r.status_code == 200
        assert r.json()["source"] in ("claude", "deterministic")
        assert len(r.json()["explanation"]) > 20


    def test_list_has_control_status(self, session):
        txs = session.get(f"{API}/transactions", timeout=30).json()
        assert len(txs) >= 100
        assert all(t["control_status"] in ("explained", "warning", "exception") for t in txs)

    def test_create_updates_totals_and_coverage(self, session):
        before = session.get(f"{API}/dashboard", timeout=30).json()
        acc = session.get(f"{API}/accounts", timeout=15).json()[0]
        r = session.post(f"{API}/transactions", json={
            "account_id": acc["id"], "amount": 250, "type": "paid", "category": "Food",
            "description": "Test chai", "source": acc["type"],
        }, timeout=30)
        assert r.status_code == 200
        tid = r.json()["id"]
        after = session.get(f"{API}/dashboard", timeout=30).json()
        assert after["balances"]["recorded_balance"] == pytest.approx(before["balances"]["recorded_balance"] - 250)
        assert after["balances"]["money_out"] == pytest.approx(before["balances"]["money_out"] + 250)
        assert after["coverage"]["records_analyzed"] == before["coverage"]["records_analyzed"] + 1
        assert after["coverage"]["explained"] == before["coverage"]["explained"] + 1
        session.delete(f"{API}/transactions/{tid}", timeout=15)

    def test_invalid_amount_rejected(self, session):
        acc = session.get(f"{API}/accounts", timeout=15).json()[0]
        r = session.post(f"{API}/transactions", json={"account_id": acc["id"], "amount": -5, "type": "paid", "source": acc["type"]}, timeout=15)
        assert r.status_code == 422

    def test_classifying_unclassified_record_clears_difference(self, session):
        d = session.get(f"{API}/dashboard", timeout=30).json()
        rid = d["top_finding"]["related"][0]["id"]
        r = session.post(f"{API}/transactions/{rid}/suggest-category", json={"language": "en"}, timeout=60)
        assert r.status_code == 200 and r.json()["category"] != "Uncategorized"
        r = session.patch(f"{API}/transactions/{rid}", json={"category": "Transfer", "description": "Sent to landlord"}, timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "cleared"
        d2 = session.get(f"{API}/dashboard", timeout=30).json()
        assert d2["balances"]["difference"] == 0.0
        # restore demo state without re-seeding
        r = session.patch(f"{API}/transactions/{rid}", json={"category": "Uncategorized", "description": "", "status": "unclassified"}, timeout=15)
        assert r.json()["status"] == "unclassified"
        assert session.get(f"{API}/dashboard", timeout=30).json()["balances"]["difference"] == -5000.0


    def test_shortfall_english(self, session):
        r = session.post(f"{API}/ask", json={"question": "Why is my balance ₹5,000 short?", "language": "en"}, timeout=90)
        assert r.status_code == 200
        body = r.json()
        assert body["intent"] == "shortfall" and "5,000" in body["answer"]

    def test_affordability(self, session):
        r = session.post(f"{API}/ask", json={"question": "Can I afford ₹2,000 today?", "language": "en"}, timeout=90)
        assert r.json()["intent"] == "affordability"
        assert "37,344" in r.json()["answer"]

    def test_hindi_next_week(self, session):
        r = session.post(f"{API}/ask", json={"question": "अगले हफ़्ते मुझे कितने पैसे चाहिए होंगे?", "language": "hi"}, timeout=90)
        ans = r.json()["answer"]
        assert any("\u0900" <= ch <= "\u097F" for ch in ans) and "12,000" in ans


    def test_list_and_week_total(self, session):
        coms = session.get(f"{API}/commitments", timeout=15).json()
        assert len(coms) == 7
        d = session.get(f"{API}/dashboard", timeout=30).json()
        assert d["upcoming_week_total"] == 12000.0
        assert d["discretionary"] == 49344.0 - 12000.0
