import { Sun, Moon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { useUi, type Theme } from "@/lib/ui-store";

const options: { value: Theme; labelKey: string }[] = [
  { value: "light", labelKey: "theme.light" },
  { value: "dark", labelKey: "theme.dark" },
  { value: "system", labelKey: "theme.system" },
];

export function ThemeSwitch() {
  const { theme, isDark, setTheme, t } = useUi();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-sidebar-accent"
          title={t("theme.title")}
          type="button"
        >
          {isDark ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)}>
            {t(o.labelKey)}
            <DropdownMenuCheck active={theme === o.value} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
