import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  Server,
  Bot,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

interface MenuItem {
  key: string;
  labelKey: string;
  icon: LucideIcon;
}

const menus: MenuItem[] = [
  { key: "overview", labelKey: "menu.overview", icon: LayoutDashboard },
  { key: "requirements", labelKey: "menu.requirements", icon: ClipboardList },
  { key: "runtime", labelKey: "menu.runtime", icon: Server },
  { key: "agents", labelKey: "menu.agents", icon: Bot },
];

export function Layout() {
  const { t } = useUi();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // 当前激活菜单由路由路径决定（/agents/:id 也归属 agents）
  const isActive = (key: string) =>
    location.pathname === "/" + key ||
    location.pathname.startsWith("/" + key + "/");

  return (
    <div className="relative flex h-full bg-sidebar">
      {/* 左侧菜单栏：融入整体底色，无边框、无阴影 */}
      <aside
        className={cn(
          "flex flex-shrink-0 flex-col bg-transparent pt-4 pb-4 transition-[width,padding] duration-200 select-none",
          collapsed ? "w-[72px] px-3" : "w-[220px] px-3.5",
        )}
      >
        {/* 工作空间切换器（含用户信息 / 切换工作空间 / 退出登录） */}
        <div className="pb-3">
          {collapsed ? (
            <div className="flex justify-center">
              <span className="inline-flex size-[26px] flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb] text-sm font-bold text-white">
                Z
              </span>
            </div>
          ) : (
            <WorkspaceSwitcher />
          )}
        </div>

        {/* 菜单 */}
        <nav className="flex flex-col gap-0.5">
          {menus.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.key);
            return (
              <NavLink
                key={item.key}
                to={"/" + item.key}
                title={collapsed ? t(item.labelKey) : undefined}
                className={cn(
                  "flex items-center gap-2.5 overflow-hidden rounded-[10px] py-2.5 text-sm whitespace-nowrap transition-colors",
                  collapsed ? "justify-center px-0" : "px-3",
                  active
                    ? "bg-active-bg font-semibold text-active-fg"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <Icon className="size-[18px] flex-shrink-0" />
                {!collapsed && (
                  <span className="truncate">{t(item.labelKey)}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* 折叠收起按钮 */}
        <button
          type="button"
          title={collapsed ? t("expand") : t("collapse")}
          onClick={() => setCollapsed((v) => !v)}
          className="mt-auto flex items-center justify-center gap-1.5 overflow-hidden rounded-[10px] border border-border bg-transparent px-3 py-2.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ChevronLeft
            className={cn(
              "size-4 flex-shrink-0 transition-transform duration-200",
              collapsed && "rotate-180",
            )}
          />
          {!collapsed && t("collapse")}
        </button>
      </aside>

      {/* 右侧主工作区：白色卡片承载路由视图 */}
      <main className="min-w-0 flex-1 py-4 pr-3.5 pl-0">
        <Outlet />
      </main>
    </div>
  );
}
