import { useSyncExternalStore } from "react";

// 轻量 toast 系统（无第三方依赖，沿用本项目模块 store + useSyncExternalStore 模式）。
// 触发与渲染解耦：toast.success/error 可在任意处调用（无需 hook），
// 渲染由 <Toaster/>（挂在 Router 内）负责，可点击的 toast 由它用 useNavigate 跳转。

export type ToastVariant = "success" | "error";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  to?: string; // 设置后整条可点击 → 跳转该路由
  duration: number;
}

interface ToastInput {
  title: string;
  description?: string;
  to?: string;
  duration?: number;
}

let snapshot: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit() {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dismissToast(id: string) {
  const tm = timers.get(id);
  if (tm) {
    clearTimeout(tm);
    timers.delete(id);
  }
  snapshot = snapshot.filter((t) => t.id !== id);
  emit();
}

function push(variant: ToastVariant, input: ToastInput): string {
  const id = `t${++seq}`;
  const duration = input.duration ?? 5000;
  snapshot = [
    ...snapshot,
    {
      id,
      variant,
      title: input.title,
      description: input.description,
      to: input.to,
      duration,
    },
  ];
  emit();
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration),
  );
  return id;
}

export const toast = {
  success: (input: ToastInput) => push("success", input),
  error: (input: ToastInput) => push("error", input),
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
