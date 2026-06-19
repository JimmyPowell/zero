# zero-daemon

Zero 的本地运行时 daemon。在你的机器上运行，它会发现本地的编码 Agent CLI（Claude Code / Codex / OpenCode），用配对令牌连上 Zero 服务端并保持心跳。**后台常驻运行**。

## 用法

在「Runtime 运行时管理」页添加一个运行时拿到令牌后（首次先 `bun install`）：

```bash
cd daemon && bun install

# 后台启动（常驻；关掉终端也不退出）
bun run src/index.ts start --server http://localhost:8787 --token <你的令牌>

# 查看状态
bun run src/index.ts status

# 停止
bun run src/index.ts stop

# 前台运行（调试用，Ctrl+C 退出）
bun run src/index.ts run --server http://localhost:8787 --token <令牌>
```

也可用环境变量 `ZERO_SERVER` / `ZERO_TOKEN` 代替 `--server` / `--token`。

- PID 文件：`~/.zero/daemon.pid`
- 日志：`~/.zero/daemon.log`

连上后，该运行时在 Web 端会变为「在线」，并显示发现到的工具。

## 打包成单文件二进制（可选）

```bash
bun run build   # 产出 ./zero-daemon
./zero-daemon start --server http://localhost:8787 --token <令牌>
./zero-daemon stop
```

## 路线

- **B2b（当前）**：发现 CLI + 配对 + 心跳 + 后台常驻。
- **B3**：认领 task、在 issue 的 worktree 里跑 agent、把执行流回传时间线。
