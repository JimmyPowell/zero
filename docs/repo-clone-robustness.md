# 仓库克隆健壮性 + 网络/鉴权 方案 ⏳待办（出方案，先不实现）

> 2026-06-20。由真实事故定位：issue #14 绑了 `git@github.com:VikingShow/e-zen.git`，
> 克隆卡死 → daemon 槽位被占死 → 运行时冻住 → 第二次评论"没反应"。本文给方案。

## 1. 事故定位（已确认）

三层叠加：

1. **程序 bug（核心）**：`prepareWorkdir` 的 `git clone` / `git fetch` **没有超时**。克隆一旦卡住，daemon 的 `git()` 无限等 → executeClaim 卡在准备工作目录 → 该任务永远 `running` → 单并发那个槽位被占死 → **整个运行时冻住**，后续任何评论触发的任务都派不出去（服务端并发守卫看到 1/1）。
2. **网络**：绑的是 **SSH 地址**（`git@github.com:`，端口 22）。本网络下 **github SSH 22 不通（挂死）**；但实测 **HTTPS 443 通**（直连 200 / 经 ClashX 代理 200）。
3. **鉴权**：`VikingShow/e-zen` 匿名 HTTPS 返回 404 = **私有库**，克隆需鉴权（用户有 SSH key / 可配 token）。

> 当前已手动解卡：把卡死任务标记 failed + 写 run_failed 事件 + 重启 daemon。但**根因没修，再触发同一仓库还会卡**。

## 2. 方案

### A. 核心：git 操作加超时 + 失败清理（程序必改）
- `prepareWorkdir` 的 `clone`（建议 120s）/ `fetch`（建议 30s）加超时：超时则 kill 子进程、`git()` 返失败、任务以清晰错误（"克隆超时/网络不通"）**fail 掉**，而不是无限等。
- 失败时清掉不完整的 `~/.zero/repos/<sanitized>` 残壳（否则下次命中坏缓存）。
- 效果：**任何克隆卡死只 fail 这一个任务，绝不再冻住整个运行时**。实现：`git()` 的 `Bun.spawn` 配 `timeout`/`AbortSignal`，或 spawn 后定时 `proc.kill()`。

### B. 让克隆真能成功（网络/鉴权，多为机器级配置，非 Zero 代码）
按省事→稳排：
1. **SSH 走 443（推荐）**：github SSH 22 被墙，但 `ssh.github.com:443` 通。用户机器 `~/.ssh/config`：
   ```
   Host github.com
     Hostname ssh.github.com
     Port 443
   ```
   → `git@github.com:` 的 SSH 克隆改走 443，**复用已有 SSH key，私有库照拉**。最适合本场景（用户有权限，只是端口被墙）。
2. **daemon 带代理 env 启动**：`https_proxy=http://127.0.0.1:7890 … zero-daemon start …` → 仅对 **HTTPS 地址**有效（SSH 22 不吃 http_proxy）。
3. **git insteadOf 重写**：`git config --global url."https://github.com/".insteadOf "git@github.com:"` → SSH 地址自动走 HTTPS（私有库需配 credential helper / token）。

### C. Zero 侧易用性增强（可选，后续）
- **绑仓库时预检 + 预克隆**：加仓库时后台试克隆一次，失败立即在 UI 提示"克隆失败：<原因>"，而不是等第一次跑任务才卡死（这正是用户踩的：建库成功进了界面，但其实没克隆成功）。
- **per-repo 代理 / 鉴权字段**（和 [[agent-credentials]] BYOK 同思路）：repo 表加 `proxy` / `token`，daemon 克隆该 repo 时带上 → 不依赖机器级配置。
- daemon 健康态暴露"能否访问 github / git 探测结果"。

## 3. 优先级
- **A（超时+清理）**：必做、优先级最高——它是"运行时被一个坏仓库冻死"的根因，影响所有用户所有仓库。
- **B**：用户机器配一下即可临时跑通（推荐 B.1）。
- **C**：体验增强，看后续。

## 4. 状态
⏳ 待办（用户要求先出方案、暂不实现）。即时绕过：用户机器配 `~/.ssh/config`（github→ssh.github.com:443）后重新触发 issue #14，SSH key 在、私有库可拉。
