import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { ActorAvatar } from "@/components/ActorAvatar";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { useIssues } from "@/lib/issues-store";
import { api } from "@/lib/api-client";
import {
  STATUS_ORDER,
  statusMeta,
  priorityMeta,
  issueKey,
} from "@/lib/issue-meta";
import type { Issue, IssueStatus } from "@/lib/api-client";

// 看板卡片（纯展示；拖拽预览复用同一组件）
function BoardCard({ issue, dragging }: { issue: Issue; dragging?: boolean }) {
  const { t } = useUi();
  const pm = priorityMeta[issue.priority];
  const PIcon = pm.Icon;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors",
        dragging
          ? "shadow-lg shadow-black/10"
          : "shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-sidebar-accent/50",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {issueKey(issue.number)}
        </span>
        <span title={t(pm.labelKey)} className="ml-auto flex shrink-0">
          <PIcon className={cn("size-3.5", pm.className)} />
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-foreground">{issue.title}</p>
      {issue.assignee && (
        <div className="mt-2 flex items-center">
          <ActorAvatar
            type={issue.assignee.type}
            name={issue.assignee.name}
            url={issue.assignee.avatarUrl}
            className="size-5 shrink-0"
          />
        </div>
      )}
    </div>
  );
}

// 可拖拽卡片：拖拽时本体淡出（浮层预览交给 DragOverlay）；拖拽刚结束时抑制误触点击
function DraggableCard({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
  });
  const wasDragged = useRef(false);
  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (wasDragged.current) {
          wasDragged.current = false;
          e.preventDefault();
          return;
        }
        onOpen(issue.id);
      }}
      className={cn(
        "w-full cursor-pointer touch-none",
        isDragging && "opacity-40",
      )}
    >
      <BoardCard issue={issue} />
    </button>
  );
}

// 单列（整列为 droppable + 纵向滚动）：列头 + 卡片堆叠
function Column({
  status,
  issues,
  onOpen,
}: {
  status: IssueStatus;
  issues: Issue[];
  onOpen: (id: string) => void;
}) {
  const { t } = useUi();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = statusMeta[status];
  const Icon = meta.Icon;

  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className={cn("size-4", meta.className)} />
        <span className="text-sm font-medium text-foreground">
          {t(meta.labelKey)}
        </span>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-1.5 transition-colors",
          isOver ? "bg-sidebar-accent/60" : "bg-muted/30",
        )}
      >
        {issues.map((i) => (
          <DraggableCard key={i.id} issue={i} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

// 需求看板：按状态分列，跨列拖拽 = 改状态（走现成 PATCH，自动写时间线）
export function RequirementsBoard() {
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
  const { issues, replace } = useIssues();
  const wsId = currentWorkspace?.id ?? null;

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const activeIssue = activeId
    ? (issues.find((i) => i.id === activeId) ?? null)
    : null;

  async function move(issueId: string, newStatus: IssueStatus) {
    const issue = issues.find((i) => i.id === issueId);
    if (!issue || issue.status === newStatus || !wsId) return;
    const prev = issue;
    replace({ ...issue, status: newStatus }); // 乐观更新
    try {
      const { issue: updated } = await api.updateIssue(wsId, issueId, {
        status: newStatus,
      });
      replace(updated);
    } catch {
      replace(prev); // 失败回滚
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = e;
        if (over) void move(active.id as string, over.id as IssueStatus);
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto pb-1">
        {STATUS_ORDER.map((s) => (
          <Column
            key={s}
            status={s}
            issues={issues.filter((i) => i.status === s)}
            onOpen={(id) => navigate(`/issues/${id}`)}
          />
        ))}
      </div>
      <DragOverlay>
        {activeIssue ? (
          <div className="w-[272px] rotate-1 cursor-grabbing">
            <BoardCard issue={activeIssue} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
