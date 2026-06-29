import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

// 「草稿」持久化：把用户输入但还没提交的内容按 key 存进 localStorage，
// 这样组件卸载（切到别的页面）、整页刷新、甚至直接切到另一条需求后再回来，
// 都能把没发出去的内容恢复回来。与 ui-store 一样走 localStorage（主题/语言/排序也在那）。
//
// key 传空串表示「不持久化」（退化成普通内存态）——这样持久化可由数据开关，
// 而不必条件式调用 hook（避免违反 React 的 hooks 规则）。

const PREFIX = "zero-draft:";

export function readDraft<T>(key: string, fallback: T): T {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

// empty 为真时删掉 key（草稿等于空），避免 localStorage 里堆垃圾。
export function writeDraft<T>(key: string, value: T, empty: boolean): void {
  if (!key) return;
  try {
    if (empty) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* localStorage 不可用 / 隐私模式 / 写满：忽略，不影响输入 */
  }
}

export function clearDraft(key: string): void {
  if (!key) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

// 用法同 useState，但按 key 自动持久化到 localStorage。
// isEmpty(v) 为真时视为「空草稿」并删除该 key（如清空了输入框）。
export function useDraftState<T>(
  key: string,
  initial: T,
  isEmpty: (v: T) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  // 把 key 一起存进 state，便于在 render 阶段察觉 key 变化。
  const [snap, setSnap] = useState<{ key: string; value: T }>(() => ({
    key,
    value: readDraft(key, initial),
  }));

  // isEmpty 始终取最新（调用处一般传字面量函数）。
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  // render 阶段同步响应 key 变化（React 官方「派生自 props 的 state」写法）：
  // 例如详情页直接从需求 A 切到 B，issueId 变了就立刻加载 B 的草稿。
  let value = snap.value;
  if (snap.key !== key) {
    value = readDraft(key, initial);
    setSnap({ key, value });
  }

  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setSnap((prev) => {
      const next =
        typeof action === "function"
          ? (action as (p: T) => T)(prev.value)
          : action;
      // 写在 setter 里（而非 effect）：始终用「设值那一刻」的 key，
      // 避免 key 切换的瞬间把旧值错写到新 key 下。
      writeDraft(prev.key, next, isEmptyRef.current(next));
      return { key: prev.key, value: next };
    });
  }, []);

  return [value, set];
}
