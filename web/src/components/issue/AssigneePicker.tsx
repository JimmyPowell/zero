import { UserPlus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { ActorAvatar } from "@/components/ActorAvatar";
import { useUi } from "@/lib/ui-store";
import type { Member, Agent } from "@/lib/api-client";
import { pillTrigger } from "./pill";

export type AssigneeValue = { type: "member" | "agent"; id: string } | null;

export function AssigneePicker({
  members,
  agents,
  value,
  onChange,
}: {
  members: Member[];
  agents: Agent[];
  value: AssigneeValue;
  onChange: (assignee: AssigneeValue) => void;
}) {
  const { t } = useUi();

  const selected =
    value?.type === "member"
      ? members.find((m) => m.id === value.id)
      : value?.type === "agent"
        ? agents.find((a) => a.id === value.id)
        : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillTrigger}>
        {selected && value ? (
          <>
            <ActorAvatar
              type={value.type}
              name={selected.name}
              url={selected.avatarUrl}
              className="size-[18px]"
            />
            <span className="max-w-[120px] truncate">{selected.name}</span>
          </>
        ) : (
          <>
            <UserPlus className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t("issue.assign")}</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className="inline-flex size-[18px] items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
            ·
          </span>
          <span className="flex-1">{t("issue.unassigned")}</span>
          <DropdownMenuCheck active={value == null} />
        </DropdownMenuItem>

        {members.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <span className="text-xs text-muted-foreground">
                {t("issue.members")}
              </span>
            </DropdownMenuLabel>
            {members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => onChange({ type: "member", id: m.id })}
              >
                <ActorAvatar
                  type="member"
                  name={m.name}
                  url={m.avatarUrl}
                  className="size-[18px]"
                />
                <span className="flex-1 truncate">{m.name}</span>
                <DropdownMenuCheck
                  active={value?.type === "member" && value.id === m.id}
                />
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          <span className="text-xs text-muted-foreground">
            {t("issue.agents")}
          </span>
        </DropdownMenuLabel>
        {agents.length > 0 ? (
          agents.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onSelect={() => onChange({ type: "agent", id: a.id })}
            >
              <ActorAvatar
                type="agent"
                name={a.name}
                url={a.avatarUrl}
                className="size-[18px]"
              />
              <span className="flex-1 truncate">{a.name}</span>
              <DropdownMenuCheck
                active={value?.type === "agent" && value.id === a.id}
              />
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-2.5 py-1.5 text-xs text-muted-foreground/70">
            {t("issue.noAgents")}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
