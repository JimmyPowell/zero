# Provider-aware 技能挂载方案 ⏳待办（出方案，先不做）

> 2026-06-19。现状：daemon `materializeSkills` 把技能只物化进 `.claude/skills/<slug>/SKILL.md`，**只有 Claude Code（和它的衍生 CodeBuddy）能发现**。现在有 5 个 provider，要让技能对各家都生效。本文给方案，待 review 后再实现。

## 1. 关键调研结论：格式是标准的，只有"目录"不同

**好消息**：`SKILL.md` 是**开放标准**（Anthropic 的 Agent Skills 规范 agentskills.io，2025-12 开源，被 OpenAI Codex / Gemini / OpenCode 等采纳）。一个 skill = 一个目录 + `SKILL.md`（YAML frontmatter: name/description + markdown 正文）+ 可选脚本/参考文件。**同一份 SKILL.md 跨工具通用** —— 我们现在生成的格式不用改。

**差异只在"放哪个目录"**（各家扫描的约定不同）：

| provider | 技能目录约定 | 备注 |
|---|---|---|
| claude_code | `.claude/skills/<slug>/SKILL.md` | 现状；自动发现 |
| codebuddy | `.claude/skills/`（极可能同 claude） | Claude Code 衍生版，待确认 |
| codex | `.agents/skills/<slug>/SKILL.md` | 从 cwd 向上扫到 repo root 的每个 `.agents/skills` |
| opencode | 采纳 SKILL.md 标准（native）；目录待确认（`.opencode/skills` 或 `.agents/skills`） | 在官方"原生支持"清单里 |
| kimi | **无原生 skills 机制**（不在标准清单） | 需兜底 |

另有 **`AGENTS.md`**（跨工具的"项目指令"标准，codex/opencode/aider/goose 等都读）——它是**常驻指令**，不是按需加载的 skill，可作无 skills 机制时的兜底载体。

来源：[Agent Skills 规范/Codex skills](https://developers.openai.com/codex/skills)、[AGENTS.md](https://agents.md/)、[SKILL.md 跨工具指南](https://www.thepromptindex.com/how-to-use-ai-agent-skills-the-complete-guide.html)。

## 2. 方案（优雅版）：把"技能目录"参数化进 provider 注册表

核心：**SKILL.md 写法不变，只把目标目录按 provider 取**。改动极小、零格式分叉。

### 2.1 provider 注册表加一个字段
daemon `PROVIDERS[provider]` 现有 `{ runner, sessionInvalid, mcp }`，加：
```ts
skills:
  | { kind: "dir"; dirs: string[] }   // 写 SKILL.md 到这些目录（可多个）
  | { kind: "agentsmd" }              // 无 skills 机制 → 汇总进 AGENTS.md
  | { kind: "prompt" }                // 最兜底 → 注入 prompt（已有 push 通道）
```
映射：
- claude_code / codebuddy → `{kind:"dir", dirs:[".claude/skills"]}`
- codex → `{kind:"dir", dirs:[".agents/skills"]}`
- opencode → `{kind:"dir", dirs:[<待确认>]}`（确认前可先 `.agents/skills`，多数采标准）
- kimi → `{kind:"agentsmd"}`（或 `"prompt"`）

### 2.2 materializeSkills 改成按策略分发
`materializeSkills(cwd, skills)` → `materializeSkills(cwd, skills, spec.skills)`：
- `dir`：现有逻辑，base 目录从写死的 `.claude/skills` 改成 `spec.skills.dirs` 逐个写（manifest 仍按目录各自管自管 slug、保留用户自带、加 git exclude）。
- `agentsmd`：把挂载技能渲染成一段，幂等地并进 `<cwd>/AGENTS.md`（带 Zero 标记块，便于清理）。
- `prompt`：不落盘，把技能名/描述/正文摘要拼进 `buildPrompt`（provider 无关，但常驻上下文、非渐进式）。

### 2.3 为什么这样优雅
- **格式零分叉**：SKILL.md 是标准，五家共用一份生成器。
- **加新 provider≈一行**：注册表里写它的 `skills` 策略即可。
- **退化安全**：没有原生 skills 的（kimi）走 AGENTS.md/prompt 兜底，不会"挂了等于没挂"。
- **渐进式优先**：能走目录的就走目录（按需加载、省 token），不行才常驻。

### 备选（更省事但略糙）
不分 provider，**一律同时写 `.claude/skills` + `.agents/skills`**（都是加性、互不干扰）→ 覆盖 claude/codebuddy/codex/opencode 四家，kimi 再兜底。少了注册表字段，但会写一些目标 provider 用不到的目录。**推荐 2.1 的按 provider 取，干净。**

## 3. 待确认（实现前先查清）
- **opencode** 实际扫的技能目录（`.opencode/skills`？`.agents/skills`？AGENTS.md？）——本机 `opencode` 起个 skill 实测。
- **codebuddy** 是否就是 `.claude/skills`（衍生版极可能，确认一下）。
- **kimi** 是否读 `AGENTS.md`（决定兜底走 agentsmd 还是 prompt）。

## 4. 改动估算（小）
- daemon：`PROVIDERS` 加 `skills` 字段 + `materializeSkills` 按策略分发（dir 逻辑复用，新增 agentsmd/prompt 两个小函数）。
- server/web：**零改动**（技能数据模型/挂载 API/详情页都不变）。

## 5. 状态
⏳ **待办**。先把 §3 三个目录约定查实，再按 §2.1 实现。当前 main 上：claude/codebuddy 技能生效，codex/opencode/kimi 技能**暂不生效**（物化只写 `.claude/skills`）。
