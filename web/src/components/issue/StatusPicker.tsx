import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { statusMeta, STATUS_ORDER } from "@/lib/issue-meta";
import type { IssueStatus } from "@/lib/api-client";
import { pillTrigger } from "./pill";

export function StatusPicker({
  value,
  onChange,
}: {
  value: IssueStatus;
  onChange: (v: IssueStatus) => void;
}) {
  const { t } = useUi();
  const m = statusMeta[value];
  const Icon = m.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillTrigger}>
        <Icon className={cn("size-4", m.className)} />
        <span>{t(m.labelKey)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {STATUS_ORDER.map((s) => {
          const sm = statusMeta[s];
          const SIcon = sm.Icon;
          return (
            <DropdownMenuItem key={s} onSelect={() => onChange(s)}>
              <SIcon className={cn("size-4", sm.className)} />
              <span className="flex-1">{t(sm.labelKey)}</span>
              <DropdownMenuCheck active={s === value} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
