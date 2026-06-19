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

## 相关
- 容器化部署（server/db/前端）：见待办 `docker-compose`。
- daemon 无头机 / BYOK 凭据：见 [[agent-credentials]]。
