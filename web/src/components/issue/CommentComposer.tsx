import { useMemo, useRef, useState } from "react";
import { Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useDraftState } from "@/lib/drafts";
import { api, type IssueEvent } from "@/lib/api-client";
import { ActorAvatar } from "@/components/ActorAvatar";
import {
  useAttachmentComposer,
  PendingAttachments,
} from "@/components/issue/AttachmentComposer";

// 评论输入框（独立组件）：comment / 附件 / posting 都是本组件的本地态，
// 打字只重渲染它自己，不再触发详情页与整段时间线（Timeline）的重渲染 —— 修「输入卡」。
// 发送成功后通过 onPosted 把新事件交回父组件（父组件负责追加到时间线 + 刷新）。
// @mention：输入 @ 弹 agent 补全下拉（↑↓ 选择、Enter/Tab 确认、Esc 关闭），
// 插入纯文本 `@名字 `，真正的解析/触发在服务端（lib/mentions.ts + dispatch fanOutMentions）。
export function CommentComposer({
  wsId,
  issueId,
  onPosted,
  agents,
}: {
  wsId: string | null;
  issueId: string;
  onPosted: (event: IssueEvent) => void | Promise<void>;
  // 本 workspace 的 agent（@ 补全候选）；不传则无补全，纯文本 @名字 仍会被服务端解析
  agents?: { id: string; name: string; avatarUrl?: string | null }[];
}) {
  const { t } = useUi();
  // 评论草稿按 issueId 持久化：切到别的页面 / 刷新 / 切到另一条需求后回来都不丢，
  // 发送成功后清除（见 postComment）。
  const [comment, setComment] = useDraftState(
    `comment:${issueId}`,
    "",
    (v) => v.trim().length === 0,
  );
  const [posting, setPosting] = useState(false);
  // 评论框附件编排（粘贴/拖拽/选文件 → 即传 → 待发；发评论时带 id）；待发清单同样按 issueId 持久化
  const att = useAttachmentComposer(wsId, `comment-att:${issueId}`);

  // ---- @ 补全 ----
  const taRef = useRef<HTMLTextAreaElement>(null);
  // mention 打开态：start = @ 在正文里的下标，query = @ 后已输入的片段
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const candidates = useMemo(() => {
    if (!mention || !agents?.length) return [];
    const q = mention.query.toLowerCase();
    return agents
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, agents]);

  // 光标前的文本匹配 `@片段` 才打开下拉；@ 前不能是 ASCII 字母数字（防 email 误触）
  function detectMention(el: HTMLTextAreaElement) {
    if (!agents?.length) return;
    const pos = el.selectionStart ?? 0;
    const before = el.value.slice(0, pos);
    const m = /(^|[^A-Za-z0-9_])@([^\s@]{0,32})$/.exec(before);
    if (m) setMention({ start: pos - m[2].length - 1, query: m[2] });
    else setMention(null);
    setActiveIdx(0);
  }

  function pickMention(name: string) {
    const el = taRef.current;
    if (!el || !mention) return;
    const pos = el.selectionStart ?? 0;
    const next = `${comment.slice(0, mention.start)}@${name} ${comment.slice(pos)}`;
    setComment(next);
    setMention(null);
    const caret = mention.start + name.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  async function postComment() {
    const body = comment.trim();
    if ((!body && att.pending.length === 0) || !wsId || posting) return;
    setPosting(true);
    try {
      const { event } = await api.addComment(
        wsId,
        issueId,
        body,
        att.pending.map((p) => p.id),
      );
      setComment("");
      att.reset();
      // 评论可能触发了 agent 执行 → 交回父组件追加 + 刷新（并启动轮询）
      await onPosted(event);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-4">
      {/* 待发附件：图片显缩略图（点开灯箱），其它显文件 chip */}
      <PendingAttachments pending={att.pending} onRemove={att.removeOne} />
      <div className="relative">
        <textarea
          ref={taRef}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            detectMention(e.target);
          }}
          onClick={(e) => detectMention(e.currentTarget)}
          onKeyDown={(e) => {
            // 中文等 IME 组字期间的 Enter/↑↓ 是给输入法的（选字/上屏），不能被下拉接管
            if (e.nativeEvent.isComposing) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              void postComment();
              return;
            }
            // 下拉打开时接管导航键
            if (mention && candidates.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => (i + 1) % candidates.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx(
                  (i) => (i - 1 + candidates.length) % candidates.length,
                );
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[activeIdx].name);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
              }
            }
          }}
          onBlur={() => {
            // 延迟关闭，让下拉项的 onMouseDown 先执行
            setTimeout(() => setMention(null), 150);
          }}
          onPaste={att.dropzone.onPaste}
          onDrop={att.dropzone.onDrop}
          onDragOver={att.dropzone.onDragOver}
          onDragLeave={att.dropzone.onDragLeave}
          placeholder={t("detail.commentPh")}
          className={cn(
            "min-h-[72px] w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-active-fg",
            att.dragOver && "border-active-fg ring-2 ring-active-fg/30",
          )}
        />
        {mention && candidates.length > 0 && (
          <div className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            {candidates.map((a, i) => (
              <button
                key={a.id}
                type="button"
                // mousedown 抢在 textarea blur 之前完成插入
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(a.name);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-foreground",
                  i === activeIdx && "bg-sidebar-accent",
                )}
              >
                <ActorAvatar
                  type="agent"
                  name={a.name}
                  url={a.avatarUrl}
                  className="size-5"
                />
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
          <Paperclip className="size-3.5" />
          {att.uploading ? t("detail.uploading") : t("detail.attach")}
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void att.pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <Button
          size="sm"
          disabled={
            (!comment.trim() && att.pending.length === 0) ||
            posting ||
            att.uploading
          }
          onClick={postComment}
          className="bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
        >
          {posting ? t("detail.posting") : t("detail.send")}
        </Button>
      </div>
    </div>
  );
}
