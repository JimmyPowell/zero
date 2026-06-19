import { cn } from "@/lib/utils";

/** 头像：有图用图，否则用名字首字母 + 柔和灰底 */
export function Avatar({
  name,
  url,
  className,
}: {
  name: string | null | undefined;
  url?: string | null;
  className?: string;
}) {
  const display = name ?? "?";
  const initial = display.trim().charAt(0).toUpperCase() || "?";
  if (url) {
    return (
      <img
        src={url}
        alt={display}
        className={cn("size-5 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
