# 长期记忆 / 团队知识库设计

> 2026-06-20 起草。本期两条分支之一（`feat/projects-knowledge`）。依赖[项目层](./projects.md)；与变更可视化（独立分支 `feat/file-diff-view`）共用 git diff。

## 一、核心理念

- **记忆 = 用 git 管理的团队 markdown 文档**，不是向量/图里的私有结构。版本化、可 review（PR）、可 `git blame`、可一键回滚乱写的记忆——而且**每次改动就是一条 git diff**，直接复用变更可视化那套 diff 查看器。
- **两级**：工作空间级（团队总库）+ 项目级（每项目一份），压在新引入的[项目层](./projects.md)上。
- 对标 Multica：它**无跨 issue 记忆**（每个 issue 从零重新探索仓库），`pgvector` 写在 README/镜像里但**代码从没启用**，`workspace.context` 是没接进执行的死代码（公开 issue **#838** 在要 workspace memory）。Zero 已把"记忆落平台侧时间线"做了一半，这里补齐"跨 issue / 团队级 / 可积累"。

## 二、自研 vs 接现成（结论）

- 主流开源记忆框架（mem0 / Letta / Zep-Graphiti / Cognee / txtai / Memori）**协议都干净**（Apache-2.0/MIT）——**所以不是协议问题**。
- 真正代价是**技术栈错配**：它们几乎全 Python 优先，重的还强拉外部库（Letta=常驻 Python 服务、mem0=向量库 Qdrant、Graphiti=图库 Neo4j、Memobase=Postgres+Redis），且把记忆存成**向量/图/私有 JSON**，跟"git 管的 markdown"诉求相反。
- **决定：自研薄薄一层**（git-markdown 真相源 + 嵌入式 MIT 编辑器 + MCP 接缝），**不把任何框架当引擎**。需要时只**隔着 MCP 边界消费**外部记忆/KB（消费 MCP server 不触发 copyleft，连 AGPL 的 basic-memory 也能这么用），**绝不嵌代码**。

## 三、存储架构（已确认：server 自管 git 仓库）

- **每个工作空间一个 Zero 自管的 git 仓库**（知识库仓库），由**常驻 server（VPS）持有** bare repo + 工作树。
  - 布局：顶层 = 团队级知识；`projects/<slug>/` 子目录 = 各项目知识库。
  - 先"**一仓 + 子目录**"（一套历史、好交叉链接）；某项目要独立权限/历史再升级为**子仓库 / submodule**。
  - **可镜像 push 到外部远端**（GitHub/自建 git）→ 你也能自己 `git clone` 直接管。
- **架构新增点（已点头）**：Zero 的 **server 此前不碰文件系统/git（只有 daemon 碰）**。知识库要常驻、团队共享，所以 server 新增"git 仓库管理"能力（`isomorphic-git` 或直接 shell `git`）。
- **MySQL 只存检索索引/元数据**，不当真相源：`kb_doc(id, workspaceId, projectId?, scope, path, title, contentHash, updatedAt, embedding?)`，用于全文/向量检索与列表。真相永远是 git 里的 `.md`。

## 四、编辑（嵌入式"团队共享文档"）

- 嵌一个 **MIT 富 markdown 编辑器**：候选 **Milkdown / MDXEditor**（markdown 原生、往返保真最好，存出来就是要 commit 的 `.md`）；或 **Plate**（Tailwind/shadcn 原生，最贴前端栈）。避开 BlockNote 的 GPL `xl-ai` 包、已停更的 Novel。
- 网页"保存" = server 往知识库仓库写文件 + 一次 commit（带作者）。

## 五、检索 / 注入

- **Tier-0 全量**：`pin` + 项目级 + 路径匹配的条目，直接全量注入——渲染成 worktree 里的 `AGENTS.md` + `CLAUDE.md`（后者 `@AGENTS.md` 引入）。所有 agent CLI 天生读，零检索、永远最新。（Anthropic：语料 <200k token 时别上 RAG。）
- **Tier-1 词法**：MySQL `FULLTEXT`（`MATCH…AGAINST`），便宜、永远最新、治函数名/错误码这类精确召回。**Tier-0+1 先覆盖 ~80%**。
- **Tier-2 向量**：`embedding` 列（MySQL 原生 `VECTOR` 或行内暴力余弦，万级够用），用 **RRF** 与 Tier-1 融合；过十万再上外部向量库。**不上 GraphRAG**（贵 20–100×，issue 场景不值）。
- **注入钩子**：往 `assembleContext`（`server/src/lib/dispatch.ts`）返回里加 `knowledge` 字段（按 issue 所属 project + workspace 取相关切片），`buildPrompt`（`daemon/src/index.ts`）渲染；再给 agent 一个 `memory_search` MCP 工具按需回拉（抄现有 `daemon/src/mcp-context.ts`）。

## 六、外部 KB 接入（MCP，双向）

- **Zero 当 MCP host 去消费**用户外部记忆/KB：mem0 / Graphiti / Cognee / basic-memory / Notion(`mcp.notion.com`) / Atlassian / Obsidian 等大多自带 MCP server——**不引入它们的运行时**。指针存在 `project_resource(kind=notion/url/…)`。
- **把 Zero 自己的记忆暴露成 MCP server**（`memory_search / get / write`），让外部 agent（Claude Code/Cursor）也能读写团队知识。
- MCP plumbing 纯 TS：`@modelcontextprotocol/sdk`（MIT，Bun 原生）或 `@hono/mcp`。
- **许可证边界**：AGPL/BSL 的项目（basic-memory、Outline…）**只隔 MCP 边界消费，绝不嵌代码**。

## 七、蒸馏（按修正：**不绑 issue 关闭**）

- **P1 必做（半自动 / 按需）**：① 人直接在编辑器里写；② agent 配 `kb_write` MCP 工具——你在提示词里说"帮我把这条沉淀进知识库"，它就写 markdown + commit。
- **P2 后续（自动）**：**定时**后台整理（夜间 / 每 N 次运行，Letta sleep-time 式离线消化），或规划/执行检查点触发 → 候选记忆进**人工审核队列**再 commit。用 mem0 式 `ADD / UPDATE / DELETE(→作废) / NOOP` 去重；**作废不硬删**（Zep 式，留可回放）。

## 八、分期

- **M1**：server git 知识库仓库（创建/读写/commit/可选镜像）+ `kb_doc` 索引表 + 后端读写 API。
- **M2**：前端嵌入式编辑器 + 工作空间/项目两级知识库视图（挂项目详情 + 工作空间设置）。
- **M3**：注入（Tier-0 `AGENTS.md` 投影 + Tier-1 FULLTEXT）接进 `assembleContext` + `memory_search` MCP 工具。
- **M4**：MCP host（消费外部）+ Zero 记忆 as MCP server（暴露）。
- **M5**：蒸馏 P1（`kb_write` 按需）→ P2（定时 + 审核 + 去重/作废）；embedding/RRF 视规模再上。

## 待办 / 取舍

- 不上 GraphRAG / 外部向量库（除非语料过十万 / 多跳"为什么"成真需求）。
- 不嵌整套 wiki app（Outline/Logseq/Wiki.js 多为 AGPL/BSL）——只取 markdown-in-git 模式 + MIT 编辑器组件。
