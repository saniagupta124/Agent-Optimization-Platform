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

async function postJSONPublic<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
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

async function patchJSON<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
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

/** Per registered agent / API key (see GET /metrics/usage-by-key). */
export interface ApiKeyUsageRow {
  agent_id: string;
  agent_name: string;
  api_key_hint: string;
  total_cost: number;
  total_tokens: number;
  request_count: number;
}

export interface AgentResponse {
  id: string;
  user_id: string;
  name: string;
  purpose: string;
  provider: string;
  model: string;
  api_key_hint: string;
  deployment_environment?: string;
  created_at: string;
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
  deployment_environment?: string;
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
  plan_tier: string;
  created_at: string;
}

export interface SubscriptionUsageRow {
  label: string;
  total_tokens: number;
  total_cost_usd: number;
}

export interface SubscriptionUsage {
  scope?: string;
  is_team_aggregate?: boolean;
  plan_tier: string;
  monthly_token_budget: number;
  monthly_cost_budget_usd: number;
  tokens_used: number;
  cost_usd: number;
  period_start: string;
  period_end: string;
  token_utilization: number;
  cost_utilization: number;
  by_provider: SubscriptionUsageRow[];
  by_model: SubscriptionUsageRow[];
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

function metricsQueryParts(opts?: {
  days?: number;
  scope?: "me" | "team";
  agentId?: string;
}) {
  const p = new URLSearchParams();
  if (opts?.days != null) p.set("days", String(opts.days));
  if (opts?.scope) p.set("scope", opts.scope);
  if (opts?.agentId) p.set("agent_id", opts.agentId);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function getOverview(
  token: string,
  agentId?: string,
  extra?: { scope?: "me" | "team"; days?: number }
) {
  return fetchJSON<OverviewMetrics>(
    `/metrics/overview${metricsQueryParts({ ...extra, agentId })}`,
    token
  );
}

export function getByAgent(
  token: string,
  scope?: "me" | "team",
  days?: number
) {
  return fetchJSON<GroupedMetric[]>(
    `/metrics/by-agent${metricsQueryParts({ scope, days })}`,
    token
  );
}

export function getByCustomer(
  token: string,
  scope?: "me" | "team",
  days?: number
) {
  return fetchJSON<GroupedMetric[]>(
    `/metrics/by-customer${metricsQueryParts({ scope, days })}`,
    token
  );
}

export function getByProvider(
  token: string,
  scope?: "me" | "team",
  days?: number
) {
  return fetchJSON<GroupedMetric[]>(
    `/metrics/by-provider${metricsQueryParts({ scope, days })}`,
    token
  );
}

export function getOutliers(
  token: string,
  scope?: "me" | "team",
  days?: number
) {
  return fetchJSON<OutlierRecord[]>(
    `/metrics/outliers${metricsQueryParts({ scope, days })}`,
    token
  );
}

export function getTimeseries(
  token: string,
  agentId?: string,
  extra?: { scope?: "me" | "team"; days?: number }
) {
  return fetchJSON<TimeseriesPoint[]>(
    `/metrics/timeseries${metricsQueryParts({ ...extra, agentId })}`,
    token
  );
}

export function getUsageByKey(
  token: string,
  days?: number,
  scope?: "me" | "team"
) {
  return fetchJSON<ApiKeyUsageRow[]>(
    `/metrics/usage-by-key${metricsQueryParts({ days, scope })}`,
    token
  );
}

export function getSubscriptionUsage(
  token: string,
  scope?: "me" | "team"
) {
  const q = scope ? `?scope=${scope}` : "";
  return fetchJSON<SubscriptionUsage>(`/subscription/usage${q}`, token);
}

// ---------- Usage (dashboard) ----------

export interface BehavioralComparison {
  window_days: number;
  before_period_label: string;
  after_period_label: string;
  avg_tokens_before: number;
  avg_tokens_after: number;
  tokens_pct_change: number;
  avg_tool_calls_before: number;
  avg_tool_calls_after: number;
  tool_calls_pct_change: number;
  avg_latency_ms_before: number;
  avg_latency_ms_after: number;
  latency_pct_change: number;
  cost_per_request_before: number;
  cost_per_request_after: number;
  cost_per_request_pct_change: number;
}

export interface TopChangeItem {
  rank: number;
  title: string;
  description: string;
  action: string;
  estimated_savings_usd: number;
  severity: string;
  type: string;
  agent_id: string;
  agent_name: string;
}

export interface UsageSummary {
  scope: string;
  team_view_available: boolean;
  team_member_count: number;
  potential_savings_usd: number;
  top_changes: TopChangeItem[];
  period_days: number;
  current_total_cost_usd: number;
  previous_total_cost_usd: number;
  cost_change_pct: number | null;
  total_tokens: number;
  request_count: number;
  avg_tokens_per_request: number;
  avg_tool_calls_per_request: number;
  stability_score: number;
  monthly_cost_usd: number;
  monthly_tokens: number;
  monthly_token_budget: number;
  monthly_cost_budget_usd: number;
  plan_tier: string;
  token_budget_utilization_pct: number;
  cost_budget_utilization_pct: number;
  behavioral: BehavioralComparison;
  insights: string[];
}

export interface UsageBreakdownRow {
  label: string;
  total_cost_usd: number;
  total_tokens: number;
  request_count: number;
  share_of_cost_pct: number;
}

export interface DashboardUsageBreakdown {
  scope: string;
  period_days: number;
  by_model: UsageBreakdownRow[];
  by_endpoint: UsageBreakdownRow[];
}

export interface TimelinePoint {
  date: string;
  cost_usd: number;
  total_tokens: number;
  request_count: number;
}

export interface UsageTimeline {
  scope: string;
  period_days: number;
  points: TimelinePoint[];
}

function usageQuery(
  days?: number,
  scope?: "me" | "team",
  deployment?: "internal" | "production" | "all"
) {
  const p = new URLSearchParams();
  if (days != null) p.set("days", String(days));
  if (scope) p.set("scope", scope);
  if (deployment && deployment !== "all") p.set("deployment", deployment);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function getUsageSummary(
  token: string,
  days?: number,
  scope?: "me" | "team",
  deployment?: "internal" | "production" | "all"
) {
  return fetchJSON<UsageSummary>(
    `/usage/summary${usageQuery(days, scope, deployment)}`,
    token
  );
}

export function getUsageBreakdown(
  token: string,
  days?: number,
  scope?: "me" | "team",
  deployment?: "internal" | "production" | "all"
) {
  return fetchJSON<DashboardUsageBreakdown>(
    `/usage/breakdown${usageQuery(days, scope, deployment)}`,
    token
  );
}

export function getUsageTimeline(
  token: string,
  days?: number,
  scope?: "me" | "team",
  deployment?: "internal" | "production" | "all"
) {
  return fetchJSON<UsageTimeline>(
    `/usage/timeline${usageQuery(days, scope, deployment)}`,
    token
  );
}

// ---------- Agents ----------

export function getAgents(
  token: string,
  scope?: "me" | "team",
  deployment?: "internal" | "production" | "all"
) {
  const p = new URLSearchParams();
  if (scope) p.set("scope", scope);
  if (deployment && deployment !== "all") p.set("deployment", deployment);
  const q = p.toString();
  return fetchJSON<AgentWithStats[]>(`/agents${q ? `?${q}` : ""}`, token);
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
    api_key_hint?: string;
    /** Sent to backend once; stored as hash + last-4 hint for /log_request matching. */
    api_key?: string;
    deployment_environment?: "internal" | "production";
  }
) {
  return postJSON<AgentResponse>("/agents", body, token);
}

export function updateAgent(
  token: string,
  id: string,
  body: Partial<{
    name: string;
    purpose: string;
    provider: string;
    model: string;
    api_key: string;
    deployment_environment: "internal" | "production";
  }>
) {
  return patchJSON<AgentResponse>(`/agents/${id}`, body, token);
}

export function deleteAgent(token: string, id: string) {
  return deleteJSON(`/agents/${id}`, token);
}

// ---------- Integrations (verify keys + discover OpenAI Assistants; stored in DB via /agents) ----------

export interface OpenAIDiscoverResult {
  valid: boolean;
  error?: string | null;
  assistants: { id: string; name: string }[];
  models_sample: string[];
}

export interface AnthropicDiscoverResult {
  valid: boolean;
  error?: string | null;
  models: string[];
}

export function discoverOpenAI(token: string, api_key: string) {
  return postJSON<OpenAIDiscoverResult>(
    "/integrations/openai/discover",
    { api_key },
    token
  );
}

export function discoverAnthropic(token: string, api_key: string) {
  return postJSON<AnthropicDiscoverResult>(
    "/integrations/anthropic/discover",
    { api_key },
    token
  );
}

export function registerOpenAIAssistant(
  token: string,
  body: {
    api_key: string;
    assistant_id: string;
    purpose?: string;
    model_override?: string | null;
  }
) {
  return postJSON<AgentResponse>(
    "/integrations/openai/register-assistant",
    body,
    token
  );
}

export function getOptimizations(token: string, agentId: string) {
  return fetchJSON<OptimizationResponse>(
    `/agents/${agentId}/optimizations`,
    token
  );
}

// ---------- Team ----------

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  agent_count: number;
  total_cost_7d: number;
  total_requests_7d: number;
  plan_tier: string;
  role: string;
}

export interface TeamOverview {
  team_name: string;
  team_id: string;
  members: TeamMember[];
}

export interface TeamInfo {
  id: string;
  name: string;
  member_count: number;
}

export interface TeamInviteCreated {
  token: string;
  team_id: string;
  team_name: string;
  expires_at: string;
  invite_url: string | null;
}

export interface TeamInvitePreview {
  valid: boolean;
  expired: boolean;
  team_name: string | null;
  team_id: string | null;
}

export function getTeamOverview(token: string) {
  return fetchJSON<TeamOverview>("/team/members", token);
}

export function createTeam(token: string, body: { name: string; password: string }) {
  return postJSON<TeamInfo>("/team/create", body, token);
}

export function joinTeam(token: string, body: { name: string; password: string }) {
  return postJSON<TeamInfo>("/team/join", body, token);
}

export function leaveTeam(token: string) {
  return postJSON<{ ok: boolean }>("/team/leave", {}, token);
}

export function createTeamInvite(token: string, expiresDays?: number) {
  return postJSON<TeamInviteCreated>("/team/invites", { expires_days: expiresDays ?? 14 }, token);
}

export function previewTeamInvite(token: string) {
  return postJSONPublic<TeamInvitePreview>("/team/invites/preview", { token });
}

export function acceptTeamInvite(authToken: string, token: string) {
  return postJSON<TeamInfo>("/team/invites/accept", { token }, authToken);
}

export interface MemberAgentRow {
  id: string;
  name: string;
  purpose: string;
  model: string;
  provider: string;
  cost_7d: number;
  requests_7d: number;
  avg_tokens_7d: number;
  cost_30d: number;
  requests_30d: number;
  deployment_environment?: string;
}

export interface MemberDetail {
  id: string;
  name: string;
  email: string;
  plan_tier: string;
  agent_count: number;
  total_cost_7d: number;
  total_requests_7d: number;
  total_cost_30d: number;
  total_requests_30d: number;
  agents: MemberAgentRow[];
}

export function getMemberDetail(token: string, memberId: string) {
  return fetchJSON<MemberDetail>(`/team/members/${memberId}`, token);
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
