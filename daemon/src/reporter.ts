// 执行事件批量上报器：缓冲规范化事件，按阈值 / 节流上报到服务端。
// 上报失败只影响实时（DB 是真相，前端可按 seq 回放）—— 不重排、不阻塞执行。

import type { OutgoingRunEvent } from "./run-events";

const FLUSH_EVERY_MS = 300;
const FLUSH_AT_COUNT = 20;

export interface Reporter {
  push(e: OutgoingRunEvent): void;
  flush(): Promise<void>;
}

export function makeReporter(
  send: (events: OutgoingRunEvent[]) => Promise<void>,
): Reporter {
  let buf: OutgoingRunEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 串行化所有 flush，保证事件按 seq 顺序送达
  let chain: Promise<void> = Promise.resolve();

  function doFlush(): Promise<void> {
    if (buf.length === 0) return Promise.resolve();
    const batch = buf;
    buf = [];
    return send(batch).catch((err) => {
      console.error(`上报执行流失败：${(err as Error).message}`);
    });
  }

  function schedule() {
    chain = chain.then(doFlush);
  }

  return {
    push(e) {
      buf.push(e);
      if (buf.length >= FLUSH_AT_COUNT) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        schedule();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          schedule();
        }, FLUSH_EVERY_MS);
      }
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      schedule();
      await chain;
    },
  };
}
