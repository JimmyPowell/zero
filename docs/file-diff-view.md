# 文件变更可视化 + 在线文件查看设计

> 2026-06-20 起草。本期三件并行之一（独立，不依赖项目层）。与[知识库](./knowledge-base.md)共用 git diff / diff 查看器。
>
> **2026-06-23 v2 更新（分支 `feat/change-tracker`）**：捕获机制从「git HEAD 基线」重构为**快照式
> `ChangeTracker`**（学 codex：内容快照当基线、不依赖目录是 VCS）。下文 §零为现状（已实现），
> §一~§五为原始设计（B1 已落地、渲染选型见 §零、B2/实时见 §六待续）。

## 零、实现现状（v2，2026-06-23）

### 为什么重构：4 种工作模式里，原方案有一半抓不到

Zero 的 4 种入口收敛成 daemon 的 3 种 `WorkSpec`：仓库(URL/本地)→worktree、工作目录→就地、不绑→空目录。
原捕获 `baseline = git rev-parse HEAD` 把「目录已是 git 仓库」当**硬前提**，于是：① 空目录永远黑屏；
② 非 git 目录黑屏；③ 脏 git 仓库把 run 前的未提交改动算进本次（污染）。

### 解法：`ChangeTracker` —— 快照追踪 + 可插拔 diff 引擎（git 从「前提」降为「引擎」）

学 codex「内容快照当基线、进程内 diff、不绑 VCS」，但**快照源用「文件系统」而非「工具流」**
（Zero 是 5 黑盒 CLI 编排器，拦工具流会漏 shell/sed/codegen 且每 provider 一套解析；FS 快照 provider
无关、catch-all）。落在 `daemon/src/index.ts` 的 `captureBaseline()` / `captureChanges()`，三引擎输出
契约一致（`files[] + patch`，server/前端/表 0 改）：

| 场景 | 引擎 | 机制 |
|---|---|---|
| git 仓库（含脏树） | git temp-index | `GIT_INDEX_FILE=<tmp> git add -A && git write-tree` 拍工作树树对象，首尾各一棵；`git diff -M --numstat/-z/patch`。不碰用户 index/HEAD |
| 非 git 目录（空/就地） | git 影子库 | `GIT_DIR=<~/.zero/snap/shadow> git init` + `--work-tree=cwd` 当一次性引擎；用户目录不出现 `.git` |
| 无 git 二进制 | 纯 JS | walk+hash 内容快照 + `jsdiff` 出 unified diff（降级，无改名识别）。`ZERO_DIFF_ENGINE=js` 可强制 |

**关键收益**：4 模式一条路径；空目录 / 非 git 不再黑屏；脏树污染消失（基线 = run 开始时的磁盘真实字节）；
不污染用户目录；**基线在「技能/附件物化后、agent 跑前」拍** → Zero 注入的 `.claude`/`.zero` 不进 diff。
e2e（`daemon/test-change-tracker.ts`）覆盖 git/脏树/影子库/纯 JS 共 25 断言全过。

### 捕获时机（v2）

成功 / 失败**都**捕获（agent 常改到一半才失败）。server 抽 `persistChanges()` 共用，`/complete` 与
`/fail` 都落 `task_change`/`task_file_change` + `diff_ready` 事件。**取消(cancel)** 暂不捕获（server 已移交终态）。

### 敏感文件 denylist（v2.1，2026-06-23）

捕获层加了**文件级敏感名单 `isSensitivePath()`**（`daemon/src/index.ts`）：`.env*`（模板
`.env.example`/`.sample`/`.template`/`.dist` 放行）、`.claude.json`、`*.pem`/`*.key`/`*.p12`/`*.pfx`/
`*.keystore`/`*.jks`、`id_rsa`/`id_dsa`/`id_ecdsa`/`id_ed25519`、`.npmrc`/`.pypirc`/`.dockercfg`/
`.netrc`/`.git-credentials`、`*credentials*` —— **这些文件即便变动也不进 diff**，杜绝密钥/凭据明文
落 `task_file_change.patch` + 前端渲染。

- **为何必需**：影子 / 纯 JS 引擎**没有 `.gitignore` 兜底**（git 引擎那条路 .gitignore 自动挡 `.env`，
  这两条没有）；且 git 引擎下 **`.gitignore` 挡不住「已跟踪」的密钥**。实测拿 `$HOME` 当 workDir 时
  `.claude.json` 漏进了 diff（`.claude/` 目录排除匹配不到 `.claude.json` 文件）——这就是把 denylist
  补到**捕获层**的由来（原 §三只给「文件浏览」设计了 denylist）。
- **三处加固**：① 影子引擎 excludes 追加 `SENSITIVE_GLOBS`（连密钥都不拍进影子树）；② 纯 JS 引擎
  `jsWalk` 跳过敏感文件（不读进快照）；③ git 引擎在取 patch 前从结果剔除（覆盖已跟踪密钥，连内容都不读）。
- **e2e**：`test-change-tracker.ts` S5 —— 影子 / 纯 JS / git 已跟踪 三引擎各验密钥被挡、普通文件正常出、
  `.env.example` 模板放行（共 15 断言，全过）。

### 渲染（v2）

`DiffOverlay` 用 **`@git-diff-view/react`**（GitHub 风格 + 内置 lowlight 语法高亮 + 大文件虚拟滚动 +
统一/并排/换行切换），**懒加载**成独立 chunk（不压初始包）。取代原手写彩色 diff。

### 待续（§六）

实时增量 diff（live）、B2 只读在线文件浏览 —— 见文末 **§六**。

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

## 六、待续（v2 出方案、未实现 —— 需跑通整套栈 / 真 agent 才能验，故本期未上代码）

### 6.1 实时增量 diff（live，边跑边看）

- **机制**：daemon run 期间起一个轻量定时器（~6s），周期跑 **`captureChanges(cwd, baseline,
  { summaryOnly:true })`**（只 numstat、跳过逐文件 patch，便宜）→ POST `/daemon/tasks/:id/diff-progress`。
  server 经 `run-bus.publish(taskId, { kind:"diff_progress", filesChanged, additions, deletions })`
  推给订阅中的 SSE（**不落时间线**，仅 live），并 upsert `task_change` 摘要供晚到的订阅者。
  前端在运行中的 run 卡片/`RunLogOverlay` 头部显示 live「N 文件 +X −Y」。
- **原则**：**权威 diff 永远是 FS 快照（首尾两次）**；事件流只做「触发重拍」与「实时推送」，**不从事件解析改了啥**
  （对标 codex 的 `turn/diff/updated`，但快照源是 FS 不是工具流）。
- **基础已在 v2 备好**：`captureChanges` 抽象已可加 `summaryOnly`；run-bus / SSE / reporter 通道现成。
- **为何本期没做**：纯 live UX，且只有跑通 server+daemon+web+真 agent 才能验收，单次无头跑无法验证 → 不上盲代码。

### 6.2 B2 只读在线文件浏览（浏览整棵 worktree）

- **同机（dev / daemon 与浏览器同机）**：复用 daemon 已有本地 HTTP（`startPicker` 127.0.0.1:8799，前端
  已直连它选目录）扩 `/tree?issueId=&path=` + `/file?issueId=&path=`：`git ls-tree` / `git show <sha>:<path>`
  / 直接读 worktree。**安全（关键）**：`realpath` 双重夹紧到 worktree 根；`.git`/`.env`/密钥独立 denylist
  （gitignore 挡提交、挡不住服务端读盘）；大小上限；按 workspace 鉴权。
- **跨机（daemon 在内网 / NAT 后，server 够不着 daemon）**：唯一可行是 **daemon→server 推**（树/blob 同步，
  按 blob SHA 缓存）—— 这是一块独立较大的工程（呼应「server 永不反连 daemon」铁律），单列 issue 做。
- 渲染走 server 端 Shiki → 静态 HTML 按 SHA 缓存（见 §三），超大文件退化 CodeMirror 6 minimal。

## 待办 / 取舍

- 不做：在线编辑（纯只读）。
- PR/分支/commit 链接：等仓库接 PR 流程再补（现 agent 自己 commit，可先抓 `headSha` 展示）。
- 取消(cancel) 的 run 暂不抓 diff（server 已移交终态）；需要再加 `/cancel` 收 changes 的端点。
