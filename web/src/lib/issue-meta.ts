import {
  Circle,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  CircleCheck,
  CircleX,
  Minus,
  SignalLow,
  SignalMedium,
  SignalHigh,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { IssueStatus, IssuePriority } from "@/lib/api-client";

export interface OptionMeta {
  labelKey: string;
  Icon: LucideIcon;
  className: string; // 图标着色
}

export const STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];

export const statusMeta: Record<IssueStatus, OptionMeta> = {
  backlog: { labelKey: "status.backlog", Icon: CircleDashed, className: "text-muted-foreground" },
  todo: { labelKey: "status.todo", Icon: Circle, className: "text-muted-foreground" },
  in_progress: { labelKey: "status.in_progress", Icon: CircleDot, className: "text-amber-500" },
  // 评审中改用「暂停」形（圈内两竖），明显区别于进行中的「实心点」
  in_review: { labelKey: "status.in_review", Icon: CirclePause, className: "text-violet-500" },
  // 阻塞：圈内斜杠，红色，一眼"卡住"
  blocked: { labelKey: "status.blocked", Icon: CircleSlash, className: "text-rose-500" },
  done: { labelKey: "status.done", Icon: CircleCheck, className: "text-emerald-500" },
  cancelled: { labelKey: "status.cancelled", Icon: CircleX, className: "text-muted-foreground/60" },
};

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const priorityMeta: Record<IssuePriority, OptionMeta> = {
  urgent: { labelKey: "priority.urgent", Icon: TriangleAlert, className: "text-red-500" },
  high: { labelKey: "priority.high", Icon: SignalHigh, className: "text-foreground" },
  medium: { labelKey: "priority.medium", Icon: SignalMedium, className: "text-foreground" },
  low: { labelKey: "priority.low", Icon: SignalLow, className: "text-muted-foreground" },
  none: { labelKey: "priority.none", Icon: Minus, className: "text-muted-foreground" },
};

/** 展示用编号：ZERO-12 */
export function issueKey(num: number): string {
  return `ZERO-${num}`;
}
