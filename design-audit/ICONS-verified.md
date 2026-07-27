# Hamster Nest 默认功能图标清单（代码核对版 / ICONS-verified）

> 用途：记录仓鼠窝窝 21 个功能入口与 SVG 文件、页面语义及 Supabase 数据表的对应关系，作为 Claude Design 升级 Design System 和后续 Expo / Web 开发的共同输入。
>
> 当前版本已移除「来信 / Letters」，因此不再为该功能选择默认图标。
>
> **本文件为草稿 `Hamster-Nest-ICONS.md` 的核对版**：`page_key`、route、Supabase 表已按仓库 `00a79f7`（2026-07-26）实际代码逐项修正；页面显示名沿用草稿定名；SVG 文件名栏与 Phosphor 原名栏按草稿保留；所有图标选择状态保持「待选」。核对依据详见 `design-audit/page-icon-map.md`。

## 0. 本次核对结果摘要

- **page_key 的事实来源**：`src/pages/HomePage.tsx:262-293` 的主屏图标注册表 `appIcons[].id`（同时是布局排序键与自定义图标配置键）。代码使用**连字符**风格（如 `hamster-wallet`），未按数据库表名风格改名。
- 10 个 page_key 与草稿不同，已修正（对照见 §6）；11 个与草稿一致。
- Supabase 表映射已按页面真实查询链修正，主要改动：设置页不读 `providers/provider_models/channel_config/agent_settings/prompt_templates`（那些属于仓鼠机）；钱包页实际读 `wallet_balance/wallet_transactions/quests`；仓鼠机无 `codex_tasks` 查询；Wiki 的 `thought_relations` 前端未使用【待确认】。
- **SVG 文件名栏未改动**（草稿定名保留）。其中 10 个文件名不再与修正后的 page_key 同名，是否让 SVG 文件名跟随代码 page_key 重命名，属于设计交付决策——【待确认】，本审计不代为决定。
- 21 个入口全部默认图标现状均为 **Emoji**（无 SVG/图片默认图标），详见 `page-icon-map.md` §3。

## 1. 图标规范（沿用草稿，未改动）

- 图标来源：[Phosphor Icons](https://phosphoricons.com/)
- 默认样式：`Regular`
- 下载格式：普通 `SVG`（非 `SVG Raw`）
- 默认颜色：不在 SVG 中固定，由 Design Tokens 控制
- 文件命名：使用稳定的英文 `page_key`，多个单词用下划线连接（**注**：修正后的真实 page_key 存在连字符风格，与本条约定的关系见 §0【待确认】）
- 图标尺寸：由 Design Tokens 控制；SVG 文件本身须保留原始 `viewBox` 和宽高比例
- 已选定的 SVG 不允许在设计阶段擅自更换、重绘或改变语义；允许调整显示尺寸、主题颜色、容器背景及交互状态
- Phosphor Icons License：MIT

## 2. 使用方法（沿用草稿，未改动）

每选定一个图标，依次完成：

1. 从 Phosphor Icons 下载普通 `SVG`。
2. 记录它在 Phosphor 中的原始名称。
3. 将文件改名为下表中的「SVG 文件名」。
4. 把文件放进与本清单相同的图标文件夹。
5. 将「Phosphor 原名」和「选择状态」更新为实际内容。

建议文件夹结构：

```text
hamster-nest-icons/
├── ICONS.md
├── chat.svg
├── checkin.svg
├── memory.svg
├── snack.svg
└── ...
```

## 3. 21 个功能入口（page_key / route / Supabase 表已核对）

| 页面 | 页面显示名 | page_key（实测） | route（实测） | SVG 文件名 | 主要 Supabase 表（实测） | 关联 Supabase 表 / 说明（实测） | 当前默认图标 | Phosphor 原名 | 样式 | 选择状态 |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | 聊天 | `chat` | 图标动作跳最近会话 `/chat/:sessionId`；`/chat` 新建重定向 | `chat.svg` | `sessions`, `messages` | 来信上下文 `letters`, `letter_conversations`；边缘函数 `openrouter-chat` 使用 `compression_cache`；本地回退 `chatStorage` | 💬 | 待选 | Regular | 待选 |
| 1 | 打卡 | `checkin` | `/checkin` | `checkin.svg` | `checkins` | 主屏打卡 Widget 同表 | ✅ | 待选 | Regular | 待选 |
| 1 | 囤囤库 | `memory` | `/memory-vault` | `memory.svg` | `memory_entries` | 合并开关存 `user_settings`；提取走 `memory-extract` 边缘函数 | 🧠 | 待选 | Regular | 待选 |
| 1 | 零食链接 | `snacks` ⚠️ | `/snacks` | `snack.svg` | `snack_posts`, `snack_replies` | 记录用量到 `llm_usage`；代码内显示名为「零食罐罐」 | 🍪 | 待选 | Regular | 待选 |
| 1 | 仓鼠日志 | `syzygy` ⚠️ | `/syzygy` | `hamster_journal.svg` | `syzygy_posts`, `syzygy_replies` | 组件为 `SyzygyFeedPage.tsx`（注意与 Syzygy Feed 入口区分）；记录 `llm_usage` | 📘 | 待选 | Regular | 待选 |
| 1 | RP 房间 | `rp` ⚠️ | `/rp`（子路由 `/rp/:sessionId`、`/rp/:sessionId/dashboard`、`/rp/story-groups`） | `rp_room.svg` | `rp_sessions`, `rp_messages` | `rp_npc_cards`, `rp_session_groups`, `rp_story_groups` | 🎭 | 待选 | Regular | 待选 |
| 1 | 设置 | `settings` | `/settings` | `settings.svg` | `user_settings` | `auto_letter_config`, `special_dates`（页面直查）；`llm_providers`, `enabled_models`（模型管理）。草稿中 `providers/provider_models/channel_config/agent_settings/prompt_templates` 实属仓鼠机，已移出 | ⚙️ | 待选 | Regular | 待选 |
| 1 | 导出 | `export` | `/export` | `export.svg` | 无独占表 | 聚合直查：`sessions`, `messages`, `checkins`, `memory_entries`, `snack_posts`, `snack_replies`, `syzygy_posts`, `syzygy_replies`, `forum_threads`, `forum_replies` | 📦 | 待选 | Regular | 待选 |
| 2 | Forum | `forum` | `/forum`（子路由 `/forum/new`、`/forum/thread/:id`、`/forum/settings`） | `forum.svg` | `forum_threads`, `forum_replies` | `forum_ai_profiles`；发帖读 `memory_entries` 作 AI 上下文 | 💭 | 待选 | Regular | 待选 |
| 2 | 备忘录 | `memo` | `/memo` | `memo.svg` | `memo_entries` | `memo_tags`, `memo_entry_tags` | 📝 | 待选 | Regular | 待选 |
| 2 | 时间轴 | `timeline` | `/timeline` | `timeline.svg` | `timeline_entries` | `timeline_config` 仅用于聊天自动注入（非本页） | 🗓️ | 待选 | Regular | 待选 |
| 2 | To do | `todo` | `/todo` | `todo.svg` | `todos` | `todo_categories` | 🌷 | 待选 | Regular | 待选 |
| 2 | 学习库 | `knowledge` ⚠️ | `/knowledge` | `learning_library.svg` | `learning_nodes`, `learning_edges` | `knowledge_folders` | 🪺 | 待选 | Regular | 待选 |
| 2 | Wiki | `wiki` | `/wiki` | `wiki.svg` | `wiki_entries` | 草稿中 `thought_relations` 仅存在于 DB 类型定义，前端未查询【待确认】 | 📚 | 待选 | Regular | 待选 |
| 2 | 小说 | `novels` ⚠️ | `/novels` | `novel.svg` | `novel_books`, `novel_chapters` | 书架、章节及小说创作数据；记录 `llm_usage` | 📖 | 待选 | Regular | 待选 |
| 2 | 议事厅 | `council` | `/council` | `council.svg` | `agent_council` | `council_categories` | 🏛️ | 待选 | Regular | 待选 |
| 2 | 仓鼠客厅 | `lounge` ⚠️ | `/lounge`（子路由 `/lounge/:sofaId`） | `hamster_lounge.svg` | `lounge_sofas`, `lounge_messages` | `lounge_members`；回复状态轮询 `syzygy_commands` | 🛋️ | 待选 | Regular | 待选 |
| 2 | 仓鼠钱包 | `hamster-wallet` ⚠️ | `/wallet` | `hamster_wallet.svg` | `wallet_transactions`, `wallet_balance` | `quests`（钱包任务）。草稿中 `llm_usage`/`usage_quota` 本页未读取，已移出 | 💰 | 待选 | Regular | 待选 |
| 2 | 仓鼠机 | `hamster-console` ⚠️ | `/hamster-console` | `hamster_machine.svg` | `codex_control`, `agent_tasks` | 页面另直查 `syzygy_commands`, `agent_settings`, `capabilities`, `channel_config`, `providers`, `provider_models`, `prompt_templates`, `current_context_snapshot`, `daily_status_digest`, `pending_wechat_messages`, `print_capsules`；草稿的 `codex_tasks` 无前端查询；`agent_heartbeats`/`device_status` 仅边缘函数使用 | 🎛️ | 待选 | Regular | 待选 |
| 3 | Syzygy Feed | `syzygy-feed` ⚠️ | `/feed` | `syzygy_feed.svg` | `agent_feed_items` | 组件为 `AgentFeedPage.tsx`；月度总览同表聚合；`daily_status_digest`/`weekly_digest`/`print_capsules`/`ideas` 为内容生产侧（边缘函数/MCP），本页不直查 | 📮 | 待选 | Regular | 待选 |
| 3 | 系统档案 | `archive` ⚠️ | `/archive` | `system_archive.svg` | `archives`, `archive_categories` | 长期档案分类与条目；页面含粉/蓝双主题（`.archive-page--syzygy`） | 🗂️ | 待选 | Regular | 待选 |

> ⚠️ = page_key 与草稿不同，已按代码修正（对照见 §6）。「页面」列为主屏默认分页（1/2/3），来源 `src/pages/HomePage.tsx:57-68`。

## 4. 数据映射说明（按核对结果更新）

- 「主要 Supabase 表」表示该页面最直接读写的数据表；「关联 Supabase 表」为辅助配置、子实体、统计或内容来源。两栏均以前端真实查询链（`src/storage/*`、页面内 `supabase.from(...)`）为准，逐条可回溯到 `design-audit/page-icon-map.md`。
- `page_key` 已与代码对齐，**不等同于数据库表名**，也不再与 SVG 文件名一一同名（见 §0【待确认】）。
- 页面显示名沿用草稿中文定名；唯一的代码差异是「零食链接」在代码中显示为「零食罐罐」（`HomePage.tsx:272`）。
- 草稿要求复核的聚合型页面结论：`hamster_journal`→ 实为 `syzygy`（`/syzygy`，SyzygyFeedPage 组件）；`settings` 表清单已收窄；`export` 确认无独占表；`hamster_machine`→ 实为 `hamster-console`，表清单已按 13 张直查表更新。
- Letters 已从清单移除；但其代码（路由/页面/图标注册/推送）仍在仓库中，处置属后续改造【待确认】。

## 5. 交给 Claude Design 的约束（沿用草稿，未改动）

```text
本文件夹中的 SVG 是已选定的 Hamster Nest 默认功能图标。

请严格按照 ICONS.md 中的 page_key、页面显示名和页面语义使用图标：
1. 不更换图标库；
2. 不重新绘制或改变图标语义；
3. 不修改 SVG 的 viewBox 和宽高比例；
4. 允许通过 Design Tokens 调整尺寸、颜色、容器背景及交互状态；
5. 所有默认功能图标保持 Phosphor Regular 风格；
6. 用户自行上传的自定义图标属于另一条渲染路径，不覆盖本清单中的默认图标映射；
7. Tokens 文件是当前实现的审计输入，请在保留仓鼠窝核心视觉身份的前提下，将其整理为 Primitive、Semantic、Component 三层；
8. 输出升级后的 Tokens、图标使用规则、组件状态及页面布局规格。
```

## 6. page_key 修正对照表

| 草稿 page_key | 实测 page_key | 依据 |
|---|---|---|
| `snack` | `snacks` | `HomePage.tsx:272` |
| `hamster_journal` | `syzygy` | `HomePage.tsx:273` |
| `rp_room` | `rp` | `HomePage.tsx:274` |
| `learning_library` | `knowledge` | `HomePage.tsx:282` |
| `novel` | `novels` | `HomePage.tsx:284` |
| `hamster_lounge` | `lounge` | `HomePage.tsx:286` |
| `hamster_wallet` | `hamster-wallet` | `HomePage.tsx:287` |
| `hamster_machine` | `hamster-console` | `HomePage.tsx:288` |
| `syzygy_feed` | `syzygy-feed` | `HomePage.tsx:289` |
| `system_archive` | `archive` | `HomePage.tsx:290` |
| （其余 11 项） | 与草稿一致 | `HomePage.tsx:264-285` |
