# 部署说明：控制平面（server）与 daemon 跨机器

> 2026-06-19 记。重点：**daemon 是「只出站、主动拉」的客户端**，跨机器部署只需改它的 `--server` 指向公网域名。

## 拓扑

```
[云端 / VPS]  server + MySQL + 前端静态  ──  https://zero.你的域名.com
                          ▲
                          │  daemon 主动发起的出站 HTTPS（server 永不反连 daemon）
                          │
[执行机：你的 Mac / 算力机 / 内网]  daemon（装了 claude/codex/opencode + 本地仓库）
```

- **server + DB + 前端**：部署到 VPS（建议 docker-compose，见待办 `docker-compose`）。
- **daemon**：跑在**有 CLI、有登录态、有代码仓库**的执行机上，原生进程（不进容器，见 [[agent-credentials]] 里对无头机的说明）。

## 通信模型（为什么跨机器很简单）

daemon → server 全是**出站**调用，server 从不主动连 daemon：
- `POST /daemon/hello`（配对 + 能力）、`/heartbeat`（心跳 + 收并发上限）
- `POST /daemon/tasks/claim`（**每 5s 轮询拉任务**，核心）
- `POST /daemon/tasks/:id/{events,complete,fail}`（回传执行流 / 结果）
- `GET /daemon/issues/:id/{comments,runs}`（MCP 按需拉上下文）

因此：
- **daemon 可在 NAT / 防火墙后**（家里、笔记本、内网），**无需开入站端口、无需端口转发**，只要能出站访问 server。模型同 CI runner。
- 排队→认领延迟 ≤ 轮询周期（5s），生产够用；要更快可加 server→daemon 推送，但轮询最穿透。

## 跨机器配置：就是传域名

本地：
```bash
zero-daemon start --server http://localhost:8787 --token <运行时令牌>
```
生产：
```bash
zero-daemon start --server https://zero.你的域名.com --token <运行时令牌>
# 也可用环境变量 ZERO_SERVER / ZERO_TOKEN
```
- `--token`：在 UI 建运行时时生成，工作空间隔离的鉴权令牌（`Authorization: Bearer`）。
- **必须 HTTPS**：令牌、任务内容、（将来的 BYOK env）都过公网，别用明文 http。你有 Cloudflare edge，套上即可。

## 要注意的点

1. **HTTPS 强制**（同上）。
2. server 域名要 DNS + TLS 可达。
3. **8799 文件夹选择器是本机限定**（`127.0.0.1`）：它给「和 daemon 同机的浏览器」弹原生选目录用。跨机器时只有在 daemon 那台机器上开浏览器才能用「浏览」；远程访问就手填路径。这是原生选择器的天然限制，不是通信问题。
4. 生产前必做：换 `JWT_SECRET`、换 MySQL 强口令（见各 `.env.example`）。

## 容器化部署（docker-compose）⏳待办（设计已定，暂不实现）

> 2026-06-20 记。结论先行：**compose 只装"控制平面"三件套（server + DB + 前端），daemon 不进 compose**。

### 为什么 daemon 不该是 compose 的第 4 个服务

daemon 不是无状态服务，它是**真正跑编码 agent 的执行机**：要装 `claude/codex/opencode/codebuddy/kimi` 这些 CLI、要有它们的登录态/凭据、要 `git clone` 真实仓库并在本地跑代码（登录流程 + BYOK 凭据在容器里很别扭）。加上它是纯出站、主动拉（见上「通信模型」），**根本不需要和 server 同机**，可以在 Mac / 算力机 / 内网，甚至多台各跑一个。塞进 compose 会把"运行时可在任何地方"的设计废掉。所以：daemon 永远是**独立的原生进程**，靠 `--server <域名> --token` 接入。

### compose 的三件套

```yaml
services:
  db:          # mysql:8；挂 db-data 卷；healthcheck
  server:      # bun 镜像；entrypoint 先 `bun run db:migrate` 再 start
    depends_on: { db: { condition: service_healthy } }
    env_file: server/.env
    volumes: [ "uploads:/app/data/uploads" ]   # ← 附件持久卷 ATTACHMENTS_DIR
  web:         # 见下「前端三选一」
volumes: { db-data, uploads }
```

两个**必须的持久卷**：① MySQL 数据；② **附件目录**（`ATTACHMENTS_DIR`，否则容器重启丢文件）。server 启动前必须先跑迁移（`bun run db:migrate`）。

### 前端三选一

web 是纯静态产物（`vite build → dist`，server 目前不托管静态）：
1. **Caddy/nginx 容器** serve `dist` + 反代 `/api → server`（进 compose，最自洽）；
2. **折进 server**：给 Bun 加 `serveStatic` 托管 `dist`，只剩一个容器（最省事）；
3. **Cloudflare Pages**（**推荐**）：本来就有 Cloudflare edge，前端挂 Pages，VPS 只留 `server + db + uploads`，前后端彻底解耦、边缘扛静态流量。

### 跟 Cloudflare edge 相关的坑

- **HTTPS 强制**（令牌/任务内容/将来 BYOK 都过公网）。
- **上传体积**：附件走 Cloudflare 受边缘 body 上限约束，大文件需直连 origin（已写进 `server/.env.example` 注释）。
- **100s 边缘超时**：daemon 侧无碍（5s 轮询 + 增量 POST，不吃长连接）；要确认的是 **Web UI 看实时日志那条链路**是否长连接——若是 SSE 会被 100s 砍，轮询则无所谓。实现 compose 前先核实这条。

### 例外：单机全包

单租户 demo / 就想一台 VPS 全装，**可以**加第 4 个 daemon 容器（镜像 bake 好 CLI、凭据挂进去）。这是特例，不是默认形态。

### 落地清单（实现时要产出）

- `server/Dockerfile`（bun，多阶段；entrypoint 跑迁移）
- 前端方案落实（先定 Pages / Caddy / 折进 server）
- 根目录 `docker-compose.yml`（db-data + uploads 卷、healthcheck、env_file）
- 生产前必做：换 `JWT_SECRET`、换 MySQL 强口令、`ATTACHMENTS_DIR` 指持久卷

## 相关
- 容器化部署细节：见上「容器化部署」⏳待办。
- daemon 无头机 / BYOK 凭据：见 [[agent-credentials]]。
