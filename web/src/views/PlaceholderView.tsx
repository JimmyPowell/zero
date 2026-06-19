import { Panel } from "@/components/Panel";
import { useUi } from "@/lib/ui-store";

/** 通用占位视图：标题由 titleKey 决定 */
export function PlaceholderView({ titleKey }: { titleKey: string }) {
  const { t } = useUi();
  return (
    <Panel>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        {t(titleKey)}
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        {t("workspace.placeholder")}
      </p>
    </Panel>
  );
}
