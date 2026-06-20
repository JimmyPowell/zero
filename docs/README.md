# Zero 文档

Zero 是一个自研的「人 + AI 智能体协作」平台 —— 把编码 Agent 当成真正的队友：给它分派需求（issue）、它在真实仓库里干活、产出回到同一条时间线供你 review、评论即可继续。对标并改进开源项目 **Multica**。

## 架构总览

```
        控制平面（云端 / VPS）                          执行机（你的 Mac / 算力机 / 内网）
┌─────────────────────────────────────┐         ┌──────────────────────────────────────┐
│  web (React SPA)                     │         │  daemon (Bun 常驻进程)                 │
│  server (Bun + Hono + Drizzle) :8787 │◀────────│  · 发现本地编码 CLI                     │
│  MySQL 8.4                  :3307    │  出站    │  · 认领 task → 跑 agent → 回传时间线     │
└─────────────────────────────────────┘  HTTPS   │  · claude / codex / opencode /         │
                                                  │    codebuddy / kimi（自动探测）          │
   server 永不反连 daemon；daemon 每 5s            │  · 真实仓库 worktree、本地登录态/凭据     │
   主动拉任务（pull 模型，可在 NAT/防火墙后）        └──────────────────────────────────────┘
```

**控制平面**（server + DB + 前端）是无状态服务，适合 docker-compose 部署。**daemon** 是独立原生进程，跑在有 CLI、有登录态、有代码仓库的执行机上，只出站、主动拉 —— 因此跨机器部署只需把它的 `--server` 指向公网域名。详见 [deployment.md](./deployment.md)。

## 项目速览

| 组件 | 技术 | 位置 / 端口 |
|---|---|---|
| 后端 server | Bun + Hono + Drizzle ORM + MySQL2 + Zod + jose(JWT) | `server/`，:8787 |
| 前端 web | React 19 + Vite 6 + Tailwind 4 + shadcn/Radix + react-router 7 + @dnd-kit + cmdk | `web/`，:5173 |
| 执行 daemon | Bun（可 `bun build --compile` 成单文件 `zero-daemon`） | `daemon/` |
| 数据库 | MySQL 8.4（OrbStack 容器 `zero-mysql-dev`） | 本机 :3307，库/账号/密码均 `zero` |
| 支持的编码 CLI | Claude Code · OpenAI Codex · OpenCode · CodeBuddy · Kimi（daemon 用 `Bun.which` 自动探测，按能力派发） |

数据模型（Drizzle，迁移已到 `0017`）：`user / workspace / issue / issue_event / agent / runtime / skill / skill_file / agent_skill / task / task_usage / repo / channel_binding / notification_outbox / attachment`。

## 核心能力（已落地）

- **需求 + 统一时间线**：issue 派给 agent，执行流（运行开始/事件/完成/失败）、评论、状态变更都汇到同一条时间线；评论即可继续对话。
- **多 Provider 执行**：daemon 自动发现本机的 5 种编码 CLI，各自适配为统一 `RunEvent`（claude/codebuddy 走 stream-json，codex/opencode/kimi 走 JSONL）。
- **运行时（runtime）**：并发上限、共享 / 私有可见性、跨工作空间触达范围、用量与成本统计（含订阅类无金额标注）。
- **智能体 + 技能库**：agent 绑定 provider/模型；技能（SKILL.md 开放标准）下发并物化到工作目录（`.claude/skills/…`，多 provider 目录映射见 [provider-skills-mounting.md](./provider-skills-mounting.md)）。
- **混合上下文**：§3.1 推送地板 +  §3.2 MCP 按需拉（自研 stdio MCP server 注入 `zero_older_comments` / `zero_prior_runs`）+ 断点续传增量。见 [agent-context-model.md](./agent-context-model.md)。
- **通知 / 推送**：邮件（SMTP）、Telegram、企业微信，支持双向回控（渠道里回复即评论）。见 [notifications.md](./notifications.md)。
- **评论附件**：小推大拉混合 —— ≤10MB 由 daemon 落盘给路径，>10MB prompt 给短时效签名 URL 的 curl 命令。见 [comment-attachments.md](./comment-attachments.md)。
- **需求看板**：列表 ⟷ 看板切换，按状态分列、跨列拖拽改状态。见 [nav-and-board.md](./nav-and-board.md)。
- **健壮性**：克隆/拉取超时、状态机（含 `blocked`）、排队反馈。见 [repo-clone-robustness.md](./repo-clone-robustness.md)、[status-and-queue-ux.md](./status-and-queue-ux.md)。

## 本地启动

```bash
# 1. 数据库（OrbStack/Docker 容器，库/账号/密码均 zero，映射 :3307）
#    首次需自行起 zero-mysql-dev 容器

# 2. 后端
cd server && bun install && bun run db:migrate && bun run dev   # :8787

# 3. 前端
cd web && bun install && bun run dev                            # :5173

# 4. （可选）执行 daemon —— 在 UI 建运行时拿到 token 后：
cd daemon && bun install
bun run src/index.ts run --server http://localhost:8787 --token <运行时令牌>   # 前台调试
#   生产 / 后台常驻用 `start`；也可 `bun build --compile` 出单文件 zero-daemon
```

数据库 schema 变更：`cd server && bun run db:generate --name <说明>` 生成迁移，再 `bun run db:migrate` 应用。各包配置见对应 `.env.example`（**生产前务必换 `JWT_SECRET` 与 MySQL 强口令**）。

## 文档索引

**核心设计**
- [design.md](./design.md) —— 设计理念、对标 Multica 的改进点、数据模型
- [agent-context-model.md](./agent-context-model.md) —— 混合上下文模型（推送地板 + MCP 按需拉 + 增量续传）
- [phase-b-execution.md](./phase-b-execution.md) —— Agent 执行体系（派发 / Runtime / Worktree）

**Provider / 扩展**
- [agent-extensibility.md](./agent-extensibility.md) —— 多 Provider 适配框架
- [codebuddy-integration.md](./codebuddy-integration.md) · [kimi-integration.md](./kimi-integration.md) —— 具体 CLI 接入
- [provider-skills-mounting.md](./provider-skills-mounting.md) —— 技能按 provider 目录映射 ⏳
- [agent-credentials.md](./agent-credentials.md) —— BYOK / 凭据注入 ⏳

**功能模块**
- [notifications.md](./notifications.md) —— 通知 / 推送（对外渠道 + 双向回控）
- [comment-attachments.md](./comment-attachments.md) —— 评论附件（小推大拉）
- [nav-and-board.md](./nav-and-board.md) —— 导航重构 + 需求看板
- [status-and-queue-ux.md](./status-and-queue-ux.md) —— 状态机（含 blocked）与排队反馈

**运维 / 部署**
- [deployment.md](./deployment.md) —— 跨机器拓扑 + 容器化部署方案 ⏳
- [repo-clone-robustness.md](./repo-clone-robustness.md) —— 克隆 / 拉取超时与健壮性
- [multi-user-credentials.md](./multi-user-credentials.md) —— 多用户凭据隔离 ⏳
- [sandboxing.md](./sandboxing.md) —— 沙箱化方案 ⏳

**进展**
- [progress.md](./progress.md) —— 进展日志（倒序，每完成一块即追加）

> 约定：**每次完成开发或有重要进展，都要更新 [progress.md](./progress.md)，涉及设计变更的同步更新对应文档。** ⏳ = 已出方案、尚未实现。

## 当前状态

- ✅ **Phase A**：认证 / 工作空间 / Issue / 详情页 + 统一时间线 / 仓库绑定。
- ✅ **Phase B（主体）**：daemon 执行体系、5 Provider 派发、运行时与用量、技能库、混合上下文、通知、评论附件、需求看板。
- ⏳ **规划中**（已出方案待实现）：容器化部署、BYOK 凭据注入、provider 技能目录映射、多用户隔离与沙箱化、执行日志活动条带视觉优化。
