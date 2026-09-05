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
};
export type ControlStatus = "explained" | "warning" | "exception";
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
  review?: string | null;
  control_status?: ControlStatus;
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
export type RelatedRecord = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string;
  source: string;
  status: string;
  reference: string;
};
export type Finding = {
  id: string;
  kind: "unexplained_difference" | "possible_duplicate" | "unexpected_fee" | "uncategorized" | "missing_description";
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  amount: number;
  account_id: string;
  account_name: string;
  transaction_ids: string[];
  title: string;
  what_happened: string;
  why_flagged: string;
  impact: string;
  action: string;
  related: RelatedRecord[];
};
export type Coverage = {
  records_analyzed: number;
  explained: number;
  affected_records: number;
  warning_records: number;
  exception_records: number;
  exception_findings: number;
  coverage_pct: number;
  high: number;
  medium: number;
  low: number;
};
export type StoryWeek = {
  label: string;
  money_in: number;
  money_out: number;
  net: number;
  records: number;
  top_category: string | null;
  top_category_amount: number;
  biggest: RelatedRecord | null;
  narrative: string;
};
export type Dashboard = {
  balances: {
    recorded_balance: number;
    expected_balance: number;
    difference: number;
    money_in: number;
    money_out: number;
    internal_transfers: number;
    accounts: (Account & { recorded_balance: number; expected_balance: number; difference: number })[];
    category_totals: { category: string; amount: number }[];
  };
  coverage: Coverage;
  upcoming_week_total: number;
  discretionary: number;
  upcoming_preview: Commitment[];
  top_finding: Finding | null;
  insights: string[];
  story: StoryWeek[];
  data_context: string;
};

type Lang = "en" | "hi";

export const api = {
  dashboard: (lang: Lang = "en") => req<Dashboard>(`/dashboard?lang=${lang}`),
  control: (lang: Lang = "en") => req<{ coverage: Coverage; findings: Finding[] }>(`/control?lang=${lang}`),
  finding: (id: string, lang: Lang = "en") => req<Finding>(`/control/findings/${id}?lang=${lang}`),
  explainFinding: (id: string, lang: Lang = "en") =>
    req<{ explanation: string; source: "claude" | "deterministic" }>(`/control/findings/${id}/explain`, {
      method: "POST",
      body: JSON.stringify({ language: lang }),
    }),
  transactions: (source?: string) =>
    req<Transaction[]>(`/transactions${source && source !== "All" ? `?source=${source}` : ""}`),
  accounts: () => req<Account[]>("/accounts"),
  categories: () => req<string[]>("/categories"),
  commitments: (kind?: string) => req<Commitment[]>(`/commitments${kind ? `?kind=${kind}` : ""}`),
  createTransaction: (body: any) => req<Transaction>("/transactions", { method: "POST", body: JSON.stringify(body) }),
  patchTransaction: (id: string, body: Partial<Transaction>) =>
    req<Transaction>(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTransaction: (id: string) => req<{ ok: boolean }>(`/transactions/${id}`, { method: "DELETE" }),
  suggestCategory: (id: string, lang: Lang = "en") =>
    req<{ category: string; rationale: string; source: string }>(`/transactions/${id}/suggest-category`, {
      method: "POST",
      body: JSON.stringify({ language: lang }),
    }),
  createCommitment: (body: any) => req<Commitment>("/commitments", { method: "POST", body: JSON.stringify(body) }),
  seed: () => req("/seed", { method: "POST" }),
  ask: (question: string, language: Lang = "en") =>
    req<{ answer: string; intent: string; source: "claude" | "deterministic" }>("/ask", {
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
