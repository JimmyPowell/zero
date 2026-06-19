import { User, Settings, LogOut } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useUi } from "@/lib/ui-store";

export function UserMenu() {
  const { t } = useUi();
  const userName = t("user.name");
  const initial = userName.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex size-9 items-center justify-center rounded-full bg-active-fg text-[13px] font-semibold text-white"
          title={userName}
          type="button"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <div className="text-sm font-semibold text-foreground">
            {userName}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t("user.org")}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => console.log("profile")}>
          <User />
          {t("user.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => console.log("settings")}>
          <Settings />
          {t("user.settings")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

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
