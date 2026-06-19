import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 内容白卡片：复刻 skillstest 的 .panel */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "h-full overflow-auto rounded-xl border border-border bg-card px-7 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        className,
      )}
    >
      {children}
    </section>
  );
}
