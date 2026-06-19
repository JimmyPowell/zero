// 极简 API 客户端：统一注入 token、解析错误、走 JSON
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

const TOKEN_KEY = "zero-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // 后端错误形如 { error: "..." } 或 zod 校验错误
    const msg =
      (data && typeof data.error === "string" && data.error) ||
      (data?.error?.issues?.[0]?.message as string | undefined) ||
      `请求失败 (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// ---- 类型 ----
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: "owner" | "admin" | "member";
}

export interface Member {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
}

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export interface IssueAssignee {
  type: "member" | "agent";
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assignee: IssueAssignee | null;
  createdAt: string;
  // 最新活动时间：任意事件（评论/模型回复/状态变更/执行）的最新时间，无事件回退创建时间
  lastActivityAt: string;
  updatedAt: string;
}

export interface CreateIssuePayload {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeType?: "member" | "agent";
  assigneeId?: string;
  repoId?: string;
  baseBranch?: string;
  workDir?: string;
}

export interface Repo {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  defaultBranch: string;
  createdAt: string;
}

export interface IssueRepoRef {
  id: string;
  name: string;
  defaultBranch: string;
}

export interface IssueDetail extends Issue {
  baseBranch: string | null;
  workDir: string | null;
  repo: IssueRepoRef | null;
}

export type IssueEventKind =
  | "created"
  | "comment"
  | "status_change"
  | "priority_change"
  | "assignment"
  | "run_started"
  | "run_progress"
  | "run_finished"
  | "run_failed"
  | "diff_ready"
  | "pr_opened";

export interface EventActor {
  type: "member" | "agent" | "system";
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AssigneeRef {
  type: "member" | "agent";
  id: string;
  name: string | null;
}

export interface IssueEvent {
  id: string;
  kind: IssueEventKind;
  body: string | null;
  meta:
    | {
        from?: string | AssigneeRef | null;
        to?: string | AssigneeRef | null;
      }
    | null;
  createdAt: string;
  actor: EventActor | null;
}

// ---- 执行（run / task）+ 细粒度执行日志 ----
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RunSummary {
  taskId: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  agentId: string | null;
  agentName: string | null;
  agentAvatar: string | null;
  provider: AgentProvider | null;
  runtimeName: string | null;
  eventCount: number;
  toolCallCount: number;
}

// 与 server/daemon 一致的规范化执行事件类型
export type RunEventType =
  | "run_status"
  | "assistant_text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "usage"
  | "error";

export type RunEventTool =
  | "read"
  | "edit"
  | "write"
  | "exec"
  | "search"
  | "task"
  | "other";

export interface RunEventRow {
  id: string;
  seq: number;
  type: RunEventType;
  tool: RunEventTool | null;
  toolName: string | null;
  text: string | null;
  payload?: unknown;
  createdAt?: string;
}

export interface UpdateIssuePayload {
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeType?: "member" | "agent" | null;
  assigneeId?: string | null;
  repoId?: string | null;
  baseBranch?: string | null;
  workDir?: string | null;
}

export type AgentProvider = "claude_code" | "codex" | "opencode";

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  avatarUrl: string | null;
  provider: AgentProvider;
  model: string | null;
  instructions: string | null;
  description: string | null;
  runtimeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPayload {
  name: string;
  provider?: AgentProvider;
  model?: string;
  instructions?: string;
  description?: string;
  runtimeId?: string | null;
}

export interface UpdateAgentPayload {
  name?: string;
  provider?: AgentProvider;
  model?: string | null;
  instructions?: string | null;
  description?: string | null;
  runtimeId?: string | null;
}

// ---- 技能（Skill）----
export type SkillSource = "manual" | "github";

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  source: SkillSource;
  sourceRef: string | null;
  agentCount: number;
  fileCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface SkillFileRef {
  id: string;
  path: string;
  isBinary: boolean;
  size: number;
}

export interface SkillDetail extends Skill {
  content: string | null;
}

export interface SkillDetailResponse {
  skill: SkillDetail;
  files: SkillFileRef[];
  agents: { id: string; name: string }[];
}

export interface CreateSkillPayload {
  name: string;
  description: string;
  content?: string;
}

export interface UpdateSkillPayload {
  name?: string;
  description?: string;
  content?: string | null;
}

// 详情页：agent + 绑定运行时 + 挂载技能 + 用量 + 最近运行
export interface AgentSkillRef {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface AgentRecentRun {
  taskId: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  issueId: string;
  issueNumber: number;
  issueTitle: string;
}

export interface AgentUsageSummary {
  days: number;
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentDetail {
  agent: Agent;
  runtime: { id: string; name: string; online: boolean } | null;
  skills: AgentSkillRef[];
  usage: AgentUsageSummary;
  recentRuns: AgentRecentRun[];
}

export type RuntimeVisibility = "private" | "workspace";

export interface Runtime {
  id: string;
  name: string;
  kind: "local" | "cloud";
  online: boolean;
  visibility: RuntimeVisibility;
  maxConcurrency: number;
  ownerId: string | null;
  ownerName: string | null;
  isOwner: boolean;
  agentCount: number;
  capabilities: Record<string, boolean> | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
}

export interface RuntimeReachWorkspace {
  id: string;
  name: string;
}

export interface RuntimeBoundAgent {
  id: string;
  name: string;
  avatarUrl: string | null;
  provider: AgentProvider;
}

export interface RuntimeUsageSummary {
  days: number;
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface RuntimeDetail {
  runtime: Runtime;
  reach: RuntimeReachWorkspace[];
  agents: RuntimeBoundAgent[];
  usage: RuntimeUsageSummary;
}

export interface RuntimeUsageByDay {
  date: string;
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RuntimeUsageByAgent {
  agentId: string | null;
  agentName: string | null;
  runs: number;
  costUsd: number;
  tokens: number;
}

export interface RuntimeUsageDetail {
  days: number;
  byDay: RuntimeUsageByDay[];
  byAgent: RuntimeUsageByAgent[];
}

export interface CreateRuntimePayload {
  name: string;
  kind?: "local" | "cloud";
  visibility?: RuntimeVisibility;
  maxConcurrency?: number;
  workspaceIds?: string[];
}

export interface UpdateRuntimePayload {
  name?: string;
  visibility?: RuntimeVisibility;
  maxConcurrency?: number;
  workspaceIds?: string[];
}

export interface CreateRepoPayload {
  name: string;
  url: string;
  defaultBranch?: string;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

// ---- 接口方法 ----
export const api = {
  register: (email: string, password: string, name?: string) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: { email, password, name },
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  me: () => request<{ user: AuthUser }>("/auth/me"),

  listWorkspaces: () =>
    request<{ workspaces: Workspace[] }>("/workspaces"),

  createWorkspace: (name: string, description?: string) =>
    request<{ workspace: Workspace }>("/workspaces", {
      method: "POST",
      body: { name, description },
    }),

  // ---- 成员 ----
  listMembers: (workspaceId: string) =>
    request<{ members: Member[] }>(`/workspaces/${workspaceId}/members`),

  // ---- 需求（issue）----
  listIssues: (workspaceId: string, params?: { status?: IssueStatus; assignee?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.assignee) qs.set("assignee", params.assignee);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ issues: Issue[] }>(`/workspaces/${workspaceId}/issues${suffix}`);
  },

  searchIssues: (workspaceId: string, q: string) =>
    request<{ issues: Issue[] }>(
      `/workspaces/${workspaceId}/issues/search?q=${encodeURIComponent(q)}`,
    ),

  createIssue: (workspaceId: string, payload: CreateIssuePayload) =>
    request<{ issue: Issue }>(`/workspaces/${workspaceId}/issues`, {
      method: "POST",
      body: payload,
    }),

  getIssue: (workspaceId: string, id: string) =>
    request<{ issue: IssueDetail }>(`/workspaces/${workspaceId}/issues/${id}`),

  updateIssue: (workspaceId: string, id: string, patch: UpdateIssuePayload) =>
    request<{ issue: IssueDetail }>(`/workspaces/${workspaceId}/issues/${id}`, {
      method: "PATCH",
      body: patch,
    }),

  listEvents: (workspaceId: string, id: string) =>
    request<{ events: IssueEvent[] }>(
      `/workspaces/${workspaceId}/issues/${id}/events`,
    ),

  addComment: (workspaceId: string, id: string, body: string) =>
    request<{ event: IssueEvent }>(
      `/workspaces/${workspaceId}/issues/${id}/events`,
      { method: "POST", body: { body } },
    ),

  // ---- 执行（run）+ 执行日志 ----
  listRuns: (workspaceId: string, issueId: string) =>
    request<{ runs: RunSummary[] }>(
      `/workspaces/${workspaceId}/issues/${issueId}/runs`,
    ),

  listRunEvents: (
    workspaceId: string,
    issueId: string,
    taskId: string,
    after?: number,
  ) =>
    request<{ events: RunEventRow[] }>(
      `/workspaces/${workspaceId}/issues/${issueId}/runs/${taskId}/events${
        after != null ? `?after=${after}` : ""
      }`,
    ),

  // SSE 实时流的完整 URL（EventSource 无法自定义请求头 → token 走查询参数）
  runStreamUrl: (
    workspaceId: string,
    issueId: string,
    taskId: string,
    after?: number,
  ) => {
    const qs = new URLSearchParams();
    const token = getToken();
    if (token) qs.set("access_token", token);
    if (after != null) qs.set("after", String(after));
    return `${API_BASE}/workspaces/${workspaceId}/issues/${issueId}/runs/${taskId}/stream?${qs.toString()}`;
  },

  // ---- 仓库 ----
  listRepos: (workspaceId: string) =>
    request<{ repos: Repo[] }>(`/workspaces/${workspaceId}/repos`),

  createRepo: (workspaceId: string, payload: CreateRepoPayload) =>
    request<{ repo: Repo }>(`/workspaces/${workspaceId}/repos`, {
      method: "POST",
      body: payload,
    }),

  // ---- 智能体 ----
  listAgents: (workspaceId: string) =>
    request<{ agents: Agent[] }>(`/workspaces/${workspaceId}/agents`),

  createAgent: (workspaceId: string, payload: CreateAgentPayload) =>
    request<{ agent: Agent }>(`/workspaces/${workspaceId}/agents`, {
      method: "POST",
      body: payload,
    }),

  updateAgent: (workspaceId: string, id: string, payload: UpdateAgentPayload) =>
    request<{ agent: Agent }>(`/workspaces/${workspaceId}/agents/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  deleteAgent: (workspaceId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/agents/${id}`, {
      method: "DELETE",
    }),

  getAgent: (workspaceId: string, id: string) =>
    request<AgentDetail>(`/workspaces/${workspaceId}/agents/${id}`),

  setAgentSkills: (workspaceId: string, id: string, skillIds: string[]) =>
    request<{ skills: AgentSkillRef[] }>(
      `/workspaces/${workspaceId}/agents/${id}/skills`,
      { method: "PUT", body: { skillIds } },
    ),

  // ---- 技能（Skill 库）----
  listSkills: (workspaceId: string) =>
    request<{ skills: Skill[] }>(`/workspaces/${workspaceId}/skills`),

  createSkill: (workspaceId: string, payload: CreateSkillPayload) =>
    request<{ skill: Skill }>(`/workspaces/${workspaceId}/skills`, {
      method: "POST",
      body: payload,
    }),

  importSkill: (workspaceId: string, url: string) =>
    request<{ skill: Skill }>(`/workspaces/${workspaceId}/skills/import`, {
      method: "POST",
      body: { url },
    }),

  getSkill: (workspaceId: string, id: string) =>
    request<SkillDetailResponse>(`/workspaces/${workspaceId}/skills/${id}`),

  updateSkill: (workspaceId: string, id: string, patch: UpdateSkillPayload) =>
    request<{ skill: SkillDetail }>(`/workspaces/${workspaceId}/skills/${id}`, {
      method: "PATCH",
      body: patch,
    }),

  deleteSkill: (workspaceId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/skills/${id}`, {
      method: "DELETE",
    }),

  // ---- 运行时 ----
  listRuntimes: (workspaceId: string) =>
    request<{ runtimes: Runtime[] }>(`/workspaces/${workspaceId}/runtimes`),

  createRuntime: (workspaceId: string, payload: CreateRuntimePayload) =>
    request<{ runtime: Runtime; token: string }>(
      `/workspaces/${workspaceId}/runtimes`,
      { method: "POST", body: payload },
    ),

  getRuntime: (workspaceId: string, id: string) =>
    request<RuntimeDetail>(`/workspaces/${workspaceId}/runtimes/${id}`),

  updateRuntime: (
    workspaceId: string,
    id: string,
    payload: UpdateRuntimePayload,
  ) =>
    request<{ runtime: Runtime }>(
      `/workspaces/${workspaceId}/runtimes/${id}`,
      { method: "PATCH", body: payload },
    ),

  getRuntimeUsage: (workspaceId: string, id: string, days?: number) =>
    request<RuntimeUsageDetail>(
      `/workspaces/${workspaceId}/runtimes/${id}/usage${
        days != null ? `?days=${days}` : ""
      }`,
    ),

  deleteRuntime: (workspaceId: string, id: string) =>
    request<{ ok: boolean; deleted: boolean }>(
      `/workspaces/${workspaceId}/runtimes/${id}`,
      { method: "DELETE" },
    ),
};
