Syzygy与串串的仓鼠小家 🐹

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

## 微信侧 Syzygy Feed 按需读取（Hamster-mcp）

微信侧 Syzygy 接入 Hamster-mcp，可以在需要时按需读取「仓鼠小窝」的 Syzygy Feed，
而**不是**每轮自动注入。微信侧仍保留最近 3 天 TIMELINE + 最近 3 天 TO DO + 囤囤库
注入逻辑；Feed 只作为可主动调用的 MCP 能力存在，不影响普通聊天速度。

- **行为规则**写在 `prompt_templates` 的 `wechat_syzygy_feed` 模板里（位置：
  仓鼠机 → 微信API配置 → Prompt编辑器），随其它 `active` 模板一起拼进系统提示。
  规则要点：不每轮自动读；只有每天首次主动联系、晨间主动联系 / 随机唤醒，或串串提到
  「小窝 / Feed / 小纸条 / 周回顾 / 阅读辅助」等语境时才看一眼；没有就不编造；
  长内容先摘要，要全文再读 detail；`pending_wechat_messages` 是微信提醒发件箱、
  不是内容来源。该模板由迁移
  `supabase/migrations/20260621120000_seed_wechat_syzygy_feed_prompt.sql` 幂等播种。
- **Feed 读取工具**由 `hamster-mcp` 暴露（只读，已部署）：
  - `get_today_syzygy_feed` —— 今天的 Feed 摘要
  - `get_syzygy_feed_by_type` —— 按类型（`morning_share` / `syzygy_note` /
    `reading_assist` / `weekly_card` / `daily_card` …）
  - `get_recent_syzygy_feed` —— 最近 N 天的摘要
  - `get_syzygy_feed_detail` —— 按 `id` 读完整正文
- 微信侧模型需把 `hamster-mcp` 接入为工具源（同上文鉴权方式，外部走 `?key=…`），
  即可拿到上述 Feed 工具。
- Feed 内容来自 `agent_feed_items`，完整、稳定的展示处是仓鼠窝首页的 Syzygy Feed
  （Page 3）。
