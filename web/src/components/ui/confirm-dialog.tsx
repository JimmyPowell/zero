import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 通用确认弹窗（替代浏览器原生 window.confirm）。受控：open 由父组件管理。
// 复用项目既有浮层规范（.zero-overlay/.zero-dialog，详情页 Esc 处理据此让行），
// 视觉对齐 shadcn AlertDialog：标题 + 说明 + 取消/确认两枚按钮，destructive 时确认为红色实心。
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 打开时：Esc 取消、Enter 确认。捕获阶段拦截并 stopPropagation，
  // 避免被详情页等全局 Esc 监听抢先处理（如连带触发返回）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="zero-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/25 px-4 backdrop-blur-md"
      onClick={busy ? undefined : onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="zero-dialog w-full max-w-[400px] rounded-2xl border border-border bg-card/95 p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            {cancelText}
          </Button>
          <Button
            autoFocus
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              destructive && "bg-destructive text-white hover:bg-destructive/90",
            )}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
