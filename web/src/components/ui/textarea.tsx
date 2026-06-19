import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[96px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-active-fg disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
