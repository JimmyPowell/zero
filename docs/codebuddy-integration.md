# 接入 CodeBuddy CLI（provider = `codebuddy`）

> 状态：开发完成、未合并。分支 `feat/codebuddy-cli`（worktree `~/code/zero-codebuddy`），基于 main `ecaa975`。合并由用户来。
> 目标：把腾讯 **CodeBuddy Code** 作为新的编码 Agent provider 接进来，和 Claude / Codex / OpenCode 一样支持「任务派发 · 日志回传 · 成本管理」。

## 一、调研：CodeBuddy 是什么

- 本机：`@tencent-ai/codebuddy-code` **v2.108.2**，可执行 `codebuddy`（别名 `cbc`），装在 nvm 的 node bin 下，已登录（`apiKeySource: www.codebuddy.ai`）。
- **关键发现：它是 Claude Code 的衍生版**，无头接口与 `claude` **逐字段同构**：
  - 调用：`codebuddy -p --output-format stream-json --verbose -y`（与 claude 完全一致）。
  - 事件流：`system/init` → `assistant`（`message.content[]` 里 `tool_use`/`text`/`thinking`）→ `user`（`tool_result`）→ `result`。比 claude 多出 `system/subtype:status`、`file-history-snapshot` 两类，**我们的 `claudeAdapter` 不认就忽略**，无副作用。
  - 会话续接：`-r/--resume <sessionId>` / `--session-id`（与 claude 一致）。
  - 成本/用量：`result.total_cost_usd` + `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`（与 claude 一致）。
  - MCP：`--mcp-config <fileOrString>` + stdio server（与 claude 一致）。
- **支持模型**（`--model`，低成本在前）：`gemini-3.1-flash-lite`、`gemini-3.0-flash`、`gemini-2.5-flash`、`gemini-3.5-flash`、`deepseek-v3-2-volc`、`kimi-k2.5`、`glm-5.0`、`gemini-3.1-pro`、`gemini-2.5-pro`、`gpt-5.5`、`gpt-5.4`、`gpt-5.3-codex`、`gpt-5.1-codex(-mini)`。
- **网络**：网关在 `www.codebuddy.ai`，本机**裸跑即通，无需代理**（区别于 codex 的 `wss://chatgpt.com`）。
- 实测探针（`gemini-3.1-flash-lite` 跑 `echo ZERO_CB_OK`）：exit 0、`result.is_error:false`、token 真实（input 41513 / output 35）、`total_cost_usd:0`（腾讯网关此模型报 0，token 始终真实，性质类似 codex 订阅）。

## 二、方案：复用 Claude 那条链，不另起炉灶

既然 stream-json / 续接 / 成本 / MCP 全同构，**daemon 侧直接复用 `claudeAdapter` 与 `runClaude` 的逻辑**，新增量极小：

### Daemon（`daemon/src/index.ts`）
- `discover()` 增 `codebuddy: Bun.which("codebuddy") != null`。
- 把 `runClaude` 抽成 `runClaudeLike(bin, …)`，`runClaude`/`runCodebuddy` 两个薄包装只换二进制名（`"claude"` / `"codebuddy"`），**adapter 原样复用**。
- `PROVIDERS` 增 `codebuddy: { runner: runCodebuddy, sessionInvalid: /no conversation found|session id/i, mcp: true }`。
- MCP 上下文 server（`zero_older_comments`/`zero_prior_runs`）经 `--mcp-config` 注入（与 claude 同档）。

### Server
- `db/schema.ts` `agent.provider` 枚举加 `"codebuddy"`；`routes/agents.ts` `providerEnum` 加 `"codebuddy"`。
- 迁移 **0012**（`0012_agent_provider_codebuddy.sql`）：`ALTER TABLE agent MODIFY provider ENUM(...,'codebuddy') ...` —— **末尾加值、加性、向后兼容**，已应用到 dev 库（不影响仍在跑的 8787 主库）。

### Web
- `lib/api-client.ts` `AgentProvider` 加 `"codebuddy"`。
- `components/CreateAgentDialog.tsx` `PROVIDERS` + `providerLabel` 加 `CodeBuddy`（`RuntimesView` 能力条、`AgentsView` 标签自动复用此 label）。
- **模型建议（item 8）**：模型框下新增可点选的常用模型 chips（低成本在前），各 provider 一组；CodeBuddy 给全量列表，codex 留空（其模型 id 依本机版本而定，不给可能失效的建议）。点选即填，仍可自由输入。

### 「三件套」如何覆盖（基本零额外工作）
- **任务派发**：`executeClaim`/`pump`/`PROVIDERS` 通用分发 + 运行时级并发，加一个 PROVIDERS 条目即接入。
- **日志回传**：经 `claudeAdapter` → `run_event`（`text` 摘要 + `detail` 完整内容）→ SSE 实时 + 历史回放 + 可展开详情 UI，与 claude 完全一致。
- **成本管理**：`runClaudeLike` 原样采集 `total_cost_usd` + token，落 `task_usage`（腾讯网关部分模型 cost 报 0，token 真实）。

## 三、测试

- **单测 9/9**：`claudeAdapter` 解析 CodeBuddy 真实抓取的 stream-json —— `system/status`、`file-history-snapshot` 被忽略；`init→run_status`(含模型名)、Bash→`exec` 且完整命令进 `detail`、`tool_result` 含输出、`assistant_text=DONE`、`usage` 事件含成本文案 + 真实 token。
- **全链路 e2e 8/8**：测试 server(8788) + 真实 daemon，建 `provider:codebuddy` / `gemini-3.1-flash-lite` 的 agent 与 issue → daemon `discover` 到 codebuddy → 认领 → `runCodebuddy` 跑真实 `codebuddy`（带 `--mcp-config`，run 成功，说明 MCP 配置被接受）→ run 成功；`tool_call.detail` = `echo ZERO_DAEMON_OK`、`tool_result.detail` 含输出、有 `assistant_text`；`task_usage` 落库（runs 1 / input 42185 / output 31 / cacheRead 19192 / cacheWrite 22993 / cost 0）。
- daemon / server / web `tsc` 全过；测试数据已清，测试进程已停，8787 主库无影响。

## 四、运维 / 后续

- **无需代理**：CodeBuddy 网关在 `www.codebuddy.ai`，daemon 裸启即可（与 codex 需带代理 env 不同）。
- **MCP 深度验证**：e2e 已确认 codebuddy 接受 `--mcp-config` 且 run 成功；agent 实际调用 `zero_*` MCP 工具的深度验证可在后续真实仓库任务中再确认（CC 衍生版，MCP 机制同源，风险低；若发现不兼容，降为 `mcp:false` 即退回 prompt 内推送上下文，功能不受损）。
- **Phase 3（后话，未做）**：某次执行改了哪些文件 / ±行数 / 每文件 diff / 文件预览 —— 对四家 provider 统一。
