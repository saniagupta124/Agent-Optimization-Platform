const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function _handle401() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
}

async function fetchJSON<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    cache: "no-store",
    headers,
  });
  if (res.status === 401) { _handle401(); throw new Error("Unauthorized"); }
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
  if (res.status === 401) { _handle401(); throw new Error("Unauthorized"); }
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.detail || text || `API error: ${res.status}`);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(text || `API error: ${res.status}`);
      throw parseErr;
    }
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
  sdk_key?: string;
  created_at: string;
  total_cost_7d: number;
  total_tokens_7d: number;
  request_count_7d: number;
  top_recommendation: string | null;
  task_description?: string;
  system_prompt?: string;
  max_tokens?: number | null;
  quality_sensitivity?: string;
  temperature?: number | null;
  repo_url?: string;
  repo_file_path?: string;
}

export interface OptimizationRecommendation {
  type: string;
  severity: string;
  title: string;
  description: string;
  estimated_savings_usd: number;
  action: string;
  quality_impact?: string; // "none" | "low" | "medium" | "high"
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
  confidence_rating?: "low" | "medium" | "high";
  confidence_n?: number;
  confidence_score?: number;
  quality_impact?: "none" | "low" | "medium" | "high";
  verdict?: "ship_it" | "ship_with_caution" | "canary_only" | "hold" | "insufficient_data";
  verdict_rationale?: string;
  latency_p95_ms?: number | null;
  latency_p95_baseline_ms?: number | null;
  structure_conformance_pct?: number | null;
  judge_preference_pct?: number | null;
  confidence_flags?: string[];
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
  by_step: UsageBreakdownRow[];
  by_provider: UsageBreakdownRow[];
  by_agent: UsageBreakdownRow[];
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

function usageQuery(days?: number, scope?: "me" | "team") {
  const p = new URLSearchParams();
  if (days != null) p.set("days", String(days));
  if (scope) p.set("scope", scope);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function getUsageSummary(
  token: string,
  days?: number,
  scope?: "me" | "team"
) {
  return fetchJSON<UsageSummary>(
    `/usage/summary${usageQuery(days, scope)}`,
    token
  );
}

export function getUsageBreakdown(
  token: string,
  days?: number,
  scope?: "me" | "team"
) {
  return fetchJSON<DashboardUsageBreakdown>(
    `/usage/breakdown${usageQuery(days, scope)}`,
    token
  );
}

export function getUsageTimeline(
  token: string,
  days?: number,
  scope?: "me" | "team"
) {
  return fetchJSON<UsageTimeline>(
    `/usage/timeline${usageQuery(days, scope)}`,
    token
  );
}

// ---------- Agents ----------

export function getAgents(token: string, scope?: "me" | "team") {
  const q = scope ? `?scope=${scope}` : "";
  return fetchJSON<AgentWithStats[]>(`/agents${q}`, token);
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
    task_description?: string;
    system_prompt?: string;
    max_tokens?: number | null;
    quality_sensitivity?: string;
    temperature?: number | null;
    repo_url?: string;
    repo_file_path?: string;
  }
) {
  return postJSON<AgentWithStats>("/agents", body, token);
}

export function updateAgent(
  token: string,
  id: string,
  body: {
    name?: string;
    purpose?: string;
    provider?: string;
    model?: string;
    task_description?: string;
    system_prompt?: string;
    max_tokens?: number | null;
    quality_sensitivity?: string;
    temperature?: number | null;
    repo_url?: string;
    repo_file_path?: string;
  }
) {
  return putJSON<AgentWithStats>(`/agents/${id}`, body, token);
}

export function implementRecommendation(
  token: string,
  agentId: string,
  recType: string,
  repoUrl?: string,
  branch?: string,
) {
  const p = new URLSearchParams({ rec_type: recType });
  if (repoUrl) p.set("repo_url", repoUrl);
  if (branch) p.set("branch", branch);
  return postJSON<{ pr_url: string }>(`/agents/${agentId}/implement?${p}`, {}, token);
}

export function deleteAgent(token: string, id: string) {
  return deleteJSON(`/agents/${id}`, token);
}

export function rotateAgentKey(token: string, id: string) {
  return postJSON<AgentWithStats>(`/agents/${id}/rotate-key`, {}, token);
}

export function getOptimizations(token: string, agentId: string) {
  return fetchJSON<OptimizationResponse>(
    `/agents/${agentId}/optimizations`,
    token
  );
}

// ---------- Agent Dashboard (span-level) ----------

export interface SpanCostRow {
  span_name: string;
  total_cost: number;
  request_count: number;
}

export interface ModelCostRow {
  model: string;
  total_cost: number;
  request_count: number;
}

export interface RetryLoop {
  span_name: string;
  occurrences: number;
  window_seconds: number;
}

export interface ToolCostRow {
  label: string;
  total_cost: number;
  request_count: number;
}

export interface AgentDashboard {
  agent_id: string;
  agent_name: string;
  session_cost_usd: number;
  alltime_cost_usd: number;
  session_request_count: number;
  alltime_request_count: number;
  requests_per_minute: number;
  by_span: SpanCostRow[];
  by_model: ModelCostRow[];
  by_tool: ToolCostRow[];
  retry_loops: RetryLoop[];
}

export interface SpanRecommendation {
  id: string;
  span_name: string;
  rec_type: string;
  explanation: string;
  current_monthly_cost: number;
  projected_monthly_cost: number;
  savings_per_month: number;
  confidence: number;
  applied: boolean;
  status: "pending" | "accepted" | "rejected" | "deferred";
  // Quality signals from backend
  latency_p95_ms?: number | null;
  latency_p95_baseline_ms?: number | null;
  structure_conformance_pct?: number | null;
  judge_preference_pct?: number | null;
  quality_impact?: string;
  confidence_rating?: "low" | "medium" | "high";
  confidence_n?: number;
  confidence_score?: number;
  confidence_flags?: string[];
  verdict?: string;
}

export function getAgentDashboard(token: string, agentId: string) {
  return fetchJSON<AgentDashboard>(`/dashboard/${agentId}`, token);
}

export function getSpanRecommendations(token: string, agentId: string) {
  return fetchJSON<SpanRecommendation[]>(`/recommendations/${agentId}`, token);
}

export function applySpanRecommendation(token: string, recommendationId: string) {
  return postJSON<{ id: string; applied: boolean }>(
    `/apply/${recommendationId}`,
    {},
    token
  );
}

async function patchJSON<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function patchSpanRecStatus(
  token: string,
  recommendationId: string,
  status: "pending" | "accepted" | "rejected" | "deferred",
  rejectReason = ""
) {
  return patchJSON<{ id: string; status: string }>(
    `/recommendations/${recommendationId}/status`,
    { status, reject_reason: rejectReason },
    token
  );
}

export function patchRecDecision(
  token: string,
  agentId: string,
  recType: string,
  status: "pending" | "accepted" | "rejected" | "deferred",
  rejectReason = ""
) {
  return patchJSON<{ agent_id: string; rec_type: string; status: string }>(
    `/rec-decisions/${agentId}/${recType}`,
    { status, reject_reason: rejectReason },
    token
  );
}

export interface RecDecision {
  agent_id: string;
  rec_type: string;
  status: "pending" | "accepted" | "rejected" | "deferred";
}

export function getRecDecisions(token: string) {
  return fetchJSON<RecDecision[]>("/rec-decisions", token);
}

export function storeEval(
  token: string,
  agentId: string,
  baselineModel: string,
  candidateModel: string,
  preferencePct: number
) {
  return postJSON<{ agent_id: string; preference_pct: number }>(
    `/agents/${agentId}/eval`,
    { baseline_model: baselineModel, candidate_model: candidateModel, preference_pct: preferencePct },
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

async function postJSONPublic<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.detail || text || `API error: ${res.status}`);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(text || `API error: ${res.status}`);
      throw parseErr;
    }
  }
  return res.json();
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

// ---------- GitHub OAuth ----------

export function getGitHubStatus(token: string) {
  return fetchJSON<{ connected: boolean; username: string }>("/auth/github/status", token);
}

export function getGitHubConnectUrl(token: string, next?: string) {
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  return fetchJSON<{ url: string }>(`/auth/github/connect-url${q}`, token);
}

export function disconnectGitHub(token: string) {
  return deleteJSON("/auth/github/disconnect", token);
}

// ---------- Onboarding ----------

export function getOnboardingStatus(token: string) {
  return fetchJSON<{ onboarding_completed: boolean }>("/onboarding", token);
}

export function completeOnboarding(token: string) {
  return postJSON<{ ok: boolean; onboarding_completed: boolean }>("/onboarding/complete", {}, token);
}

// ---------- Traces ----------

export interface OTLPSpan {
  trace_id?: string;
  span_id?: string;
  name?: string;
  start_time_unix_nano?: number;
  end_time_unix_nano?: number;
  attributes?: Record<string, any>;
  status?: Record<string, any>;
}

export interface TraceIngestionRequest {
  agent_id: string;
  spans: OTLPSpan[];
}

export interface TraceIngestionResponse {
  ingested: number;
  skipped: number;
}

export function ingestTraces(token: string, body: TraceIngestionRequest) {
  return postJSON<TraceIngestionResponse>("/traces/ingest", body, token);
}

// ---------- Recommendation Simulation ----------

export interface ModelSwitchSimulation {
  rec_type: "model_switch";
  current_model: string;
  target_model: string | null;
  cost_simulation: {
    current_monthly_cost: number;
    projected_monthly_cost: number;
    savings_usd: number;
    savings_pct: number;
    current_input_cost_per_1k: number;
    projected_input_cost_per_1k: number;
  };
  quality_simulation: {
    task_complexity: string;
    retention_score: number;
    retention_label: string;
    quality_factors: { factor: string; value: string; impact: "positive" | "neutral" | "negative" }[];
  };
  token_distribution: { bucket: string; count: number; pct: number }[];
  top_task_tags: { tag: string; count: number }[];
  request_count: number;
}

export interface PromptEfficiencySimulation {
  rec_type: "prompt_efficiency";
  current: {
    avg_prompt_tokens: number;
    avg_completion_tokens: number;
    ratio: number;
    prompt_share_pct: number;
  };
  projected: {
    avg_prompt_tokens: number;
    monthly_cost_current: number;
    monthly_cost_projected: number;
    savings_usd: number;
    savings_pct: number;
  };
  token_flow: { label: string; tokens: number; reducible: boolean; reduction_pct: number }[];
  prompt_percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  request_count: number;
}

export interface TokenLimitsSimulation {
  rec_type: "token_limits";
  percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  recommended_max_tokens: number;
  current_max_tokens: number | null;
  outlier_count: number;
  outlier_cost_usd: number;
  projected_savings_usd: number;
  cost_distribution: { bucket: string; count: number; total_cost: number; upper: number }[];
  request_count: number;
}

export interface ToolCallsSimulation {
  rec_type: "tool_calls";
  avg_tool_calls: number;
  tool_call_distribution: { range: string; count: number }[];
  estimated_redundant_pct: number;
  projected_savings_usd: number;
  request_count: number;
}

export type SimulationData =
  | ModelSwitchSimulation
  | PromptEfficiencySimulation
  | TokenLimitsSimulation
  | ToolCallsSimulation
  | { rec_type: string; empty: true };

export function getSimulation(token: string, agentId: string, recType: string, days = 30) {
  return fetchJSON<SimulationData>(
    `/agents/${agentId}/recommendations/simulate?rec_type=${recType}&days=${days}`,
    token
  );
}

// ---------- SDK Keys ----------

export interface SdkKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface SdkKeyCreated extends SdkKey {
  raw_key: string;
}

export function listSdkKeys(token: string) {
  return fetchJSON<SdkKey[]>("/sdk-keys", token);
}

export function createSdkKey(token: string, name: string) {
  return postJSON<SdkKeyCreated>("/sdk-keys", { name }, token);
}
