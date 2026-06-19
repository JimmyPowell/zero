import { Bot } from "lucide-react";

import { Avatar } from "./Avatar";
import { cn } from "@/lib/utils";

/** 指派人/作者头像：agent 用紫色机器人图标，member 用名字首字母 */
export function ActorAvatar({
  type,
  name,
  url,
  className,
}: {
  type: "member" | "agent" | "system" | null | undefined;
  name?: string | null;
  url?: string | null;
  className?: string;
}) {
  if (type === "agent" && !url) {
    return (
      <span
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full bg-violet-100 text-violet-600",
          className,
        )}
      >
        <Bot className="size-[60%]" />
      </span>
    );
  }
  return <Avatar name={name} url={url} className={className} />;
}
