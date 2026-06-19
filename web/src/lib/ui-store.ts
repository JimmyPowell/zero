import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export type Locale = "zh" | "en";

const messages: Record<Locale, Record<string, string>> = {
  zh: {
    brand: "Zero",
    "menu.overview": "概览",
    "menu.requirements": "需求管理",
    "menu.runtime": "Runtime 运行时管理",
    "menu.agents": "智能体管理",
    "workspace.placeholder": "主工作区（占位）",
    collapse: "收起侧边栏",
    expand: "展开侧边栏",
    "theme.title": "主题",
    "theme.light": "浅色",
    "theme.dark": "深色",
    "theme.system": "跟随系统",
    "lang.title": "语言",
    "user.name": "管理员",
    "user.email": "admin@zero.local",
    "user.profile": "个人资料",
    "user.settings": "设置",
    "user.logout": "退出登录",
    "workspace.label": "工作空间",
    "workspace.create": "创建工作空间",
  },
  en: {
    brand: "Zero",
    "menu.overview": "Overview",
    "menu.requirements": "Requirements",
    "menu.runtime": "Runtime",
    "menu.agents": "Agents",
    "workspace.placeholder": "Main workspace (placeholder)",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
    "theme.title": "Theme",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",
    "lang.title": "Language",
    "user.name": "Admin",
    "user.email": "admin@zero.local",
    "user.profile": "Profile",
    "user.settings": "Settings",
    "user.logout": "Log out",
    "workspace.label": "Workspaces",
    "workspace.create": "Create workspace",
  },
};

function readTheme(): Theme {
  const v = localStorage.getItem("zero-theme");
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function readLocale(): Locale {
  const v = localStorage.getItem("zero-locale");
  return v === "zh" || v === "en" ? v : "zh";
}

const mql = window.matchMedia("(prefers-color-scheme: dark)");

const state = {
  theme: readTheme(),
  locale: readLocale(),
  systemDark: mql.matches,
};

// ---- 简易外部 store：订阅 / 快照 ----
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function resolvedDark(): boolean {
  return state.theme === "dark" || (state.theme === "system" && state.systemDark);
}

function applyTheme(): void {
  document.documentElement.classList.toggle("dark", resolvedDark());
}

mql.addEventListener("change", (e) => {
  state.systemDark = e.matches;
  if (state.theme === "system") {
    applyTheme();
    emit();
  }
});

// 初始化：应用主题与语言
applyTheme();
document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";

export function setTheme(theme: Theme): void {
  state.theme = theme;
  localStorage.setItem("zero-theme", theme);
  applyTheme();
  emit();
}

export function setLocale(locale: Locale): void {
  state.locale = locale;
  localStorage.setItem("zero-locale", locale);
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  emit();
}

export function useUi() {
  // 任一字段变化即触发重渲染；快照用拼接字符串保证引用稳定
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${state.theme}|${state.locale}|${state.systemDark}`,
  );
  void snapshot;

  const t = (key: string): string => messages[state.locale][key] ?? key;

  return {
    theme: state.theme,
    locale: state.locale,
    isDark: resolvedDark(),
    setTheme,
    setLocale,
    t,
  };
}
