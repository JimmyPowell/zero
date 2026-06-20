import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/** 评论/正文的 Markdown 渲染（GFM：表格、任务列表、删除线等） */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-sm prose-zinc dark:prose-invert max-w-none break-words",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-a:text-active-fg prose-a:no-underline hover:prose-a:underline",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:border-border",
        "prose-img:rounded-lg",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 所有链接一律新标签打开 + 安全 rel —— 否则在 SPA 里点链接会顶掉当前页面（整个 Zero 应用被导航走）。
          // 作用在渲染层、与 href 无关，故对一切网址（含 gfm 自动识别的裸链接）一致生效。
          a({ node: _node, ...props }) {
            return <a {...props} target="_blank" rel="noopener noreferrer" />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
