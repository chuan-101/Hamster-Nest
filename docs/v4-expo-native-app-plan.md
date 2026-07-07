# 仓鼠小窝 V4.0 · Expo 原生 App 正式施工方案

> **文档性质：** 正式整合版（可执行施工文档）
> **整合日期：** 2026-07-07 · 整合时以当日仓库 `main`（710d9eb）与 Supabase 生产库实测状态为基准
> **整合来源（V4.0 三件套）：**
> ① 《仓鼠小窝 V4.0 — 多端入口升级与 Expo 原生控制台方案》（GPT 修订版，2026-06-22）→ 本文档骨架
> ② 《仓鼠小窝 Expo 后续功能待办草案 V2》（2026-06-25）→ 独立成附卷 [`v4-expo-feature-pool.md`](./v4-expo-feature-pool.md)
> ③ 《仓鼠小窝 V4.0 第三审意见书》（Syzygy，2026-07-02）→ 修订层，已全部内联吸收
> **本文档生效后，三份原始文档退役为历史参考，施工一律以本文档 + 附卷为准。**
> 修订对照见附录 B；与 2026-07-02 意见书相比的新增时代差（7 月 6 日安全整改、开发者账号到位）已在正文吸收。

---

## 0. 一句话结论

> **以 Supabase 为唯一后端与多端状态中枢，保留 GitHub Pages / PWA 作为桌面与备用入口，新增 Expo 原生 App 作为 iOS 手机主力控制台，让 Mac mini 24h Agent、微信 bridge、各端 Syzygy 之间形成可靠的通知、审批、状态同步与任务回流闭环。**

三条不可动摇的定位（三件套一致裁定）：

1. **V4.0 是入口层升级，不是全量重写。** 现有 Web 版不退役，Expo App 先承担手机端最高价值场景。
2. **先闭环，后迁页面。** 推送 → 审批 → 状态回流这条链路跑通，V4.0 就已经成立；页面迁移可以慢慢来。
3. **Supabase 是唯一真实状态源。** 所有端通过表、Realtime、RPC 交换状态，不互相硬连。

---

## 1. 为什么做 & 解决什么

### 1.1 当前瓶颈在入口层，不在后端

现状：React 19 + Vite 7 + TS 前端部署 GitHub Pages，以 PWA 形式添加到 iPhone 主屏；Supabase（`crfhiumxzmaszkapanrb`）承担数据库 / Auth / Edge Functions / Realtime / RLS；Mac mini `mini-agent` 24h 常驻（WeChat bridge、命令监听、CLI 唤醒、心跳）；5 个 MCP 服务器 + 9 个通用 Edge Function 在线。

PWA 通道的天花板（保留主方案原始论证，此处摘要）：

| 问题 | 影响 |
|---|---|
| Safari/WebView 存储可能被系统回收 | 偶发重新登录，破坏「私人系统」连续感 |
| iOS PWA 推送配置繁、可靠性与调试体验差 | Agent 完成任务后难以可靠请求审批 |
| 切出后进程被回收，后台能力弱 | 手机端无法作为可靠触达节点 |
| Face ID / Haptics / 文件系统 / Deep Link 受限 | 缺原生质感，工作流断裂 |
| 通知回流定位能力弱 | 多端任务上下文容易断 |

### 1.2 V4.0 要解决的四件事 + 第一动机

1. **通知**：Mac mini / Agent 任务完成、异常、待审批时，可靠推送到 iPhone（并自动镜像到 Apple Watch）。
2. **审批**：点开通知直达任务详情，批准 / 驳回 / 补充要求。
3. **状态**：手机上看到 Mac mini、微信 bridge、各端 Syzygy 的运行状态。
4. **回流**：从推送 / 微信 / 桌面回到小窝时，能定位到正确的任务、时间轴、待办或议事厅。

**第一动机（串串 2026-07-02 亲述，意见书吸收）：** 天气 / 电量 / 位置等状态信息目前经 iOS 快捷指令异步上传，「诉求即时性的信息做成了异步读取」。原生 App 的存在感层（本文档第 8 章）是 V4.0 的原点诉求之一，与推送审批闭环同级。

---

## 2. 多端分工与平台策略

| 入口 / 节点 | 主要职责 | 是否替代其他端 |
|---|---|---|
| ChatGPT 客户端 | 深度对话、架构评审、复杂推理 | 不替代仓鼠窝 |
| GitHub Pages Web 版 | 桌面 / Windows 入口、长文本编辑、调试、备用入口 | **不退役** |
| **Expo App（新）** | iPhone / iPad 主力入口：推送、审批、状态、Deep Link、存在感采集 | 不替代 ChatGPT 与微信 |
| Mac mini `mini-agent` | 24h 执行层：CLI 唤醒、WeChat、打印、定时任务 | 不承担 UI |
| 微信 bridge | 日常轻触达、陪伴、**推送降级备用通道** | 不承担控制台 |
| Supabase / MCP | 数据、记忆、任务、事件、权限、同步中枢 | 系统地基 |

平台策略：iPhone / iPad 优先 Expo App；Windows / Mac 继续 Web 版；微信保留。macOS 原生体验不是 V4.0 目标。

---

## 3. 技术选型

### 3.1 为什么是 Expo（结论保留，论证见原主方案第 3 节）

- 对 PWA：原生推送、可靠 session 持久化（SecureStore/AsyncStorage）、Face ID、Haptics、Deep Link、本地文件、本地通知。
- 对原生 Swift：React + TS 技能与业务层直接复用，适合 Codex / Claude Code 分阶段施工，双平台留有路径。

### 3.2 工作流路线（意见书 2.2 修订后的最终裁定）

> **Managed 工程 + CNG（持续原生生成）+ config plugins + development build 为默认路线；bare workflow 是最后手段。**

- **从第一天起放弃 Expo Go**：新版 Expo SDK 已移除 Expo Go 的远程推送支持，Phase 1 验收必须走 development build 真机；Phase 0 起统一用 dev build，避免中途换轨。
- Share Extension、WidgetKit、watchOS target（V4.1+ 需求）均有成熟 config plugin 方案，不需要预先退到 bare。
- **前置条件已满足：** Apple Developer 账号已注册并审批通过（2026-07-07 确认）。原意见书拍板题 1（$99 购买时点）销案；dev build 签名、推送 entitlement、TestFlight 通道自 Phase 0 起全部可用。

### 3.3 推送通道：Expo Push 先行，APNs 直连后置

- **阶段 A（V4.0 全程）：** App 获取 `ExpoPushToken` 写入 Supabase → Edge Function 调 Expo Push API → Expo 转发 APNs。实现快、调试简单、足够验证闭环。
- **阶段 B（可选，V4.1+ 再评估）：** 需要更细颗粒控制或做公版 App 时再直连 APNs/FCM。
- 推送发送后必须处理 Expo push tickets / receipts：`DeviceNotRegistered` 时将对应 token 置为 `enabled = false`（写回 `device_tokens`），失败详情写 `notification_events`。

---

## 4. 架构铁律（五条）

1. **Supabase 唯一后端。** 不新建后端、不拆库、App 无独立数据源。
2. **前台 Realtime，后台靠推送，启动后补账。** 不把「后台常驻」当地基：前台订阅 Realtime；后台由 Edge Function / Mac mini 触发推送；被杀后下次打开按 `last_seen_event_id` 从 `agent_events` 补齐。关键任务以数据库事件日志为准，不以内存订阅为准。**该铁律对存在感层的传感数据同样生效**（第 8 章）。
3. **共享业务层，不共享 client 初始化。** 可共享：表类型、Zod schema、业务常量、查询/RPC 约定、domain 逻辑。不共享：`supabase.ts` 初始化（Web 现为 `detectSessionInUrl: true`，Native 需要 AsyncStorage + `detectSessionInUrl: false` + AppState token refresh + URL polyfill）、页面组件、CSS、本地存储实现。
4. **安全基线出生即达标。** 新表、新函数、新 workflow 一律按第 10 章执行，不存在「先跑通再加固」。
5. **一表一职。** 设备的推送地址（`device_tokens`）、AI 的在场（`agent_heartbeats`）、串串的状态（`device_status` / 场景快照）是三类数据，禁止混写（意见书 3.3 边界原则）。

```
                    ┌──────────────────────────┐
                    │        Supabase          │
                    │ DB / Auth / RLS          │
                    │ Edge Functions / Realtime│
                    └───────────┬──────────────┘
        ┌───────────────────────┼───────────────────────┐
┌───────▼────────┐      ┌───────▼────────┐      ┌───────▼────────┐
│ GitHub Pages   │      │ Expo App       │      │ Mac mini       │
│ Web / Windows  │      │ iOS 控制台      │      │ mini-agent 24h │
└────────────────┘      └────────────────┘      └────────────────┘
        └───────────────┬───────┴───────────────┬───────┘
                 ┌──────▼──────┐        ┌───────▼───────┐
                 │ 微信 bridge  │        │ ChatGPT 客户端 │
                 └─────────────┘        └───────────────┘
```

---

## 5. 现状盘点（2026-07-07 实测，施工前必读）

> 本章是三件套写作之后发生的事实变化（时代差清单），施工时以本章为准。

### 5.1 已存在、可直接复用的地基

| 现状 | 对 V4.0 的意义 |
|---|---|
| `push_subscriptions.platform ∈ {web, expo, apns}`（2026-07-06 migration） | 仓库已为原生推送预留分发维度；与新表关系见 6.2 裁定 |
| **Push 跳转协议已定**：payload 携带 `{ "screen": "...", "params": {}, "url": "/#/..." }`，`screen`+`params` 为权威字段，`url` 仅 Web 兜底 | **Expo 端直接实现 screen → expo-router 路由映射即可，协议不再重新设计**（见 `docs/security-boundary.md`） |
| `usage_quota` 表 + `consume_usage_quota(user, scope)` 已上线（按北京时区自然日计数，fail-open 成本刹车） | Phase 1 推送函数直接挂 `push` scope 额度护栏，零新建 |
| `device_status` 表在役（经纬度 / 电量 / Wi-Fi / 充电 / 天气 / 步数 / now_playing / raw_data） | 存在感层的原始信号表**已经存在**，App 原生采集直接复用（8.3） |
| `current_context_snapshot` 表已建（0 行，注释：「最新状态快照：Context Builder 直接读取注入各端口上下文」） | 场景判定结果的落点**已经预留**，不必新建 presence_snapshots（8.3） |
| `syzygy_commands`（status / claimed_by / claimed_at / idempotency_key）+ mini-agent 命令监听器 | 审批结果回流 Mac mini 的监听模式**已有成熟范式**，Phase 2 照抄防重抢占设计 |
| `agent_feed_items` / `timeline_entries` / `todos` / `agent_council` 等业务表齐备 | Phase 0 读数、Phase 3 只读页面的直接数据源 |
| `agent_tasks` 全量 CLI 审计链路（1300+ 行） | 审批后执行结果写回的既有出口 |
| Edge Function 统一鉴权 `_shared/auth.ts`（A 服务密钥 / B 用户 JWT 复验 / C 共享密钥，全部 fail-closed） | 新推送函数必须走此库，见第 10 章 |
| `hamster-life-mcp` 已有高德天气工具、`generate_tts`（私有桶 + 7 天签名 URL） | 存在感层的天气不用新接 API；语音入口（附卷模块 13）后端已就绪 |
| `print_capsules` 表在役（7 行，默认纸 95×171，batch / 周排程字段齐） | 附卷模块 14 的主体表**已存在**，增量只是模板系统 |
| 阅读共振已上线：`read_excerpt_resonances` / `add_excerpt_resonance` MCP 工具（AAB 实例） | 附卷模块 15 后端**已就绪**，App 端只欠 UI |

### 5.2 与三件套记述不同的事实（以下为准）

1. **anon 白名单已清零（2026-07-06）。** 意见书 4.5 所述「device_status / checkin_logs 的 anon insert 保留」已过时：iOS 快捷指令已切换到 `device-report` Edge Function（模式 C，`DEVICE_REPORT_SECRET`），`device_status` anon INSERT 策略已删除；`checkin_logs` 等同型策略一并收紧。当前唯一豁免仅剩 auth 泄露密码保护警告（OTP-only + Free plan）。**V4.0 期间不得重开任何 anon 策略。**
2. **RLS 策略统一子查询形式。** 加表守则现为 `(select auth.uid()) = user_id`（initplan 优化）。意见书附录 A 的裸 `auth.uid()` 写法已按此更新（见本文档附录 A）。
3. **Apple Developer 账号已到位。** 拍板题 1 销案；Phase 0 即可 EAS dev build + 推送 entitlement。
4. **Letter 功能已半退役（2026-07-06 工单）。** 定时生成弃用、函数封存；「主动来信」明确等待 V4.0 推送管线落地后重构——已列入附卷 V4.1 候选。
5. **单租户边界已锁。** 全库 `USER_ID = 94dd24be-...` 业主本人，Auth 关闭自助注册、邮箱 OTP 仅业主邮箱放行。Expo 端登录即走同一 OTP 流（7.1）。

### 5.3 顺手工单（主仓库，非 V4.0 阻塞项）

- `deploy-supabase-functions.yml` 无 `paths` 过滤（每次 push main 全跑）且与 `deploy-edge-functions.yml` 职责重叠；两个 workflow 的 Supabase CLI 均为 `version: latest` 未固定。建议合并为一个、按第 10 章规范修缮。新 App 仓库的第一个 workflow 从出生起即须合规。

---

## 6. 数据模型：五张新表 + 三个边界裁定

新表清单（DDL 全文见附录 A）：`device_tokens`、`agent_events`、`approval_requests`、`notification_events`、`agent_heartbeats`。

### 6.1 表名归一（意见书 1.2，维持）

原主方案 5.5 `actor_heartbeats` 作废，统一为 **`agent_heartbeats`**（草案 V2 字段版：`agent_id` / `agent_type` 分离 + `last_task`）。施工时严禁两张都建。

### 6.2 裁定：`device_tokens` 与 `push_subscriptions` 的边界（整合时新增）

现状冲突：仓库 2026-07-06 已给 `push_subscriptions` 加了 `platform ∈ {web, expo, apns}`（当时预期原生 token 入此表），而意见书附录 A 裁定新建 `device_tokens`。

**默认裁定（如无异议按此施工）：新建 `device_tokens`，`push_subscriptions` 收敛为 Web Push 专用。**

理由：
- `push_subscriptions` 的 `endpoint` / `p256dh` / `auth` 均为 NOT NULL，是 Web Push（VAPID）专属形状；Expo token 塞入需填哑值或放宽约束，得不偿失。
- `device_tokens` 带设备注册语义（`device_name` / `app_version` / `enabled` / `last_seen_at`），是推送地址 + 设备注册表，与浏览器订阅生命周期完全不同。
- 附录 A 的 RLS 结构已经过安全评审，直接可用。

执行细节：
- `push_subscriptions.platform` 的 `expo` / `apns` 值弃用不删（历史兼容），Web 行永远是 `web`；
- 推送分发：原生走 `device_tokens`（新 `push-dispatch` 函数），Web Push 维持现有 `sw.js` 链路；`{screen, params, url}` payload 协议两边共用；
- V4.1+ 可评估把 Web 订阅并入 `device_tokens` 统一后退役旧表，不在 V4.0 范围。

### 6.3 裁定：`approval_requests` 与 `agent_council` 的边界（整合时新增）

两者有表面重叠（都含「串串拍板」），职责必须分清：

| | `agent_council`（已存在） | `approval_requests`（新建） |
|---|---|---|
| 定位 | 提案 → 评审 → 拍板 → 执行计划的**重决策流程** | Agent 运行时**单个动作的轻量放行** |
| 粒度 | 一个提案（含多轮评审、投票、风险等级） | 一个待执行动作（`proposed_action` jsonb） |
| 时效 | 无过期概念 | 有 `expires_at`，过期即 `expired` |
| 入口 | 议事厅页面 / council MCP 工具 | **推送通知 + 通知按钮 + 审批详情页** |
| 回流 | `council-plan-listener` 生成执行计划 | mini-agent 监听 status 变更继续执行 |

两者共用同一条推送管线：council 提案等待拍板时，也写一条 `agent_events`（`event_type = 'council_decision_requested'`）触发推送，**不为议事厅另建第二条通知链路**。

### 6.4 裁定：存在感数据落表方案（回应意见书拍板题 2，推荐案）

> 意见书 3.3 留题：「升级复用 device_status 或新建 presence_snapshots」。基于 5.1 实测，**推荐复用，不新建**：

- **原始信号流 → `device_status`（复用）。** App 原生采集（expo-location / expo-battery）与 iOS 快捷指令写同一张表，`source_app` 区分 `expo_app` / `ios_shortcut`。App 端以 authenticated 身份直写（受 owner RLS 保护；若现行策略缺 authenticated INSERT，补一条 owner-scoped 策略即可）；快捷指令继续走 `device-report`（模式 C），**降级备份通道**。
- **场景判定结果 → `current_context_snapshot`（复用）。** 该表本来就是「最新状态快照，Context Builder 注入各端口」的设计，0 行待用。规则引擎（`presence_rules`，V4.1 随附卷模块 5 建表）判定出的 `at_home` / `wind_down` 等场景写入此表，各端口 Syzygy 统一消费。
- 好处：零新表、三类数据边界不破（tokens / heartbeats / status），且快捷指令通道天然成为原生采集失效时的降级方案。
- 此裁定仍留给串串拍板确认（第 17 章拍板题 1）。

---

## 7. 推送与审批闭环（V4.0 核心链路）

### 7.1 登录与 session（Phase 0）

- 单租户 OTP：Expo 端 `signInWithOtp`（业主邮箱）→ **6 位验证码 `verifyOtp` 流**。刻意不用 magic link，避免 Phase 0 就引入 auth 深链处理；深链留给推送跳转场景。
- `lib/supabase.native.ts`：AsyncStorage（token 可后续升级 SecureStore）、`persistSession: true`、`autoRefreshToken: true`、`detectSessionInUrl: false`、`react-native-url-polyfill`，AppState 前台时 `startAutoRefresh()`。
- 环境变量只允许 `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` 两个公开值；任何服务密钥不得进 App（对应架构评审 P2 · 2-5）。

### 7.2 闭环全链路

```
Codex / Claude Code / mini-agent 完成任务或需要放行
        ↓ 写 agent_events（+ 需要放行时写 approval_requests）
Supabase：agent_events AFTER INSERT 触发 Database Webhook（pg_net）
        ↓ 携共享密钥 header 调用
Edge Function push-dispatch（鉴权模式 A/C · fail-closed · usage_quota 'push' 护栏）
        ↓ 按 importance 判断是否推送；查 device_tokens 启用行
Expo Push Service → APNs → iPhone（自动镜像 Apple Watch）
        ↓ 写 notification_events（queued/sent/failed；receipts 回查更新）
串串点通知（或直接按通知上的操作按钮）
        ↓ Deep Link: hamsternest://approvals/[id]（payload {screen, params} → expo-router）
审批详情页：批准 / 驳回 / 补充说明 → UPDATE approval_requests
        ↓ Realtime / 轮询
mini-agent 监听 status 变更（照抄 syzygy_commands 的 claimed_by 防重范式）→ 继续执行
        ↓ 结果写回 agent_events / agent_tasks / agent_feed_items
Expo（前台 Realtime / 启动补账）· Web · 微信 同步可见
```

设计要点：

- **写事件方不需要知道推送的存在**：任何端写 `agent_events` 即可能触发推送，推不推由 `push-dispatch` 按 `importance`（low 不推 / normal 合并 / high、urgent 即推）+ 静默时段规则决定。微信 bridge 作为推送失败时的降级通道（`notification_events.channel = 'wechat_bridge'` 复用 `pending_wechat_messages` 队列）。
- **补账协议**：`agent_events.id` 用 bigint 自增；App 本地存 `last_seen_event_id`，启动 / 回前台时拉增量；`device_tokens.last_seen_at` 同步更新，供「多久没打开 App」判断。
- **Apple Watch 零成本层（意见书 2.1，施工硬要求）**：Phase 1 实现推送时**必须一并设计 notification categories + actionable buttons**——审批类推送带「批准 / 稍后 / 驳回」按钮，iPhone 通知自动镜像到 Watch，抬腕即可处理，无需任何 watchOS 代码。睡前轻提醒等用系统默认震动实现过渡版；自定义 Taptic 节奏留 V4.2（附卷模块 12）。

---

## 8. 存在感层（意见书第 3 章吸收 + 落地方案）

### 8.1 定位

输入端（串串 → 系统）与输出端（Syzygy → 串串）是同一根线的两端：

```
输入：App 原生采集 定位/电量/充电/Wi-Fi  →  presence_rules 规则引擎（V4.1）判定场景
      快捷指令通道降级为备份            →  current_context_snapshot 供各端消费
输出：Presence Ring 呈现多端在场（读 agent_heartbeats）
      推送 / 通知按钮 / （V4.2）触觉信号 反向触达
```

### 8.2 技术现实边界（预期校准，不许对原生抱错误幻想）

- **定位**：expo-location。前台实时无障碍；后台走 Always 权限 +「显著位置变化唤醒」——这是相对 PWA 的最大实质提升，但不是持续追踪。
- **电量**：expo-battery。前台即时 + 充电状态变化事件。**iOS 不允许任何 App 后台 7×24 持续上报电量流，原生也不行。**
- **天气**：定位的衍生品。App 拿坐标调天气 API；**高德天气已在 `hamster-life-mcp` 在线，不新接**；WeatherKit 为开发者账号内含的选配升级。
- **总原则**：手机端永远是「前台即时新鲜 + 后台事件驱动唤醒」；7×24 常驻角色属于 Mac mini（铁律 2）。

### 8.3 落表（6.4 裁定的执行图）

```
expo-location / expo-battery（前台 + 显著变化唤醒）
        ↓ authenticated 直写（owner RLS）
device_status（source_app = 'expo_app'）   ←  device-report（快捷指令，降级备份）
        ↓ mini-agent / Edge 规则引擎（V4.1: presence_rules）
current_context_snapshot（最新场景快照，各端口 Context Builder 消费）
```

V4.0 范围内只做：原生采集直写 `device_status` + 首页展示当前状态。规则引擎、场景化行为调整（在家 / 外出 / 睡前策略）留 V4.1（附卷模块 5）。

---

## 9. 记忆系统在 Expo 端的消费形态（占位章，意见书 1.3）

记忆系统三命题（公理层 / 压缩层 / 重建层，2026-06-24 推导）晚于主方案定稿，本章占位待补，**不阻塞 Phase 0-2 施工**。定稿时至少回答：

1. Expo App 如何读取与呈现 timeline / archives 的三层结构；
2. 「数据的记忆用数据的方式」在移动入口的落地形态（关键词检索入口、被动注入的边界）；
3. 启动补账（`last_seen_event_id`）与记忆层的关系——补账补的是事件流，不是记忆本身。

本章具体设计由对话窗 Syzygy 另行产出后并入。

---

## 10. 安全基线（对 V4.0 全部新建内容生效）

> 最高准绳是仓库 [`docs/security-boundary.md`](./security-boundary.md)（2026-07-06 版）；本章为 V4.0 施工摘录 + 原生端增补。与意见书第 4 节的差异以 5.2 节时代差为准。

1. **新表出生即带 RLS，零 anon 策略。** authenticated 策略统一 `(select auth.uid()) = user_id` 子查询形式。禁止「Allow service insert」类误解性策略——service_role 天然绕过 RLS，此类策略实际是向 anon 敞开写入。
2. **新建数据库函数默认 `REVOKE EXECUTE ... FROM PUBLIC`**，再按需显式 GRANT（仅 REVOKE FROM anon 是空操作）。参考现役 `consume_usage_quota` 的写法。
3. **新 Edge Function 禁止裸奔。** 一律从 `_shared/auth.ts` 引 `verifyAuth` / `verifySharedSecret`（模式 A 服务密钥 / B 用户 JWT 复验 / C 共享密钥，fail-closed：密钥未配置一律拒绝）；在 `config.toml` 登记 `verify_jwt = false`（网关不支持 ES256，鉴权必须在函数内完成）。`push-dispatch` 从第一行代码起适用：DB Webhook / mini-agent 调用走 A 或 C；额度护栏挂 `consume_usage_quota(user, 'push')`。
4. **部署 workflow：`paths` 过滤 + 固定 CLI 版本**，hamster-nest-app 仓库的第一个 workflow 写下时即生效（背景：无参数全量部署曾导致已删函数被 CI 复活；主仓库自身待修见 5.3）。
5. **原生端专属规矩：**
   - App 内只有 `EXPO_PUBLIC_*` 公开变量（URL + anon key），anon key 是公开常量，永远不是凭证；
   - session token 存储 Phase 0 用 AsyncStorage 起步，Phase 5 迁 `expo-secure-store`；
   - Deep Link 处理器必须校验参数（uuid 格式等）后再导航，不信任 payload 原文；
   - 推送 payload 不携带敏感正文（标题 + id 即可，详情进 App 后按 RLS 拉取）。
6. **既有白名单（2026-07-06 后）：** 仅剩 auth 泄露密码保护警告豁免（OTP-only + Free plan）。device_status / checkin_logs 的 anon 通道**已关闭**，不得以 V4.0 名义重开。

---

## 11. 代码组织

### 11.1 仓库策略（维持主方案裁定）

新建独立仓库 **`hamster-nest-app`**；本仓库（Web 版）继续在役。共享层初期用「复制 + 约定」，等 App 跑通后再决定抽 npm package / monorepo，不提前工程化。

```
hamster-nest/              # 现有 Web 版（本仓库），docs/ 存放 V4.0 方案
hamster-nest-app/          # 新 Expo App
hamster-nest-shared/       # 可选，后置
```

### 11.2 Expo App 结构

```
hamster-nest-app/
  ├── app/                         # expo-router
  │   ├── index.tsx                # 首页：Feed + 当前状态 + Presence 简版
  │   ├── approvals/index.tsx      # 审批中心
  │   ├── approvals/[id].tsx       # 审批详情（Deep Link 落点）
  │   ├── tasks/[id].tsx           # 任务详情
  │   ├── todos/index.tsx          # 待办（Phase 3 只读）
  │   ├── timeline/index.tsx       # 时间轴（Phase 3 只读）
  │   └── settings/index.tsx       # 设置（通知开关 / 设备管理）
  ├── features/                    # approvals / agent-events / feed / presence / todos / timeline
  ├── lib/
  │   ├── supabase.native.ts       # 见 7.1，绝不复制 Web 版 client.ts
  │   ├── notifications.ts         # token 注册 / categories / 响应处理
  │   ├── deep-linking.ts          # {screen, params} → 路由映射（协议见 5.1）
  │   ├── sync.ts                  # last_seen_event_id 补账
  │   └── presence.ts              # expo-location / expo-battery 采集
  ├── components/  ├── shared/     # 从 Web 仓库同步的 types / 常量（复制层）
  └── assets/
```

### 11.3 共享边界（维持主方案 7.3）

可共享：表类型（可用 `supabase gen types` 统一生成）、查询/RPC 约定、业务常量、Zod schema、RLS 与数据模型文档。
不共享：client 初始化、页面组件、CSS/DOM、Web-only hooks、本地存储实现。

---

## 12. 分阶段施工计划

> 相对原主方案的变更：开发者账号已到位（不再是流程节点）；Phase 1 并入 Watch 零成本层与 notification categories 硬要求；每阶段验收含安全项。

### Phase 0 · 原生壳验证（1 个周末）

- 新建 `hamster-nest-app`（Expo SDK 最新稳定版 + expo-router + TS）。
- **直接 development build**（EAS 或本地 `expo run:ios`），不装 Expo Go。
- `supabase.native.ts` + OTP 登录 + session 持久化（杀 App 重开仍在登录态）。
- 读取并渲染 `agent_feed_items` 最近 10 条。
- 验收：真机安装打开 ✓ 登录持久 ✓ 读到 Supabase 数据 ✓ 开发手感串串接受 ✓。

### Phase 1 · 通知闭环（1 周）

- 建表：`device_tokens` + `notification_events`（附录 A）。
- App：请求通知权限 → 获取 ExpoPushToken → upsert `device_tokens`；**同步定义 notification categories（审批类含 批准/稍后/驳回 三按钮）**。
- 后端：`push-dispatch` Edge Function（第 10 章规范）+ `agent_events` 表 + AFTER INSERT Webhook；receipts 回查。
- 从 mini-agent 触发一条测试事件 → iPhone 收到推送 → **确认 Watch 自动镜像与按钮可用**。
- 点击通知 Deep Link 进入指定页；`notification_events` 记录到达/点击。
- 验收：Mac mini / Edge 稳定推真机 ✓ Watch 镜像+按钮 ✓ Deep Link 正确落页 ✓ 通知日志可查 ✓ 函数鉴权 fail-closed ✓。

### Phase 2 · 审批闭环（1 周）

- 建表：`approval_requests` + `agent_heartbeats`（附录 A）。
- App：审批列表 / 详情、批准 / 驳回 / 补充说明；通知按钮直接写回（App 冷启时兜底进详情页）。
- mini-agent：监听 `approval_requests` 状态变更（复用 syzygy_commands 防重范式），继续执行并写回 `agent_events` / `agent_tasks`。
- 各端开始上报 `agent_heartbeats`。
- 验收：CLI 发起审批 → 推送 → 手表/手机处理 → mini-agent 收到并续跑 → 结果回流可见 ✓ 微信降级通道可用 ✓。

### Phase 3 · 核心只读页面 + 存在感 V4.0 部分（1-2 周）

- 只读迁移顺序：首页 Feed → Agent 状态页（Presence 简版，读 `agent_heartbeats`）→ 审批中心 → 待办只读 → 时间轴只读。
- 存在感：expo-location / expo-battery 前台采集 + 显著位置变化唤醒，直写 `device_status`（source_app='expo_app'）；首页展示当前状态卡。
- 验收：Expo App 成为手机端查看与审批主入口；Web 保留编辑与完整管理。

### Phase 4 · 核心编辑能力（2-3 周）

待办增改完成 → 时间轴新增 → feed item 操作 → 议事厅补充说明 → 设置页。验收：手机高频操作不再依赖 PWA。

### Phase 5 · 原生体验增强（1-2 周）

Face ID（expo-local-authentication）、Haptics、SecureStore 迁移、本地缓存与离线状态提示、Badge、启动补账打磨。验收：断网 / 后台 / 重启后状态可恢复。

### Phase 6 · TestFlight（1-2 天，可选项已就绪）

EAS Build → TestFlight 自用分发（账号已备）。App Store 上架不是 V4.0 目标。

### 工期与费用

- 总工期 6-10 周业余时间；**MVP（Phase 0-2 + Phase 3 首屏）2-3 周见到核心价值**。
- 费用：Apple Developer $99/年（**已支付**，记账名目「生态门票」——推送真机验证、Share Extension / WidgetKit / watchOS 签名、HealthKit、后台定位、WeatherKit、TestFlight 全在其内）；Expo EAS 免费额度起步；Supabase 沿用现有项目。

---

## 13. 风险与对策（修订版）

| 风险 | 对策 |
|---|---|
| 误把 V4.0 做成全量重写 | 先闭环后迁页；Phase 0-2 未验收不开 Phase 3 |
| 过度相信后台常驻 | 铁律 2：前台 Realtime + 后台推送 + 启动补账；传感数据同样适用 |
| 双前端维护成本 | Web 桌面强入口 / App 移动控制台，不追求同构；共享层后置 |
| Supabase client 共享方式错误 | 铁律 3：只共享业务层，两套初始化 |
| 推送链路过早复杂化 | Expo Push 先行；APNs 直连留 V4.1+ 评估 |
| 推送地址两张表混乱 | 6.2 裁定：device_tokens 原生 / push_subscriptions 仅 Web；payload 协议共用 |
| 审批双轨并行混乱 | 6.3 裁定：council 重决策 / approval_requests 轻放行，共用一条推送管线 |
| ~~Expo 模块受 Managed 限制~~ | 已更新：Managed + CNG + config plugins + dev build 为默认路线，bare 为最后手段 |
| 安全基线回归 | 第 10 章出生即达标；PR 评审对照 security-boundary.md |
| App Store 审核不确定 | TestFlight 自用优先，上架非前置条件 |

---

## 14. MVP 范围

**必含：** OTP 登录 + 持久 session ✦ 首页 Feed / agent_events ✦ device_tokens 注册 ✦ push-dispatch 推送（含 categories 审批按钮 + Watch 镜像）✦ Deep Link 落审批详情 ✦ 批准/驳回回流 mini-agent ✦ 启动补账 ✦ notification_events 日志。

**不含：** 全部页面迁移、时间轴编辑、待办拖拽、App Store 上架、APNs 直连、复杂离线编辑、后台常驻 Realtime、规则引擎（V4.1）、watchOS App（V4.2）。

---

## 15. 未来扩展

V4.1+ 功能池唯一文档为附卷 [`v4-expo-feature-pool.md`](./v4-expo-feature-pool.md)（Nest Intake、分享菜单、视觉记忆管线、空间感规则引擎、Presence Ring 完整版、收束仪式、Watch App、抽屉、触觉、语音、打印模板、阅读共振、离线信、主动来信重构……）。原主方案第 13 节所列 Nibble-Chat 公版、All About Book 独立 App、Companion 轻量版等复用方向一并记于附卷末章。

---

## 16. 施工顺序总览（给 Codex / Claude Code 的执行卡）

1. Phase 0 开仓 → 原生壳验收。
2. 附录 A migration 提 PR（表随 Phase 分批上线也可，RLS 结构不得削弱）。
3. `push-dispatch` 函数 + Webhook + categories（Phase 1）。
4. 审批页 + mini-agent 监听（Phase 2）。
5. 只读页 + 存在感采集（Phase 3）。
6. 每阶段收尾：更新本文档勾选状态，重大偏差回写修订记录。

## 17. 拍板题（截至 2026-07-07）

| # | 题目 | 状态 |
|---|---|---|
| 1 | 存在感数据落表：复用 device_status + current_context_snapshot（6.4 推荐案）还是新建 presence_snapshots | **待拍板**（默认按推荐案施工） |
| 2 | device_tokens 与 push_subscriptions 边界（6.2 默认裁定） | **待确认**（无异议即按裁定施工） |
| 3 | ~~$99 购买时点~~ | **已销案**：账号已注册并审批通过 |
| 4 | ~~草案 V2 十六提案取舍~~ | 已销案：附卷第十八节即裁定（2026-07-02 确认） |

---

## 附录 A · 五张新表 Migration 草案（2026-07-07 修订版）

> 变更 against 意见书附录 A：RLS 谓词全部改为 `(select auth.uid())` 子查询形式（仓库 2026-07-06 加表守则）；其余结构不变。**RLS 策略结构不得削弱**；字段类型可在施工评审时微调。service_role 天然 bypassrls，所有表均不为其建策略。

```sql
-- ============================================================
-- V4.0 新表 migration 草案（附录 A · 2026-07-07 修订版）
-- 规范依据：docs/security-boundary.md（2026-07-06）加表守则
-- ============================================================

-- 1. device_tokens：原生推送 token + 设备注册（边界见正文 6.2）
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  platform text not null check (platform in ('ios','android','web')),
  device_name text,
  expo_push_token text not null,
  native_push_token text,
  app_version text,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);
alter table public.device_tokens enable row level security;
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy device_tokens_insert_own on public.device_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy device_tokens_update_own on public.device_tokens
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- 2. agent_events：多端事件流（事实日志，bigint id 供补账）
create table public.agent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  actor text not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  importance text not null default 'normal'
    check (importance in ('low','normal','high','urgent')),
  created_at timestamptz not null default now()
);
create index agent_events_user_created_idx on public.agent_events (user_id, id desc);
alter table public.agent_events enable row level security;
create policy agent_events_select_own on public.agent_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy agent_events_insert_own on public.agent_events
  for insert to authenticated with check (user_id = (select auth.uid()));
-- 事实日志：不给 authenticated UPDATE/DELETE；Agent 写入走 service_role

-- 3. approval_requests：运行时轻审批（敏感表：写入权即执行权）
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_actor text not null,
  title text not null,
  description text,
  proposed_action jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired','cancelled')),
  response_note text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table public.approval_requests enable row level security;
create policy approval_requests_select_own on public.approval_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy approval_requests_update_own on public.approval_requests
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- 不给 authenticated INSERT：审批只应由 Agent（service_role）发起；
-- 串串在 App 中的动作是「响应」（UPDATE），不是「发起」。
-- 未来确需 App 端发起，另行评审后单独加 insert 策略。

-- 4. notification_events：通知尝试日志
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_event_id bigint references public.agent_events(id),
  channel text not null check (channel in ('expo_push','wechat_bridge','email','local')),
  status text not null default 'queued'
    check (status in ('queued','sent','failed','skipped')),
  target text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notification_events enable row level security;
create policy notification_events_select_own on public.notification_events
  for select to authenticated using (user_id = (select auth.uid()));
-- 只读给 authenticated；写入全部由 service_role（push-dispatch / mini-agent）完成

-- 5. agent_heartbeats：多端 Syzygy 心跳（归一版，采用草案 V2 字段）
create table public.agent_heartbeats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_id text not null,
  agent_type text not null,
  status text not null
    check (status in ('online','idle','working','waiting_approval','failed','offline')),
  last_task text,
  metadata jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, agent_id)
);
alter table public.agent_heartbeats enable row level security;
create policy agent_heartbeats_select_own on public.agent_heartbeats
  for select to authenticated using (user_id = (select auth.uid()));
create policy agent_heartbeats_upsert_own on public.agent_heartbeats
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy agent_heartbeats_update_own on public.agent_heartbeats
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- expo_app / web 端以 authenticated 上报自身心跳；CLI 各端走 service_role
```

---

## 附录 B · 三件套修订对照表

| 本文档章节 | 来源 | 应用的修订 |
|---|---|---|
| 0-3 定位/分工/选型 | 主方案 0-3 | 3.2 按意见书 2.2 改 CNG 路线；$99 拍板题销案（2026-07-07 新事实） |
| 4 架构铁律 | 主方案 4 + 意见书 3.3 | 增补铁律 5「一表一职」 |
| 5 现状盘点 | **整合时新增** | 2026-07-07 仓库 + 生产库实测；时代差清单 |
| 6.1 表名归一 | 意见书 1.2 | actor_heartbeats 作废 → agent_heartbeats |
| 6.2 / 6.3 / 6.4 边界裁定 | **整合时新增** | 基于 5.1 实测的施工评审裁定 |
| 7 推送审批闭环 | 主方案 6 + 意见书 2.1 | 并入 notification categories / Watch 零成本层硬要求 |
| 8 存在感层 | 意见书 3 | 落表方案按 6.4 具体化 |
| 9 记忆占位章 | 意见书 1.3 | 原样立占位 |
| 10 安全基线 | 意见书 4 | 按 2026-07-06 security-boundary.md 更新（白名单清零、子查询 RLS、_shared/auth.ts）+ 原生端增补 |
| 11 代码组织 | 主方案 7 | 结构图并入 presence.ts / sync.ts |
| 12 施工计划 | 主方案 8-10 + 意见书 1.1/2.1 | 账号前置条件已满足；Phase 1 并入 categories/Watch；验收加安全项 |
| 13 风险 | 主方案 11 | 按意见书 2.2 更新 + 新增两条边界风险 |
| 14 MVP | 主方案 12 | 增 categories/Watch 镜像 |
| 15 未来扩展 | 主方案 13 + 意见书 1.4 | 压缩为指向附卷 |
| 附录 A | 意见书附录 A | RLS 谓词改 `(select auth.uid())` 子查询形式 |

> 整合完成后的后续动作：本文档与附卷入库 `docs/`（本 PR）；定稿摘要由对话窗 Syzygy 落 archives（意见书 6.5，待办移交）。
