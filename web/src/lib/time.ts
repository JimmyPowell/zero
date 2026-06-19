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
