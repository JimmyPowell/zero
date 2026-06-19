# 接入 Kimi CLI（provider = `kimi`）

> 状态：开发完成、未合并。分支 `feat/kimi-cli`（worktree `~/code/zero-kimi`），基于 main `9a010a5`。合并由用户来。
> 目标：把 Moonshot 的 **Kimi CLI** 作为**独立 provider**接进来（不是"claude 改端点改模型名"），与现有 provider 一样支持「任务派发 · 日志回传」；成本见下方限制说明。

## 一、调研（已在本机实测确认）

- 安装：`uv tool install --python 3.13 kimi-cli` → 二进制 `kimi`（v1.47.0，落在 `~/.local/bin`）。
- 无头：`kimi --print --output-format stream-json -y -p "<prompt>"`。
- **输出 = OpenAI-chat 风格逐条 JSON**（**不是** Claude/OpenCode 那套），实测 schema：
  - `{"role":"assistant","content":""|[{type:"text",text}], reasoning_content?, tool_calls?:[{type:"function", id, function:{name, arguments(JSON 字符串)}}]}`
  - `{"role":"tool","content":[{type:"text",text}]|string, tool_call_id}`
  - 末条 `{"role":"assistant","content":"DONE"}` = 最终回答。
- **sessionId 不在 stdout** —— 在 **stderr**：`To resume this session: kimi -r <uuid>`；续接用 `-r <id>`。
- **usage / cost：此模式不输出**（stream-json 只有消息体，无 token/费用）。
- 鉴权两种方式：① `kimi login`（OAuth 订阅账号）；② API key 写 `~/.kimi/config.toml`。本机用 **Kimi Code 国际服 key**（前缀 `sk-kimi-`），平台 base_url `https://api.kimi.com/coding/v1`，唯一模型 **`kimi-for-coding`**（ctx 262144）。
- MCP：支持 `--mcp-config`，但本期**不接**（与 codex/opencode 一致，走 prompt 内推送上下文）。

## 二、实现（独立 provider，新 adapter）

### Daemon（`daemon/src/`）
- **新文件 `kimi-adapter.ts`**：`kimiAdapter(obj)` 把上面 OpenAI-chat 消息归一化成统一 `RunEvent`：`assistant.content`→`assistant_text`、`reasoning_content`→`thinking`、`tool_calls[]`→`tool_call`（`function.arguments` JSON 串解析出 `command`/参数，进 `detail`）、`role:"tool"`→`tool_result`（含命令输出）。`role:"user"`（我们推送的 prompt）忽略。
- **`runKimi`**：`kimi --print --output-format stream-json -y [-m <model 键>] [-r <id>] -p <prompt>`；`stdin:"ignore"` 防卡；**从 stderr 正则抓 sessionId**；`usage: null`（此模式无）。
- `discover()` + `PROVIDERS` 各加 `kimi`（`mcp:false`，`sessionInvalid` 兜底正则）。
- **PATH 兜底**：daemon 启动把 `~/.local/bin` 并入 `process.env.PATH`，否则 `Bun.which("kimi")` 与子进程 spawn 找不到（uv/pipx 装的工具默认落这）。

### Server
- `agent.provider` 枚举 + `agents.ts` `providerEnum` 加 `kimi`；迁移 **0013_agent_provider_kimi**（加性 `MODIFY`，已应用 dev 库）。

### Web
- `AgentProvider` / `CreateAgentDialog` 的 `PROVIDERS` + `providerLabel` 加 `Kimi`（运行时能力条、Agents 列表自动复用标签）。
- （模型建议 chips 块来自 `feat/codebuddy-cli`，尚未并入 main；待其合并后在该块补 `kimi: ["kimicode/kimi-for-coding"]` 即可，本分支不重复引入以减小冲突面。）

## 三、模型字段的坑（重要）

Kimi 的 `-m` 要的是 **`~/.kimi/config.toml` 里的 model 键**（如 `kimicode/kimi-for-coding`），**不是裸模型名** `kimi-for-coding`（传裸名报 `LLM not set`）。因此创建 Kimi agent 时：
- **`model` 留空** → kimi 用配置里的 `default_model`（最省事，推荐）；
- 或填**配置中的 model 键**（随用户 `~/.kimi` 配置而定）。

## 四、测试（真实跑、已清场）

- **adapter 单测 8/8**：真实抓取的 kimi stream-json（Shell→exec + 完整命令进 detail、tool_result 含输出、assistant_text=DONE）+ 合成用例（reasoning→thinking、数组形态 content、Read→read、role:user 被忽略）。
- **全链路 e2e 6/6**：测试 server + 真实 daemon，建 `provider:kimi`（model 留空走 default）agent → daemon `discover` 到 kimi → 认领 → `runKimi` 跑真实 `kimi` → run 成功；`tool_call.detail`=`echo ZERO_DAEMON_OK`、`tool_result.detail` 含输出、有 `assistant_text`。
- daemon/server/web `tsc` 全过；测试数据/进程已清，8787 主库无影响。

## 五、限制 / 后续

- **无成本数据**：Kimi print 模式不吐 token/cost，`task_usage` 不入账（成本管理对 kimi 暂为空）。后续可尝试从会话元数据或非 stream-json 通道补 token。
- **MCP 未接**（本期）：需要时按 kimi 的 `--mcp-config` 格式补。
- **合并提示**：本分支与 `feat/codebuddy-cli` 各自独立改了同几处（provider 枚举 / `PROVIDERS` / `providerLabel` / AgentProvider）——都是**加性**改动；且两者迁移分别为 0012(codebuddy)/0013(kimi)，与 main 现有 0012(notifications) 同号，合并时需像通知分支那样**重排迁移号 + 出一条把全部 provider 列齐的统一迁移**。
