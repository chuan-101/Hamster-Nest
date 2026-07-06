# 安全边界与鉴权矩阵

> 更新日期：2026-07-06 · 对应 `docs/supabase-architecture-review.md` 的整改落地记录
> 涵盖：4-5 单租户安全边界 · 1-1 Edge Function 鉴权矩阵 · 1-3 额度护栏 · 2-4 push 协议 · 3-5 未用索引评估

## 安全模型（一句话）

**边界 = Auth 注册白名单（已锁）+ anon 零暴露面（已收敛）+ Edge Function 鉴权（已统一）**。

## 单租户假设（4-5）

本系统是**单租户**应用：全库硬编码 `USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'`（业主本人）。

- Auth 后台已关闭自助注册；邮箱 OTP 只对业主邮箱放行 → `authenticated` 角色 ≈ 业主本人。
- `anon` 角色 = 公网。anon key 随前端发布，等于公开常量，**任何策略都不得向 anon 授予读写**。
  2026-07-06 起 anon 在 public schema 的读写面为零：iOS 快捷指令已切换到 `device-report`
  函数（当日 03:03 验证落数），`device_status` 的 anon INSERT 策略随即删除；
  全库扫描时又发现 `quests` / `wallet_transactions` / `wechat_messages` 三张表存在
  「`{public}` + 硬编码 owner UUID」的旧模式（评审清单遗漏项，与 `checkin_logs` 同型），已一并收紧为 authenticated。
- **加表守则**：新表默认 RLS 开启、零 anon 策略；authenticated 策略统一用
  `(select auth.uid()) = user_id` 形式（initplan 优化，见 3-1 migration）。
- **加函数守则**：从 `_shared/auth.ts` 引 `verifyAuth`（或机器调用方用 `verifySharedSecret`），
  在 `config.toml` 登记 `verify_jwt = false`（网关不支持 ES256，鉴权必须在函数内完成），
  禁止任何「长得像 JWT 就放行」的模式匹配兜底。

## Edge Function 鉴权矩阵（1-1）

统一后只有三种模式，全部 fail-closed：

| 模式 | 实现 | 适用 |
|:---|:---|:---|
| **A · 服务密钥** | `_shared/auth.ts` 的 timing-safe 精确比对 | cron、Mac mini agent、函数间调用 |
| **B · 用户 JWT 复验** | `/auth/v1/user` 真实验签（`_shared/auth.ts` / `mcp_common.ts` / 各函数内置） | Web 前端（未来 Expo 同路径） |
| **C · 共享密钥** | header / query 参数 timing-safe 比对 | 不持 Supabase key 的机器调用方 |

| 函数 | 鉴权 | 额度 | 备注 |
|:---|:---|:---:|:---|
| `openrouter-chat` | B（内置复验） | 1000/天 | 额度检查随下次 main 合并部署 |
| `openrouter-models` | B（内置复验） | – | |
| `memory-extract` | B（内置复验） | – | |
| `hamster-mcp` ×5 | B 或 C（`HAMSTER_MCP_KEY`），`mcp_common.ts` 统一 | – | CORS 白名单另加一层 |
| `signal-bus-consumer` | 共享密钥（信任调用方模式） | – | 仅 cron/函数间调用 |
| `letter-generate` | **A/B（2026-07-06 修复）** | 50/天 | 曾有 eyJ 前缀兜底 + serviceKeyPrefix 日志泄漏，均已删除。**产品已弃用（2026-06），函数封存待 V4.0 重构**，护栏保留 |
| `letter-check` | **A/B（2026-07-06 修复）** | – | 同上；GitHub cron 已删除，无调用方 |
| `wechat-reply` | **A/B（2026-07-06 修复）** | 500/天 | 同上 |
| `tts-generate` | **A/B（2026-07-06 新增）** | 200/天 | 原先完全裸奔；前端调用已补 session JWT |
| `device-report` | **C（`DEVICE_REPORT_SECRET`，2026-07-06 新建）** | – | iOS 快捷指令上报通道，替代 anon 直写 |

额度护栏（1-3）：`usage_quota` 表 + `consume_usage_quota(user, scope)`，按北京时区自然日计数。
护栏**失败时放行**（fail-open）并打日志——它是成本刹车，不是鉴权门；鉴权在它之前已完成。
上限是各函数内的常量，调整改代码即可，无需动 DDL。

## Push 跳转协议（2-4 / 2-1）

Push payload 携带结构化跳转契约，Web 与未来 Expo 共用：

```json
{ "screen": "letters", "params": {}, "url": "/#/letters" }
```

- `screen` + `params` 是权威字段；原生端把 screen 名映射到自己的导航器。
- `url` 仅作 Web 兜底；`sw.js` 的 `SCREEN_ROUTES` 表负责 screen → hash 路由。
- `push_subscriptions.platform ∈ {web, expo, apns}`（默认 web）；
  `letter-generate` 按 platform 分发，expo/apns 通道待原生 App 接入。

## Storage（1-4）

`tts-audio` 桶已转**私有**；`hamster-life-mcp` 的 `generate_tts` 改发 7 天签名 URL。
转私有时桶内仅 5 个对象、微信/outbound 消息中零引用，旧公开链接失效无实际影响。

## 未用索引评估清单（3-5 · 不删，先观察）

Advisor 快照（2026-07-06）中从未命中的 39 个既有索引如下，**建议积累 30 天以上真实流量后复查再删**
（部分索引服务于低频路径：全文搜索、标签过滤、批量打印排序等，"未命中"≠"无用"）：

`agent_council`: idx_agent_council_parent_created / status_created / user_created ·
`agent_feed_items`: expiry / metadata / pinned / priority_unread ·
`agent_tasks`: idx_agent_tasks_parent ·
`archive_categories`: idx_archive_categories_parent ·
`archives`: idx_archives_keywords ·
`capabilities`: idx_capabilities_enabled_cooldown ·
`compression_cache`: compression_cache_updated_at_idx ·
`enabled_models`: idx_enabled_models_provider ·
`forum_ai_profiles`: forum_ai_profiles_user_id_idx ·
`ideas`: idx_ideas_category / status ·
`learning_edges`: idx_learning_edges_type ·
`learning_nodes`: idx_learning_nodes_tags / type ·
`llm_usage`: idx_llm_usage_created_at / module ·
`lounge_messages`: idx_lounge_messages_sofa ·
`memo_entries`: is_deleted / is_pinned / updated_at ·
`print_capsules`: idx_print_capsules_batch_sort ·
`syzygy_signals`: created_at / signal_type / user_id ·
`thought_relations`: from / to ·
`timeline_entries`: recorder / source / user_id ·
`wallet_transactions`: idx_wallet_tx_created_at / type ·
`wiki_entries`: category / search / tags

（2026-07-06 新建的 15 个外键覆盖索引不在评估范围——它们刚创建，未命中属预期。）

## Letter 功能半退役（2026-07-06 工单）

「每日定时生成」模式确认弃用（微信桥取代，`letters` 最后写入 2026-04-19）；
「主动来信」需求保留，待 V4.0 原生 App 的 APNs 推送落地后重构（届时可能融入聊天流）。

- **已删除**：GitHub Actions `auto-letter-cron.yml`；GitHub Secret `SUPABASE_SERVICE_KEY`
  仅服务该 cron（已核实无其他引用），可在仓库 Settings → Secrets 中删除。
- **保留**：`letters` / `letter_conversations` / `auto_letter_config` 三张表
  （115 封历史信件为记忆资产，不归档不清理）；`letter-generate` / `letter-check`
  两函数在线封存（源码标 DEPRECATED，作重构参考实现）；`usage_quota` 的 letter 额度。

## 尚未完成 / 有意留白

- **P2 原生侧**：2-2（AsyncStorage/secure-store）、2-5（`EXPO_PUBLIC_*`）、2-1 客户端半边（expo-notifications + APNs）随 Expo 项目落地。
- **4-1** Provider/Model 多表收敛、**4-4** 扩展迁出 public schema：大改动，单独开工单。
- **密钥轮换**：`~/wechat-agent-channel/` 僵尸目录曾以明文存有 service_role key，清理后建议在
  Dashboard 轮换 service key（轮换会同时使 mini-agent / GitHub Secrets 里的旧 key 失效，需同步更新）。
