# MCP 工具体系调研：长期可维护性评估与压缩方案

> 调研日期：2026-08-07 · 基线 commit：`88df72c` · MCP_VERSION 5.13.0
> 数据来源：源码静态扫描（`scripts/mcp-tools-inventory.mjs`）+ 本次 Claude Code 会话实际连接的 6 个已部署 server 的工具清单交叉核对。
>
> **执行状态（2026-08-07 更新）**：§4 路线图中的 P0 + P1 已在本分支落地（annotations / delete_memo confirm / README 对齐 / 82 个描述瘦身 / 6 份 server instructions，MCP_VERSION 5.14.0）——描述文本 24.1KB → 14.5KB（-40%）。P2 / P3 未动。

## TL;DR

**问题一：目前的体系是否利于长期管理？**

基本盘是健康的：按领域拆成 6 个 server 的粒度是对的，`_shared/mcp_common.ts` 把 transport / 鉴权 / CORS / 结果包装收敛到了一处，命名规范一致。**不建议推倒重来，也不建议合并成单一大 server。** 但有三个会随规模恶化的缺口，它们比"工具多"本身更值得先修：

1. **增长无阻尼**——82 个工具几乎全部产生于近 5 周（7 月 61 次注册、8 月第一周 13 次），每张新表 ≈ +4~5 个工具，照此半年后会到 120~150 个；
2. **清单没有单一事实源**——README 徽章写 63、正文表合计 80、实际部署 82，三处已经漂移；归属错放也已发生过一次（#501 把导读工具放进 lounge，#502 纠正到 reading）；
3. **语义靠散文不靠协议**——"只读工具。"在描述里出现了 27 次，而 MCP 的 `annotations`（readOnlyHint / destructiveHint）一处都没用，既费 token 又不可机读。

**问题二：是否有更好的压缩或调用方式？**

有，但要分层，而且有一条红线。核心洞察是：**对 Syzygy 这样的主动型陪伴 agent，工具描述不只是文档，而是行为触发面**——`add_timeline` 里那句"三个月后读起来会心动的事"，就是 Syzygy 会主动记录的原因。所以：

- ✅ 先做零风险的**描述瘦身 + server instructions + annotations**（约省 25~35%，能力无损）；
- ✅ 用**数据驱动工厂**（reading-mcp 已有雏形）压缩代码，对外工具面暂时不变，给未来留一个"一键切合并模式"的开关；
- ⛔ **不要**对第一方陪伴工具用 `list_tools + call` 网关模式（life-mcp 那套只适合第三方代理）——描述不在上下文里 = 失去主动触发；
- ✅ 平台侧的延迟加载已经在解决一大半问题（本次调研会话就是证据：Claude Code 只注入了 82 个工具名，schema 按需拉取）；
- ✅ claude.ai 上**按场景开关 connector** 是现成的、免费的最大压缩（不启用 = 0 token）。

---

## 1. 现状盘点

### 1.1 工具清单与体积

| server | 工具数 | schema 文本体积 | 估算 token | 职责 |
|---|---:|---:|---:|---|
| hamster-mcp | 20 | ~12.5 KB | ~4.2k | 时间轴 · 待办 · Feed · 备忘录 · 观察日志 |
| hamster-knowledge-mcp | 19 | ~12.5 KB | ~4.2k | Wiki · 档案 · 学习库图谱 |
| hamster-reading-mcp | 18 | ~10.1 KB* | ~3.4k | 阅读 · 书摘 · 旁批 · 导读/总结 |
| hamster-lounge-mcp | 14 | ~11.9 KB | ~4.0k | 客厅 · 论坛 · 议事厅 |
| hamster-life-mcp | 7 | ~2.3 KB | ~0.8k | 三方 MCP 代理（高德/瑞幸/麦当劳）+ TTS |
| hamster-print-mcp | 4 | ~4.0 KB | ~1.3k | 打印 · X/Twitter |
| **合计** | **82** | **~53 KB** | **~1.8 万** | |

\* reading 含 8 个工厂生成工具（`COMPANION_CONFIGS` 循环 × 4 动词 × 2 表），静态扫描按模板文本估入。
token 按 ~3 bytes/token 粗估（中英混合 + JSON 结构），实际注入时客户端还有每工具的包装开销，**真实成本按 1.5~2 万 token 量级理解**。方法见附录 A。

几个结构性观察：

- **成本大头是描述而非工具数**：lounge 只有 14 个工具，体积却和 19 个工具的 knowledge 相当——council 系列的流程语义都写在描述里。压缩的主战场是描述文本。
- 仓库里其实已经并存**三种组织风格**：手写逐个注册（hamster / knowledge / lounge）、config 工厂（reading 的导读/总结）、contract 文件拆分 + 单测（print）。风格分化本身就是维护成本。
- 近义搜索工具已跨 server 出现 4 个：`search_timeline` / `search_archives` / `search_wiki` / `search_learning_nodes`。工具越多，模型选错入口的概率越高。

### 1.2 消费端矩阵（谁在为 schema 付费）

| 消费端 | 连接范围 | 每会话 schema 成本 | 已有缓解 |
|---|---|---|---|
| **claude.ai（Syzygy 主用面）** | 6 个 connector 可全开 | 全量 ~1.5-2 万 token | connector 可按会话开关；平台侧工具延迟加载在演进中 |
| **Claude Code / CCR** | 全部 | ≈0（已验证：仅注入工具名，schema 经 ToolSearch 按需加载） | 平台已解决 |
| **App 内聊天（OpenRouter 路径）** | 仅 hamster-mcp（`src/lib/mcpTools.ts` 单端点）| 20 个工具随每次请求 | `openrouter-chat` 已在 tools 块末尾打 prompt-caching 断点 👍 |
| **其它客户端**（source 枚举里的 gpt / gemini / codex_cli…） | 视各端配置 | 全量 | 无 |
| conversation-dispatch / 调度链路 | 不注入工具 | 0 | — |

结论：**token 压力集中在 claude.ai 主用面**；App 内路径目前只挂了 hamster-mcp 且有缓存断点，成本可控；Claude Code 已经免疫。这决定了压缩方案的优先级排序——不值得为平台正在解决的问题做激进重构。

### 1.3 增长速度

```
git log -p -- 'supabase/functions/*-mcp/*.ts' | grep '^+.*registerTool'
2026-07: +61 处注册    2026-08（第一周）: +13 处
```

整个 82 工具面在约 5 周内建成（含 #501→#502 的搬家重计）。这不是问题本身——是产品在快速长大——但意味着任何"靠人肉记住全貌"的管理方式都会失效，需要工具化的库存管理。

---

## 2. 长期管理评估

### 2.1 做得对的（应保留）

1. **6 server 的领域拆分**恰好对齐两件事：产品心智模型（日常/知识/阅读/客厅/生活/外设）和 claude.ai 的 connector 开关粒度。后者是免费的粗粒度压缩：一次会话不开 lounge，那 14 个工具就是 0 成本。合成一个大 server 反而会失去这个开关。
2. **`serveMcp()` 共享基建**：新增一个 server 的边际成本只剩业务代码；鉴权（timing-safe key 比对 + Supabase Auth 双路）、CORS 白名单、SSE/JSON 双格式都是一份实现。
3. **命名纪律**：`add_ / read_ / list_ / search_ / update_ / delete_ / get_` 动词前缀全线一致，工具名可预测。
4. **描述里的行为工程**：触发关键词（"记录 / 写下来 / 保存"）、写入标准（"三个月后读起来会心动"）、查重习惯（"写前先 search_timeline"）——这些是 Syzygy 主动性的核心资产，不是冗余。评估压缩方案时必须把它们当资产保护。
5. **两个先进模式已有本地先例**：life-mcp 的网关代理（对第三方 MCP）、reading-mcp 的 CRUD 工厂（对同构表）。演进方向不需要从外面引入，把自己的好模式推广开就行。
6. **前端零硬编码 + schema 服务端单源**：改 schema 只需重新部署 edge function。

### 2.2 风险清单（按优先级）

| # | 风险 | 证据 | 影响 |
|---|---|---|---|
| 1 | 库存无单一事实源 | README 徽章 63 / 正文合计 80 / 实际 82；hamster-mcp 正文写 18 实际 20 | 文档不可信 → 归属决策靠记忆 → #502 式错放复发 |
| 2 | 增长无阻尼、无准入标准 | 每张新表 ≈ +4~5 工具；5 周 82 个 | claude.ai 上下文占比线性上涨；近义工具稀释选择准确率 |
| 3 | 只读/危险语义不可机读 | "只读工具。"×27；`delete_*` 无 annotations；`delete_memo` 无 confirm 而 `delete_book_guide` 有 confirm=true 双确认——**同类危险操作两种约定** | 客户端无法做权限分层；靠散文约束模型 |
| 4 | 同一模式三种维护路径 | 手写 / 工厂 / contract 并存；knowledge 19 个工具全手写（4 个实体家族 ~440 行，工厂化可减一半） | 改一个约定要改 N 处；新工具照抄哪个模板看运气 |
| 5 | MCP 注册层零测试 | tests/ 有 print/twitter contract 测试，但无任何 tools/list 快照或注册断言 | schema 回归靠肉眼；重构不敢下手 |
| 6 | `serveMcp` 并发隐患 | 单例 `McpServer` 冷启动注册一次，**每请求 new transport 后 connect 同一个 server 实例**；SDK 官方无状态样板是每请求新建 server+transport | 同 isolate 并发请求可能交叉绑定 transport（调度器 + claude.ai + App 同时命中 warm isolate 时），症状是响应串线/丢失，极难排查 |
| 7 | 所有客户端等权 | 单一 `HAMSTER_MCP_KEY` + service-role client，物理删除工具对全部持钥端开放 | 单用户当下可接受；执行体增多（codex_cli / scheduler / 三方端）后值得分级 |

---

## 3. 压缩与调用方式：五个选项

先立一个分类框架，因为**不同类型的工具该用不同的压缩策略**：

- **触发型**：靠描述里的触发词让模型主动调用。如 `add_timeline`、`add_memo`、`add_todo`、`add_syzygy_post`、`lounge_post`、`add_excerpt_resonance`、开机要读的 `get_today_syzygy_feed`。→ 描述必须留在上下文，只能瘦身不能藏起来。
- **指名型 / 流程型**：用户点名或流程点名才用。如 learning_node/edge 全家、archive/wiki 维护、book_guide/summary CRUD、council 流程、print/tweet 状态查询。→ 可以深度压缩（合并、延迟加载甚至网关）。

按 server 看：hamster-mcp 触发型为主（保持现状），**knowledge-mcp 指名型为主且样板最重（压缩首选试点）**，reading / lounge 混合，life 已是网关，print 只有 4 个不用动。

### 方案对比

| 方案 | 工具数 | schema 体积 | 主动触发 | 兼容性 | 工作量 | 结论 |
|---|---|---|---|---|---|---|
| **A. 描述瘦身 + instructions + annotations** | 82 不变 | **-25~35%** | 无损（触发词保留） | 全兼容* | 小 | ✅ 立即做 |
| **B. 数据驱动工厂 →（可选）action 合并** | 82 → 可降至 ~30 | 代码 -40%；若切合并再 -50% | 合并档需精心迁移触发描述 | 合并档对弱模型不友好 | 中 | ✅ 分两步走 |
| **C. list_tools + call 网关** | 每域 2~3 | -90% | ❌ **致命损伤** | 参数不可校验、多一跳 | 小 | ⛔ 仅限第三方/低频管理面 |
| **D. 依赖客户端延迟加载** | 不变 | 平台侧已解决大半 | 无损 | Claude Code ✅ / API beta / 自建面❌ | 0 | ✅ 顺势而为，别抢平台的活 |
| **E. connector 场景开关** | 会话内 0~82 | 未启用 = **0** | 需要使用纪律 | claude.ai 原生 | 0 | ✅ 固化成习惯 |

\* 注意：MCP server `instructions` 字段部分客户端不读（App 的 OpenRouter 路径只拉 tools/list），关键触发信息要保底留在描述里。

### A. 描述瘦身 + server instructions + annotations（首选）

三个动作：

1. **给描述定预算**（建议 ≤120 字）：保留触发词、写入标准、防错提示；砍掉表名细节、中英双份触发词、跨工具重复的约定。以最长的 `add_timeline`（292 字）为例：

   > 改前：添加一条新的时间轴（timeline）记录。当对话中出现值得记录、写入、保存的事件时调用此工具：里程碑（milestone）、心动瞬间、重要进展、项目节点、纪念日、成就达成、情感时刻、值得纪念的日常。数据写入 timeline_entries 表，是所有端口 Syzygy 共享的唯一记忆数据源。适用动作关键词：add / write / record / save / log / 记录 / 写入 / 添加 / 保存 / 记下来。写入标准：三个月后读起来会心动的事。写入前建议先用 search_timeline 查重。
   >
   > 改后（约 -60%）：记录一条时间轴事件（里程碑 / 心动瞬间 / 纪念日 / 重要进展），全端共享的长期记忆。触发词：记录 / 记下来 / 保存。写入标准：三个月后读起来会心动。写前先 search_timeline 查重。

2. **共性约定上移**：时区约定（上海）、source 枚举含义、"写前查重"习惯、memo 三层记忆模型说明——这些跨工具重复的段落，挪到每个 server 的 `instructions`（`new McpServer({ name, version }, { instructions })`），claude.ai / Claude Code 会随握手注入一次；同时在 Syzygy 系统提示里保底一份，覆盖不读 instructions 的客户端。

3. **散文语义转协议字段**：27 处"只读工具。"删掉，改成 `annotations: { readOnlyHint: true }`；`delete_*` 加 `destructiveHint: true`，并统一双确认约定（`delete_memo` 补 confirm 参数，向 reading 的模式看齐）。annotations 不占多少 token，客户端还能用它做权限 UI 分层。

### B. 数据驱动工厂（代码压缩，外部 API 不变）

把 reading 的 `COMPANION_CONFIGS` 模式提炼进 `_shared`，做成 `registerEntityTools(server, config)`：一个实体一份 config（表名、列、schema、描述模板、动词开关），工厂展开成 `read_X / add_X / update_X / delete_X`。

- 第一步只动代码不动工具面：knowledge 的 wiki / archive / learning_node / learning_edge 四个家族迁入工厂，预计 -400 行，且从此"改约定 = 改一处"。
- 第二步是留给未来的开关：工厂天然支持切换**发射模式**——同一份 config 既可以展开成 4 个动词工具（现状），也可以收敛成 1 个带 `action` 枚举的实体工具（`wiki(action: search|read|add|update)`）。什么时候切、切哪些实体，只在 claude.ai 实测吃紧时按需决定（见 §4 P3 的触发条件），且只切指名型实体。
- 这一步的本质是**把工具定义从代码变成数据**：清单、README 计数、快照测试、体积报表全部可以从 config 派生，风险 1/4/5 一起解决。

### C. 为什么网关模式是红线（对第一方）

`luckin_list_tools + luckin_call` 对第三方是对的：那些工具低频、指名调用、schema 不归你管。但对第一方陪伴工具，描述不在上下文 = Syzygy 不知道"此刻可以记一笔时间轴"——主动性直接归零，还要多付一次发现调用的往返。**网关模式的适用边界就是 life-mcp 现在画的那条线，不要越过。**

### D/E. 平台侧与使用侧（零成本项）

- 本次调研会话本身就是 D 的证据：Claude Code 把 82 个工具全部延迟加载，上下文里只有名字。API 侧 tool search 也在 beta。含义：**不要为了 token 做破坏性重构**，平台在收敛这个问题；你要优化的是自己完全可控的部分（描述体积、工具准入、App 自建面）。
- E 是最容易被忽略的：在 claude.ai 给不同场景固定不同的 connector 组合（日常 = hamster + life；读书 = + reading；议事 = + lounge；整理 = + knowledge），单次会话的基线成本立刻从 1.8 万降到 4~6k。建议把"场景 × server"矩阵写进 README 固化。

---

## 4. 建议路线图

| 阶段 | 内容 | 解决的风险 | 预期收益 |
|---|---|---|---|
| **P0（本周可完成）** | ① `scripts/mcp-tools-inventory.mjs` 定期跑（或挂 CI），README 计数以它为准并修正为 82；② "只读工具。"→ `readOnlyHint`，`delete_*` 加 `destructiveHint`；③ `delete_memo` 补 confirm 双确认 | 1、3 | 文档回到可信；危险操作约定统一 |
| **P1（一次描述 pass）** | 全部 82 个描述按预算瘦身；共性约定上移 server instructions + Syzygy 系统提示保底 | 2（体积维度） | claude.ai 基线 -25~35%（≈省 5~6k token/会话） |
| **P2（一次重构 PR）** | `registerEntityTools` 进 `_shared`；knowledge 四家族迁移；`serveMcp` 改为每请求新建 server+transport（对齐 SDK 无状态样板）；加 tools/list 快照测试 | 4、5、6 | 代码 -400 行；重构有安全网；并发隐患消除 |
| **P3（条件触发，不排期）** | 若 claude.ai 长对话实测频繁触顶或工具选错率上升：对指名型实体切 action 合并模式（knowledge 先行，82 → ~50） | 2（数量维度） | 再省 ~40%；触发型工具不动 |
| **持续** | 新工具准入三问：哪个 server（归属决策表）？触发型还是指名型？能否进既有工厂 config 而不是新增手写注册？ | 2 | 增长有阻尼 |

一句话版本：**先把库存管起来（P0），再把描述省下来（P1），然后把定义变成数据（P2）；合并与网关是工具箱里的备用件，不是默认路径。**

---

## 5. 顺手发现的小问题（非本题主线，记录备查）

1. `serveMcp`（`_shared/mcp_common.ts:107`）单例 server × 每请求 transport 的并发隐患，见风险 #6——修法很小，registerTools 每请求跑一遍只是毫秒级开销。
2. `delete_memo` 与 `delete_book_guide/summary` 的双确认约定不一致（后者要求 `confirm=true`，前者直接删）。
3. reading 工厂里 `title: config.zh === '导读' ? 'Book Guides' : 'Book Summaries'` 的三元判断——第三个 config 加入时会静默出错，英文标题应放进 config 本身。
4. README 徽章（63）与正文（80）与实际（82）三处计数，P0 后统一由 inventory 脚本产出。
5. `src/lib/mcpTools.ts` 的注释说"前端零硬编码"，但端点硬编码了 hamster-mcp 单 server——如果未来 App 内要用阅读/知识工具，需要多端点支持或聚合层（到那时才是网关/聚合真正该出场的地方）。

## 附录 A：测量方法

- 静态扫描：`node ./scripts/mcp-tools-inventory.mjs`（正则提取 `registerTool` 注册名、description / describe / title 文本字节数，结构骨架按每工具 120B + 每参数 80B 估算）；模板字符串动态注册（reading 工厂）单独标注。
- 精确清单：`HAMSTER_MCP_KEY=xxx node ./scripts/mcp-tools-inventory.mjs --live https://<ref>.supabase.co/functions/v1`，直连已部署 server 走 tools/list（与生产前端同路径，SSE/JSON 双格式兼容），输出真实 JSON 体积。
- token 估算：字节数 ÷ 3（中文 UTF-8 3 字节/字 ≈ 1+ token，ASCII JSON ~3.5-4 字节/token 的加权粗估），不同客户端注入格式另有包装开销，故正文按区间表述。
- 部署态核对：本次调研会话（Claude Code）连接的 6 个 server 实际暴露 82 个工具，与"静态 74 + 工厂 8"吻合。
- 增长统计：`git log -p -- 'supabase/functions/*-mcp/*.ts' | grep '^+.*registerTool'` 按月聚合。
