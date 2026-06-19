# Zero 文档

Zero 是一个自研的「人 + AI 智能体协作」平台 —— 把编码 Agent 当成真正的队友：给它分派需求（issue）、它在真实仓库里干活、产出回到同一条时间线供你 review、评论即可继续。对标并改进开源项目 **Multica**。

## 文档索引

- [design.md](./design.md) —— 设计理念、对标 Multica 的改进点、当前数据模型
- [phase-b-execution.md](./phase-b-execution.md) —— Phase B：Agent 执行体系（派发流程 / Runtime / Worktree）的方案
- [progress.md](./progress.md) —— 进展日志（每完成一块开发就在此追加）

> 约定：**每次完成开发或有重要进展，都要更新 [progress.md](./progress.md)，涉及设计变更的同步更新对应文档。**

## 项目速览

| | 技术 | 位置 / 端口 |
|---|---|---|
| 后端 | Bun + Hono + Drizzle ORM + MySQL + Zod + jose(JWT) | `server/`，:8787 |
| 前端 | React 19 + Vite + Tailwind 4 + Radix/shadcn + react-router 7 + cmdk | `web/`，:5173 |
| 数据库 | MySQL 8.4（OrbStack 容器 `zero-mysql-dev`） | 本机 :3307，库/账号/密码均 `zero` |

本地启动：`server/` 跑 `bun run dev`（端口 8787），`web/` 跑 `bun run dev`（端口 5173）。
数据库迁移：`cd server && bun run db:generate && bun run db:migrate`。

## 当前状态

- ✅ **Phase A 已完成**：认证 / 工作空间 / Issue 模块 / 详情页 + 统一时间线 / 仓库绑定占位。
- 🔜 **Phase B 进行中规划**：Agent 执行体系（详见 [phase-b-execution.md](./phase-b-execution.md)）。
