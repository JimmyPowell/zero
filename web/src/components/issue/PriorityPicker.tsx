import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { priorityMeta, PRIORITY_ORDER } from "@/lib/issue-meta";
import type { IssuePriority } from "@/lib/api-client";
import { pillTrigger } from "./pill";

export function PriorityPicker({
  value,
  onChange,
}: {
  value: IssuePriority;
  onChange: (v: IssuePriority) => void;
}) {
  const { t } = useUi();
  const m = priorityMeta[value];
  const Icon = m.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillTrigger}>
        <Icon className={cn("size-4", m.className)} />
        <span>{t(m.labelKey)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {PRIORITY_ORDER.map((p) => {
          const pm = priorityMeta[p];
          const PIcon = pm.Icon;
          return (
            <DropdownMenuItem key={p} onSelect={() => onChange(p)}>
              <PIcon className={cn("size-4", pm.className)} />
              <span className="flex-1">{t(pm.labelKey)}</span>
              <DropdownMenuCheck active={p === value} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
