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
  runtimeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPayload {
  name: string;
  provider?: AgentProvider;
  model?: string;
  instructions?: string;
  runtimeId?: string | null;
}

export interface UpdateAgentPayload {
  name?: string;
  provider?: AgentProvider;
  model?: string | null;
  instructions?: string | null;
  runtimeId?: string | null;
}

export interface Runtime {
  id: string;
  name: string;
  kind: "local" | "cloud";
  online: boolean;
  capabilities: Record<string, boolean> | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
}

export interface CreateRuntimePayload {
  name: string;
  kind?: "local" | "cloud";
}

export interface CreateRepoPayload {
  name: string;
  url: string;
  defaultBranch?: string;
}

// ---- 通知渠道 ----
export type ChannelKind = "email" | "telegram" | "wecom" | "feishu" | "webpush";

export interface ChannelBinding {
  id: string;
  kind: ChannelKind;
  // email: {address}；wecom: {target}；telegram: {chatId}（均经绑定码/填值关联）
  config: { address?: string; target?: string; chatId?: string } & Record<
    string,
    unknown
  >;
  enabled: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

// 仅 email 走 upsert；wecom 走绑定码流程（createWecomLinkCode）
export interface UpsertChannelPayload {
  kind: "email";
  address: string;
  enabled?: boolean;
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

  // ---- 运行时 ----
  listRuntimes: (workspaceId: string) =>
    request<{ runtimes: Runtime[] }>(`/workspaces/${workspaceId}/runtimes`),

  createRuntime: (workspaceId: string, payload: CreateRuntimePayload) =>
    request<{ runtime: Runtime; token: string }>(
      `/workspaces/${workspaceId}/runtimes`,
      { method: "POST", body: payload },
    ),

  deleteRuntime: (workspaceId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/runtimes/${id}`, {
      method: "DELETE",
    }),

  // ---- 通知渠道 ----
  listChannels: (workspaceId: string) =>
    request<{ channels: ChannelBinding[] }>(
      `/workspaces/${workspaceId}/channels`,
    ),

  upsertChannel: (workspaceId: string, payload: UpsertChannelPayload) =>
    request<{ channel: ChannelBinding }>(
      `/workspaces/${workspaceId}/channels`,
      { method: "POST", body: payload },
    ),

  deleteChannel: (workspaceId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/channels/${id}`, {
      method: "DELETE",
    }),

  // 生成企业微信绑定码（发给智能机器人完成关联）
  createWecomLinkCode: (workspaceId: string) =>
    request<{ code: string }>(
      `/workspaces/${workspaceId}/channels/wecom/link-code`,
      { method: "POST", body: {} },
    ),

  // 生成 Telegram 绑定码（发给 bot 完成关联）
  createTelegramLinkCode: (workspaceId: string) =>
    request<{ code: string }>(
      `/workspaces/${workspaceId}/channels/telegram/link-code`,
      { method: "POST", body: {} },
    ),
};
