# Supabase 架构体检 · 任务清单

> 扫描日期：2026-07-03 · 范围：Supabase 生产项目（`crfhiumxzmaszkapanrb` / Hamster-Nest）+ GitHub 仓库全量
> 目的：安全策略 / 功能短路径 / Expo 迁移准备 的分批整改清单。**本文件只记录待办，不含任何代码改动。**
>
> **整改状态（2026-07-06）**：P0 全部完成（0-2 余一步：快捷指令切换后删 anon INSERT 策略）；
> P1 全部完成；P2 服务端半边完成（2-1/2-4/2-7），原生侧待 Expo 项目；
> P3 完成 3-1/3-2/3-3/3-4（advisor 清零），3-5 只出评估清单；P4 完成 4-2/4-3/4-5，4-1/4-4 留待单独工单。
> 落地细节与新安全守则见 [`security-boundary.md`](./security-boundary.md)。

## 前提与安全边界（已与业主确认）

- **Open signup 已关闭**：Auth 后台不接受自助注册。
- **OTP 一对一**：邮箱验证码只对业主本人邮箱放行。
- 因此：`authenticated` 角色 ≈ 业主本人。「登录即全放行（`USING(true)`）」这批表**当前无实际越权风险**，降级为「纵深防御 / 迁移前卫生」。
- 仍然成立的真实攻击面：**`anon` 角色 = 公网**（anon key 随前端发布，等于公开常量），以及**无鉴权 / 弱鉴权的 Edge Function**（可被公网刷第三方额度）。

安全模型一句话：**边界 = Auth 注册白名单（已锁）+ anon 只读脱敏面（待收敛）+ Edge Function 鉴权（待补齐）**。后续每加一张表 / 一个函数都对齐这条线。

---

## 批次总览

| 批次 | 主题 | 为什么放这批 | 建议节奏 |
|:---:|:---|:---|:---|
| **P0** | 堵公网可读的隐私 + 无鉴权烧钱口 | 与「就我一个用户」无关，公网可直接命中 | 尽快，一次一项 |
| **P1** | Edge Function 鉴权统一 + 成本护栏 | 上架/扩面前的唯一防线 | P0 后紧接 |
| **P2** | Expo / iOS 迁移前必改的架构点 | 到 RN 会直接失效，越早定型越省 | 开 App 前 |
| **P3** | RLS / 索引 性能批量整改 | 低成本高收益，可安排到任意空档 | 穿插进行 |
| **P4** | 结构收敛与卫生项 | 长期可维护性 | 有余力再做 |

---

## P0 · 公网隐私 & 无鉴权（最先做）

| # | 事项 | 现状 | 目标 | 涉及对象 | 校验方式 |
|:---:|:---|:---|:---|:---|:---|
| 0-1 | **`device_status` 经纬度对 anon 可读** | 策略 `Allow select for anon by user`（role=anon）+ 该表在 `supabase_realtime` 发布中 → 任何人凭公开 anon key 可实时订阅 GPS | 经纬度移出 anon 可读路径；免登录展示改走脱敏视图 / `security definer` 只读 RPC，只暴露非敏感字段 | `public.device_status` 策略、`supabase_realtime` publication | 用 anon key 直查 `device_status` 应查不到 lat/long |
| 0-2 | ⚠️ **`device_status` 可被 anon 伪造写入** | `Allow insert for anon` `WITH CHECK (true)` → 任何人可注入假位置/电量，且会被 `wechat-reply` 当上下文喂给模型 | 收回 anon 写入；设备上报改由服务端密钥或 authenticated 通道 | `public.device_status` INSERT 策略 | **前置**：先确认上报方（iOS 快捷指令 / Mac mini 脚本）持有的 key——若用 anon key，须先把上报切到带共享密钥的 Edge Function 或 service key 再删策略，否则上报会断。删后用 anon key INSERT 应被拒 |
| 0-3 | **`tts-generate` 完全无鉴权** | `Deno.serve` 直接处理，任何人可调用刷 ElevenLabs 额度；产物桶 `tts-audio` 为 public | 补 JWT 复验（对齐 `openrouter-chat` 的做法） | `supabase/functions/tts-generate/index.ts` | 无 token 调用应返回 401 |
| 0-4 | **letter / wechat 弱鉴权兜底** | `verifyAuth` 内 `if (token.startsWith('eyJ') && token.length > 100) return true` → 任何像 JWT 的串都放行 | 删除该兜底分支，改真正验签或共享密钥 fail-closed | `letter-generate`、`wechat-reply` | 伪造长串 token 调用应返回 401 |
| 0-5 | **收敛其余 anon 只读表** | `agent_tasks`(1163) / `current_context_snapshot` / `daily_status_digest` / `weekly_digest` / `ideas` / `print_capsules` / `scheduled_wakeup` / `capabilities` 均 role=anon 公网可读 | 逐张判断：真需免登录展示的→脱敏视图；否则策略角色 anon→authenticated | 上述表的 `frontend_read_*` 策略 | 用 anon key 直查应受限 |
| 0-6 | ⚠️ **其余对 anon 敞开的 INSERT 策略** | `checkin_logs·Allow service insert`、`outbound_messages·Allow insert messages`、`rp_messages·rp_messages_insert`、`rp_npc_cards·rp_npc_cards_insert`、`rp_sessions·rp_sessions_insert` 均 `{public}` INSERT `WITH CHECK (true)` → anon 可写 | service_role 天然绕过 RLS，不需要这些策略（同 `20260702100000` migration 思路）；删除即堵住 anon 写入 | 上述 5 条 INSERT 策略 | **前置**：同 0-2，先确认各表外部写入方持有的 key。`outbound_messages` 最要紧——若有桥接程序消费它发消息，anon 可写 = 任何人能借你的通道发消息 |

> 注：0-1 与 0-5 若都要保留「免登录首页展示」，建议统一成**一个 `public_dashboard` 只读视图 / RPC**，把「该对公网暴露什么」集中到一处，别散在各表策略里。
>
> **重要发现（关联 0-3 / 0-4 / P1）**：鉴权最弱的 4 个函数 `letter-generate`、`letter-check`、`wechat-reply`、`tts-generate` **只存在于云端——git 仓库 `supabase/functions/` 里没有源码，`config.toml` 也未登记**。改它们前先把源码收编进仓库并走 CI（见 2-7），否则改动无版本管理、易回退丢失。另：`letter-generate` 鉴权失败时会 `console.error` 打印 `serviceKeyPrefix`（service key 前缀），修 0-4 时顺手删掉这行日志。

---

## P1 · Edge Function 鉴权统一 & 成本护栏

| # | 事项 | 现状 | 目标 | 涉及对象 |
|:---:|:---|:---|:---|:---|
| 1-1 | **鉴权矩阵盘点** | 14 个函数强度不一：MCP 系列/openrouter 严、signal-bus 共享密钥、letter/wechat 弱、tts 裸奔 | 统一到两种模式之一：① JWT 复验（`/auth/v1/user`）② 共享密钥 fail-closed；结论写进文档 | 全部 `supabase/functions/*` |
| 1-2 | **公共鉴权抽到 `_shared`** | `verifyAuth` / CORS / `getBeijingTimeString` 在多个函数各写一份，弱鉴权正是复制扩散的结果 | 抽公共实现到 `_shared/`，各函数引用同一份 | `supabase/functions/_shared/` |
| 1-3 | **调用额度护栏** | `llm_usage` 只记账无刹车；openrouter/letter/wechat/tts 无速率/日额度上限 | 入口加「按 user+天」计数与上限；建 `usage_quota` 表 | 上述 4 个函数 + 新表 |
| 1-4 | **`tts-audio` 桶权限** | 当前 public，靠链接难猜 | 敏感则改私有桶 + 签名 URL（原生上架前尤其） | Storage bucket `tts-audio` |

---

## P2 · Expo / iOS 迁移前必改（开 App 前定型）

| # | 事项 | 现状（Web/PWA） | 到 RN 的问题 | 目标 |
|:---:|:---|:---|:---|:---|
| 2-1 | **Push 通道** | Web Push：`push_subscriptions`(3) + VAPID + `public/sw.js` | iOS 原生收不到 Web Push，必须走 APNs | `push_subscriptions` 加 `platform` 列（web/expo/apns）；`letter-generate` 的 `sendPushToUser` 按 platform 分发；接 `expo-notifications` |
| 2-2 | **Auth session 存储** | `client.ts` 默认 localStorage + `detectSessionInUrl:true` | RN 无 localStorage | 换 `AsyncStorage`/`expo-secure-store`、`detectSessionInUrl:false`、引 `react-native-url-polyfill` |
| 2-3 | **登录流** | 邮箱 OTP 验证码（`verifyOtp` 6 位码） | 验证码方式原生可直接复用 ✅ | **保留验证码模式，不要切 magic link**（深链更麻烦） |
| 2-4 | **路由 / 跳转协议** | 全站 hash 路由 `/#/letters`，push `data.url='/letters'` 依赖它 | RN 无 hash 路由 | push payload 现在就改结构化 `{screen, params}`，Web + 原生共用一份跳转协议；换 React Navigation / Expo Router |
| 2-5 | **环境变量** | `import.meta.env.VITE_*` | Vite 专有 | 迁 `process.env.EXPO_PUBLIC_*` / `app.config`；注意 anon 可读敏感表在原生同样公网可读（P0 先收敛） |
| 2-6 | **CORS 依赖复核** | `_shared/mcp_common.ts` 靠 Origin 判断，原生无 Origin「恰好放行」 | 原生端访问控制全落在 JWT 复验上 | 确认 P0/P1 鉴权补齐后，原生路径才安全 |
| 2-7 | ⚠️ **云端孤儿函数收编进仓库** | `letter-generate`、`letter-check`、`wechat-reply`、`tts-generate` 只在云端，git 与 `config.toml` 均无 | 拉回源码入 `supabase/functions/`、登记 `config.toml`、走与其他函数相同的 CI 部署 | 本次最弱鉴权（0-3/0-4）恰好全在这 4 个脱管函数里，修它们前必须先收编，否则改动无版本管理。验收：`supabase/functions/` 与云端 `list_edge_functions` 一一对应 |

---

## P3 · RLS / 索引 性能批量整改（可穿插）

> 数据来源：Supabase performance advisor，共 271 条。

| # | 事项 | 数量 | 现状 | 目标 | 收益 |
|:---:|:---|:---:|:---|:---|:---|
| 3-1 | **`auth_rls_initplan`** | 140 | 老策略用裸 `auth.uid() = user_id`，逐行重算 | 统一改 `(select auth.uid())` | 大表（rp_messages 3914 / wechat_messages 2078 / checkin_logs 2351）实打实提速 |
| 3-2 | **`multiple_permissive_policies`** | 74 | 同(表,角色,操作)多条重叠策略逐条评估 | 合并为单条（`device_status` 的 3 条 SELECT 优先，兼消 P0 隐患） | 减少每行策略评估 |
| 3-3 | **`unindexed_foreign_keys`** | 15 | codex_tasks / novel_chapters / letters.conversation_id / wallet_transactions.quest_id 等外键无覆盖索引 | 补 15 个索引 | join / 级联删除提速 |
| 3-4 | **`duplicate_index`** | 2 | daily_status_digest、weekly_digest 各有一对完全相同索引 | 各删其一 | 降写入负担 |
| 3-5 | **`unused_index`** | 40 | 从未命中的索引 | 结合真实查询模式评估后删（勿一刀切） | 降写入负担 |

> 建议：3-1 与 3-2 可合并到**一次 migration** 批量处理，收益最大。改动前先在 dev branch（`create_branch`）重放验证。

---

## P4 · 结构收敛与卫生项（有余力再做）

| # | 事项 | 现状 | 目标 |
|:---:|:---|:---|:---|
| 4-1 | **Provider/Model 多表收敛** | `llm_providers`/`providers`、`enabled_models`/`provider_models` 职责相近（不同阶段引入） | 收敛成规范化 `model_bindings` 视图，前端 + Edge 统一读，去掉各端各自 join |
| 4-2 | **成本聚合视图** | `llm_usage`(93→未来上万) 每次全表扫 | 加按天聚合物化视图，支撑成本仪表盘 |
| 4-3 | **`thought_relations` 无策略** | RLS 开启但零策略（表空，靠 service_role 写） | 补 select 策略，或显式声明只走服务端 |
| 4-4 | **扩展迁出 public** | `pg_trgm` / `fuzzystrmatch` / `unaccent` 装在 public schema | 迁到 `extensions` schema |
| 4-5 | **单租户假设显式化** | 全库硬编码 `USER_ID='94dd24be…'` | 架构文档写明安全边界，防后续加表时遗忘对齐 |

---

## 建议执行方式

1. **每批开工前先 `create_branch`**：migrations 重放到干净库，验证前端没有依赖「anon 全读」的隐藏免登录路径，再合回主库。
2. **P0 一次一项、逐项校验**（每项都给了校验方式），避免一次动太多难回滚。
3. 需要把某一项落成具体 SQL migration / 函数改动时，单独开工单，本清单只做索引。
