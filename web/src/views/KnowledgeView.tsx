import { useEffect, useState, type MouseEvent } from "react";
import { Plus, BookText, Trash2, Pin } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { api, type KbDoc } from "@/lib/api-client";

function DocGroup({
  label,
  docs,
  activePath,
  onOpen,
  onRemove,
}: {
  label: string;
  docs: KbDoc[];
  activePath: string | null;
  onOpen: (d: KbDoc) => void;
  onRemove: (d: KbDoc, e: MouseEvent) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground/55">
        {label}
      </p>
      {docs.map((d) => (
        <div
          key={d.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(d)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen(d);
          }}
          className={cn(
            "group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm",
            activePath === d.path
              ? "bg-active-bg font-medium text-active-fg"
              : "text-foreground hover:bg-sidebar-accent",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{d.title || d.path}</span>
          {d.pinned && <Pin className="size-3 shrink-0 text-active-fg" />}
          <button
            type="button"
            onClick={(e) => onRemove(d, e)}
            className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function KnowledgeView() {
  const { t } = useUi();
  const { currentWorkspace } = useAuth();
  const wsId = currentWorkspace?.id ?? null;

  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [activePath, setActivePath] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [docLoading, setDocLoading] = useState(false);

  function reload() {
    if (!wsId) return;
    setStatus("loading");
    api
      .listKbDocs(wsId)
      .then((r) => {
        setDocs(r.docs);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  async function openDoc(d: KbDoc) {
    if (!wsId) return;
    setIsNew(false);
    setActivePath(d.path);
    setPath(d.path);
    setPinned(d.pinned);
    setMode("preview");
    setDocLoading(true);
    try {
      const r = await api.getKbDoc(wsId, d.path);
      setContent(r.content);
    } catch {
      setContent("");
    }
    setDocLoading(false);
  }
  function newDoc() {
    setIsNew(true);
    setActivePath(null);
    setPath("");
    setContent("");
    setPinned(false);
    setMode("edit");
  }
  async function save() {
    if (!wsId || !path.trim() || saving) return;
    setSaving(true);
    try {
      await api.putKbDoc(wsId, { path: path.trim(), content, pinned });
      setIsNew(false);
      setActivePath(path.trim());
      reload();
    } finally {
      setSaving(false);
    }
  }
  async function remove(d: KbDoc, e: MouseEvent) {
    e.stopPropagation();
    if (!wsId) return;
    if (!window.confirm(t("kb.deleteConfirm"))) return;
    await api.deleteKbDoc(wsId, d.path);
    if (activePath === d.path) {
      setActivePath(null);
      setPath("");
      setContent("");
      setIsNew(false);
    }
    reload();
  }

  const team = docs.filter((d) => d.scope === "workspace");
  const proj = docs.filter((d) => d.scope === "project");
  const editing = isNew || activePath != null;

  return (
    <Panel className="flex">
      {/* 左：文档列表（团队 / 项目） */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border pr-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("kb.title")}
          </h2>
          {wsId && (
            <Button size="sm" variant="outline" onClick={newDoc}>
              <Plus className="size-3.5" />
              {t("kb.new")}
            </Button>
          )}
        </div>
        {status === "ready" && docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center">
            <BookText className="mx-auto size-6 text-muted-foreground/60" />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("kb.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DocGroup
              label={t("kb.team")}
              docs={team}
              activePath={activePath}
              onOpen={openDoc}
              onRemove={remove}
            />
            <DocGroup
              label={t("kb.projects")}
              docs={proj}
              activePath={activePath}
              onOpen={openDoc}
              onRemove={remove}
            />
          </div>
        )}
      </div>

      {/* 右：编辑器 / 预览 */}
      <div className="flex min-w-0 flex-1 flex-col pl-4">
        {!editing ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("kb.pickDoc")}
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t("kb.pathPh")}
                disabled={!isNew}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground outline-none disabled:opacity-70"
              />
              <label
                className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
                title={t("kb.pinHint")}
              >
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                />
                <Pin className="size-3.5" />
                {t("kb.pin")}
              </label>
              <div className="flex shrink-0 items-center rounded-lg border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs",
                    mode === "edit"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {t("kb.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("preview")}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs",
                    mode === "preview"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {t("kb.preview")}
                </button>
              </div>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={saving || !path.trim()}
                className="shrink-0 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
              >
                {saving ? t("kb.saving") : t("kb.save")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
              {docLoading ? (
                <p className="p-4 text-sm text-muted-foreground">
                  {t("kb.loading")}
                </p>
              ) : mode === "edit" ? (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("kb.contentPh")}
                  className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm text-foreground outline-none"
                />
              ) : (
                <div className="p-4 text-sm">
                  <Markdown>{content || "_(空)_"}</Markdown>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
