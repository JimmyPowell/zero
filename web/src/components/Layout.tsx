import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  Server,
  Bot,
  ChevronLeft,
  Search,
  SquarePen,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { useIssues } from "@/lib/issues-store";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { CreateIssueDialog } from "@/components/CreateIssueDialog";
import { SearchCommand } from "@/components/SearchCommand";

// 通过 Outlet context 让子视图也能打开“创建工作空间 / 新建需求 / 搜索”
export interface LayoutContext {
  openCreateWorkspace: () => void;
  openCreateIssue: () => void;
  openSearch: () => void;
}

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

// 侧边栏动作项（搜索 / 新建需求）：图标 + 文案 + 右侧快捷键徽标
function SidebarAction({
  icon: Icon,
  label,
  hint,
  collapsed,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "group flex items-center gap-2.5 overflow-hidden rounded-[10px] py-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        collapsed ? "justify-center px-0" : "px-3",
      )}
    >
      <Icon className="size-[18px] flex-shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground">
            {hint}
          </kbd>
        </>
      )}
    </button>
  );
}

export function Layout() {
  const { t } = useUi();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
  const { issues, load, prepend } = useIssues();

  const [collapsed, setCollapsed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const wsId = currentWorkspace?.id ?? null;

  // 当前激活菜单由路由路径决定（/agents/:id 也归属 agents）
  const isActive = (key: string) =>
    location.pathname === "/" + key ||
    location.pathname.startsWith("/" + key + "/");

  // 当前工作空间的需求：在此统一加载，保证侧栏搜索/新建在任意页面可用
  useEffect(() => {
    if (wsId) void load(wsId);
  }, [wsId, load]);

  // 全局快捷键：⌘K 搜索；C 新建需求（输入框内或弹窗已开时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (wsId) setSearchOpen(true);
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "c") {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
        if (createIssueOpen || searchOpen || createOpen) return;
        e.preventDefault();
        if (wsId) setCreateIssueOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wsId, createIssueOpen, searchOpen, createOpen]);

  const openSearch = () => {
    if (wsId) setSearchOpen(true);
  };
  const openCreateIssue = () => {
    if (wsId) setCreateIssueOpen(true);
  };

  return (
    <div className="relative flex h-full overflow-hidden bg-sidebar">
      {/* 左侧菜单栏：融入整体底色，无边框、无阴影 */}
      <aside
        className={cn(
          "flex flex-shrink-0 flex-col bg-transparent pt-4 pb-4 transition-[width,padding] duration-200 select-none",
          collapsed ? "w-[72px] px-3" : "w-[220px] px-3.5",
        )}
      >
        {/* 工作空间切换器（含用户信息 / 切换工作空间 / 退出登录） */}
        <div className="pb-2">
          {collapsed ? (
            <div className="flex justify-center">
              <span className="inline-flex size-[26px] flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb] text-sm font-bold text-white">
                Z
              </span>
            </div>
          ) : (
            <WorkspaceSwitcher onCreateWorkspace={() => setCreateOpen(true)} />
          )}
        </div>

        {/* 搜索 / 新建需求（仿 Multica，置于工作空间下方） */}
        {currentWorkspace && (
          <div className="flex flex-col gap-0.5 pb-2">
            <SidebarAction
              icon={Search}
              label={t("nav.search")}
              hint="⌘K"
              collapsed={collapsed}
              onClick={openSearch}
            />
            <SidebarAction
              icon={SquarePen}
              label={t("nav.newIssue")}
              hint="C"
              collapsed={collapsed}
              onClick={openCreateIssue}
            />
          </div>
        )}

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

      {/* 右侧主工作区：白色卡片承载路由视图（高度锁死，滚动交给内部面板） */}
      <main className="min-h-0 min-w-0 flex-1 py-4 pr-3.5 pl-0">
        <Outlet
          context={
            {
              openCreateWorkspace: () => setCreateOpen(true),
              openCreateIssue,
              openSearch,
            } satisfies LayoutContext
          }
        />
      </main>

      <CreateWorkspaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {wsId && (
        <>
          <CreateIssueDialog
            open={createIssueOpen}
            workspaceId={wsId}
            onClose={() => setCreateIssueOpen(false)}
            onCreated={(issue) => prepend(issue)}
          />
          <SearchCommand
            open={searchOpen}
            workspaceId={wsId}
            recent={issues.slice(0, 6)}
            onClose={() => setSearchOpen(false)}
            onNewIssue={() => setCreateIssueOpen(true)}
            onSelectIssue={(issue) => navigate(`/issues/${issue.id}`)}
          />
        </>
      )}
    </div>
  );
}
