# 沙箱化执行 调查 ⏳待办

> 2026-06-20 调查记录。**现在不做**——先把方案落档。
> 背景：daemon 在共享 Linux 机上跑 AI CLI（Claude Code / Codex / opencode）执行任意 build/test/shell，目前只有目录级隔离。问题：1) 要不要上沙箱；2) 主流方案 + 侵入性 / 成本 / 投入产出。
> 关联：[[multi-user-credentials]]（共享机隔离的另一半）。

## 1. 现状 4 个缺口
目录级隔离（每 issue 一棵 worktree，其余全共享）挡不住：
- **文件系统**：AI 命令能 `cat ~/.ssh`、读别人 worktree、读 daemon 自己的密钥 / env。
- **网络出口**：能把密钥 POST 出去（恶意 issue/README 的 prompt injection 触发外泄）。
- **资源**：fork bomb / 跑飞的 build 拖垮全机。
- **内核逃逸**：当前完全无防护。

两条业界铁律：
1. **"容器 ≠ 沙箱"** —— Cursor 后台 agent 被研究者从 Docker 逃到宿主 EC2。
2. **"只隔文件不隔网络几乎没用"** —— 出口是头号外泄通道（Anthropic 原话）。Codex 执行阶段断网、Copilot 默认开防火墙、Claude Code 走 allowlist 代理。

## 2. 主流方案分层
- **轻量 OS 沙箱**：bubblewrap / nsjail / macOS `sandbox-exec` + seccomp-bpf + Landlock + cgroups v2。**Claude Code 和 Anthropic `@anthropic-ai/sandbox-runtime` 用的就是这套。**
- **容器**：硬化 Docker（drop caps + 无宿主挂载 + seccomp + 只读 rootfs + 代理出网）/ rootless Podman / Sysbox（安全 rootless DinD）/ gVisor（runsc，用户态内核，~10–15% CPU）。
- **VM 级**：Kata / Firecracker（需 KVM）。
- **托管服务**：E2B(Firecracker)、Daytona(可自托管 AGPL)、Modal(gVisor)、Cloudflare Sandbox、Fly Machines(Firecracker)、Northflank(BYOC)、Runloop、CodeSandbox SDK。

## 3. 业界 AI agent 实际用什么
| 产品 | 隔离机制 | 默认网络 |
|---|---|---|
| OpenAI Codex(云) | OpenAI 托管容器；执行阶段离线 | 默认断网 + 域名 allowlist |
| Claude Code 内置沙箱 | Seatbelt(mac)/bubblewrap+seccomp(Linux) + 代理 allowlist | 写限 cwd；网络白名单 |
| `@anthropic-ai/sandbox-runtime`(OSS) | bubblewrap/sandbox-exec + 代理；Linux 去 netns 强制走代理 | 默认拒绝 |
| Devin / Google Jules | 每会话 / 每任务独立云 VM | 各自网络 |
| Cursor 后台 agent | 单租户 AWS VM（但被逃逸过） | 锁 VPC |
| Replit Agent | 每用户容器 + seccomp + 包防火墙 | 默认开 |
| GitHub Copilot agent | GitHub Actions 临时环境 | **默认开防火墙防外泄** |

两条共性：**每任务一个临时隔离环境**；**默认拒绝出网 + allowlist**。目录级隔离是唯一没人单独依赖的。

## 4. 80/20 推荐（立即、自托管、改动极小）
用 **`@anthropic-ai/sandbox-runtime`**（bubblewrap + 代理 allowlist）把每个 spawn 的 CLI 包一层 + **cgroups v2 限额**（`pids.max`/`memory.max`，`systemd-run --scope`）+ **只注入该用户最小权限短期密钥**（不再透传 daemon 全量 env）+ **默认拒绝出网**（只放行 git host + 包仓库）。
- 这正是 Anthropic / OpenAI / GitHub 在用的同一套原语；**改动只在 daemon spawn 那一行附近**。
- 挡住：外泄(fs+egress)、fork bomb(cgroups)、跨仓库读、大部分跨用户密钥泄露。
- 挡不住：内核逃逸（共享内核）、域名 allowlist 的 domain-fronting。
- 叠加防御纵深（免费）：把各 CLI 自带沙箱也打开（Claude Code `/sandbox`、Codex 执行断网）。

## 5. 分阶段
- **NOW**：bubblewrap/sandbox-runtime + cgroups + scoped secrets + 出口 allowlist。20% 力气 80% 安全，无新基建 / 无 $ / 无 KVM，只改 spawn。
- **NEXT**（有具体需求再 bolt-on，免费自托管）：rootless 容器 / Sysbox（仓库测试需 Docker 时）/ gVisor（更强逃逸抵抗）。
- **DEFER**（接入不可信外部用户或上规模再说）：microVM —— 买（E2B/Fly）或自托管（Daytona+Kata）。
- ❌ 别用 Depot/Blacksmith（那是 CI 加速，不是 agent 沙箱）。

## 6. 投入产出 / 侵入性 / 成本结论
- **NOW 层 ROI 最高**：早期就该上，再重的现在都是过早优化。**唯一不可省**：默认拒绝出口 + allowlist 代理（只隔文件无用）。
- **NEXT 层**：低侵入、免费、自托管，按需 bolt-on。
- **DEFER 层**：最强隔离但要钱 / 多数不能自托管，或自托管 microVM = 重运维；等真要硬多租户再上。

## 7. 与凭据隔离的关系
共享机上"按人隔离凭据"和"沙箱"是同一件事两面：不沙箱，注入再细的 per-user 密钥也会被同机其他 run / 宿主读走。见 [[multi-user-credentials]]。
- 走"每人一个 daemon（各自 OS 用户）" → 凭据 / 文件隔离靠 OS 账户白送，沙箱主要缩小单 run 爆炸半径（中优先）。
- 走"共享 daemon + BYOK" → 沙箱是**前置必需**。

## 8. 状态
⏳ 待办（先记录，不实现）。
