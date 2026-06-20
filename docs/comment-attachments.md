# 评论附件（comment attachments）

> 状态：**Phase 1 已完成，未合并**。分支 `feat/comment-attachments`。让评论能附带文件（图片 / 文档 / 任意类型），并妥当地交给执行的 agent。

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

- **≤ 阈值（默认 10MB）**：daemon 跑前直接落到 `<cwd>/.zero/attachments/`，prompt 给**相对路径**。弱模型无需任何动作，图片/文档照读。
- **> 阈值**：**不下载**，prompt 里列出该文件 + 一条**可直接运行的下载命令**（指向短时效**签名 URL**）：
  > 大附件 `dataset.csv` (40.0MB) → `curl -sL '<signed-url>' -o 'dataset.csv'`
  - 不浪费（没用到就不下）；
  - 比 Multica 的「列+按 id download」更弱模型友好（是"跑这一行"，不是"自己发现并调 CLI"）；
  - 全 provider 通用（都有 shell 能跑 curl），不依赖 MCP。

严格优于两种纯方案：纯推的浪费没了（大文件改懒取）、纯拉的脆弱也避开了（小文件零动作）。

### 图片 & 大文件
- **大文件**：只给路径/命令、**不进 prompt 正文**，agent 用 Read/Bash 按需读 → 不撑爆上下文。
- **图片**：统一落盘给路径；能否"看懂"取决于该 CLI 的图片读取能力——**Claude / CodeBuddy 的 Read 直接喂视觉**（可靠），Codex/OpenCode/Kimi 待实测。prompt 对图片特别点名让 agent 主动 Read。

## 三、已实现的架构（Phase 1，对应代码）

### 数据模型
`attachment` 表：`id / workspaceId / issueId(FK cascade) / issueEventId(评论, 可空, FK cascade) / uploaderType+Id / filename / mime / sizeBytes / storageKey / createdAt`（迁移 **0017**）。先上传（未 link，issueEventId 空），发评论时按 `attachmentIds` link 到该评论。

### 存储
本地磁盘，配置 `ATTACHMENTS_DIR`（dev=`<server>/data/uploads`，已 gitignore `data/`；prod=VPS 路径）。key=`workspaces/{ws}/{uuid}{ext}`。单文件上限 **25MB**（`ATTACH_MAX_BYTES`）。mime 存**客户端上报值**（未做 magic-byte 嗅探，见取舍）。

### 签名下载（仅签名，不需登录）
`GET /attachments/:id?exp=<ts>&sig=<hmac>`——HMAC（jwtSecret 对 `id.exp` 签，取 32 hex）。浏览器 `<img>`/下载 与 daemon 拉取**都用签名 URL**，服务端在各响应里临时签发（不暴露长期令牌）。安全：**非图片强制 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`**；过期/篡改 → 403。

### Server API
- `POST /workspaces/:ws/attachments`（multipart，成员鉴权，25MB 上限）→ 存盘 + 入表（未 link）→ 返回 `{id, filename, mime, size, url(签名,24h)}`。
- `commentSchema` 加 `attachmentIds: string[]`（body 与附件至少有一个）；发评论时把本工作空间内、尚未 link 的这些附件 link 到该评论。
- `GET /attachments/:id` 签名流式返回。
- 评论列表（`GET /:id/events`）每条评论带 `attachments`；**claim 上下文（`assembleContext`）** 带每个附件的元数据 + `signedPath`（daemon 据 size 自行决定小推/大拉）。

### Daemon
- `prepareWorkdir` 之后 `materializeAttachments`：**≤10MB** 经 signedPath 下载落到 `<cwd>/.zero/attachments/<安全文件名>`（**文件名消毒防路径穿越**、按文件名去重、重跑不重下；**任一下载失败 → 退化为懒取**给 URL）；**>10MB** 不下、留签名 URL。
- `buildPrompt` 加「Attached files」段：小文件列**相对路径**、大文件列**现成 curl 命令**，指示 agent 按需读取（图片可用文件工具打开、大文件择要读）。

### Web
- 评论框：**附件按钮** → 选中即上传、显示**待发 chip**（名/大小/移除）；提交带 `attachmentIds`。
- 时间线评论：**图片显缩略图、其它显下载 chip**（点开走签名 URL）。

### 生命周期
- 删 issue/评论 → DB 的 `attachment` 行**随 FK 级联删**；worktree 清理时工作目录里的 `.zero/attachments/` 一并清。
- ⚠️ **服务端磁盘文件当前不随级联自动删**（只删了 DB 行）——见取舍。

### 测试
- 管线 e2e **12/12**（上传→link→事件列表带附件→签名下载，含无效签名 403 / 非图片强制下载 / `assembleContext` 带附件且可拉取）。
- daemon `buildPrompt` 单测 **7/7**（小=路径、大=curl、无附件不渲染）。
- server/daemon/web `tsc` + web build 全过。

## 四、取舍与暂不做（含原因）

| 没做的 | 原因 / 现状 |
|---|---|
| **MCP `zero_fetch_attachment` 工具** | 大文件按需拉**已由 prompt 里的 curl 覆盖、且全 provider 通用**；MCP 工具只是给 claude/codebuddy 换个更干净的接口，**功能重复、收益小**，不做。 |
| **对象存储（S3/MinIO）** | 当前单 VPS 部署，本地磁盘足够；存储层已用 `storageKey` 抽象，未来要换可插拔，先不做。 |
| **服务端磁盘文件随删** | 级联只删了 DB 行，`ATTACHMENTS_DIR` 里的文件会**残留累积**。已知缺口，后续在删除钩子里补 `rm`（或定时清扫）。 |
| **孤儿附件清理** | 上传了但没提交评论的附件（`issueEventId` 空）目前不自动清。低频、占用小，后续加 TTL 清扫。 |
| **拖拽 / 粘贴上传** | 先把"点按钮上传"闭环跑通；拖拽、粘贴图片是 UX 增强，后续加。 |
| **配额 / workspace 限额** | 暂无单文件 25MB 之外的限额。 |
| **PDF 等转文本（服务端抽取）** | **不需要**——agent 自己会用 Read/Bash 读文件，不必服务端预抽取。 |
| **图片走 vision content block** | 按 provider 各异、复杂；统一落盘给路径，由 CLI 的图片 Read 能力决定能否"看懂"。 |
| **mime 嗅探** | 存的是客户端上报 mime；已用 `nosniff` + 非图片强制下载 + API 独立源 兜底安全，先不做 magic-byte 嗅探。 |
| **buildPrompt 增量** | 每轮列**全部**附件（非"resume 只列新增"）；轻微冗余、无害，先不优化。 |
| **真实 agent 端到端** | 管线 + prompt 已验证；"模型实际读懂图片/文件"这步留待**合并后用真 agent 实测**（图片首选 Claude/CodeBuddy）。 |
