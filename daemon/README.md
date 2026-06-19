# zero-daemon

Zero 的本地运行时 daemon。在你的机器上运行，它会发现本地的编码 Agent CLI（Claude Code / Codex / OpenCode），用配对令牌连上 Zero 服务端并保持心跳。

## 运行

在「Runtime 运行时管理」页添加一个运行时，拿到配对命令后：

```bash
cd daemon
bun install
bun run src/index.ts --server http://localhost:8787 --token <你的令牌>
```

或用环境变量：

```bash
ZERO_SERVER=http://localhost:8787 ZERO_TOKEN=<令牌> bun run src/index.ts
```

连上后，该运行时在 Web 端会变为「在线」，并显示发现到的工具。

## 打包成单文件二进制（可选）

```bash
bun run build   # 产出 ./zero-daemon
./zero-daemon --server http://localhost:8787 --token <令牌>
```

## 路线

- **B2b（当前）**：发现 CLI + 配对 + 心跳。
- **B3**：认领 task、在 issue 的 worktree 里跑 agent、把执行流回传时间线。
