import { useEffect, useState } from "react";

import type { Locale } from "./ui-store";

// 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 月日
export function relativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const zh = locale === "zh";

  if (s < 60) return zh ? "刚刚" : "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return zh ? `${m} 分钟前` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return zh ? `${d} 天前` : `${d}d ago`;

  const date = new Date(iso);
  if (zh) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// 实时运行时长（毫秒）：从 startIso 起算到 endIso（完成）；endIso 为空且 active 时
// 每秒自增。active 变 false → 定时器清掉、now 冻结在最后一拍 → 显示自动定格，无闪烁；
// 随后拿到权威 endIso 即无缝对齐服务端真值。startIso 为空（如排队中未开跑）→ 返回 null。
export function useElapsedMs(
  startIso: string | null,
  endIso: string | null,
  active: boolean,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [active]);
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now;
  return Math.max(0, end - start);
}

// 时长格式化：12s / 3m 05s / 1h 02m（秒级整数，避免实时跳动时抖动）
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}
