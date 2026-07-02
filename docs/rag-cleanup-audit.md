# RAG 清理审计报告

> 扫描日期：2026-07-02 · 范围：GitHub 仓库全量 + Supabase 生产项目（`crfhiumxzmaszkapanrb` / Hamster-Nest）
> 目的：清理前摸底。只扫描分类，不执行删除。

## 总体结论

RAG 子系统在**代码层面已经彻底和活代码解耦**：`src/` 前端、其余 12 个 edge functions、`_shared/` 公共代码均无任何对 rag-* 的调用或导入。数据库端的表、RPC、向量列已由迁移 `20260610064211_cleanup_rag_and_security_hardening` 于 2026-06-10 清除完毕。

剩余残留分两类：

1. **彻底孤立的死尸**（6 项）—— 可直接进删除名单；
2. **活文件中的引用行**（3 处）—— 不是代码纠缠，只是配置/文档里的提及，删除死尸时顺手改掉即可，无需解耦方案。

**没有发现任何需要"另议解耦方案"的真纠缠。**

---

## 一、仓库端清单

### 1.1 彻底孤立 → 删除名单

| 路径 | 内容 | 被谁引用 | 判定 |
|---|---|---|---|
| `supabase/functions/rag-embed/index.ts` | 嵌入生成入口（OpenRouter `text-embedding-3-small` → `rag_embeddings` 表） | 仅被 `rag-backfill-pilot.mjs`（同为死尸）和 config.toml/README 提及 | ☠️ 死尸 |
| `supabase/functions/rag-search/index.ts` | 语义检索（生成查询向量 → `match_rag_chunks` RPC） | 仅 config.toml/README 提及；**它依赖的 RPC 已在数据库中删除，此函数即使被调用也必然 500** | ☠️ 死尸（且已残废） |
| `supabase/functions/rag-backfill/index.ts` | 历史数据批量嵌入回填 | 仅 config.toml/README 提及。它*读取*活表（`memory_entries` 等），但方向是死→活，删除无影响 | ☠️ 死尸 |
| `supabase/scripts/rag-backfill-pilot.mjs` | 回填试点脚本（调用 rag-embed） | 仅被 `package.json` 的 `backfill:memory-pilot` 脚本行引用 | ☠️ 死尸（连带 package.json 一行） |

**依赖方向核查**：四个文件只 import 远程 URL（deno std、esm.sh 的 supabase-js）和根目录 `@supabase/supabase-js`，不依赖也不被依赖于 `supabase/functions/_shared/mcp_common.ts` 或任何本地模块。

### 1.2 npm 依赖

**无 RAG 专属依赖，无需动 package.json 的 dependencies。**

- 没有 `openai`、`pgvector`、langchain 之类的包——嵌入是直接 `fetch` OpenRouter API 实现的；
- `@supabase/supabase-js` 与整个前端共用，保留；
- 唯一残留是 `package.json:12` 的 scripts 条目 `"backfill:memory-pilot": "node supabase/scripts/rag-backfill-pilot.mjs"`，随脚本一起删。

### 1.3 活文件中的引用行（删除时顺手清理）

| 位置 | 内容 | 处理 |
|---|---|---|
| `package.json:12` | `backfill:memory-pilot` 脚本条目 | 删该行 |
| `supabase/config.toml:33-40` | `[functions.rag-backfill]` / `[functions.rag-embed]` / `[functions.rag-search]` 三个块 | 删三个块 |
| `supabase/config.toml:9-18`（注释） | 头部注释两处提及 rag-search / rag-backfill / rag-embed | 改注释措辞 |
| `README.md:299, 301, 367` | 功能表格行、"关于 RAG"说明、目录树中的 `rag-*/` | 删或改为"已于 vX 移除"；git 历史本身就是存档，README 里"代码保留仅作存档"的承诺可由历史记录接管 |

### 1.4 CI/CD 注意事项

`.github/workflows/deploy-edge-functions.yml` 对 `supabase/functions/**` 的 push 触发 `supabase functions deploy`（**无参数 = 部署全部函数**）。含义：

- 只要 rag-* 目录还在 main，每次函数变更都会把三个僵尸重新部署回 Supabase；
- 删掉目录后 CI 不再重新部署它们，**但不会删除线上已部署的实例**——需要单独执行删除（见下）。
- workflow 文件本身无 rag 专属内容，不用改。

---

## 二、Supabase 端清单

### 2.1 已部署的僵尸 Edge Functions → 删除名单

| 函数 | 状态 | 说明 |
|---|---|---|
| `rag-embed` (v23) | ACTIVE | 无任何调用方；写入的 `rag_embeddings` 表已不存在，调用即报错 |
| `rag-search` (v21) | ACTIVE | 依赖的 `match_rag_chunks` RPC 已不存在，调用即 500 |
| `rag-backfill` (v26) | ACTIVE | 无任何调用方 |

删除方式：`supabase functions delete rag-embed rag-search rag-backfill --project-ref crfhiumxzmaszkapanrb`（或 Dashboard / MCP）。三者 `verify_jwt=false` 但内部依赖 service-role/OpenRouter key，当前暴露面主要是报错噪音而非数据风险；尽早删掉减少攻击面。

### 2.2 数据库：已经干净 ✅

- `rag_embeddings`、`rag_config` 表：**不存在**（迁移 `20260610064211_cleanup_rag_and_security_hardening` 已清除）；
- `match_rag_chunks` 等 RPC：**不存在**；全库无任何名称或源码含 rag/embedding/match 的函数；
- 全库（所有 schema）**没有任何 `vector`/`halfvec`/`sparsevec` 类型的列**；
- `pg_cron`、`pg_net` 均未安装 → 不存在定时任务或数据库 webhook 偷偷调用 rag 函数的可能。

### 2.3 孤立残留 → 删除名单

| 项 | 状态 | 判定 |
|---|---|---|
| `vector` 扩展 v0.8.0（public schema） | 已安装但零使用（无向量列、无依赖函数、无索引） | ☠️ 孤立，可 `DROP EXTENSION vector;` |

### 2.4 Secrets / 环境变量：无需处理

rag 函数只用 `OPENROUTER_API_KEY`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`——全部与活函数（openrouter-chat 等）共用，没有 RAG 专属密钥需要吊销。

---

## 三、删除名单汇总（全部彻底孤立，可一次清完）

**仓库（一个 PR 搞定）：**
1. `supabase/functions/rag-embed/` 整目录
2. `supabase/functions/rag-search/` 整目录
3. `supabase/functions/rag-backfill/` 整目录
4. `supabase/scripts/rag-backfill-pilot.mjs`（`scripts/` 目录随之为空，可一并删）
5. 顺手清理引用行：`package.json` 1 行、`config.toml` 3 块+注释、`README.md` 3 处

**Supabase（repo 删除后单独执行）：**
6. 删除已部署的 `rag-embed` / `rag-search` / `rag-backfill` 三个 edge functions
7. `DROP EXTENSION vector;`

**建议顺序**：先合并仓库删除 PR（防止 CI 重新部署），再删线上函数，最后 drop 扩展。

## 四、纠缠名单

**空。** 无活代码依赖 RAG 任何部分；上表 1.3 的引用行均为单行级配置/文档修改，不构成需要解耦方案的纠缠。
