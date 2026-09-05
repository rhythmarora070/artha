import Constants from "expo-constants";

const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  Constants.expoConfig?.extra?.backendUrl ||
  "";

export const API_BASE = `${BACKEND}/api`;

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

export type Account = {
  id: string;
  name: string;
  type: string;
  opening_balance: number;
  observed_balance: number | null;
};
export type Transaction = {
  id: string;
  account_id: string;
  amount: number;
  type: "paid" | "received" | "transfer" | "refund" | "fee";
  category: string;
  description: string;
  date: string;
  source: string;
  reference?: string | null;
  status: string;
  note?: string | null;
};
export type Commitment = {
  id: string;
  name: string;
  amount: number;
  due_date: string;
  frequency: string;
  category: string;
  kind: "upcoming" | "recurring" | "loan" | "owed_by_me" | "owed_to_me";
  status: string;
};
export type BlindSpot = {
  id: string;
  kind: string;
  amount: number;
  severity: "high" | "medium" | "low";
  confidence: number;
  title: string;
  reason: string;
  account_id?: string | null;
  transaction_id?: string | null;
};
export type Dashboard = {
  balances: {
    current_balance: number;
    expected_balance: number;
    difference: number;
    money_in: number;
    money_out: number;
    accounts: (Account & { expected_balance: number; difference: number | null })[];
  };
  coverage: {
    records_analyzed: number;
    explained: number;
    exceptions: number;
    coverage_pct: number;
    high: number;
    medium: number;
    low: number;
  };
  upcoming_week_total: number;
  upcoming_preview: Commitment[];
  top_blind_spot: BlindSpot | null;
  insights: string[];
};

export const api = {
  dashboard: () => req<Dashboard>("/dashboard"),
  control: () => req<{ coverage: Dashboard["coverage"]; blind_spots: BlindSpot[] }>("/control"),
  transactions: (source?: string) =>
    req<Transaction[]>(`/transactions${source && source !== "All" ? `?source=${source}` : ""}`),
  accounts: () => req<Account[]>("/accounts"),
  commitments: (kind?: string) =>
    req<Commitment[]>(`/commitments${kind ? `?kind=${kind}` : ""}`),
  createTransaction: (body: any) =>
    req<Transaction>("/transactions", { method: "POST", body: JSON.stringify(body) }),
  createCommitment: (body: any) =>
    req<Commitment>("/commitments", { method: "POST", body: JSON.stringify(body) }),
  seed: () => req("/seed", { method: "POST" }),
  askOnce: (question: string, language: "en" | "hi" = "en") =>
    req<{ answer: string }>("/ask_once", {
      method: "POST",
      body: JSON.stringify({ question, language }),
    }),
};

export function fmtINR(n: number, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || isNaN(n as any)) return "₹0";
  const neg = n < 0;
  const v = Math.abs(n);
  if (opts.compact && v >= 100000) return `${neg ? "-" : ""}₹${(v / 100000).toFixed(1)}L`;
  if (opts.compact && v >= 1000) return `${neg ? "-" : ""}₹${(v / 1000).toFixed(1)}K`;
  return `${neg ? "-" : ""}₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
