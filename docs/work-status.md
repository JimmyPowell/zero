# 工作状态总览（2026-06-20）

> 本轮 Claude 协作产出的三块功能 + 分支 / 合并状态一页速览。明细见 [progress.md](./progress.md) 与各设计文档。

## 一、三块功能 · 当前状态

| 功能 | 分支 / worktree | 状态 | 设计文档 |
|---|---|---|---|
| **项目层 Project** | `feat/projects-knowledge` | ✅ **完成 + 真库验证** | [projects.md](./projects.md) |
| **知识库 Knowledge** | `feat/projects-knowledge`（同上） | ✅ **核心可用（M1–M3 + M5-P1）**；M4 / M5-P2 未做 | [knowledge-base.md](./knowledge-base.md) |
| **变更可视化 File-diff** | `feat/file-diff-view` | ✅ **完成（后端机制已验证）**；B2 文件浏览器未做 | 该分支 `docs/file-diff-view.md` |

> 按耦合度分两条分支：项目层 + 知识库共享 schema → 一条；变更可视化独立 → 一条。

### 项目层（P-Proj-1/2/3）✅
`Workspace → Project → Issue`。`project` + 多态 `project_resource`（代码仓库 / 知识库 / 外部KB 指针一表三用）+ `issue.projectId`。前端导航 + 列表 / 详情 / 创建编辑 / 挂仓库。派发时 issue 继承项目主仓库（`assembleContext`）。**真库 4/4 + 3/3 验证。**

### 知识库（M1–M3 + M5-P1）✅ 可用
**记忆 = server 自管 per-workspace git 仓库里的 markdown**（server 首次碰 fs/git）。闭环：人写 / 编辑（前端 `/knowledge`）→ git 落库 + `kb_doc` 索引 → pinned 文档常驻注入 agent（`buildPrompt` 的「Team knowledge」段）→ agent 按需 搜（`zero_search_knowledge`）+ 写（`zero_write_knowledge`）。**M1 真库 7/7、M3a/M3b 真库验证。**
- **v1 取舍**：编辑器 textarea + Markdown 预览（非 WYSIWYG）；检索 LIKE 式（非 FULLTEXT / 向量）。
- **未做**：**M4** 外部 KB 接入（MCP host 消费 Notion/Obsidian + 暴露 Zero 记忆为 MCP server）；**M5-P2** 自动蒸馏（定时提炼 + 审核队列）。

### 变更可视化（P-Diff-1/2）✅
「看某次运行 agent 改了哪些文件 + diff」。daemon 拍 HEAD 基线 + `git add -A -N` + `git diff -M` 抓改动 → `task_change`/`task_file_change` + `diff_ready` 事件 → 时间线「改动卡片」→ `DiffOverlay` 手写彩色 unified diff。**git 捕获机制临时 repo 实测通过（含修复"新文件漏抓"bug）。**
- **未做**：B2 只读在线文件浏览器（server 端 Shiki）。

## 二、分支 / worktree 映射（2026-06-20）

```
~/code/zero                 main                  3fd24f1   ← 你在推进（agent_wakeup / 子代理 / 无头修复…）
~/code/zero-projects-kb     feat/projects-knowledge 6492d05  ← 项目层 + 知识库（本轮主要产出）
~/code/zero-file-diff-view  feat/file-diff-view     fa21765  ← 变更可视化（已 rebase 到 e82aca3）
~/code/zero-cancel-task     feat/cancel-task        (你的)
~/code/zero-scroll-nav      feat/scroll-nav         (你的)
```
`main` 全程未被本轮改动。两条产出分支均**真库验证 + typecheck/build 全过**。

## 三、合并待办（review / merge 时处理）

1. **迁移号撞号**：main 已合入 `0018_agent_wakeup` + `0019_run_event_subagent`。
   - `feat/projects-knowledge`：`0018`(project) / `0019`(kb_doc) **撞号** → 合并时重排到 main 之后（0020 / 0021…），并重生成 journal/snapshot。
   - `feat/file-diff-view`：`0020`(task_change) —— 基于含 0019 的 main，**不撞**。
2. **代码合并**：两条分支都改过 `schema.ts`/`issues.ts`/`dispatch.ts`/`daemon` —— 与 main 的 agent_wakeup/子代理改动多为不同区块，预计大多 auto-merge，但需 review。

## 四、测试 / 凭据

- 所有 DB 验证走**隔离库 `zero_projkb`**（root 建 + 授权 zero），**未碰共享 `zero` 库**。
- 知识库 git 仓库默认 `<server>/data/kb`（`config.kbDir`，已 gitignore）。
- **留待真机 e2e**：① 变更可视化 —— 真 agent 跑一次看 UI 出 diff；② 知识库 —— 真 agent 跑一次确认 prompt 带「Team knowledge」+ 三个 MCP 工具可调。机制均已单测，差最后端到端一哆嗦。

## 五、下一步可选

- 继续 **M4 外部 KB 接入** / **M5-P2 自动蒸馏**（体量较大）。
- 补 **变更可视化 B2** 只读文件浏览器。
- 或先 **review + 试合并** 这两条分支（先处理迁移重排）。
