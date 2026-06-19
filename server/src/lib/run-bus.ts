// 进程内发布 / 订阅：daemon 上报的执行事件实时分发给正在订阅的 SSE 连接。
// 单进程 Bun 服务足够；DB 始终是真相，SSE 只是优化（断线可按 seq 从 DB 补齐）。
// 多实例部署时再换 Redis / pg LISTEN —— 当前不需要。

type Listener = (ev: unknown) => void;

const channels = new Map<string, Set<Listener>>();

export function publish(taskId: string, ev: unknown): void {
  const ls = channels.get(taskId);
  if (!ls) return;
  for (const fn of ls) {
    try {
      fn(ev);
    } catch {
      /* 单个订阅者异常不影响其他 */
    }
  }
}

export function subscribe(taskId: string, fn: Listener): () => void {
  let ls = channels.get(taskId);
  if (!ls) {
    ls = new Set();
    channels.set(taskId, ls);
  }
  ls.add(fn);
  return () => {
    const s = channels.get(taskId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) channels.delete(taskId);
  };
}
