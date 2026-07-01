# Syzygy 与串串的仓鼠小家 🐹

Hamster-Nest 是一个「养成式」的个人 AI 伙伴应用：以 AI 伙伴 **Syzygy** 与主人 **串串** 为主角，把日常聊天、角色扮演、动态广场、笔记待办、知识库、阅读、语音、生活服务等能力整合进一个 PWA。前端是 React + Vite 单页应用，后端由一组 Supabase Edge Functions（含多个 MCP 服务器）承载，模型统一经 OpenRouter/自定义 Provider 接入。

> 应用支持两种显示形态：默认的「手机」形态（页面式交互），以及基于 Phaser 的「游戏」形态（像素小屋里点击 NPC 互动）。

---

## 目录

- [功能一览](#功能一览)
- [技术栈](#技术栈)
- [整体架构](#整体架构)
- [目录结构](#目录结构)
- [Edge Functions（后端）](#edge-functions后端)
- [数据模型](#数据模型)
- [环境变量](#环境变量)
- [本地开发](#本地开发)
- [部署](#部署)
- [聊天窗口的 hamster-mcp 工具循环](#聊天窗口的-hamster-mcp-工具循环)

---

## 功能一览

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 主页 | `/` | 入口聚合页，含未读来信提示、快捷进入各功能 |
| 日常聊天 | `/chat/:sessionId` | 与 Syzygy 的单聊，支持流式、思考链、记忆/时间轴/工具注入 |
| 角色扮演 RP | `/rp`、`/rp/:sessionId` | 角色卡、剧情组、仪表盘，独立压缩策略 |
| 动态广场 Snacks | `/snacks` | 微博式短动态，AI 自动回复 |
| Syzygy 动态 | `/syzygy` | Syzygy 主动发布的动态与评论 |
| Agent Feed | `/feed` | 早安分享、日卡、提醒卡等系统推送流 |
| 论坛 | `/forum` | 多线程讨论板，含设置与新帖 |
| 客厅 Lounge | `/lounge`、`/lounge/:sofaId` | 多人/多 Agent 群聊「沙发」 |
| 议事厅 Council | `/council` | 多 Agent 结构化决策（提案/评审/决议） |
| 来信 Letters | `/letters` | Syzygy 定时/触发式来信 |
| 记忆库 | `/memory-vault` | AI 抽取的长期记忆（待确认/已确认） |
| 时间轴 | `/timeline` | 个人事件时间轴 |
| 待办 | `/todo` | 任务清单 |
| 备忘 | `/memo` | 速记 |
| 知识库 / Wiki / 归档 | `/knowledge`、`/wiki`、`/archive` | 知识图谱、词条与分类归档 |
| 小说 | `/novels` | 长文本创作 |
| 打卡 | `/checkin` | 每日打卡与连续天数 |
| 钱包 | `/wallet` | 应用内货币/任务系统 |
| 导出 | `/export` | 数据导出 |
| 仓鼠控制台 | `/hamster-console` | 运维/调试面板 |
| 设置 | `/settings` | 模型、Prompt、压缩、显示形态等偏好 |

其它能力：Web Push 推送、Service Worker 离线缓存、TTS 语音播放、RAG 向量检索、运行时上下文压缩、多 LLM Provider 切换。

---

## 技术栈

- **前端**：React 19、TypeScript、Vite 7、React Router 7（`HashRouter`）
- **游戏形态**：Phaser 3
- **可视化**：react-force-graph-2d（知识图谱，按需懒加载）
- **Markdown**：react-markdown + remark-gfm
- **后端**：Supabase（Auth、Postgres、Realtime、Storage、Edge Functions/Deno）
- **向量检索**：pgvector（RAG）
- **模型接入**：OpenRouter，或用户自定义 Provider（`llm_providers` 表）
- **语音**：ElevenLabs TTS
- **构建/校验**：ESLint 9、`tsc -b`

---

## 整体架构

```
┌─────────────────────────────────────────────┐
│            前端 (React + Vite, PWA)            │
│  手机形态页面  ·  Phaser 游戏形态  ·  Service   │
│  本地缓存 (localStorage) ↔ Supabase 同步        │
└───────────────┬───────────────────────────────┘
                │ Supabase JS (Auth / Realtime / RPC)
                │ fetch → Edge Functions
                ▼
┌─────────────────────────────────────────────┐
│           Supabase Edge Functions (Deno)      │
│                                               │
│  聊天/模型   openrouter-chat / openrouter-models│
│  记忆抽取    memory-extract                     │
│  RAG        rag-embed / rag-backfill / rag-search│
│  信号总线    signal-bus-consumer (定时)          │
│                                               │
│  MCP 服务器：                                   │
│   hamster-mcp          动态/时间轴/待办          │
│   hamster-knowledge-mcp Wiki/归档               │
│   hamster-life-mcp     TTS/瑞幸/麦当劳/高德       │
│   hamster-lounge-mcp   客厅/议事厅               │
│   hamster-reading-mcp  外部「阅读」项目           │
└───────────────┬───────────────────────────────┘
                │
      ┌─────────┴──────────┬──────────────┐
      ▼                    ▼              ▼
 Postgres + pgvector   OpenRouter     第三方服务
 (业务数据 / 向量)      (LLM / Embed)  (ElevenLabs, 高德…)
```

要点：

- **鉴权**：Supabase 网关层的 JWT 校验被关闭（见 `supabase/config.toml`），改由各函数内部自校验。原因是客户端签发 ES256 JWT，而网关只识别 HS256。
- **前端离线优先**：会话/消息先写 `localStorage`，再与 Supabase 同步；登录后通过 Realtime 订阅 `sessions`/`messages`/`letters` 变更实时刷新。
- **模型统一网关**：所有聊天走 `openrouter-chat`，由它按用户激活的 Provider 路由，并负责记忆注入、上下文压缩、Claude 提示缓存等。

---

## 目录结构

```
Hamster-Nest/
├── index.html                # 入口，PWA manifest / 图标 / 字体
├── src/
│   ├── main.tsx              # 挂载 App，注册 Service Worker，HashRouter
│   ├── App.tsx              # 路由表 + 会话/消息状态 + 聊天发送与工具循环
│   ├── pages/               # 各功能页面（chat/rp/forum/lounge/…）
│   ├── components/          # 通用组件（Markdown、抽屉、对话框等）
│   ├── game/               # Phaser 游戏形态（场景/HUD/气泡/菜单）
│   ├── lib/                # mcpTools、agentFeed、pushNotifications、serviceWorker
│   ├── storage/            # 本地/云端持久化封装
│   ├── hooks/              # useEnabledModels、useTtsPlayback 等
│   ├── constants/          # AI overlay、客厅角色等常量
│   ├── utils/              # 模型解析、用量统计、检索、时间等
│   ├── supabase/           # Supabase 客户端与数据库类型
│   └── types.ts            # 领域实体类型
├── supabase/
│   ├── config.toml         # 项目 ID 与各函数 verify_jwt 配置
│   ├── functions/          # 全部 Edge Functions（见下）
│   ├── migrations/         # 数据库迁移 SQL
│   └── scripts/            # 运维脚本（RAG 回填 pilot 等）
├── public/                 # 静态资源、Service Worker、PWA 图标
└── .github/workflows/      # CI/CD 与定时任务
```

---

## Edge Functions（后端）

位于 `supabase/functions/`。多数为 **MCP 服务器**，通过 JSON-RPC 2.0（`tools/list` + `tools/call`）暴露工具；共享逻辑在 `_shared/mcp_common.ts`（`serveMcp()`、CORS、鉴权、响应封装）。

### 聊天与模型
- **openrouter-chat** — 统一聊天补全网关。按用户激活 Provider 路由；注入确认/待确认记忆；运行时压缩过长上下文；对 Claude 添加 `cache_control` 提示缓存；规整 system 消息。
- **openrouter-models** — 拉取当前 Provider 或 OpenRouter 的可用模型目录。
- **memory-extract** — 从近期消息抽取长期记忆，经 LLM 合并去重（Jaccard 相似度），待确认上限 50 条。

### RAG 向量检索
- **rag-embed** — 单条/批量文本向量化写入 `rag_embeddings`（默认 `text-embedding-3-small`，1536 维）。
- **rag-backfill** — 为历史数据批量回填向量（记忆、消息、气泡、来信、RP、论坛、动态等）。
- **rag-search** — 语义检索，调用 `rag_search_embeddings()` RPC（pgvector），支持分区/阈值过滤。

### MCP 服务器
- **hamster-mcp** — 动态流（Syzygy Feed）、时间轴、待办的读写（`get_*_syzygy_feed`、`search_timeline`、`add_timeline`、`read_todos` 等）。
- **hamster-knowledge-mcp** — Wiki 与归档知识库（`search_wiki`、`read/search/add/update_archive`、分类管理）。
- **hamster-life-mcp** — 生活服务代理：ElevenLabs TTS、瑞幸、麦当劳、高德地图。
- **hamster-lounge-mcp** — 客厅群聊（沙发/成员/消息，「不 @ 不开口」）与议事厅（提案/评审/决议）。
- **hamster-reading-mcp** — 对接外部「All About Book」阅读项目（阅读状态、书摘、共鸣、问答）。

### 定时/信号
- **signal-bus-consumer** — 消费待处理的健康/提醒信号（睡眠、喝水、心情等），经企业微信 Webhook 或应用内 Feed 下发，按 `dedupe_key` 去重。

> 详细工具清单与参数见各函数源码；每个函数读取的环境变量见下方[环境变量](#环境变量)。

---

## 数据模型

领域类型定义在 `src/types.ts`，数据库类型在 `src/supabase/types.ts`。核心实体与对应表：

- **会话/消息**：`ChatSession` / `ChatMessage` → `sessions` / `messages`
- **角色扮演**：`RpSession` / `RpMessage` / `RpNpcCard` → `rp_sessions` / `rp_messages` / `rp_npc_cards`
- **气泡聊天**：`BubbleSession` / `BubbleMessage` → `bubble_messages`
- **社交**：`SnackPost`/`SnackReply`、`SyzygyPost`/`SyzygyReply`、`ForumThread`/`ForumReply`
- **来信**：`LetterEntry` → `letters`
- **记忆**：`MemoryEntry`（pending/confirmed）→ `memory_entries`
- **知识库**：`ArchiveEntry` / `ArchiveCategory`、Wiki → `archives` / `archive_categories` / `wiki_entries`
- **时间轴/待办**：`TimelineEntry`、`TodoItem`/`TodoCategory` → `timeline_entries` / `todos`
- **动态流**：`AgentFeedItem` → `agent_feed_items`
- **客厅/议事厅**：`lounge_sofas` / `lounge_messages` / `lounge_members` / `agent_council`
- **打卡/钱包**：`checkins`/`check_in_streaks`、`wallet_balances`/`wallet_quests`/`wallet_transactions`
- **设置/Provider/推送**：`user_settings` / `llm_providers` / `push_subscriptions`
- **RAG/压缩**：`rag_embeddings` / `rag_config` / `compression_cache`

---

## 环境变量

### 前端（Vite，`VITE_` 前缀，构建期注入）
| 变量 | 说明 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_NO_FX` | 设为 `1` 关闭动效（也可用 URL 参数 `?noFx=1`） |

### Edge Functions（Supabase 密钥/环境）
| 变量 | 用途 | 使用方 |
| --- | --- | --- |
| `SUPABASE_URL` | 本项目 Supabase URL | 全部函数 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端访问密钥 | 全部函数 |
| `SUPABASE_ANON_KEY` | 客户端 JWT 复验 | memory-extract、openrouter-chat |
| `OPENROUTER_API_KEY` | OpenRouter 网关 | openrouter-chat/-models、memory-extract、rag-* |
| `HAMSTER_MCP_KEY` | MCP 外部 connector 的 URL query 鉴权 | mcp_common |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | TTS 合成与音色 | hamster-life-mcp |
| `LUCKIN_MCP_TOKEN` / `MCD_MCP_TOKEN` / `AMAP_API_KEY` | 瑞幸/麦当劳/高德接入 | hamster-life-mcp |
| `AAB_SUPABASE_URL` / `AAB_SUPABASE_SERVICE_ROLE_KEY` / `AAB_USER_ID` | 外部「阅读」项目 | hamster-reading-mcp |
| `CYBERBOSS_WECHAT_WEBHOOK_URL` | 企业微信 Webhook | signal-bus-consumer |

---

## 本地开发

前置：Node.js 20+；如需调试后端另需 [Supabase CLI](https://supabase.com/docs) 与 Deno。

```bash
# 安装依赖
npm install

# 在项目根创建 .env.local，填入前端变量
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_ANON_KEY=...

# 启动开发服务器
npm run dev

# 生产构建 / 预览
npm run build
npm run preview

# 代码检查（tsc + eslint）
npm run check      # 或分别 npm run lint

# RAG 回填 pilot 脚本
npm run backfill:memory-pilot
```

> 应用需要登录（Supabase Auth）后才能使用大部分功能；未登录或未配置 Supabase 时，聊天会返回离线占位回复。

---

## 部署

CI/CD 由 `.github/workflows/` 定义：

- **deploy-pages.yml** — push 到 `main` 时 `npm run build` 并发布到 GitHub Pages（生产构建 `base` 为 `/Hamster-Nest/`，故前端使用 `HashRouter`）。
- **deploy-edge-functions.yml** — `supabase/functions/**` 变更时，用 Supabase CLI 部署全部 Edge Functions。
- **deploy-supabase-functions.yml** — push 到 `main` 时以 `--no-verify-jwt` 部署核心函数（openrouter-chat/-models、signal-bus-consumer）。
- **signal-bus-cron.yml** — 每 10 分钟触发 `signal-bus-consumer`。
- **auto-letter-cron.yml** — 每小时触发 `letter-check`（来信检查）。

部署所需 Secrets（在仓库 Settings 配置）：`SUPABASE_ACCESS_TOKEN`、`SUPABASE_PROJECT_REF`、`SUPABASE_SERVICE_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。

---

## 聊天窗口的 hamster-mcp 工具循环

聊天窗口（单聊）支持 function calling 的模型可以调用 Edge Function `hamster-mcp`
暴露的全部 MCP 工具。数据流如下（前端驱动循环，`src/App.tsx` + `src/lib/mcpTools.ts`）：

1. 发消息时前端向 `hamster-mcp` 发送 JSON-RPC `tools/list`（带 5 分钟缓存），
   把返回的工具 schema 转成 OpenAI function calling 格式；工具 schema 不在前端硬编码。
2. 聊天请求带上 `tools` 参数，经 `openrouter-chat` 透传给上游模型。
3. 模型返回 `tool_calls` 时，前端对每个调用向 `hamster-mcp` 发送 `tools/call`
   执行，把结果以 `role: 'tool'` 消息追加进上下文后再次请求模型，循环直至模型
   产出普通回复。循环上限 5 轮；工具执行报错时把错误文本作为工具结果返回给模型，
   不中断会话。
4. 不支持 function calling 的模型自动降级：带 `tools` 的请求被上游拒绝（4xx）时，
   立即不带 `tools` 重发本轮，并在本次会话内记住该模型不再附带工具。
5. 工具调用过程在消息气泡内显示可折叠的状态条（工具名 + 执行中/完成/失败），
   状态随消息 meta 持久化。

`hamster-mcp` 的鉴权为双通道，任一通过即放行：前端带 Supabase 用户 JWT
（`Authorization` + `apikey` header）；Claude/GPT 等外部 connector 走 URL query
密钥 `?key=…`（对应服务端 env `HAMSTER_MCP_KEY`，未配置时该通道关闭）。
