# Fork 部署指南（从零开始）

> **已有部署报 42703（如 messages.client_id 不存在）或某张表 404 的：在 SQL Editor 里重跑一遍 `supabase/schema.sql` 即可补齐缺表缺列**（重跑前同样要做下面第 3 步的两个占位符替换，整个文件可安全重复执行）。

## 1. 新建 Supabase 项目

在 [supabase.com](https://supabase.com) 新建一个项目（免费档即可），记下项目 ref（Settings → General → Project ID）。

## 2. 建你自己的账号，拿到 user UUID

Dashboard → Authentication → Users → Add user，用邮箱+密码创建你的账号；然后在 SQL Editor 跑 `select id from auth.users;`，复制得到的 UUID。

## 3. 运行 supabase/schema.sql

用编辑器打开仓库里的 `supabase/schema.sql`，做两个全局替换：`11111111-1111-1111-1111-111111111111` → 你的 user UUID；`YOUR_PROJECT_REF` → 你的项目 ref。
把替换后的整个文件粘贴进 SQL Editor 运行一次（约 440KB，可整体粘贴；文件幂等，报错修复后可整体重跑）。

## 4. 开启 Auth 邮箱登录

Dashboard → Authentication → Sign In / Up → 确认 Email 登录已启用；单人使用建议顺手关掉「Allow new users to sign up」，防止陌生人注册。

## 5. 填环境变量

复制根目录 `.env.example` 为 `.env.local`，填入 `VITE_SUPABASE_URL`（https://你的ref.supabase.co）和 `VITE_SUPABASE_ANON_KEY`（Settings → API Keys），`npm install && npm run dev` 即可跑起前端。
Edge Functions 的密钥不写文件，下一步部署后用 `supabase secrets set` 逐个配置（清单见 `.env.example` 的 Edge Functions 段，标了「可选」的用不到可不设）。

## 6. 部署 Edge Functions

装好 [Supabase CLI](https://supabase.com/docs/guides/cli) 后，在仓库根目录执行：

```sh
supabase login
supabase link --project-ref 你的项目ref
supabase functions deploy        # 按 supabase/config.toml 一次性部署全部函数
supabase secrets set OPENROUTER_API_KEY=xxx   # 依 .env.example 清单逐个设置
```

全部函数（19 个）：`hamster-mcp`、`hamster-knowledge-mcp`、`hamster-lounge-mcp`、`hamster-reading-mcp`、`hamster-life-mcp`、`hamster-print-mcp`、`openrouter-chat`、`openrouter-models`、`memory-extract`、`letter-generate`、`letter-check`、`wechat-reply`、`tts-generate`、`device-report`、`push-dispatch`、`signal-bus-consumer`、`conversation-dispatch`、`conversation-task-cancel`、`runtime-control`。也可 `supabase functions deploy 函数名` 单个部署；只想先跑通网页聊天，最少部署 `openrouter-chat` + `openrouter-models`。

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
- 数据库数据：`prompt_templates`（syzygy_base 等人设模板正文）、`lounge_members`（客厅成员显示名/头像）、`forum_ai_profiles`（论坛 AI 昵称）

**注意**：`chuanchuan`、`syzygy_instant`、`app_companion`、`codex_cli_syzygy` 这类机器标识（sender_key / port_key / target_role）被数据库函数和约束写死，属于协议的一部分，**不要改**；要改的只是展示名和 prompt 文案。

---

可选项：需要 Web 推送时在 Dashboard → Vault 建一个名为 `push_dispatch_secret` 的 secret（缺失时推送触发器只告警不影响使用）；`supabase/migrations/` 里带 `seed` 字样的文件包含 prompt 模板等种子数据，可按需在 SQL Editor 执行。
