// 浏览器 → server → daemon 的即时请求中继（如浏览执行机目录）。
// server 永不反连 daemon：daemon 长轮询 POST /daemon/rpc/poll 领取请求，本地执行后
// POST /daemon/rpc/:id/result 回传；发起方在 server 内 await 结果，超时即视为运行时无响应。
// 纯内存、单 server 实例（与 run-bus 相同的假设）；请求丢了由发起方超时兜底，无需持久化。

export type RpcOp = "fs.list";

export interface RpcRequest {
  id: string;
  op: RpcOp;
  args: Record<string, unknown>;
}

export type RpcResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

const queues = new Map<string, RpcRequest[]>(); // runtimeId → 待领取
const pollers = new Map<string, Set<() => void>>(); // runtimeId → 挂起中的长轮询
const pending = new Map<
  string,
  {
    runtimeId: string;
    resolve: (r: RpcResult) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function takeQueue(runtimeId: string): RpcRequest[] {
  const q = queues.get(runtimeId) ?? [];
  queues.delete(runtimeId);
  return q;
}

// 发起一次请求并等 daemon 回传。超时返回 { ok:false, error:"timeout" }。
export function callRuntime(
  runtimeId: string,
  op: RpcOp,
  args: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<RpcResult> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const q = queues.get(runtimeId);
      if (q) queues.set(runtimeId, q.filter((r) => r.id !== id));
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    pending.set(id, { runtimeId, resolve, timer });
    queues.set(runtimeId, [...(queues.get(runtimeId) ?? []), { id, op, args }]);
    for (const wake of pollers.get(runtimeId) ?? []) wake();
  });
}

// daemon 长轮询：有积压立即返回，否则挂起至新请求到来或 holdMs 到期。
// 连接断开（signal abort）时只摘掉自己、不取走队列，避免请求被投给已断开的连接。
export function pollRequests(
  runtimeId: string,
  holdMs: number,
  signal?: AbortSignal,
): Promise<RpcRequest[]> {
  const now = takeQueue(runtimeId);
  if (now.length || signal?.aborted) return Promise.resolve(now);
  return new Promise((resolve) => {
    const set = pollers.get(runtimeId) ?? new Set<() => void>();
    pollers.set(runtimeId, set);
    const finish = (take: boolean) => {
      clearTimeout(timer);
      set.delete(wake);
      if (set.size === 0) pollers.delete(runtimeId);
      signal?.removeEventListener("abort", onAbort);
      resolve(take ? takeQueue(runtimeId) : []);
    };
    const wake = () => finish(true);
    const onAbort = () => finish(false);
    const timer = setTimeout(wake, holdMs);
    set.add(wake);
    signal?.addEventListener("abort", onAbort);
  });
}

// daemon 回传结果；只接受发给本运行时的请求
export function resolveRequest(
  runtimeId: string,
  id: string,
  result: RpcResult,
): boolean {
  const p = pending.get(id);
  if (!p || p.runtimeId !== runtimeId) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(result);
  return true;
}
