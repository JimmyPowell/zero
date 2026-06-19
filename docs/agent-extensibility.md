# 智能体管理升级：Skills · MCP · 可扩展性设计

> 状态：**方案设计中（待确认）**。2026-06-19 整理。
> 隔离开发：分支 `feat/agent-skills` / 工作树 `~/code/zero-agent-skills`。
> 一句话：把「智能体 = 系统指令 + 模型 + 运行时」这套**粗糙配置**，升级成「智能体 = 人格(instructions) + **可移植能力包(Skills)** + 工具(MCP) + 运行时」的**能力组合**，并配一个真正的**详情页**来管理它。

---

## 0. 现状与痛点

当前 `agent` 表只有 `name / provider / model / instructions / runtime_id`（见 `server/src/db/schema.ts:166`），管理界面只有一个创建弹窗 `web/src/components/CreateAgentDialog.tsx`（名称 / 底层工具 / 运行时 / 模型 / 系统指令五个字段）+ 列表 `AgentsView.tsx`。问题：

1. **能力只有一坨 `instructions`**：一个 agent 的全部"本事"塞在一个自由文本框里，不可复用、不可移植、不可组合、改一处动全身。
2. **没有工具层**：无法给某个 agent 接 MCP / 限定可用工具。
3. **没有扩展位**：provider 写死在枚举里，第三方能力无处可接。
4. **界面太简陋**：没有详情页，看不到一个 agent 的活动 / 用量 / 挂了哪些能力。

目标（来自需求）：**Skill 作为可移植的"提示包"，比单纯系统指令更好**；**在控制层统一保存、每次新开会话时动态加载**，绝不在单机层面手配；同时给智能体一个**详细查看页**。

---

## 1. 调研结论（底层工具 + Multica + 社区）

### 1.1 底层编码 Agent CLI 能力矩阵

调研了我们要对接/可能对接的四个底层工具（Codex/OpenCode 读本地源码，Claude Code/Gemini 查官方文档）：

| 能力 | Claude Code | Codex CLI | OpenCode | Gemini CLI |
|---|---|---|---|---|
| **Skills（SKILL.md 包）** | ✅ `.claude/skills/<n>/SKILL.md` | ✅ `~/.codex/skills`、`.agents/skills` | ✅ `.opencode/skills`，**且读 `.claude/skills`、`.agents/skills`** | ✅ `.gemini/skills`、`~/.agents/skills` |
| **MCP** | ✅ `.mcp.json` / `--mcp-config` | ✅ `config.toml [mcp_servers]` | ✅ `opencode.json mcp` | ✅ `settings.json mcpServers` |
| **子代理 subagents** | ✅ `.claude/agents/*.md` | 🟡 `agents/*.toml`（未文档化） | ✅ `agent` 块 / `*.md` | ✅ `.gemini/agents/*.md` |
| **自定义命令** | ✅ `.claude/commands` | ❌（用 Skills 替代） | ✅ | ✅（TOML） |
| **Hooks** | ✅ settings.json | ✅ `[hooks]` TOML | 🟡 只能写插件代码 | ✅ settings.json |
| **插件 / 市场** | ✅ `.claude-plugin` + marketplace | ✅ `.codex-plugin` | 🟡 npm 包，无市场 | ✅ extensions + 官方画廊 |
| **系统提示注入** | `CLAUDE.md` / `--append-system-prompt` | `AGENTS.md` / `model_instructions_file` | `AGENTS.md`（读 `CLAUDE.md`） | `GEMINI.md` / `GEMINI_SYSTEM_MD` |
| **无头调用** | `claude -p` | `codex exec` | `opencode run --dir` | `gemini -p` |

**🔑 关键结论：`SKILL.md` 是这四家共同遵循的开放标准。** 四家全部读 `SKILL.md`；而且 **OpenCode 和 Codex 直接读 Claude 的 `.claude/skills/` 和通用的 `.agents/skills/`**。对一个**主打多 provider** 的平台（Zero 正是），Skill 是可移植性最高的能力载体——一份 skill 写一次，四个底层都能用。MCP 次之（JSON/TOML 各家略不同但可机械转换）。subagents / hooks / 插件各家 schema 差异大，可移植性最差。

> 推论：**Skill 应当成为 Zero 的"能力原语"**，优先级高于 MCP，远高于插件。

### 1.2 Multica 怎么做的（对标对象）

- **Skill 存储**：DB 里 `skill`（name/description/content/config）+ `skill_file`（path/content）两表；`agent_skill` 多对多结对挂载（必须显式挂）。从 GitHub / ClawHub / skills.sh 导入；根目录 `skills-lock.json`（其实是借用 `vercel-labs/skills` 的 lockfile 格式，做可复现安装）。
- **Skill 注入**：**不进 prompt、不进 CLI 参数**。任务开跑时，daemon 把挂载的 skill **物化成真实文件**写进工作目录（`.claude/skills/` 等）+ 通用 `~/.agents/skills/`，让底层 CLI 用它自己的发现机制加载。
- **Agent 数据模型**（比我们厚很多）：`instructions / model / runtime_config / custom_env / custom_args / visibility / status / max_concurrent_tasks / mcp_config(JSONB) / skills[](junction) / archived_at`。
- **MCP**：每个 agent 一个 `mcp_config` JSONB，物化成底层原生配置，`--mcp-config` 下发。12 个 provider 里 **8 个吃、4 个忽略**。
- **插件**：**没有**。provider 全写死在核心代码里，加一个要改一堆文件——开放 issue #257 求"可插拔 provider 机制"至今没做。
- **Agent UI**：有详情页 = 左 inspector（runtime/model/visibility/concurrency picker）+ 右 tab 面板（activity/instructions/**skills**/env/custom-args）。Skills tab：从工作空间技能目录里增删；提示"本地运行时的 skill 自动可用"。

### 1.3 Multica 的短板（我们要差异化的点）

| 短板 | 证据 | Zero 的机会 |
|---|---|---|
| **版本粗糙**：skill 改了，**在跑的任务还用旧版**，无回滚/锁版本 | 官方 docs | 派发即**快照版本**进任务上下文，跑中不变；可锁 hash |
| **二进制资产导入失败**：skill 文件存 UTF-8 文本列，带图片/编译产物会炸 | flowtivity 评测 | `skill_file` 支持二进制（对象存储 / blob） |
| **provider 写死**：第三方后端无处接（#257） | GitHub issue #257 | 从第一天就留 **ProviderAdapter** 接口 |
| **安全裸奔**：不签名/不审计/不沙箱第三方 skill（2026-02 "ClawHavoc" 事件偷 API key） | 官方 docs 自承 | 导入 skill / 配 MCP 走**信任与工具白名单**层 |
| **可信度/可审计弱**：#1579 "更像玩具不像工具"，$10–100/单，完成度虚报 | GitHub issue #1579 | Zero 的 push 模型天生可把"这次用了哪些 skill / 哪些 MCP 工具 / 花了多少"**全快照落库** |

> 注意：Multica 的"skills + MCP + 插件"这个说法**夸大了插件层**——它其实只有 **skills + 按 provider 分流的 MCP**，插件行为完全甩给底层 CLI。我们不必追这个虚的。

### 1.4 MCP 的"说法"（争议）——这决定我们怎么接 MCP

社区（含 Anthropic 自己、MCP 作者）对 MCP 作为机制有实打实的批评：

- **Token / 上下文膨胀**：一上来把所有工具定义塞进上下文。Anthropic 自己实测一个任务 **150,000 → 2,000 token（-98.7%）**靠"代码执行 + MCP"省下来；GitHub 官方 MCP server 光工具定义就 ~42–55K token；5–10 个 server 没开干就吃掉 >20% 上下文。
- **安全**：工具投毒（tool poisoning）、`tools/list` 阶段的"抢跑注入"(line jumping，**调用前就能注入**)、过宽权限、长效高权 token、供应链投毒（已有真实案例）。
- **工具混淆**："工具越多 agent 越差"，几十个工具后准确率明显掉。
- **反方/解法**：**渐进式披露(progressive disclosure)/ Agent Skills / 把工具当代码调(code execution)**——只在需要时加载几十 token，是主流解药；Cloudflare "Code Mode" 把 2500+ 端点从 ~117 万 token 压到 ~1000 token。MCP 没死，它的优势在**分发**（远程工具即插即用），与 Skill **互补**。

> 推论：**MCP 要接，但要带着这些教训接**——按 agent 限定作用域、工具白名单、把工具数/token 成本显式展示、优先渐进式披露。**且排在 Skill 之后**（Skill 价值更高、风险更低）。

---

## 2. 核心设计理念

### 2.1 Skill = Zero 的能力原语（可移植提示包）

一个 **Skill** = 一份 `SKILL.md`（frontmatter：`name` / `description` / 可选 `allowed-tools` / `model`）+ 可选附属文件（脚本、模板、参考资料）。

- **遵循 SKILL.md 开放标准** → 一份 skill 四个底层通吃，契合 Zero 多 provider 定位。
- **比 instructions 强在哪**：可复用（一份挂多个 agent）、可移植（跨 provider/跨平台）、可组合（多个 skill 叠加）、**可渐进披露**（平时只有 name+description 在上下文里，命中任务才加载正文——天然规避 1.4 的 token 膨胀）。

### 2.2 instructions vs skills：人格 vs 按需能力

这是本次最关键的概念升级，**两者并存、分工明确**：

| | instructions | skills |
|---|---|---|
| 是什么 | 这个 agent **永远是谁**（人格/口吻/红线） | 它**能临时调用的本事**（某类任务的打法/规范/流程） |
| 加载 | 每轮常驻（→ `--append-system-prompt` / `CLAUDE.md`） | 渐进披露：name+desc 常驻，正文按需 |
| 粒度 | 每 agent 一份 | 工作空间共享、多对多挂载 |

### 2.3 控制层统一保存 + 运行时动态物化（需求硬约束）

**绝不在单机/单子层面往下配 skill。** 流程：

```
控制层(DB)          派发              本地 daemon                 底层 CLI
workspace 的         server 装配       claim 时拿到 agent 的       claude -p / codex exec …
skill 库(权威)  ──▶  task 时把已挂载 ──▶ 已解析 skill(含版本) ──▶  自己从 .claude/skills 等
                    的 skill 解析进     在 worktree 里物化成        发现并加载
                    task 上下文         真实文件，跑完随 worktree 清理
```

完全复用 Zero 现有架构：server 已经"主动装配上下文"（`dispatch.ts: assembleContext`），daemon 已经会写 `CLAUDE.md` 和 `~/.zero/mcp/<issueId>.json`（见 `agent-context-model.md` §5）。Skill 物化只是**在同一处多写几个文件**。

### 2.4 双层：工作空间技能库 + 每 agent 挂载（回答"单独管理 vs 每 agent 加"）

需求问到："是单独搞个 skills 管理，还是只在每个 agent 下面加 skill？" —— **答案是两个都要，分工不同**：

- **工作空间技能库（单独管理页）**：skill 的**作者态** —— 建、改、导入、删、看版本、看被谁用。一处维护，多处复用。
- **每个 agent 的 Skills tab（挂载态）**：从库里**勾选挂载/卸载**，不在这里写 skill 正文。

这正是 Multica 的形态，也是唯一讲得通的形态：库负责"有哪些能力"，agent 负责"我用哪几个"。

---

## 3. 数据模型（提案）

新增三张表 + 给 `agent` 加几列。MySQL / Drizzle，与 `schema.ts` 风格一致。

```
skill                      // 工作空间级技能（SKILL.md 主体）
  id, workspace_id
  slug            -- 工作空间内唯一，= SKILL.md 的 name
  name, description        -- description 用于渐进披露 + 列表
  content (text)           -- SKILL.md 正文
  source enum(manual|github|registry) default manual
  source_ref (text)        -- 导入来源(repo URL / 包名)，manual 为空
  content_hash char(64)    -- 正文+文件的指纹，用于版本锁定/快照
  created_by, created_at, updated_at
  unique(workspace_id, slug)

skill_file                 // skill 的附属文件（支持二进制，修 Multica 的坑）
  id, skill_id -> skill.id (cascade)
  path (varchar)           -- skill 内相对路径，校验防穿越/绝对路径/..
  is_binary (bool)
  content (longtext)       -- 文本直存；二进制走 storage_key
  storage_key (text)       -- 二进制对象存储键（可选）
  size (int)
  unique(skill_id, path)

agent_skill                // 多对多挂载（显式）
  agent_id -> agent.id (cascade)
  skill_id -> skill.id (cascade)
  position (int)           -- 展示/加载顺序
  unique(agent_id, skill_id)

agent  // 加列
  + description (text)            -- 详情页用
  + mcp_config (json)             -- 每 agent MCP（Phase S4）
  + allowed_tools (json)          -- 工具白名单（可选，S4）
  + env (json), custom_args (json)-- 可选，靠后
```

**版本快照（修 Multica 的"跑中用旧版"）**：派发 task 时，server 把每个挂载 skill 的 `content_hash` 一并写进 task 的上下文快照（Phase B 已规划 task 带 `context` JSON）。daemon 物化的是**快照那一刻的版本**；跑到一半改库不影响在跑的任务。可选：建 `task_skill(task_id, skill_id, content_hash)` 把"这次用了啥版本"落库 → 直接服务于 Zero 的**可审计**卖点。

---

## 4. Skill 注入流程（细节，每个 provider 落地）

daemon 在 worktree 准备好后、调底层 CLI 前，按 agent.provider 物化 skill：

| provider | 物化目标（worktree 内） | 备注 |
|---|---|---|
| claude_code | `<worktree>/.claude/skills/<slug>/SKILL.md` + 文件 | cwd=worktree 时 Claude 自动加载；**别用 `--bare`**（会跳过 skill 自动发现） |
| opencode | 同写 `.claude/skills/`（OpenCode 也读它）即可 | 省一份 |
| codex | `<worktree>/.agents/skills/<slug>/` 或 `.codex/skills/` | Codex 读 `.agents/skills` |
| 通用兜底 | `<worktree>/.agents/skills/<slug>/` | 四家多数都读，跨 provider 一份搞定 |

**关键工程细节（比 Multica 想得细）：**

1. **物化进 worktree，不进 home**：保证**按 issue 隔离**、**随 worktree 关闭自动清理**（契合 Zero 的 worktree GC），不像 Multica 写 `~/.agents/skills/` 会跨任务串味。
2. **不污染仓库 diff/PR**：把 `.claude/ .codex/ .agents/ .opencode/` 写进该 worktree 的 `.git/info/exclude`，让物化文件不出现在 `git status`/PR 里。
3. **版本即快照**：物化的是派发时刻的 `content_hash` 版本（见 §3）。
4. **instructions 仍走 `CLAUDE.md` / `--append-system-prompt`**（daemon 已有），与 skills 并存不冲突。

> 这条流水线让需求里"控制层保存 + 每次新开动态加载 + 不在单子层往下配"**逐字落地**。

---

## 5. MCP 设计（带着 1.4 的教训接）

Zero **已经有一半**了：daemon 的 `src/mcp-context.ts` 是一个平台级 MCP server（`zero_older_comments` / `zero_prior_runs`），`writeMcpConfig` 写 `~/.zero/mcp/<issueId>.json`（0600）、`runClaude` 加 `--mcp-config`。在此之上分两层：

- **平台 MCP（已建，继续扩）**：Zero 自己的上下文工具（更早评论、历史运行；可加：关联 issue、上次 diff）。这是渐进披露的正面案例——只暴露 2 个工具，"够用就别拉"。
- **用户 MCP（新增，Phase S4）**：每 agent 一个 `mcp_config`（§3），daemon 把它**和平台 server 合并**写进同一份 `--mcp-config`，对 Codex/OpenCode 则转成各自原生格式。

**针对争议的设计动作：**
1. **按 agent 限定作用域**：MCP 只对挂了它的 agent 生效，token 膨胀被关在需要它的 agent 里，不全局污染。
2. **工具白名单**：`agent.allowed_tools` 限定该 agent 能调哪些 MCP 工具（`--allowedTools "mcp__x__*"`）。
3. **把成本摆上台面**：详情页/运行详情显示"本次启用 N 个 MCP 工具、占多少 token、花多少钱"（Zero 已有 `task_usage` 落库，可直接做）——这是 Multica 给不了的可审计差异化。
4. **优先渐进披露**：能用 skill/CLI 解决的不开 MCP；MCP 留给真正需要"远程即插即用工具"的场景。
5. **信任层**：导入的第三方 skill / 配的 MCP server 标注来源与信任级别（修 Multica 的安全裸奔）。

---

## 6. Provider 适配层 → 插件位（留缝，先不做市场）

把每个 provider 在 daemon 侧抽象成一个 **adapter**：

```
interface ProviderAdapter {
  materializeSkills(worktree, skills)   // §4：写到该 provider 的 skills 目录
  writeMcpConfig(worktree, mcpConfig)   // §5：转成原生 MCP 配置
  buildArgs(opts)                        // 无头调用参数（-p / exec / run …）
  parseStream(stdout) -> RunEvent[]      // 翻成 Zero 统一事件（已有 run_event 规范）
}
```

- 现在就把 claude_code / codex / opencode 三个 adapter 抽出来——**这就是未来"插件/第三方 provider"的接缝**，从第一天解决 Multica #257 的硬伤。
- **先不做插件市场**：Multica 都没有，它是最不被验证、成本最高的部分。**留接口，往后排**。

---

## 7. 前端：智能体详情页 + 技能库（清爽）

延续设计令牌（纯白卡片 + `#2563eb` + 柔和毛玻璃弹层，见 `[[ui-soft-transitions]]`）。

**A. 智能体详情页** `/agents/:id`（替代现在的单弹窗）：
- **左侧 inspector**：头像 / 名称 / 描述（行内编辑）、provider、model、runtime、可见性、并发、状态。
- **右侧 tab 面板**：
  - **Instructions**：人格系统提示（原 instructions 搬这）。
  - **Skills**（本次主角）：已挂载列表 + "从技能库添加"；只挂载不编辑。
  - **Tools / MCP**（S4）：配 MCP server、看工具数 / token / 成本、设工具白名单。
  - **Activity**：最近运行 + 用量/成本（接 `task_usage`）。
  - （靠后）**Environment**：env / custom_args。
- 创建仍保留**极简弹窗**（名称 + provider + runtime），细配进详情页。

**B. 技能库** `/skills`（工作空间级，新菜单"技能库"）：
- 列表（name/description/来源/被几个 agent 用）、新建/编辑（写 SKILL.md + 附件）、导入（先手动，GitHub/registry 靠后）、删除（带"被 N 个 agent 引用"保护）。

---

## 8. 与 Multica 的差异化（一张表）

| 维度 | Multica | Zero 的设计 |
|---|---|---|
| Skill 标准 | SKILL.md（可移植） | 同（保留这个优点） |
| Skill 版本 | 跑中用旧版、无锁 | **派发即快照 hash**，可锁、可审计 |
| 二进制附件 | UTF-8 文本列，会炸 | `skill_file` 支持二进制 |
| 物化位置 | 写 home，跨任务串味 | **写 worktree，随 issue 清理 + git exclude 不污染 PR** |
| provider | 写死核心代码（#257） | **ProviderAdapter 接缝**，留插件位 |
| MCP | 接了但按 provider 分流、UI 缺 | 接 + **按 agent 限域 + 工具白名单 + 成本上台面** |
| 安全 | 不签名/不审计/不沙箱 | 来源/信任标注 + 工具白名单 |
| 可审计 | 弱（pull 模型） | **强**：用了哪些 skill/MCP/花多少全快照落库（push 模型天生优势） |
| 插件市场 | 无 | 先留缝，往后做 |

---

## 9. 分阶段实施（每步可独立验收，配合 commit-per-module）

> 命名延续 Phase A(底座)/B(执行)，本批为 **Phase C（可扩展性）**。

- **C1 技能库 + 数据模型**：`skill / skill_file / agent_skill` 表；工作空间"技能库"CRUD + 手动建/编辑；API。**不动执行链**，纯加法。
- **C2 智能体详情页**：用详情页替换单弹窗；Instructions / Skills（挂载/卸载）/ Activity tab；provider/model/runtime 搬进去。前端为主。
- **C3 Skill 运行时注入**：daemon 按 provider 物化挂载的 skill 进 worktree；派发快照版本；随 worktree 清理；git exclude。**这步 skill 才真正在跑里生效。**
- **C4 每 agent MCP**：`mcp_config` + 工具白名单 + 物化 + 详情页 Tools tab + 工具数/成本展示。
- **C5 适配层重构 + 导入/版本**：抽 `ProviderAdapter`；GitHub/registry 导入 skill；版本锁定/二进制附件；（更后）插件位。

依赖关系：C1 → C2/C3 可并行 → C4 → C5。建议先做 **C1 + C2 + C3** 这条"skill 全链路"，让 skill 端到端跑通见效，再上 MCP(C4)。

---

## 10. 待你拍板的开放问题

1. **范围与顺序**：先把 **C1+C2+C3（Skill 全链路）**做完见效，MCP(C4) 下一批？还是要并行推 MCP？（建议：先 Skill，理由见 §1.4）
2. **技能库归属**：skill 定在**工作空间级**（团队共享、跨 agent）对吧？要不要再留个"账号级私有 skill"概念？（建议：先只做工作空间级，够用且简单）
3. **导入来源**：C1 先只做"手动新建 skill"，GitHub/registry 导入放 C5？（建议：是）
4. **二进制附件**：第一版 `skill_file` 是否只支持文本，二进制留到 C5？（建议：是，先文本）
5. **命名**：分支/工作树叫 `feat/agent-skills`，文档叫 `agent-extensibility.md`，对外能力叫"技能(Skills)"——这套命名 OK 吗？

> 确认后，我按 §9 的阶段开始，每个阶段过测后本地 commit 并更新 `progress.md`。
