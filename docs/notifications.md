# Zero 通知 / 推送系统

> 状态：N1（通知骨架 + 邮件，真实发信已验证）✅ + N2（企业微信**智能机器人** SDK 长连接，主动推送已真机验证；绑定码；双向能力已具备但回控留后续）✅；N3（Telegram，长轮询+出站，代码已建，待 token+代理真测）。本文是设计定稿 + 路线图。
> 缘起：对标 Multica 调研发现——**Multica 的对外通知是一片空白**（只有站内收件箱 + WebSocket，没有邮件事件通知 / Telegram / 企业微信 / 飞书 / 移动推送 / 对外 webhook）。这正是 Zero 的差异化点：让 issue 的状态流转能**主动推到外部渠道**，并支持**从渠道回控**。

## 一、调研结论：Multica 的通知能力（参照系）

| 维度 | Multica 实际做法 |
|---|---|
| 站内收件箱 | `inbox_item` 表（recipient member/agent、severity action_required/attention/info、read/archived），唯一通知落点 |
| 谁被通知 | `issue_subscriber`（creator/assignee/commenter/mentioned/manual 自动订阅） |
| 偏好 | `notification_preference`（JSONB 分 5 组：assignments/status_changes/comments/agent_activity/updates，每组 all\|muted） |
| 触发点 | issue 创建/指派/状态/优先级/截止日/描述@、评论创建/@、表情回应、**task 失败**（task 完成不发 inbox，靠状态体现） |
| 实时送达 | 进程内 event bus → realtime broadcaster（scope workspace/user/task）→ **WebSocket** |
| 邮件 | 仅 Resend，**只发登录码 + 工作空间邀请**，不发 issue 事件 |
| 对外集成 | ❌ Slack/Discord/Telegram/企业微信/飞书 全无 |
| 移动端 | ❌ 无原生 App / 无 PWA / 无 web-push（桌面端 Electron 也只走同一 WebSocket） |
| 对外 webhook | autopilot 表定义了 `kind='webhook'` 但**未实现入站端点**，TODO |

**一句话**：Multica = 站内收件箱 + WebSocket，封闭生态，不出墙。Zero 要补的就是「出墙 + 回控」。

## 二、总体架构：两条对称链路

所有渠道（邮件 / 企业微信 / Telegram / 飞书 / 未来 Web Push / 原生 App 推送）都收敛成**同一套出站管线**；回控收敛成**复用现有 issue 接口**，不写新业务逻辑。

```
  出站(推送)
  issue_event 写入点（已存在，见 §五清单）
        │  事件发生后调用 notifyIssueEvent()
        ▼
  收件人解析（creator + assignee，后续接订阅/偏好）
        ▼
  notification_outbox（落库 = 真相，可靠投递 + 退避重试）
        ▼  outbox worker 周期 flush
  ┌──────┬────────┬─────────┬───────┬──────────┐
  邮件   企业微信  Telegram  飞书   Web Push(PWA/App)   ← 全是同构 channel adapter
  └──────────────────────────────┬───────────────┘
                                 │
  入站(回控)              Telegram webhook / App
                                 │ 解析命令/回复 → 鉴权(已验证绑定+工作空间成员)
                                 ▼
            复用现有动作：recordIssueEvent + enqueueTaskForIssue
```

设计承诺（延续 run-bus 注释的哲学）：**DB 是真相，投递是优化**。外部 HTTP 会失败，所以一律先落 `notification_outbox`，worker 异步投递 + 退避重试，绝不「发出去就算」。

## 三、数据模型

### `channel_binding` —— 谁 + 在哪收
| 字段 | 说明 |
|---|---|
| `id` | PK |
| `workspace_id` | 所属工作空间 |
| `user_id` | 绑定的用户（群机器人类渠道可为空，后续） |
| `kind` | `email \| telegram \| wecom \| feishu \| webpush`（枚举先全，N1 只用 email） |
| `config` | JSON：email `{address}`；**wecom `{target}`**（企微 userid/chatid，经绑定码关联）；telegram `{chatId}`；feishu `{webhookUrl}`；webpush `{endpoint,keys}` |
| `enabled` | 是否启用 |
| `verified_at` | 验证时间（email 先免验证 = 创建即视为已验证；Telegram `/start <token>` 时回填） |
| `created_at` / `updated_at` | |

唯一约束 `(workspace_id, user_id, kind)`（一个用户在一个工作空间一种渠道一条，后续可放宽）。

### `notification_outbox` —— 可靠投递队列
| 字段 | 说明 |
|---|---|
| `id` | PK |
| `workspace_id` | |
| `event_id` | 来源 `issue_event.id`（可空） |
| `issue_id` | 关联 issue（可空） |
| `binding_id` | 投到哪条 `channel_binding` |
| `channel` | 冗余渠道类型，便于 worker 分流 / 查询 |
| `subject` / `body` | 渲染好的标题 + 正文（text/markdown） |
| `payload` | JSON：渠道特定结构（卡片等），可空 |
| `status` | `pending \| sent \| dead` |
| `attempts` / `max_attempts` | 已尝试次数 / 上限（默认 5） |
| `next_attempt_at` | 下次投递时间（退避锚点） |
| `last_error` | 最近错误 |
| `ref` | JSON：回控用（外部 msg_id ↔ issue），N1 邮件用不到，预留 |
| `created_at` / `sent_at` | |

索引 `(status, next_attempt_at)` 供 worker 拉取待投。

> 偏好表 `notification_pref`（分组 × 渠道开关）**N1 暂不做**——N1 默认规则够用（见 §四）。等渠道多了再加，配套设置页。

## 四、通知规则（N1 起步：先两个点）

| 事件 kind | 触发 | 默认收件人 | 渠道 |
|---|---|---|---|
| `created` | issue 创建 | creator + assignee(member) | 邮件 |
| `run_finished` | agent 执行完成（issue→in_review） | creator + assignee(member) | 邮件 |

> 起步只点亮这两个。骨架建好后加「`run_failed` / `status_change` / 评论@你 / `assignment`」只是多挂几行，不动结构。
> 收件人当前 = creator + assignee(member) 去重；每个收件人取其在该工作空间**已启用的对应渠道绑定**才会真正投递（无绑定 = 不打扰）。后续接入 `issue_subscriber` 订阅 + 偏好分组。

## 五、事件写入点清单（= 通知挂载点）

| 事件 | 代码位置 | kind |
|---|---|---|
| 创建 issue | `server/src/routes/issues.ts`（POST /） | `created` |
| 状态/优先级/指派变更 | `issues.ts`（PATCH /:id） | `status_change` / `priority_change` / `assignment` |
| 人发评论 | `issues.ts`（POST /:id/events） | `comment` |
| 无运行时 | `lib/dispatch.ts` | `run_failed`(no_runtime) |
| agent 开始/完成/失败 | `routes/daemon.ts`（claim / complete / fail） | `run_started` / `run_finished` / `run_failed` |

N1 在 **created**（issues.ts）与 **run_finished**（daemon.ts complete）两处调用 `notifyIssueEvent()`（fire-and-forget，不阻塞请求、不抛错）。

## 六、双向回控（Telegram 阶段起）

- **绑定**：用户给 bot 发 `/start <一次性 token>` → 把 `chat_id` 绑到 Zero 用户（回填 `verified_at`）。之后该 chat 命令以此用户身份执行，且校验工作空间成员。
- **回控**（复用现有接口，零新业务逻辑）：
  - 直接**回复**某条通知 → 作为评论写回该 issue（outbox 的 `ref` 存 `msg_id↔issue_id`）→ 自动 `enqueueTaskForIssue` 触发 agent。
  - 命令 / 内联按钮：`✅ 完成`、`/status ZERO-12 in_review`、`/assign ZERO-12 @agent`。
- 邮件、企业微信群机器人**天生单向**（只推不回）；双向能力首次出现在 **Telegram 档**，再到原生 App 完整双向。架构全程预留双向（outbox.ref + 入站 webhook 位）。

## 七、移动端结论：PWA vs React Native vs Flutter

调研澄清（重要）：

- **PWA ≠ 客户端**。它本质就是「现在这个 React 网页」+ manifest（可安装/图标）+ service worker（离线缓存 + 接收推送）+ Web Push。装到手机像 App，但底层仍是操作系统网页引擎在渲染网页，**不是原生客户端、不是 React Native**。
- **现有 React 不能直接变 React Native**：共享 React 本身（JSX/hooks/状态/逻辑），**不共享渲染层**——`<div>`/Tailwind/shadcn/Radix/cmdk 全是 DOM 专用，要用 `<View>`/`<Text>` + RN 生态重写。可复用层：`api-client`、TS 类型、zod、store、业务逻辑；要重写层：所有页面/组件/样式。
- **RN vs Flutter（给 Zero 全 TS 栈）**：推荐 **React Native + Expo**——同语言（TS）、类型/接口能和 server·web 三端共享、Expo 封好 APNs/FCM + 构建 + OTA。Flutter（Dart）观感更精致，但要养第二门语言 + 重复逻辑，性价比低。

**结论**：手机客户端是「最后一档」，且**不挡收通知**——邮件/企业微信/Telegram 本来就直接到手机，无需任何 App。真正「做原生 App」解决的是第一方精致体验 + 完整双向，独立排在最后；要做就 RN + Expo。移动端形态本阶段**不定死**，等渠道做完再决定。

## 八、配置（env）

N1（邮件，SMTP）：
```
SMTP_HOST=        # 如 smtp.qq.com / smtp.gmail.com / 公司 SMTP
SMTP_PORT=465     # 465(SSL) 或 587(STARTTLS)
SMTP_SECURE=true  # 465 用 true；587 用 false
SMTP_USER=        # 登录用户名（通常是发件邮箱）
SMTP_PASS=        # 密码 / 授权码（QQ/163 用「授权码」而非登录密码）
SMTP_FROM=        # 发件地址，如 noreply@yourdomain
SMTP_FROM_NAME=Zero
APP_URL=http://localhost:5173   # 邮件里 issue 链接的 web 基址
```
未配置 SMTP 时：worker 进入 **dev 回退**，把邮件内容打到控制台（便于无凭据先验证整条管线），不真正发信。

## 九、路线图

- **N1** ✅ 通知骨架（`notifyIssueEvent` + `notification_outbox` + worker + 退避重试）+ **邮件** adapter + 渠道绑定 API + 前端「设置」页；点亮 `created` / `run_finished` 两个通知点。真实 QQ SMTP 发信已验证。
- **N2** ✅ 企业微信「智能机器人」（官方 `@wecom/aibot-node-sdk` 长连接，**双向能力** + **主动推送**，免公网回调）。服务端常驻 `WSClient`，outbox 经 `sendWecomMessage(target)` 推送；绑定走**一次性绑定码**（设置页生成 → 发给机器人 → 回调写 `config={target}`）。真机实测：连接/双向/主动推送/接入 Zero 管线 sent 全通过。**本档只做主动推送**，双向回控（按钮/命令）排到后续。
  > 注：旧版「群机器人 webhook（带 key）」是另一个产品、单向；用户用的是新版智能机器人，故 N2 改用 SDK 长连接重做。
- **N3** Telegram（长轮询 `getUpdates` 入站 + `sendMessage` 出站，proxy-aware；绑定走一次性码/`/start`）。**代码已建**；本档先做主动推送。⚠️ 本机直连 `api.telegram.org` 不可达（国内），真测需 `TELEGRAM_PROXY` 或可出网节点。← 待 token+代理真测
- **N4** 飞书自定义机器人。
- **N5（独立最后档）** React Native + Expo 原生 App（复用 TS 逻辑/类型，UI 重写，APNs/FCM 推送 + 完整双向）。
- 可并行/后置：站内小铃铛（`inbox` 表 + 工作空间级实时流，run-bus 扩到 workspace/user scope）+ 偏好设置页。
