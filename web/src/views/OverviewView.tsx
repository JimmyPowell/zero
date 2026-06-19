import { Panel } from "@/components/Panel";
import { useUi } from "@/lib/ui-store";

export function OverviewView() {
  const { t } = useUi();
  return (
    <Panel>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        {t("menu.overview")}
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        {t("workspace.placeholder")}
      </p>
    </Panel>
  );
}
