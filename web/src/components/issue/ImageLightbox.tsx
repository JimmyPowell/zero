import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

import { useUi } from "@/lib/ui-store";

export interface LightboxImage {
  url: string; // 已用 attachmentUrl() 拼好的完整签名地址
  filename: string;
}

// 页内大图预览（灯箱）：点遮罩/✕/Esc 关闭，←/→ 或左右按钮切换
export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useUi();
  const count = images.length;
  const cur = images[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && count > 1)
        onIndex((index - 1 + count) % count);
      else if (e.key === "ArrowRight" && count > 1)
        onIndex((index + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndex]);

  if (!cur) return null;

  return (
    <div
      className="zero-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 顶部栏：文件名 + 计数 + 原图链接 + 关闭 */}
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-3 px-5 py-3 text-sm text-white/90"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate">{cur.filename}</span>
        {count > 1 && (
          <span className="shrink-0 tabular-nums text-white/60">
            {index + 1} / {count}
          </span>
        )}
        <a
          href={cur.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {t("img.openOriginal")}
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* 上一张 */}
      {count > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index - 1 + count) % count);
          }}
          className="absolute left-3 flex size-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          aria-label="prev"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}

      {/* 图片本体（点图片本身不关闭） */}
      <img
        src={cur.url}
        alt={cur.filename}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />

      {/* 下一张 */}
      {count > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index + 1) % count);
          }}
          className="absolute right-3 flex size-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          aria-label="next"
        >
          <ChevronRight className="size-6" />
        </button>
      )}
    </div>
  );
}
