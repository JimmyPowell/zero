import { Workflow } from "lucide-react";

import { Panel } from "@/components/Panel";
import { useUi } from "@/lib/ui-store";

// 自动化：占位页（编排定时任务 / 自动触发的工作流，后续填充）
export function AutomationView() {
  const { t } = useUi();
  return (
    <Panel>
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("automation.title")}
          </h2>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
          <Workflow className="size-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {t("automation.empty")}
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t("automation.emptyHint")}
          </p>
        </div>
      </div>
    </Panel>
  );
}
