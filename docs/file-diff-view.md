# 文件变更可视化 + 在线文件查看设计

> 2026-06-20 起草。本期三件并行之一（独立，不依赖项目层）。与[知识库](./knowledge-base.md)共用 git diff / diff 查看器。

## 一、核心理念

- 对标 Multica **最大吐槽点**（issue **#1579**："不知道用了哪个 repo/分支/路径、改了什么、有没有验证、是真完成还是只是被标完成"）。Multica **完全没有** diff：只有一条原始工具调用流水，`PRURL` 字段是没人读的死代码。
- **Zero 先天优势**：一 issue 一**持久 worktree**（`~/.zero/worktrees/<issueId>`，分支 `zero/ZERO-N`），且 **daemon 能直接对它跑 git**；`issue_event.kind` 早就**预留 `diff_ready` / `pr_opened`**（至今没写没渲染）——正好落点。
- 两半：**B1 每次运行变更摘要**（高优先，直接补吐槽点）+ **B2 只读在线文件浏览**。

## 二、B1 每次运行变更摘要（文件清单 + 增减行 + 可展开 diff）

### 捕获（daemon）

- 在 `executeClaim`（`daemon/src/index.ts`）里 `reporter.flush()` 与 `/complete` POST 之间——`cwd / work / issueId` 都在作用域。
- run **开始**时 `git stash create -u` 拍**快照基线**（含未跟踪、不动工作树/ref，**扛 agent 中途自己 commit**）。
- run **结束**时对基线：`git diff -z -M --numstat`（每文件 +增/-删、识别改名）+ `--shortstat`（总计）+ `git diff`（补丁文本）。未跟踪文件 `git add -N` 让其显示为全增；二进制 numstat 显示 `-`。

### 持久化（server `/complete`，`server/src/routes/daemon.ts`）

- 扩展 `/complete` body：加 `files[] / diff`（与现有 `usage` 并列）。
- 新表（仿 `taskUsage` 去关联范式）：
  - `task_change(taskId PK, workspaceId, issueId, filesChanged, additions, deletions, baselineSha, headSha, createdAt)`
  - `task_file_change(id, taskId, path, status(A/M/D/R), additions, deletions, isBinary, patch?)`（大补丁可懒取/走对象存储）
- 写 **`diff_ready`** issue_event 落到时间线。

### 读接口（server `issues.ts`）

- `GET .../runs/:taskId/files`（清单 + ±计数）、`GET .../runs/:taskId/diff?path=`（单文件 unified）。
- `.../runs` 列表像 `eventCount/toolCallCount` 一样带变更计数。

### 前端

- 用 **`@git-diff-view/react`**（React 19 安全；避开 `react-diff-viewer-continued` 的 peer `^15–^18` 问题）。GitHub「Files changed」风格：总计行（`N files, +X −Y`）+ 变更文件树（每文件 ±徽标 / 改名标记）+ 点开 unified/split diff（Shiki 高亮）。
- 落在 `web/src/components/issue/Timeline.tsx` 的 RunCard（渲染 `diff_ready`）+ `RunLogOverlay.tsx`（加 Files/Diff 标签页）。

## 三、B2 只读在线文件浏览（浏览整棵 worktree）

- **不用** Monaco/code-server（重、是编辑器，只读用不上）。**server 端 Shiki 高亮成静态 HTML，按 blob SHA 缓存**，前端注入——客户端零编辑器负担、VS Code 级保真。超大单文件再退化 **CodeMirror 6 minimal**（~75KB gzip、原生虚拟滚动）。
- **后端落点（注意）**：worktree 在 **daemon 侧**（server 无 fs 访问）。两条路：① daemon 暴露只读 file/tree API（daemon 已有本地 HTTP 服务 `startPicker` 127.0.0.1:8799 可扩展）；② daemon→server 同步树/blob。读 `git ls-tree` / `git show <sha>:<path>` / 直接读 `~/.zero/worktrees/<issueId>`。
- **安全（关键，呼应"绝不提交 .env"）**：`path.resolve` + `realpath` 双重夹紧到 worktree 根；`.git`/点文件/`.env`/密钥走**独立 denylist**（gitignore 只挡提交、挡不住服务端读盘，agent 写出的 `.env` 仍在 worktree）；大小上限；按 workspace 鉴权（防 BOLA 越权）。

## 四、选型小结

| 点 | 选型 | 理由 |
|---|---|---|
| diff 前端 | `@git-diff-view/react` | React 19 安全；GitHub 风格；split/unified + 内嵌高亮 |
| 文件高亮 | server 端 Shiki → 静态 HTML，SHA 缓存 | 只读最轻、保真最高 |
| diff 捕获 | `git stash create -u` 快照基线 + `--numstat -z -M` | 扛中途 commit、含未跟踪、识别改名 |
| 超大文件 | CodeMirror 6 minimal | 原生虚拟滚动 |

## 五、分期

- **P-Diff-1（B1 后端）**：daemon 捕获 → `/complete` 扩展 → `task_change/task_file_change` + `diff_ready` → 读接口。
- **P-Diff-2（B1 前端）**：`@git-diff-view/react` + Files-changed UI（RunLogOverlay/Timeline）。
- **P-Diff-3（B2）**：daemon file/tree API + server 端 Shiki 缓存 + 只读浏览视图 + 安全 denylist。

## 待办 / 取舍

- 不做：在线编辑（纯只读）。
- PR/分支/commit 链接：等仓库接 PR 流程再补（现 agent 自己 commit，可先抓 `headSha` 展示）。
