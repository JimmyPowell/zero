# 多用户凭据隔离（共享机部署）调查 ⏳待办

> 2026-06-20 调查记录。**现在不做**——先把方案落档。
> 背景：Zero 将部署到**一台共享机器**，团队多人共用；但每人 SSH key / Git token 不同、负责仓库不同，需要"每人配自己的凭据、只访问自己的仓库"（隔离）。
> 关联：[[agent-credentials]]（BYOK/custom_env 蓝本，env/API key 维度）、[[sandboxing]]（共享机隔离的另一半）。

## 1. 结论先行
- **Multica 没有**"共享机器上每人独立凭据"——它用「每人在自己机器上跑自己的 daemon」**绕开**了这个问题。
- **Zero 现在也没有**，而且"一台机共享"恰是 Multica 刻意避开的更难的路。
- **好消息**：Zero 现有 `runtime.ownerId` + `visibility=private` 已足够支撑"每人一个 daemon"模式，**几乎零代码**；难的"共享 daemon + BYOK"留到真要 SaaS 化再做。

## 2. Multica 怎么做（调研结论）
- **BYO-machine**：每人在自己机器 `multica login`（拿 90 天 PAT）→ 跑本地 daemon；git/GitHub 认证 = 那台机器**已配好**的 gh/ssh/缓存凭据。Multica 自己**不存任何 git 凭据**，daemon 继承宿主 `os.Environ()`。
  - 证据：`server/internal/daemon/repocache/cache.go:19-51`（`gitEnv()` 透传宿主 env + 关 TTY 提示，clone 不注入凭据）；`CLI_AND_DAEMON.md` / `CLI_INSTALL.md`（每人各自机器装 + login + daemon start）。
- 多租户隔离只在 **API/DB 层**（`workspace_id` + 成员校验 + claim 时 workspace fail-closed 校验 `handler/daemon.go:1117-1143`），**不是 OS 级**。
- 唯一密钥位 `agent.custom_env`：**明文存**、workspace 内可见、执行时无视谁触发都注入（`handler/agent.go:289-330`）→ **不是按人隔离**。
- **判定**：不支持"一台共享机、每人不同 key、按人隔离仓库"。它靠"每人各自机器"绕开，而非解决。

## 3. Zero 现状（code-verified）
- 一台机一个**共享 daemon**，以单一 OS 用户跑，spawn CLI 用 `env: process.env`（`daemon/src/index.ts` 各 runner）。
- git 认证 **100% 靠宿主** `~/.ssh`/`~/.gitconfig`：`daemon/src/index.ts:185-219` 的 `git()` 只透传 env、`stdin:"ignore"`；全仓库无 `GIT_SSH`/credential helper/askpass/`HOME` 覆盖。
- provider（claude/codex/kimi）认证靠**宿主 CLI 登录态**（`~/.claude`/`~/.codex`/`~/.kimi/config.toml`）。
- 控制层**零凭据字段**：`repo` 表只有 `name/url/defaultBranch`；`agent` 只有 `provider/model/instructions/runtimeId`；schema + 17 个迁移全查过，无 token/ssh/secret 列。
- 仓库权限**只到 workspace**：任何成员能登记/绑定/用任何仓库（`server/src/routes/repos.ts`，仅 `requireWorkspaceMember`，无角色 / 归属校验）。
- daemon↔server = runtime token（`runtime.token_hash` sha256）；**runtime 已有 `ownerId` + `visibility`(private/workspace)**（`schema.ts:285-297`）。
- 隔离只有**目录级**（每 issue 一棵 worktree，`~/.zero/worktrees/<issueId>`）；OS 用户 / env / 网络 / git 身份 / provider key **全共享**。⚠️ **worktree 关闭自动清理：规划未实现，现会无限堆积。**
- 已有蓝本 [[agent-credentials]]：per-agent 加密 `custom_env` + spawn 注入 + 黑名单系统键。但它**按 agent（非按人）、只管 env/API key（不管 git SSH、不管仓库 ACL）**。

## 4. 给 Zero 的两条路

### ▶ 推荐（短期）：每人一个 daemon，各自 OS 用户
即 Multica 模式搬到同一台机。
- 复用现成 `runtime.ownerId` + private 可见性：每人建自己的 runtime + token，在**自己的 OS 账户**下跑 daemon。
- 每个 OS 用户天生有独立 `~/.ssh`、`~/.claude`、家目录 → **凭据 + 文件隔离"白送"，几乎零代码**；仓库隔离自然跟随各自 git 身份。
- 代价：每人建账户 + 跑一个 daemon（可脚本化 / `systemd --user`）。
- 仍需补的小项：仓库 ACL 目前 workspace 级——此模式下问题不大（认证跟 daemon 身份走），但跨人误绑会路由到对方 daemon，建议加"谁能用哪个 runtime / repo"约束（中优先）。

### ▷ 备选（更重，SaaS 化再做）：共享 daemon + BYOK 注入
- 把 [[agent-credentials]] 扩成：**按人（不止按 agent）+ 加 git SSH key（`GIT_SSH_COMMAND`/askpass 注入）+ per-user 仓库 ACL**。
- **必须配合沙箱**（见 [[sandboxing]]）：否则注入的密钥会被同机其他 run / 宿主读走。
- 触发条件：真要"一个 daemon 服务很多人"（云端 SaaS / 无头多租户）。

## 5. 落地顺序（未做，待拍板）
1. 先上 80/20 沙箱层（见 [[sandboxing]]）——无论哪条路都值。
2. 凭据先采"每人一个 daemon / 各自 OS 用户"（复用现成，几乎零代码）。
3. 更新 [[agent-credentials]] 触发条件 + 补"按人 + git SSH + 仓库 ACL"蓝本。
4. 排期 worktree 关闭自动清理。

## 6. 状态
⏳ 待办（先记录，不实现）。触发条件：要真正多人共享一台机执行任务时启动。
