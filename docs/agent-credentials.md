# Agent 凭据注入（BYOK / custom_env）设计方案 ⏳待办

> 2026-06-19 立项记录。**现在不做**——个人在自己 Mac 上复用 CLI 登录态已够用。
> 等要上「云端无头 runtime / 一台机多账号 / 走代理路由 / 企业 Bedrock」时再做。本文是届时的实现蓝本。

## 1. 背景与现状

Zero 现在 daemon 跑 CLI 是 `env: process.env`（`daemon/src/index.ts` 的 `runClaude/runCodex/runOpenCode` spawn）——把 daemon 自己那份完整环境**原样透传**，靠机器上**已有的登录态**（claude OAuth / codex ChatGPT 登录 / opencode 存盘凭据）。控制层**没有任何凭据字段**：agent 只有 `provider/model/instructions/runtimeId`。

**够用，但天花板明显**：

| 场景 | 机器登录够吗 | 对凭据注入的需求 |
|---|---|---|
| 个人在自己 Mac 跑（现状） | ✅ 够 | 低 |
| 云端 / 无头 runtime（VPS、CI） | ❌ 不能交互式 `claude login` | **刚需** |
| 一台 runtime 多账号 / 多 provider | ❌ 一台机共用一个登录 | 高 |
| 走代理 / 网关（国内、企业出口、LiteLLM） | ❌ | 高（靠 `*_BASE_URL`） |
| 企业 Bedrock / Vertex / 合规 | ❌ | 高 / 刚需 |

CLI 层本就支持用 env 传认证：claude `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`/Bedrock；codex `OPENAI_API_KEY`；opencode 各 provider key。所以机制现成，缺的是**控制层的录入 + 注入 + 安全存储**。

## 2. 目标

- 控制层可按 **agent**（可选 **runtime**）注入认证 / 环境变量（BYOK）。
- 与机器登录**并存、向后兼容**：`custom_env` 为空 → 完全退回现状，零回归。

## 3. 方案（参考 Multica，且安全上做得比它好）

**Multica 的做法**（已调研）：per-agent `custom_env`（JSONB），spawn 时 merge 进进程 env；黑名单系统键（`MULTICA_*`/`PATH/HOME/...`）；非 owner 读取 redaction 成 `****`，取值走专门审计端点 `GET /api/agents/{id}/env`；CLI 三种录入（inline/file/stdin）。**短板：值在 DB 里明文存**（官方文档明确警告）。

**Zero 方案：照搬其结构，但凭据加密存（差异化）。**

### 3.1 数据模型
- `agent` 加 `custom_env`（JSON，**值加密存**）。
- 可选：`runtime` 加 `base_env`（该机器共享默认，如统一代理 `*_BASE_URL`）。
- 生效优先级（后者覆盖前者）：`机器 process.env` < `runtime.base_env` < `agent.custom_env`。

### 3.2 注入点（daemon）
- spawn 从 `env: process.env` → `env: { ...process.env, ...resolvedEnv }`（claim 响应里下发 `resolvedEnv`）。
- **黑名单**（不可被覆盖）：`ZERO_*`、`PATH/HOME/USER/SHELL/TERM`、MCP 注入用到的键。

### 3.3 安全（重点，胜过 Multica 的明文）
- **静态加密**：DB 存密文，server 持 `CREDENTIAL_ENC_KEY`（env，别入库），AES-256-GCM。
- **写多读少**：set 时写入；`list/get` 只回 key 名 + 是否有值（**不回值**）；读明文仅 owner/admin 走**专门审计端点**（记谁在何时读了哪个 agent 的 env）。
- **下发**：claim 时把**解密后**的 env 随 task 下发给 daemon（走运行时令牌鉴权通道，**生产必须 HTTPS**）；daemon 用完不落盘。
- **不泄漏**：绝不进 `run_event` / 日志 / 前端（除掩码）；表单 / CLI 值 write-only。

### 3.4 前端
- agent 编辑页加「凭据 / 环境变量」分区：key-value 列表，值掩码 + write-only；文案提示用途（BYOK / 代理 / 企业网关）。

## 4. 改动点估算（小）
- **迁移**：`agent.custom_env`（+ 可选 `runtime.base_env`）。
- **server**：set / redacted-list / audited-read 端点 + 加解密 + 黑名单校验。
- **dispatch**：claim 响应带解密后的 `resolvedEnv`。
- **daemon**：spawn 处 merge env（一行）。
- **web**：agent 表单加分区。

## 5. 风险 / 注意
- 下发的是明文 env，过网络 → 生产**强制 HTTPS**。
- `CREDENTIAL_ENC_KEY` 管理（env，丢了等于凭据全失效；轮转方案另议）。
- 审计日志（读取 env 的人/时间/目标）。
- 黑名单别漏 `ZERO_*` 与系统键，否则可被覆盖搞破坏。

## 6. 状态
⏳ **待办**。触发条件：要上**云端无头 runtime / 多账号 / 代理路由 / 企业**任一时启动。优先级随「上云」需求提升。届时按本方案「加密存 + 审计读 + 黑名单」实现，不要学 Multica 明文存。
