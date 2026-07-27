# Hamster Nest 功能入口 × 图标 × 数据映射（代码实测版）

> 审计基线：commit `00a79f7`（2026-07-26）。
> **page_key 的事实来源**：主屏图标注册表 `appIcons`（`src/pages/HomePage.tsx:262-293`）中的 `id` 字段——这是主屏布局、图标自定义配置（`appIconConfigs`）与图标顺序（`iconOrder`）共用的键，即代码中真实存在的"页面 key"。路由注册见 `src/App.tsx:1975-2341`。路由采用 **HashRouter**（`src/main.tsx:19`），实际 URL 形如 `/#/checkin`。
> Supabase 表映射来自页面源码中的真实查询链（页面 → `src/storage/*` / 直接 `supabase.from(...)`），逐条可回溯。

## 1. 21 个功能入口总表

| # | 页面显示名 | 实际 page_key | route/path | 页面源码 | 主要 Supabase 表 | 当前默认图标 | 自定义图标机制 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | 聊天 | `chat` | 无直连路由：图标走 `action: onOpenChat` → 跳最近会话 `/chat/:sessionId`（无会话则新建）；`/chat` 为新会话重定向 | `src/pages/ChatPage.tsx`（路由 `src/App.tsx:2038-2049, 2094-2127`；入口行为 `src/App.tsx:2000-2009`） | `sessions`、`messages`（`src/storage/supabaseSync.ts`；本地回退 `src/storage/chatStorage.ts`）；会话关联来信上下文 `letters`、`letter_conversations`（`fetchLettersByConversation`）；后端 `openrouter-chat` 边缘函数读写 `compression_cache`（`supabase/functions/openrouter-chat/index.ts:607,636`） | Emoji 💬（`HomePage.tsx:264`） | ✅（见 §3 通用机制） | 有 `ios`/`pixel` 双聊天主题（`src/App.tsx:2123`） |
| 2 | 打卡 | `checkin` | `/checkin` | `src/pages/CheckinPage.tsx`（路由 `src/App.tsx:2128-2135`） | `checkins`（`createTodayCheckin`/`fetchRecentCheckins`/`fetchCheckinTotalCount`） | Emoji ✅（`HomePage.tsx:265`） | ✅ | 主屏打卡 Widget 同样读写 `checkins`（`HomePage.tsx:12-16`） |
| 3 | 囤囤库 | `memory` | `/memory-vault` | `src/pages/MemoryVaultPage.tsx`（路由 `src/App.tsx:2206-2221`） | `memory_entries`；开关存 `user_settings`（`loadMemoryMergeEnabled`）；提取走 `memory-extract` 边缘函数 | Emoji 🧠（`HomePage.tsx:267-271`） | ✅ | |
| 4 | 零食链接 | `snacks` | `/snacks` | `src/pages/SnacksPage.tsx`（路由 `src/App.tsx:2197-2204`） | `snack_posts`、`snack_replies`（+ `llm_usage` 用量记录） | Emoji 🍪（`HomePage.tsx:272`） | ✅ | **代码中显示名为「零食罐罐」**（`HomePage.tsx:272`），与清单用名「零食链接」不同，见 §4-3 |
| 5 | 仓鼠日志 | `syzygy` | `/syzygy` | `src/pages/SyzygyFeedPage.tsx`（路由 `src/App.tsx:2222-2229`） | `syzygy_posts`、`syzygy_replies`（+ `llm_usage`） | Emoji 📘（`HomePage.tsx:273`） | ✅ | 组件名叫 SyzygyFeedPage 但**不是** Syzygy Feed 入口（那是 `/feed`，见 #20）；易混淆，命名沿代码事实记录 |
| 6 | RP 房间 | `rp` | `/rp`；子路由 `/rp/:sessionId`、`/rp/:sessionId/dashboard`、`/rp/story-groups` | `src/pages/RpRoomsPage.tsx`、`RpRoomPage.tsx`、`StoryGroupPage.tsx`（路由 `src/App.tsx:2144-2175`） | `rp_sessions`、`rp_messages`、`rp_npc_cards`；剧情分组 `rp_story_groups`、`rp_session_groups`（StoryGroupPage）；RP 压缩缓存由边缘函数处理（`RpRoomPage.tsx:428` 日志提及 compression_cache） | Emoji 🎭（`HomePage.tsx:274`） | ✅ | |
| 7 | 设置 | `settings` | `/settings` | `src/pages/SettingsPage.tsx`（路由 `src/App.tsx:2176-2196`） | `user_settings`（主）、`auto_letter_config`、`special_dates`（页面直查）；模型管理 `llm_providers`、`enabled_models`（`src/storage/llmProviders.ts`） | Emoji ⚙️（`HomePage.tsx:275`） | ✅ | 草稿中的 `providers/provider_models/channel_config/agent_settings/prompt_templates` 实际属于仓鼠机（#19） |
| 8 | 导出 | `export` | `/export` | `src/pages/ExportPage.tsx`（路由 `src/App.tsx:2136-2143`） | 无独占表；直查聚合：`sessions`、`messages`、`checkins`、`memory_entries`、`snack_posts`、`snack_replies`、`syzygy_posts`、`syzygy_replies`、`forum_threads`、`forum_replies`（均在 `ExportPage.tsx` 内直查） | Emoji 📦（`HomePage.tsx:276`） | ✅ | |
| 9 | Forum | `forum` | `/forum`；子路由 `/forum/new`、`/forum/thread/:id`、`/forum/settings` | `src/pages/ForumPage.tsx`、`ForumNewThreadPage.tsx`、`ForumThreadPage.tsx`、`ForumSettingsPage.tsx`（路由 `src/App.tsx:2050-2081`） | `forum_threads`、`forum_replies`、`forum_ai_profiles`；发帖/回帖时读 `memory_entries` 作为 AI 上下文 | Emoji 💭（`HomePage.tsx:277`） | ✅ | 像素风页面（VT323/DotGothic16 字体，`ForumPage.css:1`） |
| 10 | 备忘录 | `memo` | `/memo` | `src/pages/MemoPage.tsx`（路由 `src/App.tsx:2238-2245`） | `memo_entries`、`memo_tags`、`memo_entry_tags` | Emoji 📝（`HomePage.tsx:279`） | ✅ | 聊天注入检索另走 `src/utils/memoRetrieval.ts`（同三表） |
| 11 | 时间轴 | `timeline` | `/timeline` | `src/pages/TimelinePage.tsx`（路由 `src/App.tsx:2282-2289`） | `timeline_entries`；`timeline_config` 仅被聊天自动注入使用（`src/utils/timelineAutoInject.ts:85,90`，非本页读写） | Emoji 🗓️（`HomePage.tsx:280`） | ✅ | |
| 12 | To do | `todo` | `/todo` | `src/pages/TodoPage.tsx`（路由 `src/App.tsx:2290-2297`） | `todos`、`todo_categories` | Emoji 🌷（`HomePage.tsx:281`） | ✅ | |
| 13 | 学习库 | `knowledge` | `/knowledge` | `src/pages/KnowledgeLibraryPage.tsx`（懒加载，路由 `src/App.tsx:2330-2339`） | `learning_nodes`、`learning_edges`、`knowledge_folders`（页面直查） | Emoji 🪺（`HomePage.tsx:282`） | ✅ | 知识图谱用 react-force-graph-2d，按需加载（`App.tsx:163-165`） |
| 14 | Wiki | `wiki` | `/wiki` | `src/pages/WikiPage.tsx`（路由 `src/App.tsx:2322-2329`） | `wiki_entries`；草稿提到的 `thought_relations` 存在于 DB 类型定义（`src/supabase/database.types.ts:2926`）但**前端无任何查询**——【待确认】 | Emoji 📚（`HomePage.tsx:283`） | ✅ | |
| 15 | 小说 | `novels` | `/novels` | `src/pages/NovelPage.tsx`（路由 `src/App.tsx:2314-2321`） | `novel_books`、`novel_chapters`（+ `llm_usage`） | Emoji 📖（`HomePage.tsx:284`） | ✅ | 阅读器用系统衬线字体栈（`NovelPage.css:80,85`） |
| 16 | 议事厅 | `council` | `/council` | `src/pages/AgentCouncilPage.tsx`（路由 `src/App.tsx:2246-2253`） | `agent_council`、`council_categories` | Emoji 🏛️（`HomePage.tsx:285`） | ✅ | |
| 17 | 仓鼠客厅 | `lounge` | `/lounge`；子路由 `/lounge/:sofaId` | `src/pages/LoungePage.tsx`、`LoungeRoomPage.tsx`（路由 `src/App.tsx:2262-2281`） | `lounge_sofas`、`lounge_messages`、`lounge_members`；回复状态轮询 `syzygy_commands`（`src/hooks/useLoungeReplyStatus.ts`，用于 `LoungeRoomPage.tsx:92`）（+ `llm_usage`） | Emoji 🛋️（`HomePage.tsx:286`） | ✅ | 角色色板在 `src/constants/loungeRoles.ts` |
| 18 | 仓鼠钱包 | `hamster-wallet` | `/wallet` | `src/pages/WalletPage.tsx`（路由 `src/App.tsx:2306-2313`） | `wallet_balance`、`wallet_transactions`、`quests`（任务）；草稿写的 `llm_usage`/`usage_quota` 本页**未读取**（`llm_usage` 由各 AI 页面写入、`usage_quota` 仅边缘函数使用）——已按代码修正 | Emoji 💰（`HomePage.tsx:287`） | ✅ | page_key 为连字符 `hamster-wallet`（非下划线） |
| 19 | 仓鼠机 | `hamster-console` | `/hamster-console` | `src/pages/HamsterConsolePage.tsx`（路由 `src/App.tsx:2298-2305`） | 页面直查 13 表：`codex_control`、`syzygy_commands`、`agent_tasks`、`agent_settings`、`capabilities`、`channel_config`、`providers`、`provider_models`、`prompt_templates`、`current_context_snapshot`、`daily_status_digest`、`pending_wechat_messages`、`print_capsules`；草稿写的 `codex_tasks` 前端不存在（DB 里有该表但无查询）；`agent_heartbeats`/`device_status` 仅边缘函数（`device-report`、`wechat-reply`）使用 | Emoji 🎛️（`HomePage.tsx:288`） | ✅ | page_key 为 `hamster-console`（非 `hamster_machine`） |
| 20 | Syzygy Feed | `syzygy-feed` | `/feed` | `src/pages/AgentFeedPage.tsx`（路由 `src/App.tsx:2230-2237`） | `agent_feed_items`（`src/lib/agentFeed.ts`；含月度总览聚合）；主屏第 3 页的入口卡片 `SyzygyFeedEntryCard` 同样读 `agent_feed_items` | Emoji 📮（`HomePage.tsx:289`） | ✅ | 组件名 AgentFeedPage；与 #5 的 SyzygyFeedPage 互为"名不对版"，注意区分 |
| 21 | 系统档案 | `archive` | `/archive` | `src/pages/ArchivePage.tsx`（路由 `src/App.tsx:2254-2261`） | `archives`、`archive_categories` | Emoji 🗂️（`HomePage.tsx:290`） | ✅ | 页面自带粉/蓝双主题（`.archive-page--syzygy`，`ArchivePage.css:3-13,29-41`） |

✅ 共 21 项，无 Letters。

## 2. 入口之外的路由（供迁移时参考，不属于 21 入口）

| route | 组件 | 说明 |
|---|---|---|
| `/`（主屏）与 `/home`→`/` | `HomePage`（`src/App.tsx:1993-2017`） | 图标网格 + Widget；打卡 Widget 读写 `checkins` |
| `/home-layout` | `HomeLayoutSettingsPage`（`src/App.tsx:2018-2037`） | 主屏布局/图标编辑页（HomePage 的 `mode="settings"` 包装） |
| `/auth` | `AuthPage`（`src/App.tsx:1976`) | 登录 |
| `/letters` | `LettersPage`（`src/App.tsx:2082-2093`） | **Letters 遗留页面，见 §4-1** |
| `/conversation-canary`、`/runtime-control-canary` | Canary 调试页（`src/App.tsx:1977-1992`） | 内部诊断 |
| `*` | 重定向 `/`（`src/App.tsx:2340`） | 兜底 |
| （非路由）游戏模式 | `GameModeShell`（懒加载，`src/App.tsx:163,1940-1956`） | Phaser 像素房间，displayMode='game' 时替换整个路由树；气泡聊天读写 `bubble_sessions`、`bubble_messages`（`src/storage/supabaseSync.ts`） |

## 3. 默认图标与自定义图标机制（Web 现状，全部入口通用）

**默认图标**：21 个入口全部是 **Emoji 字符**（无 SVG/图片默认图标），定义在 `src/pages/HomePage.tsx:262-293` 的 `appIcons[].defaultEmoji`。渲染时作为文本节点输出（`HomePage.tsx:1693`）。

**配置数据结构**（`src/storage/homeLayout.ts:22-31`）：

```ts
type AppIconConfig =
  | { type: 'emoji'; emoji: string }
  | { type: 'image'; imageKey?: string; imageDataUrl?: string }
```

按主屏分页存储于 `HomeSettingsState.pageLayouts[page1|page2|page3].appIconConfigs[page_key]`。

**自定义流程**：
1. **入口**：`/home-layout` 编辑模式 → 「编辑图标」面板（`HomePage.tsx:1359-1418`）：可自由输入 Emoji（maxLength=4，`HomePage.tsx:1380-1392`）、「上传本地图标」（`HomePage.tsx:1395-1416`）或「恢复默认」（`handleResetAppIcon`，`HomePage.tsx:1081-1091`）。
2. **上传**：`handleAppIconImageSelected`（`HomePage.tsx:1053-1079`）→ FileReader 转 DataURL（图标不压缩、不裁剪）→ `saveImageDataUrl(dataUrl, createImageKey())`。
3. **存储**：图片存 **IndexedDB** `hamster-home-db` / object store `home_assets`（`homeLayout.ts:63-65`），失败回退 localStorage `hamster_home_assets_fallback_v1`（`homeLayout.ts:66,151-161`）；布局与图标配置整体 JSON 存 localStorage `hamster_widget_prefs_v1`（`homeLayout.ts:60,341-379`，含 `imageDataUrl` 冗余副本）。**完全不经过 Supabase，纯设备本地**。
4. **回显**：`appIconConfigs` 变化时按 `imageKey` 从 IndexedDB 异步取 DataURL 装入 `appIconImageUrls`（`HomePage.tsx:700-775`）；渲染优先级 = 自定义图片 `<img class="icon-image">` > 自定义 emoji > 默认 emoji（`HomePage.tsx:1634-1695`）。
5. **附带机制**：主屏背景图上传（canvas 缩到宽 ≤1080、webp@0.86，`HomePage.tsx:133-155`）与装饰 Widget 图片（≤1800px、webp@0.84，`HomePage.tsx:76-77`）走同一 IndexedDB 存储；`letters` 图标上有未读红点 `app-icon-notification-dot`（`HomePage.tsx:1683-1685`）。

**迁移到 Expo 时需要保留的行为**：
- 「默认 emoji → 自定义 emoji → 自定义图片」三态与「恢复默认」；
- 图标配置按 page1/2/3 分页存储、跟随 `iconOrder` 拖拽排序；
- 本地持久化语义（当前 IndexedDB+localStorage 需替换为 AsyncStorage/FileSystem 或改为 Supabase Storage 同步——【待确认技术方案】）；
- 上传图片的原比例展示（Web 端未做裁剪/压缩）；
- Letters 未读红点逻辑若随 Letters 移除则一并处理【待确认】。

## 4. 与草稿/清单不一致、需要记录的事实

1. **Letters 仍完整存在于代码**：路由 `/letters`（`App.tsx:2082-2093`）、`LettersPage.tsx/.css`、图标注册（`HomePage.tsx:278`，💌）、默认 page2 布局含 `letters`（`HomePage.tsx:67`）、实时订阅+Toast（`App.tsx:347-407`）、SW 推送落点 `/#/letters`（`public/sw.js`）、边缘函数 `letter-check`/`letter-generate`。本审计按要求未将其计入 21 入口；代码层面的移除属于后续改造范围【待确认】。
2. **两份默认布局配置不一致**：`src/storage/homeLayout.ts:69-94`（page2 共 9 项，缺 `todo/knowledge/lounge`）vs `src/pages/HomePage.tsx:57-68`（page2 共 12 项）。实际生效以 HomePage 的解析回退链为准，但这是一处代码级重复配置。
3. **「零食链接」在代码里叫「零食罐罐」**（`HomePage.tsx:272`）。本表"页面显示名"列沿用清单定名，代码事实已在备注注明。
4. **page_key 命名风格**：代码用连字符（`hamster-wallet/hamster-console/syzygy-feed`），草稿用下划线（`hamster_wallet/hamster_machine/syzygy_feed`）——以代码为准，未做任何改名。
5. `syzygy`（仓鼠日志页，组件 SyzygyFeedPage）与 `syzygy-feed`（Syzygy Feed 页，组件 AgentFeedPage）的 key/组件名交叉容易误读，映射以本表为准。
