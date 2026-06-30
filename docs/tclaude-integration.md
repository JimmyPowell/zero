# 接入 TClaude CLI（provider = `tclaude`）

> 状态：开发完成，已端到端验证（隔离测试栈跑通真实调用 + 日志 + 用量）。分支 `feat/tclaude-provider`（worktree `~/zero-tclaude`），基于 main `4682e0e`。合并由用户来。
> 目标：把腾讯 **TClaude** 作为新的编码 Agent provider 接进来，和 Claude / Codex / OpenCode / CodeBuddy / Kimi 一样支持「任务派发 · 日志回传 · 成本管理」。

## 一、调研：TClaude 是什么（与 CodeBuddy 的本质区别）

- 本机：`@tencent/tclaude` **v0.0.8**，可执行 `tclaude`，装在 nvm 的 node bin 下，已登录（IOA SSO）。
- **关键发现：它是「封装原版 Claude Code 的 wrapper」**，而非 CodeBuddy 那种独立衍生版：
  - `package.json` 依赖直接写死 `"@anthropic-ai/claude-code": "2.1.154"`；`bin/tclaude` 仅 `require('../dist/tclaude')`。
  - `tclaude --help`：自带子命令 `login/logout/update/daemon`，**其余参数原样透传给底层 claude-code**（"All other args are forwarded to upstream Claude Code as-is"）。
  - 因此无头接口与 `claude` **逐字段同构**：`tclaude -p --output-format stream-json --verbose --dangerously-skip-permissions --disallowedTools AskUserQuestion`（prompt 走 stdin）→ `system/init`(session_id, model) → `assistant`(text/thinking/tool_use) → `user`(tool_result) → `result`(total_cost_usd, usage)。实测无 flag 冲突、无需 `--`。
  - 会话续接 `-r/--resume`、`--mcp-config`、`--effort`、`--model` 全部透传可用。
- **与 CodeBuddy 的差异（决定接入细节）**：

  | 维度 | CodeBuddy | **TClaude** |
  |---|---|---|
  | 本质 | 独立 CC 衍生版 | **封装原版 claude-code 2.1.154 的 wrapper** |
  | 网关 | `www.codebuddy.ai`（裸跑即通） | `copilot.tencent.com`（**腾讯内网 IOA，须直连、不能走境外代理**） |
  | 鉴权 | API key | **IOA SSO**（`tclaude login` 浏览器授权，登录态复用本机 `~/.tclaude`） |
  | 成本 | `total_cost_usd` 报 0 | **报真实 USD**（实测 haiku 一次 $0.05） |
  | 模型 | gemini/gpt/deepseek… | **纯正 Claude**：sonnet-4-6 / opus-4-8 / haiku-4-5（含 `[1m]` 百万上下文）+ 混元 `hy3` |
  - `--model` 取值是 tclaude 的「name」（连字符 + 可选 `[1m]`，如 `claude-haiku-4-5`、`claude-opus-4-8[1m]`），**非带点 id**。

## 二、方案：复用 Claude 那条链，仅加 tclaude 专属的网络隔离

stream-json / 续接 / 成本 / MCP / 技能全同构（且比 CodeBuddy 更干净——本就是原版 CC），**daemon 侧直接复用 `claudeAdapter` 与 `runClaudeLike`**：

### Daemon（`daemon/src/index.ts`）
- `discover()` 增 `tclaude: Bun.which("tclaude") != null`。
- `runTclaude = (…) => runClaudeLike("tclaude", …)`（只换二进制名，adapter 原样复用）。
- `PROVIDERS.tclaude = { runner: runTclaude, sessionInvalid: /no conversation found|session id/i, mcp: true, skills: { kind:"dir", dirs:[".claude/skills"] } }`。
- **代理隔离（tclaude 专属，唯一增量）**：`runClaudeLike` 的子进程 env 改为 `bin==="tclaude" ? tclaudeEnv() : process.env`。`tclaudeEnv()` 默认**剥离继承的全部 proxy 变量**（直连内网网关）+ `NO_PROXY` 收口 `copilot.tencent.com,.tencent.com,.woa.com,.codebuddy.cn`；`ZERO_TCLAUDE_PROXY` 设了则改用它（兜底）。**claude/codebuddy 那条链完全不受影响**。
- "暂未支持"错误串补 `tclaude`。

### Server
- `db/schema.ts` `agent.provider` 枚举加 `"tclaude"`；`routes/agents.ts` `providerEnum` 加 `"tclaude"`；effort 注释把 tclaude 纳入 Claude 系。
- 迁移 **0027**（`0027_cultured_lionheart.sql`，drizzle-kit 生成含 snapshot/journal）：`ALTER TABLE agent MODIFY provider ENUM(…,'tclaude') …` —— **末尾加值、加性、向后兼容**。

### Web
- `lib/api-client.ts` `AgentProvider` 加 `"tclaude"`。
- `CreateAgentDialog.tsx`：`PROVIDERS` + `providerLabel:{tclaude:"TClaude"}` + `modelSuggestions.tclaude`（低成本在前：`claude-haiku-4-5 / claude-sonnet-4-6 / claude-sonnet-4-6[1m] / claude-opus-4-8[1m]`）+ `effortOptions.tclaude`（同 claude_code）。
- `ProviderIcon.tsx`：tclaude 用 Claude 商标但 `currentColor`（随主题着色，区别官方橙）。`RuntimeDetailView/RuntimesView/AgentsView/AgentDetailView` 均经 `providerLabel`/`ProviderIcon` 自动显示「TClaude」。

### 鉴权（按用户决策：不写凭证代码）
- daemon 以本机 OS 用户跑，tclaude 自动复用 `~/.tclaude` 登录态——和 claude 读 `~/.claude`、kimi 读 `~/.kimi` 同一套路。
- **前置条件**：跑 tclaude 任务的 runtime 主机须预先 `tclaude login` 完成一次 IOA 授权（登录态按主机 OS 用户、自动复用）。

## 三、测试（端到端，隔离栈）

隔离测试栈：一次性 MySQL（docker，:3399）+ 迁移到 0027 + 测试 server（独立端口）+ worktree daemon + 真实 tclaude；**不碰 live 8787/主库**，跑完即清。

全链路实测通过：
- daemon `discover()` 上报 `capabilities.tclaude=true` → 运行时详情页/列表显示「TClaude」（"前端能看到"）。
- 建 `provider:tclaude` / `model:claude-haiku-4-5` 智能体 → server 接受新枚举（"智能体能选 tclaude"）。
- 建 issue 派发 → daemon `runTclaude` 真跑（直连内网、复用 `~/.tclaude` 登录态）→ task `succeeded`。
- 运行日志 7 条 `run_event` 全部回传：`run_status`(init, model=claude-haiku-4-5) / `thinking` / `tool_call`(Bash `echo`) / `tool_result` / `assistant_text` / `usage`(用时 12.4s · $0.0507) / `run_status`(结束)。
- `task_usage` 落库**真实成本**：cost $0.050713、input 16 / output 346 / cacheRead 31540 / cacheWrite 35497 / turns 2。
- 三端 `tsc` 全过；迁移仅在一次性库执行（主库无影响）。

## 四、后续（未做，留后）
- 未登录时把 IOA 授权链接透出到 Web 端引导（当前靠主机预登录）。
- 按 Zero 用户隔离 tclaude 身份（当前同 runtime 共用一个 IOA 身份，与现有 provider 一致）。
- 读 `product.json` 动态生成模型 chips（当前手填 enabled 列表）。
