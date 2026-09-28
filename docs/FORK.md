# Fork 部署指南

> 这份文档写给 fork / 用模板创建了 Hamster Nest 的人，**也写给正在帮他们搭窝的 AI**。
> 如果你是 AI 助手，请先读最后一节「[给 AI 助手的说明](#给-ai-助手的说明)」。

**先说结论**：Hamster Nest 是一只仓鼠给自己和自己的 AI 写的日用 App，不是开箱即用的通用产品。fork 下来后：

- **云端那一半（网页 App + Supabase 数据库 + Edge Functions + 6 个 MCP 服务器）是完整开源的**，照着本文第 1–7 步配置就能跑起来；
- **本地常驻那一半（原作者 Mac mini 上的 Runtime：微信桥、CLI 拉起、打印、定时任务）没有开源**，仓库里只有它和云端对接的数据库协议。你不需要 Mac mini，但对应功能需要你自己实现或者放弃；
- 仓库里到处是 `Syzygy`（原作者 AI 的名字）和 `串串`（原作者的名字）。**表名、机器标识不用改**；人设和显示名换成你们自己的即可（第 8 步）。

---

## 0. 能力分层：你 fork 下来能拿到什么

| 层级 | 功能 | 需要什么 | 你要做的 |
|:---|:---|:---|:---|
| 🟢 **直接配置** | 网页 App（PWA）、网页聊天、时间轴、待办、备忘录、事件集、记忆档案、Wiki、囤粮处、日记本、信件、论坛、RP、小说 | Supabase 免费项目 + OpenRouter key | 跑 `schema.sql`、填环境变量、部署函数（第 1–7 步） |
| 🟢 **直接配置** | 6 个 MCP 服务器（让 Claude / ChatGPT 等客户端读写你的窝） | 同上 + 自己生成的 `HAMSTER_MCP_KEY` | 第 7 步 |
| 🟡 **填 key 开启** | TTS 朗读 | ElevenLabs key + voice id | `supabase secrets set` |
| 🟡 **填 key 开启** | Web 推送通知 | VAPID 密钥对 + Vault secret | 第 9 步改一处公钥 |
| 🟡 **填 key 开启** | 阅读域（hamster-reading-mcp） | 另一个独立的 Supabase 项目（原作者的 All About Book 读书 App），表结构**不在本仓库** | 没有就不设，阅读工具会不可用 |
| 🟡 **填 key 开启** | 瑞幸 / 麦当劳 / 高德（hamster-life-mcp） | 各家官方 MCP token / 高德 key | 不用就不设 |
| 🔴 **需要你自己实现** | 微信收发、CLI（Claude Code / Codex）聊天窗口与客厅 CLI 回复、议事厅拍板后自动执行、远程打印、X 发帖、晨报 / 日总结等定时任务、设备心跳 | 一台常驻电脑 + **你自己写的本地 worker** | 见第 11 节协议说明；不实现的话这些入口会一直显示离线 / 任务停在 `pending`，不影响其他功能 |

> 「直接配置」指在本地 `npm run dev` 跑起来不用改代码。**如果要把前端部署到网上（GitHub Pages 或其他域名），或者用 GitHub Actions 自动部署，就需要改第 9 节列出的几个文件**，里面写着原作者的项目标识和域名。

---

## 1. 新建 Supabase 项目

在 [supabase.com](https://supabase.com) 新建一个项目（免费档即可），记下项目 ref（Settings → General → Project ID）。

## 2. 建你自己的账号，拿到 user UUID

Dashboard → Authentication → Users → Add user，用邮箱+密码创建你的账号；然后在 SQL Editor 跑 `select id from auth.users;`，复制得到的 UUID。

## 3. 运行 supabase/schema.sql

用编辑器打开仓库里的 `supabase/schema.sql`，做两个全局替换：`11111111-1111-1111-1111-111111111111` → 你的 user UUID；`YOUR_PROJECT_REF` → 你的项目 ref。
把替换后的整个文件粘贴进 SQL Editor 运行一次（约 550KB；文件幂等，报错修复后可整体重跑）。如果网页编辑器嫌文件太大，也可以用命令行：`psql "<Dashboard → Connect 里的连接串>" -f supabase/schema.sql`。

> **已有部署报 42703（如 messages.client_id 不存在）或某张表 404 的**：在 SQL Editor 里重跑一遍 `supabase/schema.sql` 即可补齐缺表缺列（重跑前同样要做上面两个占位符替换）。

> `schema.sql` 已与线上对齐到迁移 `20260921122013_wiki_app_save`（2026-09-28 同步），**只跑这一个文件就够了，不需要再跑 `supabase/migrations/`**。它还会用 pg_cron 注册两个每分钟任务（Feed 通知派发、客厅 API 兜底唤醒），Supabase 上直接可用。

> **Supabase 2026-10-30 起的新规**：`public` 里新建的表不再自动获得 Data API（PostgREST / supabase-js）权限，缺 GRANT 的表会报 `permission denied`。`schema.sql` 与 `supabase/migrations/` 里每张表都已自带 `GRANT ... TO authenticated / service_role`，照常跑即可；你自己以后加表时，请把 GRANT 写进建表的同一份 SQL（`npm test` 里的 `migration-grants` 会检查迁移目录）。

## 4. 开启 Auth 邮箱登录

Dashboard → Authentication → Sign In / Up → 确认 Email 登录已启用；单人使用建议顺手关掉「Allow new users to sign up」，防止陌生人注册。

> 这是**单用户应用**：很多 RLS 策略和 Edge Function 都按「站主 UUID」圈定数据，一个部署只服务一个人。想给朋友用，请让他们各自 fork 一份。

## 5. 填环境变量，跑起前端

复制根目录 `.env.example` 为 `.env.local`，填入 `VITE_SUPABASE_URL`（https://你的ref.supabase.co）和 `VITE_SUPABASE_ANON_KEY`（Settings → API Keys），`npm install && npm run dev` 即可在本地跑起前端。

想发布到自己的 GitHub Pages，还要：

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**；
2. 仓库 Settings → Secrets and variables → Actions 里添加 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；
3. 处理 `deploy-pages.yml` 里的「Verify generated database types」这一步（它默认连原作者的项目，fork 里一定会失败）：改好第 9 节的 `scripts/supabase-types.mjs` 并添加 `SUPABASE_ACCESS_TOKEN` secret，**或者直接删掉这一步**；
4. 如果你把仓库改了名，同步改 `vite.config.ts` 里的 `base: '/Hamster-Nest/'`，否则页面白屏；
5. **把你的前端域名加进 Edge Functions 的 CORS 白名单**：`supabase secrets set HAMSTER_ALLOWED_ORIGINS=https://你的用户名.github.io`（多个用英文逗号分隔，只写协议+域名，不带路径），否则页面能打开，但聊天等请求全部会被浏览器拦截。本地 `npm run dev` 走 localhost，不受影响。

Edge Functions 的密钥不写文件，下一步部署后用 `supabase secrets set` 逐个配置（清单见 `.env.example` 的 Edge Functions 段，标了「可选」的用不到可不设）。

## 6. 部署 Edge Functions

装好 [Supabase CLI](https://supabase.com/docs/guides/cli) 后，在仓库根目录执行：

```sh
supabase login
supabase link --project-ref 你的项目ref
supabase functions deploy        # 按 supabase/config.toml 一次性部署全部函数
supabase secrets set OPENROUTER_API_KEY=xxx   # 依 .env.example 清单逐个设置
```

全部函数（19 个）：`hamster-mcp`、`hamster-knowledge-mcp`、`hamster-lounge-mcp`、`hamster-reading-mcp`、`hamster-life-mcp`、`hamster-print-mcp`、`openrouter-chat`、`openrouter-models`、`memory-extract`、`letter-generate`、`letter-check`、`wechat-reply`、`tts-generate`、`device-report`、`push-dispatch`、`signal-bus-consumer`、`conversation-dispatch`、`conversation-task-cancel`、`runtime-control`。也可 `supabase functions deploy 函数名` 单个部署。

**最小可用路径**：只部署 `openrouter-chat` + `openrouter-models`（网页聊天），再加上你想用的 `hamster-*-mcp`，设好 `OPENROUTER_API_KEY`、`SUPABASE_SECRET_KEYS`、`HAMSTER_OWNER_USER_ID`、`HAMSTER_MCP_KEY` 四个 secret，就已经是一个能聊天、有记忆的窝了。

想让推送到 `main` 时自动部署函数：在 GitHub Secrets 里加 `SUPABASE_PROJECT_REF` 和 `SUPABASE_ACCESS_TOKEN`（`deploy-edge-functions.yml` 会用）；不需要的话可以删掉这个工作流，否则每次改函数它都会报红。

## 7. 生成 HAMSTER_MCP_KEY

自己生成一个随机串并设为 secret：

```sh
openssl rand -hex 32
supabase secrets set HAMSTER_MCP_KEY=上面生成的串
```

MCP 客户端（Claude / 其他）连 `https://你的ref.supabase.co/functions/v1/hamster-mcp` 等 6 个 `*-mcp` 端点时，带请求头 `x-hamster-mcp-key: 这个串` 即可；`HAMSTER_OWNER_USER_ID` 也要一并 `secrets set` 成第 2 步的 UUID。

## 8. 把名字改成你自己的

Syzygy（AI 名）和串串（用户名）可以在这几处换成你们的名字：

- `src/constants/aiOverlays.ts` —— 默认人设 prompt（「你是 Syzygy…」）与各覆盖人格
- `src/constants/loungeRoles.ts` —— 客厅各角色的显示名
- `src/storage/supabaseSync.ts` —— `FORUM_USER_AUTHOR_NAME = '串串'`（论坛署名）
- `src/App.tsx`、`src/pages/SettingsPage.tsx` 等页面 —— 界面文案里的称呼（全局搜索 `Syzygy` / `串串` 按需替换）
- `supabase/functions/*` 里 MCP 服务器的 `instructions` 和工具描述 —— 这些文字会随握手发给你的 AI，里面有原作者的称呼和家规，建议改成你们自己的约定
- 数据库数据：`prompt_templates`（syzygy_base 等人设模板正文）、`lounge_members`（客厅成员显示名/头像）、`forum_ai_profiles`（论坛 AI 昵称）

**不要改的**：

- **表名和函数名**里的 `syzygy`（`syzygy_commands`、`syzygy_posts`、`syzygy_signals`、`syzygy_replies` 等）。它们只是这套协议的名字，和你家 AI 叫什么没有关系。改了要同步改前端、类型文件、Edge Functions 和 RLS，收益为零。
- **机器标识**：`chuanchuan`、`syzygy_instant`、`app_companion`、`codex_cli_syzygy` 这类 sender_key / port_key / target_role 被数据库函数和约束写死，属于协议的一部分。要改的只是展示名和 prompt 文案。

---

## 9. Fork 后需要自己改的地方（写着原作者项目标识的文件）

这些文件里写着原作者的 Supabase 项目 ref `crfhiumxzmaszkapanrb`、GitHub 用户名 `chuan-101` 或密钥，**只在你用到对应功能时才需要改**。一条命令就能全部找出来：

```sh
grep -rn "crfhiumxzmaszkapanrb\|chuan-101" --exclude-dir=node_modules --exclude-dir=.git .
```

| 文件 | 用途 | 怎么改 |
|:---|:---|:---|
| `supabase/config.toml` → `project_id` | Supabase CLI 本地配置 | 换成你的 ref |
| `scripts/supabase-types.mjs` → `projectRef` | `npm run db:types:*` 从哪个项目生成类型；Pages 部署前也会跑 | 换成你的 ref；或按第 5 步删掉工作流里的检查 |
| `.github/workflows/deploy-pages.yml` | 推送 main 时发布 GitHub Pages | 见第 5 步 |
| `.github/workflows/deploy-edge-functions.yml` | 推送 main 时部署函数 | 加 `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` 两个 secret，或删掉 |
| `.github/workflows/signal-bus-cron.yml` | 每 10 分钟触发 `signal-bus-consumer` | 把 URL 换成你的项目，**删掉** `if: github.repository == 'chuan-101/Hamster-Nest'` 这一行，并添加 `SIGNAL_BUS_SECRET` secret。不删的话它在 fork 里不会运行 |
| `supabase/functions/_shared/cors.ts` | Edge Functions 的 CORS 白名单，默认只放行 `https://chuan-101.github.io` 和 localhost | **不用改代码**：设置 secret `HAMSTER_ALLOWED_ORIGINS=https://你的域名`（见第 5 步）。想彻底去掉原站也可以改这个文件里的 `PRIMARY_BROWSER_ORIGIN` |
| `vite.config.ts` → `base` | GitHub Pages 子路径 | 换成 `/你的仓库名/` |
| `src/lib/pushNotifications.ts` → `WEB_PUSH_VAPID_PUBLIC_KEY` | Web 推送公钥 | `npx web-push generate-vapid-keys` 生成后换成你的公钥，私钥用 `supabase secrets set` 设置 |
| `supabase/migrations/20260712073230_*`、`20260919062843_*` | 历史迁移里的回调 URL | 只有你按顺序重放 migrations 时才要改；用 `schema.sql` 的话不用管（里面已是 `YOUR_PROJECT_REF` 占位符） |
| `CITATION.cff`、`README.md` | 原作者的署名与介绍 | 随你 |

---

## 10. 注意事项

1. **从旧版 `schema.sql` 升级的已有部署**：9/28 同步补上了客厅规范化（沙发 = 一个会话）。新库直接跑没有问题；如果你的库里已经有旧客厅沙发数据，重跑时会看到一条 `lounge_sofas 有旧数据…` 的 WARNING，这时需要先参照 `supabase/migrations/20260919062843_lounge_canonical_groups.sql` 搬迁数据（它只能执行一次，第 678 行附近的 URL 要先换成你的项目），再重跑 `schema.sql`。
2. **种子数据**：`schema.sql` 只含结构，不含数据。`supabase/migrations/` 里带 `seed` 字样的文件包含 prompt 模板、默认联系人等种子数据，是「不用跑 migrations」的唯一例外，可按需在 SQL Editor 执行（执行前把里面的名字换成你们的）。
3. **Web 推送**需要在 Dashboard → Vault 建一个名为 `push_dispatch_secret` 的 secret；缺失时推送触发器只告警，不影响业务写入。
4. `schema.sql` 已在一个带 Supabase 平台桩（auth / vault / pg_net / storage）的全新 PostgreSQL 上验证过：从零运行、重复运行、从旧版升级都能跑通，结构与线上逐项一致。但**整份指南还没有在一个真实的全新 Supabase 项目上从头走过一遍**，遇到问题欢迎提 issue。

---

## 11. 本地 Runtime 层（未开源）：协议说明

原作者在 Mac mini 上跑着一个常驻进程（README「Mac mini 本地常驻层」一节有介绍），负责所有**云端做不到、必须在一台真实电脑上动手**的事。这部分代码不在仓库里，短期内也不打算开源。

**你不需要 Mac mini**。任何一台能 24 小时开机、能连 Supabase 的电脑（旧笔记本、NAS、云服务器）都可以；也可以完全不做这层，🟢 🟡 两层照常工作。

如果你想自己实现，云端和本地之间只靠数据库对话（表 + Realtime + RPC），没有私有接口：

| 表 / RPC | 方向 | 约定 |
|:---|:---|:---|
| `syzygy_commands` | 云 → 本地 | 通用命令队列。worker 认领 `status='pending'` 的行，改成 `running` 并写 `claimed_by / claimed_at`；做完后写 `done` + `result`，或者写 `failed` + `error_message`，同时写 `completed_at`。`command_type` 目前有 `print_document`（打印）、`browser_opencli`（X 发帖）、CLI 对话唤醒等。有 `idempotency_key` 的命令要保证只执行一次 |
| `agent_tasks` | 本地 → 云 | 每次本地执行的审计记录：来源、executor、结果摘要、错误 |
| `pending_wechat_messages` + `claim_pending_wechat_message()` | 云 → 本地 | 待发微信队列，用 RPC 认领后真实发送 |
| `lounge_messages` / `messages` | 双向 | 客厅与 CLI 对话里的 @ 提及；本地 CLI 的回复写回同一个会话 |
| `agent_council` | 云 → 本地 | 议事厅提案拍板为 `approved` 且指定了 CLI executor 时，本地接单执行，再写回执 |
| `agent_heartbeats` / `device_status` | 本地 → 云 | 心跳与在线状态；前端据此显示「在线 / 离线」 |

最小的 worker 可以只做一件事，例如订阅 `syzygy_commands` 执行打印，其余表不管；没人认领的命令会一直停在 `pending`，不会拖累其他功能。具体字段以 `supabase/schema.sql` 和 `src/supabase/database.types.ts` 为准。

---

## 给 AI 助手的说明

如果你是被用户叫来帮忙部署或改造这个 fork 的 AI，下面是你需要知道的事。

**这个项目是什么**：React 19 + Vite 前端（`src/`），Supabase Postgres（`supabase/schema.sql`、`supabase/migrations/`），Deno Edge Functions（`supabase/functions/`，其中 6 个 `hamster-*-mcp` 是 MCP 服务器）。单用户、单部署。原作者叫「串串」，她的 AI 叫「Syzygy」。

**动手之前先问用户**：
1. 想要哪几层（参照第 0 节的表）？大多数人只需要 🟢 层，不要默认去搭 🔴 层。
2. 前端要不要部署到 GitHub Pages，还是只在本地跑 / 部署到别处？
3. 他们的 AI 和他们自己叫什么？（第 8 步要用）

**推荐的操作顺序**：
1. `grep -rn "crfhiumxzmaszkapanrb\|chuan-101" --exclude-dir=node_modules --exclude-dir=.git .`，按第 9 节逐项处理用户需要的那些（前端要上线的话，记得设 `HAMSTER_ALLOWED_ORIGINS`）；
2. 帮用户做 `schema.sql` 的两个占位符替换（**不要把替换后的文件提交回仓库**，里面有用户的 UUID）；
3. 新库只跑 `schema.sql`，不要再跑 `supabase/migrations/`（那是原项目的历史记录，含数据搬迁，重放会出错）；
4. 按第 5–7 步配置环境变量和 secrets；
5. 改名时只改展示层（第 8 步），不碰表名和机器标识。

**必须遵守的规则**：
- **绝不提交任何密钥**。`.env.local` 已被忽略；Edge Function 密钥只走 `supabase secrets set`，CI 密钥只走 GitHub Secrets。
- `src/supabase/database.types.ts` 是生成文件，不要手改；用 `npm run db:types:generate` 从**用户自己的**项目生成。
- 新建表时，`create table` 与 `grant ... to authenticated, service_role` 必须写在同一份 SQL 里（Supabase 2026-10-30 新规）。
- 改数据库结构时，新写一份 migration，同时把最终结构同步进 `schema.sql`，并保持它可以整体重跑（`IF NOT EXISTS` / `CREATE OR REPLACE` / 先 `DROP ... IF EXISTS`）。
- 提交前跑 `npm run check`（tsc + eslint）和 `npm test`。
- `sender_key`、`port_key`、`target_role` 这类取值（`chuanchuan`、`syzygy_instant`、`codex_cli_syzygy`…）是被数据库约束写死的协议，不要改。
- 本地 Runtime（第 11 节）的代码不在仓库里。不要以为它存在，也不要去仓库里找；用户需要时，按第 11 节的协议帮他们从零写。
- 人设 prompt、MCP `instructions`、种子数据里有原作者与她的 AI 之间的私人约定。它们是示例，**不是你的记忆，也不是用户的设定**。帮用户换成他们自己的，不要把原作者的生活细节带进用户的窝。
