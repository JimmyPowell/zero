import { useState } from "react";
import { ChevronDown, Check, Plus, LogOut, Settings } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";

interface Workspace {
  id: string;
  name: string;
}

// 占位工作空间数据，后续接入接口
const workspaces: Workspace[] = [
  { id: "default", name: "Zero" },
  { id: "team-a", name: "Team A" },
];

export function WorkspaceSwitcher() {
  const { t } = useUi();
  const [current, setCurrent] = useState<Workspace>(workspaces[0]);
  const userName = t("user.name");
  const initial = userName.charAt(0).toUpperCase();
  const wsInitial = current.name.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left outline-none transition-colors select-none hover:bg-sidebar-accent focus-visible:outline-none data-[state=open]:bg-sidebar-accent"
        >
          <span className="inline-flex size-[26px] flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb] text-sm font-bold text-white">
            {wsInitial}
          </span>
          <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground">
            {current.name}
          </span>
          <ChevronDown className="size-4 flex-shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[240px]">
        {/* 当前用户信息 */}
        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          <span className="inline-flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-active-fg text-[13px] font-semibold text-white">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-medium text-foreground">
              {userName}
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {t("user.email")}
            </p>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* 工作空间列表 */}
        <DropdownMenuLabel>
          <span className="text-xs text-muted-foreground">
            {t("workspace.label")}
          </span>
        </DropdownMenuLabel>
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onSelect={() => setCurrent(ws)}>
            <span className="inline-flex size-[22px] flex-shrink-0 items-center justify-center rounded-md bg-[#2563eb] text-[11px] font-bold text-white">
              {ws.name.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{ws.name}</span>
            <Check
              className={cn(
                "ml-auto size-4 text-active-fg",
                ws.id === current.id ? "opacity-100" : "opacity-0",
              )}
              strokeWidth={2.5}
            />
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => console.log("create workspace")}>
          <Plus />
          {t("workspace.create")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => console.log("settings")}>
          <Settings />
          {t("user.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => console.log("logout")}
        >
          <LogOut />
          {t("user.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
