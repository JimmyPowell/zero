import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";

// 折叠阈值（px）：读视图超过这个高度就 clamp + 底部渐隐 + 展开按钮
const COLLAPSE_PX = 184;

// Issue 描述：默认读视图（长文折叠 + 展开/收起），点击进入编辑（textarea 自动增高、
// 失焦保存）。替代原来「定高内部滚动」的 textarea。
export function DescriptionField({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (next: string) => void;
}) {
  const { t } = useUi();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const readRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 外部值变化（保存成功 / 切换 issue）时同步草稿
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // 读视图测量是否超长（scrollHeight 取完整内容高度，与是否展开无关）
  useLayoutEffect(() => {
    if (editing) return;
    const el = readRef.current;
    if (el) setOverflowing(el.scrollHeight > COLLAPSE_PX + 8);
  }, [value, editing]);

  // textarea 自动增高（去掉内部滚动）
  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    if (editing) grow();
  }, [editing]);

  const save = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          grow();
        }}
        onBlur={save}
        placeholder={placeholder}
        className="mt-2 w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    );
  }

  // 空描述：占位，点一下进入编辑
  if (!value.trim()) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2 block w-full text-left text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        {placeholder}
      </button>
    );
  }

  const collapsed = overflowing && !expanded;
  return (
    <div className="mt-2">
      <div
        ref={readRef}
        onClick={() => setEditing(true)}
        style={collapsed ? { maxHeight: COLLAPSE_PX } : undefined}
        className={cn(
          "relative cursor-text text-sm leading-relaxed whitespace-pre-wrap text-foreground",
          collapsed && "overflow-hidden",
        )}
      >
        {value}
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              expanded && "rotate-180",
            )}
          />
          {expanded ? t("detail.descCollapse") : t("detail.descExpand")}
        </button>
      )}
    </div>
  );
}
