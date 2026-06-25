import {
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { Paperclip, X } from "lucide-react";

import { api, attachmentUrl, type Attachment } from "@/lib/api-client";
import {
  ImageLightbox,
  type LightboxImage,
} from "@/components/issue/ImageLightbox";

// 人类可读文件大小
export function fmtSize(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))}KB`;
  return `${n}B`;
}

// 「选了就传」附件编排：粘贴 / 拖拽 / 选文件统一走 pickFiles → 即传 → 进 pending 待发列表。
// 详情页评论框与新建需求弹窗共用：详情页发评论时带 pending.id，弹窗创建需求时带 pending.id。
export function useAttachmentComposer(workspaceId: string | null | undefined) {
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // 选文件即上传，拿到 id 进待发列表（提交时一起 link）
  async function pickFiles(files: FileList | null) {
    if (!files || !files.length || !workspaceId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const { attachment } = await api.uploadAttachment(workspaceId, file);
          setPending((prev) => [...prev, attachment]);
        } catch {
          /* 单个失败忽略，继续传其余 */
        }
      }
    } finally {
      setUploading(false);
    }
  }

  // 直接粘贴图片/文件：从剪贴板取出文件，走同一条上传链路
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault(); // 有文件时拦截，避免把文件名当文本插入
      void pickFiles(files);
    }
  }

  // 拖拽文件到输入框
  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) void pickFiles(files);
  }

  function onDragOver(e: DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    setDragOver((v) => (v ? v : true));
  }

  function onDragLeave() {
    setDragOver(false);
  }

  function removeOne(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
  }

  function reset() {
    setPending([]);
  }

  return {
    pending,
    uploading,
    dragOver,
    pickFiles,
    removeOne,
    reset,
    // 直接铺到 <textarea> 上：onPaste / onDrop / onDragOver / onDragLeave
    dropzone: { onPaste, onDrop, onDragOver, onDragLeave },
  };
}

// 待发附件区：图片显缩略图（点开灯箱左右切换），其它显文件 chip；自带灯箱状态。
export function PendingAttachments({
  pending,
  onRemove,
  className,
}: {
  pending: Attachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (pending.length === 0) return null;

  // 仅图片参与灯箱；按 id 定位，避免同名误开
  const imageAtts = pending.filter((p) => p.mime.startsWith("image/"));
  const images: LightboxImage[] = imageAtts.map((p) => ({
    url: attachmentUrl(p.url),
    filename: p.filename,
  }));

  return (
    <>
      <div className={className ?? "mb-2 flex flex-wrap items-start gap-2"}>
        {pending.map((a) => {
          const remove = () => onRemove(a.id);
          if (a.mime.startsWith("image/")) {
            const imgIdx = imageAtts.findIndex((x) => x.id === a.id);
            return (
              <div key={a.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setLightbox(imgIdx)}
                  className="block cursor-zoom-in"
                >
                  <img
                    src={attachmentUrl(a.url)}
                    alt={a.filename}
                    className="size-16 rounded-lg border border-border object-cover transition-opacity hover:opacity-90"
                  />
                </button>
                <button
                  type="button"
                  onClick={remove}
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          }
          return (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs"
            >
              <Paperclip className="size-3 text-muted-foreground" />
              <span className="max-w-[160px] truncate text-foreground">
                {a.filename}
              </span>
              <span className="text-muted-foreground">{fmtSize(a.size)}</span>
              <button
                type="button"
                onClick={remove}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
      </div>
      {lightbox != null && images[lightbox] && (
        <ImageLightbox
          images={images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
