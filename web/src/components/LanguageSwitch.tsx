import { Languages } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { useUi, type Locale } from "@/lib/ui-store";

const options: { value: Locale; label: string }[] = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
];

export function LanguageSwitch() {
  const { locale, setLocale, t } = useUi();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-sidebar-accent"
          title={t("lang.title")}
          type="button"
        >
          <Languages className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setLocale(o.value)}>
            {o.label}
            <DropdownMenuCheck active={locale === o.value} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
