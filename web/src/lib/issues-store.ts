import { useSyncExternalStore } from "react";

import { api, ApiError, type Issue } from "./api-client";

interface IssuesState {
  workspaceId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  issues: Issue[];
  error: string | null;
  // 项目筛选：null=全部；NO_PROJECT=未分类；否则为某个 project.id
  projectFilter: string | null;
}

// 「未分类」哨兵：区分「不筛选(null)」与「只看没归属项目的需求」
export const NO_PROJECT = "__none__";

const state: IssuesState = {
  workspaceId: null,
  status: "idle",
  issues: [],
  error: null,
  projectFilter: null,
};

// 按当前筛选条件过滤需求列表（列表视图与看板视图共用同一口径）
export function filterByProject(
  issues: Issue[],
  projectFilter: string | null,
): Issue[] {
  if (projectFilter == null) return issues;
  if (projectFilter === NO_PROJECT) return issues.filter((i) => i.project == null);
  return issues.filter((i) => i.project?.id === projectFilter);
}

const listeners = new Set<() => void>();
let snapshot: IssuesState = { ...state };

function emit() {
  snapshot = { ...state };
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 加载某工作空间的需求；切换工作空间或强制刷新时重新拉取
async function load(workspaceId: string, opts: { force?: boolean } = {}) {
  if (!opts.force && state.workspaceId === workspaceId && state.status !== "idle") {
    return;
  }
  const switching = state.workspaceId !== workspaceId;
  state.workspaceId = workspaceId;
  state.status = "loading";
  // 切换工作空间时清掉筛选：旧项目 id 在新空间里不存在
  if (switching) {
    state.issues = [];
    state.projectFilter = null;
  }
  state.error = null;
  emit();

  try {
    const { issues } = await api.listIssues(workspaceId);
    // 防止竞态：期间工作空间又被切走则丢弃结果
    if (state.workspaceId !== workspaceId) return;
    state.issues = issues;
    state.status = "ready";
    emit();
  } catch (err) {
    if (state.workspaceId !== workspaceId) return;
    state.status = "error";
    state.error = err instanceof ApiError ? err.message : "加载失败";
    emit();
  }
}

// 新建成功后把新需求插到列表最前
function prepend(issue: Issue) {
  if (state.workspaceId == null) return;
  state.issues = [issue, ...state.issues];
  emit();
}

// 详情页改动后，用新值替换列表里对应项（保持概览同步）
function replace(issue: Issue) {
  state.issues = state.issues.map((i) =>
    i.id === issue.id ? { ...i, ...issue } : i,
  );
  emit();
}

// 切换项目筛选（列表/看板共用），值为 null / NO_PROJECT / project.id
function setProjectFilter(projectId: string | null) {
  if (state.projectFilter === projectId) return;
  state.projectFilter = projectId;
  emit();
}

export const issuesActions = {
  load,
  refresh: () => {
    if (state.workspaceId) return load(state.workspaceId, { force: true });
  },
  prepend,
  replace,
  setProjectFilter,
};

export function useIssues() {
  const s = useSyncExternalStore(subscribe, () => snapshot);
  return { ...s, ...issuesActions };
}
