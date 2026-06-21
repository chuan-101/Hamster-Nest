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
