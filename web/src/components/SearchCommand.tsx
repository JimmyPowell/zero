import { useEffect, useRef, useState } from "react";
import { Plus, Clock, Loader2 } from "lucide-react";

import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useUi } from "@/lib/ui-store";
import { api, type Issue } from "@/lib/api-client";
import { statusMeta, issueKey } from "@/lib/issue-meta";
import { cn } from "@/lib/utils";

function ResultRow({ issue }: { issue: Issue }) {
  const m = statusMeta[issue.status];
  const Icon = m.Icon;
  return (
    <>
      <Icon className={cn("size-4", m.className)} />
      <span className="w-[68px] shrink-0 font-mono text-xs text-muted-foreground">
        {issueKey(issue.number)}
      </span>
      <span className="truncate">{issue.title}</span>
    </>
  );
}

export function SearchCommand({
  open,
  workspaceId,
  recent,
  onClose,
  onNewIssue,
  onSelectIssue,
}: {
  open: boolean;
  workspaceId: string;
  recent: Issue[];
  onClose: () => void;
  onNewIssue: () => void;
  onSelectIssue: (issue: Issue) => void;
}) {
  const { t } = useUi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时清空查询并聚焦输入框
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    // 等挂载/绘制后再聚焦，确保光标落在搜索框内、键入能命中输入框
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 防抖服务端搜索
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { issues } = await api.searchIssues(workspaceId, q);
        if (!ctrl.signal.aborted) setResults(issues);
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query, workspaceId, open]);

  if (!open) return null;

  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="zero-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="zero-dialog w-full max-w-[600px] overflow-hidden rounded-2xl border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t("search.placeholder")}
          />
          <CommandList>
            {/* 快捷命令 */}
            <CommandGroup heading={t("search.commands")}>
              <CommandItem
                value="__new_issue__"
                onSelect={() => {
                  onClose();
                  onNewIssue();
                }}
              >
                <Plus className="text-muted-foreground" />
                {t("issue.create")}
              </CommandItem>
            </CommandGroup>

            {/* 有查询：搜索结果；无查询：最近 */}
            {hasQuery ? (
              <CommandGroup
                heading={
                  loading ? t("search.searching") : t("search.issuesGroup")
                }
              >
                {loading && results.length === 0 ? (
                  <div className="flex items-center gap-2 px-2.5 py-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {t("search.searching")}
                  </div>
                ) : (
                  results.map((issue) => (
                    <CommandItem
                      key={issue.id}
                      value={`issue-${issue.id}`}
                      onSelect={() => {
                        onClose();
                        onSelectIssue(issue);
                      }}
                    >
                      <ResultRow issue={issue} />
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
            ) : recent.length > 0 ? (
              <CommandGroup heading={t("search.recent")}>
                {recent.map((issue) => (
                  <CommandItem
                    key={issue.id}
                    value={`recent-${issue.id}`}
                    onSelect={() => {
                      onClose();
                      onSelectIssue(issue);
                    }}
                  >
                    <Clock className="text-muted-foreground" />
                    <span className="w-[68px] shrink-0 font-mono text-xs text-muted-foreground">
                      {issueKey(issue.number)}
                    </span>
                    <span className="truncate">{issue.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {hasQuery && !loading && results.length === 0 && (
              <CommandEmpty>{t("search.empty")}</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
