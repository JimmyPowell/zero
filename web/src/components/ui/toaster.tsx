import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Check, AlertTriangle, X, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useToasts, dismissToast, type ToastItem } from "@/lib/toast-store";

function ToastCard({
  toast,
  onNavigate,
}: {
  toast: ToastItem;
  onNavigate: (to: string) => void;
}) {
  const { t } = useUi();
  const success = toast.variant === "success";
  const clickable = !!toast.to;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onNavigate(toast.to!) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onNavigate(toast.to!);
            }
          : undefined
      }
      className={cn(
        "zero-toast pointer-events-auto relative w-full rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-lg",
        clickable && "cursor-pointer transition-colors hover:bg-muted/50",
      )}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          dismissToast(toast.id);
        }}
        className="absolute right-2 top-2 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="close"
      >
        <X className="size-3.5" />
      </button>

      {/* 标题行：图标小圆 + 标题 */}
      <div className="flex items-center gap-2 pr-5">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            success
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-destructive/15 text-destructive",
          )}
        >
          {success ? (
            <Check className="size-3" />
          ) : (
            <AlertTriangle className="size-3" />
          )}
        </span>
        <span className="text-sm font-medium">{toast.title}</span>
      </div>

      {/* 详情行 */}
      {toast.description && (
        <div className="ml-7 mt-1 truncate text-sm text-muted-foreground">
          {toast.description}
        </div>
      )}

      {/* 跳转提示 */}
      {clickable && (
        <div className="ml-7 mt-1.5 inline-flex items-center gap-0.5 text-sm font-medium text-[#2563eb]">
          {t("toast.view")}
          <ArrowUpRight className="size-3.5" />
        </div>
      )}
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts();
  const navigate = useNavigate();
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onNavigate={(to) => {
            navigate(to);
            dismissToast(toast.id);
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
