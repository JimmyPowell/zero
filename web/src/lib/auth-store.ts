import { useSyncExternalStore } from "react";

import {
  api,
  getToken,
  setToken,
  type AuthUser,
  type Workspace,
} from "./api-client";

interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  user: AuthUser | null;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
}

const CURRENT_WS_KEY = "zero-current-workspace";

const state: AuthState = {
  status: "loading",
  user: null,
  workspaces: [],
  currentWorkspaceId: localStorage.getItem(CURRENT_WS_KEY),
};

const listeners = new Set<() => void>();
function emit() {
  // 拷贝快照引用，保证 useSyncExternalStore 检测到变化
  snapshot = { ...state };
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let snapshot: AuthState = { ...state };

function setCurrentWorkspace(id: string | null) {
  state.currentWorkspaceId = id;
  if (id) localStorage.setItem(CURRENT_WS_KEY, id);
  else localStorage.removeItem(CURRENT_WS_KEY);
  emit();
}

// 确保 currentWorkspaceId 落在现有列表内（否则取第一个）
function reconcileCurrent() {
  if (state.workspaces.length === 0) {
    state.currentWorkspaceId = null;
    return;
  }
  const exists = state.workspaces.some(
    (w) => w.id === state.currentWorkspaceId,
  );
  if (!exists) {
    state.currentWorkspaceId = state.workspaces[0]!.id;
    localStorage.setItem(CURRENT_WS_KEY, state.currentWorkspaceId);
  }
}

async function loadWorkspaces() {
  const { workspaces } = await api.listWorkspaces();
  state.workspaces = workspaces;
  reconcileCurrent();
  emit();
}

// 应用启动：有 token 就拉用户 + 工作空间
export async function restoreAuth() {
  if (!getToken()) {
    state.status = "anonymous";
    emit();
    return;
  }
  try {
    const { user } = await api.me();
    state.user = user;
    await loadWorkspaces();
    state.status = "authenticated";
    emit();
  } catch {
    // token 失效
    setToken(null);
    state.status = "anonymous";
    state.user = null;
    state.workspaces = [];
    emit();
  }
}

async function afterAuth(token: string, user: AuthUser) {
  setToken(token);
  state.user = user;
  await loadWorkspaces();
  state.status = "authenticated";
  emit();
}

export const authActions = {
  async login(email: string, password: string) {
    const { token, user } = await api.login(email, password);
    await afterAuth(token, user);
  },
  async register(email: string, password: string, name?: string) {
    const { token, user } = await api.register(email, password, name);
    await afterAuth(token, user);
  },
  logout() {
    setToken(null);
    setCurrentWorkspace(null);
    state.status = "anonymous";
    state.user = null;
    state.workspaces = [];
    emit();
  },
  async createWorkspace(name: string, description?: string) {
    const { workspace } = await api.createWorkspace(name, description);
    state.workspaces = [...state.workspaces, workspace];
    setCurrentWorkspace(workspace.id);
    return workspace;
  },
  selectWorkspace(id: string) {
    setCurrentWorkspace(id);
  },
  refreshWorkspaces: loadWorkspaces,
};

export function useAuth() {
  const s = useSyncExternalStore(subscribe, () => snapshot);
  const currentWorkspace =
    s.workspaces.find((w) => w.id === s.currentWorkspaceId) ?? null;
  return { ...s, currentWorkspace, ...authActions };
}
