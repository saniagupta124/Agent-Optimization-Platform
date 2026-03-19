const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchJSON<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    cache: "no-store",
    headers,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function postJSON<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

async function putJSON<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

async function deleteJSON(path: string, token?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
}

// ---------- Types ----------

export interface OverviewMetrics {
  total_cost: number;
  total_tokens: number;
  request_count: number;
  avg_latency: number;
}

export interface GroupedMetric {
  group: string;
  total_cost: number;
  total_tokens: number;
  request_count: number;
}

export interface OutlierRecord {
  id: string;
  timestamp: string;
  agent_id: string;
  customer_id: string;
  provider: string;
  model: string;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

export interface TimeseriesPoint {
  date: string;
  total_cost: number;
  total_tokens: number;
}

export interface AgentWithStats {
  id: string;
  user_id: string;
  name: string;
  purpose: string;
  provider: string;
  model: string;
  api_key_hint: string;
  created_at: string;
  total_cost_7d: number;
  total_tokens_7d: number;
  request_count_7d: number;
  top_recommendation: string | null;
}

export interface OptimizationRecommendation {
  type: string;
  severity: string;
  title: string;
  description: string;
  estimated_savings_usd: number;
  action: string;
}

export interface ProviderComparison {
  provider: string;
  model: string;
  estimated_monthly_cost: number;
  vs_current: string;
}

export interface OptimizationResponse {
  agent_id: string;
  current_monthly_cost_estimate: number;
  recommendations: OptimizationRecommendation[];
  provider_comparison: ProviderComparison[];
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  organization_name: string;
  created_at: string;
}

// ---------- Auth ----------

export function register(body: {
  email: string;
  name: string;
  password: string;
  organization_name?: string;
}) {
  return postJSON<{ access_token: string; user: UserProfile }>(
    "/auth/register",
    body
  );
}

// ---------- Metrics ----------

export function getOverview(token: string, agentId?: string) {
  const q = agentId ? `?agent_id=${agentId}` : "";
  return fetchJSON<OverviewMetrics>(`/metrics/overview${q}`, token);
}

export function getByAgent(token: string) {
  return fetchJSON<GroupedMetric[]>("/metrics/by-agent", token);
}

export function getByCustomer(token: string) {
  return fetchJSON<GroupedMetric[]>("/metrics/by-customer", token);
}

export function getByProvider(token: string) {
  return fetchJSON<GroupedMetric[]>("/metrics/by-provider", token);
}

export function getOutliers(token: string) {
  return fetchJSON<OutlierRecord[]>("/metrics/outliers", token);
}

export function getTimeseries(token: string, agentId?: string) {
  const q = agentId ? `?agent_id=${agentId}` : "";
  return fetchJSON<TimeseriesPoint[]>(`/metrics/timeseries${q}`, token);
}

// ---------- Agents ----------

export function getAgents(token: string) {
  return fetchJSON<AgentWithStats[]>("/agents", token);
}

export function getAgent(token: string, id: string) {
  return fetchJSON<AgentWithStats>(`/agents/${id}`, token);
}

export function createAgent(
  token: string,
  body: {
    name: string;
    purpose: string;
    provider: string;
    model: string;
    api_key_hint: string;
  }
) {
  return postJSON<AgentWithStats>("/agents", body, token);
}

export function deleteAgent(token: string, id: string) {
  return deleteJSON(`/agents/${id}`, token);
}

export function getOptimizations(token: string, agentId: string) {
  return fetchJSON<OptimizationResponse>(
    `/agents/${agentId}/optimizations`,
    token
  );
}

// ---------- Profile ----------

export function getProfile(token: string) {
  return fetchJSON<UserProfile>("/auth/me", token);
}

export function updateProfile(
  token: string,
  body: { name?: string; organization_name?: string }
) {
  return putJSON<UserProfile>("/auth/me", body, token);
}

export function deleteAccount(token: string) {
  return deleteJSON("/auth/me", token);
}
