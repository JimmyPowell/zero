import { useState } from "react";
import { Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { api, type IssueEvent } from "@/lib/api-client";
import {
  useAttachmentComposer,
  PendingAttachments,
} from "@/components/issue/AttachmentComposer";

// 评论输入框（独立组件）：comment / 附件 / posting 都是本组件的本地态，
// 打字只重渲染它自己，不再触发详情页与整段时间线（Timeline）的重渲染 —— 修「输入卡」。
// 发送成功后通过 onPosted 把新事件交回父组件（父组件负责追加到时间线 + 刷新）。
export function CommentComposer({
  wsId,
  issueId,
  onPosted,
}: {
  wsId: string | null;
  issueId: string;
  onPosted: (event: IssueEvent) => void | Promise<void>;
}) {
  const { t } = useUi();
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  // 评论框附件编排（粘贴/拖拽/选文件 → 即传 → 待发；发评论时带 id）
  const att = useAttachmentComposer(wsId);

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
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void postComment();
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
