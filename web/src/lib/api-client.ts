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

// 附件签名 URL 是相对路径（/attachments/:id?...），拼上 API 基址即可直接用于 <img>/下载
export function attachmentUrl(signedPath: string): string {
  return signedPath.startsWith("http") ? signedPath : `${API_BASE}${signedPath}`;
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
  | "blocked"
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
  project: { id: string; title: string | null; slug: string | null } | null;
  creatorId: string;
  createdAt: string;
  // 最新活动时间：任意事件（评论/模型回复/状态变更/执行）的最新时间，无事件回退创建时间
  lastActivityAt: string;
  // 「我发给 agent 的最新一条评论」摘要（已折叠空白/限长），无则为 null
  lastMessage: string | null;
  updatedAt: string;
}

export interface CreateIssuePayload {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeType?: "member" | "agent";
  assigneeId?: string;
  projectId?: string;
  repoId?: string;
  baseBranch?: string;
  workDir?: string;
  attachmentIds?: string[]; // 正文里粘贴/拖拽的附件，创建时 link 到新 issue
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
  | "run_queued"
  | "run_started"
  | "run_progress"
  | "run_finished"
  | "run_failed"
  | "run_cancelled"
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

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string; // 签名相对路径，用 attachmentUrl() 拼全
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
  attachments?: Attachment[];
  deleted?: boolean; // 软删的评论：body 为 null，前端渲染「已删除」占位
}

// 回收站项：已软删的需求
export interface TrashIssue extends Issue {
  deletedAt: string;
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
  // 子代理结构化：tool_use 自身 id / 所属子代理父调用 id（用于折叠嵌套）
  toolUseId?: string | null;
  parentToolUseId?: string | null;
  text: string | null;
  detail?: string | null;
  payload?: unknown;
  createdAt?: string;
}

// ---- 变更可视化（某次 run 改了哪些文件）----
export interface RunFileChange {
  id: string;
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
}

export interface RunChangeSummary {
  taskId: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  baselineSha: string | null;
  headSha: string | null;
}

export interface RunFilesResponse {
  summary: RunChangeSummary | null;
  files: RunFileChange[];
}

export interface UpdateIssuePayload {
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeType?: "member" | "agent" | null;
  assigneeId?: string | null;
  projectId?: string | null;
  repoId?: string | null;
  baseBranch?: string | null;
  workDir?: string | null;
}

export type AgentProvider =
  | "claude_code"
  | "codex"
  | "opencode"
  | "codebuddy"
  | "kimi";

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  avatarUrl: string | null;
  provider: AgentProvider;
  model: string | null;
  effort: AgentEffort | null;
  instructions: string | null;
  description: string | null;
  runtimeId: string | null;
  createdAt: string;
  updatedAt: string;
}

// 推理强度（仅 Claude 系 provider 生效）；null = 跟随 CLI 默认。
export type AgentEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface CreateAgentPayload {
  name: string;
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  instructions?: string;
  description?: string;
  runtimeId?: string | null;
}

export interface UpdateAgentPayload {
  name?: string;
  provider?: AgentProvider;
  model?: string | null;
  effort?: AgentEffort | null;
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
  // 无金额数据的运行数（cost 为空，如 codex 走 ChatGPT 订阅，无单价）
  noCostRuns: number;
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

// ---- 渠道服务端配置（A 层：SMTP 发信凭据，仅 owner/admin 可编辑）----
// 后端永不回传密码明文，只给 hasPassword 表示是否已设
export interface EmailProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  fromName: string;
  enabled: boolean;
  hasPassword: boolean;
  updatedAt: string | null;
}

export interface UpsertEmailProviderPayload {
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string; // 留空 = 不修改原密码
  from: string;
  fromName?: string;
  enabled?: boolean;
}

// ---- 项目（Project）----
export type ProjectStatus =
  | "planned"
  | "in_progress"
  | "paused"
  | "completed"
  | "cancelled";

export interface Project {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  description: string | null;
  icon: string | null;
  status: ProjectStatus;
  leadType: "member" | "agent" | null;
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResource {
  id: string;
  projectId: string;
  kind: string; // repo | knowledge | notion | gdoc | url | file …
  ref: Record<string, unknown>;
  label: string | null;
  position: number;
  createdAt: string;
}

export interface ProjectDetailResponse {
  project: Project;
  resources: ProjectResource[];
}

export interface CreateProjectPayload {
  title: string;
  slug?: string;
  description?: string;
  icon?: string;
  status?: ProjectStatus;
  leadId?: string;
}

export interface UpdateProjectPayload {
  title?: string;
  description?: string | null;
  icon?: string | null;
  status?: ProjectStatus;
  leadId?: string | null;
}

export interface AddProjectResourcePayload {
  kind: string;
  ref: Record<string, unknown>;
  label?: string;
  position?: number;
}

// ---- 知识库（团队 markdown 文档）----
export interface KbDoc {
  id: string;
  workspaceId: string;
  projectId: string | null;
  scope: "workspace" | "project";
  path: string;
  title: string | null;
  pinned: boolean;
  contentHash: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
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

  // ---- 删除 / 回收站（软删除）----
  deleteIssue: (workspaceId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/issues/${id}`, {
      method: "DELETE",
    }),

  restoreIssue: (workspaceId: string, id: string) =>
    request<{ issue: IssueDetail }>(
      `/workspaces/${workspaceId}/issues/${id}/restore`,
      { method: "POST", body: {} },
    ),

  listTrash: (workspaceId: string) =>
    request<{ issues: TrashIssue[] }>(`/workspaces/${workspaceId}/issues/trash`),

  deleteComment: (workspaceId: string, issueId: string, eventId: string) =>
    request<{ ok: boolean }>(
      `/workspaces/${workspaceId}/issues/${issueId}/events/${eventId}`,
      { method: "DELETE" },
    ),

  restoreComment: (workspaceId: string, issueId: string, eventId: string) =>
    request<{ ok: boolean }>(
      `/workspaces/${workspaceId}/issues/${issueId}/events/${eventId}/restore`,
      { method: "POST", body: {} },
    ),

  listEvents: (workspaceId: string, id: string) =>
    request<{ events: IssueEvent[] }>(
      `/workspaces/${workspaceId}/issues/${id}/events`,
    ),

  addComment: (
    workspaceId: string,
    id: string,
    body: string,
    attachmentIds?: string[],
  ) =>
    request<{ event: IssueEvent }>(
      `/workspaces/${workspaceId}/issues/${id}/events`,
      { method: "POST", body: { body, attachmentIds } },
    ),

  // 上传附件（multipart，单独走 fetch 不经 JSON request 封装）
  uploadAttachment: async (workspaceId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/attachments`, {
      method: "POST",
      headers,
      body: fd,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw new ApiError(res.status, (data?.error as string) ?? "上传失败");
    return data as { attachment: Attachment };
  },

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

  // 某次 run 的变更文件 + 逐文件 diff（变更可视化）
  listRunFiles: (workspaceId: string, issueId: string, taskId: string) =>
    request<RunFilesResponse>(
      `/workspaces/${workspaceId}/issues/${issueId}/runs/${taskId}/files`,
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

  // 取消（停止）一次 run
  cancelRun: (workspaceId: string, issueId: string, taskId: string) =>
    request<{ ok: boolean; status?: string; alreadyTerminal?: boolean }>(
      `/workspaces/${workspaceId}/issues/${issueId}/runs/${taskId}/cancel`,
      { method: "POST" },
    ),

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

  // ---- 渠道服务端配置（SMTP 发信凭据，仅 owner/admin）----
  getEmailProvider: (workspaceId: string) =>
    request<{ config: EmailProviderConfig | null; cryptoReady: boolean }>(
      `/workspaces/${workspaceId}/channel-config/email`,
    ),

  upsertEmailProvider: (
    workspaceId: string,
    payload: UpsertEmailProviderPayload,
  ) =>
    request<{ config: EmailProviderConfig | null }>(
      `/workspaces/${workspaceId}/channel-config/email`,
      { method: "PUT", body: payload },
    ),

  testEmailProvider: (workspaceId: string) =>
    request<{ ok?: boolean; sentTo?: string; error?: string }>(
      `/workspaces/${workspaceId}/channel-config/email/test`,
      { method: "POST", body: {} },
    ),

  // ---- 项目（Project）----
  listProjects: (workspaceId: string) =>
    request<{ projects: Project[] }>(`/workspaces/${workspaceId}/projects`),

  createProject: (workspaceId: string, payload: CreateProjectPayload) =>
    request<{ project: Project }>(`/workspaces/${workspaceId}/projects`, {
      method: "POST",
      body: payload,
    }),

  getProject: (workspaceId: string, id: string) =>
    request<ProjectDetailResponse>(
      `/workspaces/${workspaceId}/projects/${id}`,
    ),

  updateProject: (
    workspaceId: string,
    id: string,
    patch: UpdateProjectPayload,
  ) =>
    request<{ project: Project }>(`/workspaces/${workspaceId}/projects/${id}`, {
      method: "PATCH",
      body: patch,
    }),

  deleteProject: (workspaceId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/projects/${id}`, {
      method: "DELETE",
    }),

  addProjectResource: (
    workspaceId: string,
    id: string,
    payload: AddProjectResourcePayload,
  ) =>
    request<{ resource: ProjectResource }>(
      `/workspaces/${workspaceId}/projects/${id}/resources`,
      { method: "POST", body: payload },
    ),

  deleteProjectResource: (workspaceId: string, id: string, rid: string) =>
    request<{ ok: boolean }>(
      `/workspaces/${workspaceId}/projects/${id}/resources/${rid}`,
      { method: "DELETE" },
    ),

  // ---- 知识库 ----
  listKbDocs: (workspaceId: string, projectId?: string) =>
    request<{ docs: KbDoc[] }>(
      `/workspaces/${workspaceId}/knowledge${
        projectId ? `?projectId=${projectId}` : ""
      }`,
    ),

  getKbDoc: (workspaceId: string, path: string) =>
    request<{ path: string; content: string }>(
      `/workspaces/${workspaceId}/knowledge/doc?path=${encodeURIComponent(path)}`,
    ),

  putKbDoc: (
    workspaceId: string,
    payload: {
      path: string;
      content: string;
      projectId?: string | null;
      pinned?: boolean;
    },
  ) =>
    request<{ id: string; path: string }>(
      `/workspaces/${workspaceId}/knowledge/doc`,
      { method: "PUT", body: payload },
    ),

  deleteKbDoc: (workspaceId: string, path: string) =>
    request<{ ok: boolean }>(
      `/workspaces/${workspaceId}/knowledge/doc?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
};
