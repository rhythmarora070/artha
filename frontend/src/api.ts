import Constants from "expo-constants";

const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  Constants.expoConfig?.extra?.backendUrl ||
  "";

export const API_BASE = `${BACKEND}/api`;

// Session token lives in memory here (persisted by src/auth.tsx via SecureStore / localStorage).
let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export function setSessionToken(t: string | null) {
  sessionToken = t;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && sessionToken && !path.startsWith("/auth/")) onUnauthorized?.();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = typeof j?.detail === "string" ? j.detail : JSON.stringify(j?.detail ?? j);
    } catch {}
    throw new Error(`API ${res.status}: ${detail.slice(0, 160)}`);
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
  snooze_until?: string | null;
  last_paid_at?: string | null;
};
export type Reminder = Commitment & { hours_until_due: number; overdue: boolean };
export type Resolution = {
  id: string;
  finding_id: string;
  kind: Finding["kind"];
  severity: "high" | "medium" | "low";
  amount: number;
  account_name: string;
  related: RelatedRecord[];
  fix: "categorised" | "described" | "kept_both" | "removed_copy" | "marked_reviewed" | "record_deleted";
  fix_detail: string;
  resolved_at: string;
  title: string;
};
export type CategoryComparison = {
  window_days: number;
  current_total: number;
  previous_total: number;
  rows: { category: string; current: number; previous: number; change: number; change_pct: number | null }[];
};
export type ImportRow = {
  line: number;
  date: string | null;
  description: string;
  amount: number | null;
  type: Transaction["type"] | null;
  reference: string | null;
  category: string;
  error: string | null;
  duplicate: boolean;
};
export type ImportPreview = {
  columns: Record<string, string>;
  rows: ImportRow[];
  summary: { total: number; importable: number; duplicates: number; errors: number };
};
export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  auth_providers: string[];
  onboarded: boolean;
  app_lock: boolean;
  is_demo: boolean;
};
export type AuthResult = { session_token: string; user: User };
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
  reminders: Reminder[];
  story: StoryWeek[];
  data_context: string;
};

type Lang = "en" | "hi";

export const api = {
  register: (email: string, password: string, name: string) =>
    req<AuthResult>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) => req<AuthResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  googleSession: (session_id: string) => req<AuthResult>("/auth/session", { method: "POST", body: JSON.stringify({ session_id }) }),
  demoLogin: () => req<AuthResult>("/auth/demo", { method: "POST" }),
  me: () => req<User>("/auth/me"),
  patchMe: (body: Partial<Pick<User, "name" | "onboarded" | "app_lock">>) => req<User>("/auth/me", { method: "PATCH", body: JSON.stringify(body) }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  createAccount: (body: { name: string; type: string; opening_balance: number }) => req<Account>("/accounts", { method: "POST", body: JSON.stringify(body) }),
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
  payCommitment: (id: string) => req<Commitment>(`/commitments/${id}/pay`, { method: "POST" }),
  snoozeCommitment: (id: string, days = 1) => req<Commitment>(`/commitments/${id}/snooze?days=${days}`, { method: "POST" }),
  history: (lang: Lang = "en") => req<Resolution[]>(`/control/history?lang=${lang}`),
  categoryInsights: () => req<CategoryComparison>("/insights/categories"),
  importPreview: (account_id: string, csv_text: string) =>
    req<ImportPreview>("/import/preview", { method: "POST", body: JSON.stringify({ account_id, csv_text }) }),
  importCommit: (account_id: string, rows: Omit<ImportRow, "line" | "error" | "duplicate">[]) =>
    req<{ ok: boolean; imported: number }>("/import/commit", { method: "POST", body: JSON.stringify({ account_id, rows }) }),
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
