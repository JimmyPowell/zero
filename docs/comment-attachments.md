# 评论附件（comment attachments）

> 状态：开发中。分支 `feat/comment-attachments`。让评论能附带文件（图片 / 文档 / 任意类型），并把附件妥当地交给执行的 agent。

## 一、目标
- 评论支持附带文件：图片、文档、任意类型，多文件。
- 文件要能**有效地交给 agent**：大文件不撑爆上下文、图片能被"看"、弱模型也能用上。

## 二、关键设计决策：小文件「推」、大文件「懒取」（混合）

调研了 Multica：它走**纯拉**——文件存对象存储，agent 用 `multica` CLI 列元数据、`download <id>` 下到工作目录再用原生工具读（图片当普通文件，不走 vision block）。

但 **Zero 的 agent 是裸 CLI**（claude/codex/kimi…），手里没有 `zero` 命令，没法 fetch-on-demand；Zero 的 daemon 又本来就「先备好工作目录再跑 agent」。两种纯方案各有短板：

| | 优点 | 短板 |
|---|---|---|
| 纯推（全下到工作目录） | 零摩擦、弱模型直接读 | 大文件没用到 → 白下载 + 占本地盘（worktree 一 issue 一份） |
| 纯拉（agent 自己取） | 不浪费、按需 | 多步、要 agent 主动调 → **弱模型常常不去取，文件就废了** |

**结论：浪费只在大文件、脆弱只在"要 agent 主动取"。所以分大小：**

- **≤ 阈值（默认 10MB，图片可放宽）**：daemon 跑前直接落到 `<cwd>/.zero/attachments/`，prompt 给**相对路径**。弱模型无需任何动作，图片/文档照读。
- **> 阈值**：**不下载**，prompt 里列出该文件 + 一条**可直接运行的下载命令**（指向短时效**签名 URL**）：
  > 大附件 `dataset.csv` (40MB)，需要时执行：`curl -sL '<signed-url>' -o dataset.csv`
  - 不浪费（没用到就不下）；
  - 比 Multica 的「列+按 id download」更弱模型友好（是"跑这一行"，不是"自己发现并调 CLI"）；
  - 全 provider 通用（都有 shell 能跑 curl），不依赖 MCP。

严格优于两种纯方案：纯推的浪费没了（大文件改懒取）、纯拉的脆弱也避开了（小文件零动作）。

### 图片 & 大文件
- **大文件**：只给路径/命令、**不进 prompt 正文**，agent 用 Read/Bash 按需读 → 不撑爆上下文。
- **图片**：统一落盘给路径；能否"看懂"取决于该 CLI 的图片读取能力——**Claude / CodeBuddy 的 Read 直接喂视觉**（可靠），Codex/OpenCode/Kimi 待实测。prompt 对图片特别点名让 agent 主动 Read。（"注入 vision content block"按 provider 各异、复杂，先不做。）

## 三、架构

### 数据模型
`attachment` 表：`id / workspaceId / issueId(FK cascade) / issueEventId(评论, 可空, FK cascade) / uploaderType+Id / filename / mime / sizeBytes / storageKey / createdAt`。先上传（未 link，issueEventId 空），发评论时按 `attachmentIds` link 到该评论。

### 存储
本地磁盘，配置 `ATTACHMENTS_DIR`（dev=`<server>/data/uploads`，prod=VPS 路径）。key=`workspaces/{ws}/{uuid}{ext}`，落盘时**嗅探真实 content-type**（不信客户端）。对象存储后续可插拔。

### 签名下载
`GET /attachments/:id` 双鉴权：① 成员（浏览器预览/下载）；② **签名 query**（`?exp=<ts>&sig=<hmac>`，HMAC 用 jwtSecret 对 `id.exp` 签，TTL 默认 2h）——给 daemon 落盘小文件、给大文件的 curl 命令用，**不暴露长期令牌**。

### Server API
- `POST /workspaces/:ws/attachments`（multipart，成员鉴权）→ 存盘 + 入表（未 link）→ 返回 `{id, filename, mime, size, url}`。
- `commentSchema` 加 `attachmentIds: string[]` → 发评论时 link。
- `GET /attachments/:id`（成员 / 签名）流式返回。
- 评论列表 + **claim 上下文（`assembleContext`）** 带上每条评论的附件元数据 + 签名 path + `big` 标记。

### Daemon
- `prepareWorkdir` 之后，把**小**附件下载落到 `<cwd>/.zero/attachments/<filename>`（按 id 去重、重跑不重下）；**大**附件不下、留给 prompt 的 curl。
- `buildPrompt` 增一段：小文件列**相对路径**、大文件列**curl 命令**，指示 agent 按需读取（图片可用文件工具打开）。resume 那轮只提**新增**附件。

### Web
- 评论框：附件按钮（+ 后续拖拽/粘贴）；选中即上传、显示待发 chip（名/大小/移除）；提交带 `attachmentIds`。
- 时间线评论：图片显缩略图、其它显下载 chip。柔和过渡。

### 生命周期
- 随 issue/评论级联删除（FK），同时删存储文件；worktree 清理时 `.zero/attachments/` 一并清。
- 孤儿附件（上传未提交）TTL 清理 → Phase 2。

## 四、分期
- **Phase 1（核心闭环，本次）**：表+迁移、存储+签名、上传/下载/link、`assembleContext` 带附件、daemon 小推大拉 + prompt、基础 web（按钮/chip/缩略图）。图片/文档/任意类型都通。
- **Phase 2（后续）**：拖拽粘贴、对象存储后端、孤儿 TTL、配额、给 MCP provider 加 `zero_fetch_attachment` 工具、PDF 抽取（多半不需要——agent 自己会读）。
