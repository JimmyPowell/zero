import { Terminal } from "lucide-react";

import claudeUrl from "@/assets/providers/claude.svg";
import codexUrl from "@/assets/providers/codex.svg";
import opencodeUrl from "@/assets/providers/opencode.svg";
import kimiUrl from "@/assets/providers/kimi.svg";
import type { AgentProvider } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// 各 provider 的品牌图标（取自公开图标库 Simple Icons 的单色商标）。
// 用 CSS mask + currentColor 渲染 —— 随主题自适应（浅/深色都可见），无需额外依赖。
// 没有公开图标的（如 codebuddy）回退到通用 Terminal 字形。
const ICONS: Partial<Record<AgentProvider, string>> = {
  claude_code: claudeUrl,
  codex: codexUrl,
  opencode: opencodeUrl,
  kimi: kimiUrl,
};

export function ProviderIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const url = ICONS[provider as AgentProvider];
  if (!url) return <Terminal className={cn("size-3.5", className)} />;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3.5 shrink-0 bg-current", className)}
      style={{
        maskImage: `url(${url})`,
        WebkitMaskImage: `url(${url})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
