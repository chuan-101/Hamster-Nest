# design-audit/ — App UI 迁移前置审计交付说明

> 审计对象：Hamster Nest（仓鼠窝窝）Web 项目，commit `00a79f7`（2026-07-26）。
> 性质：**只读审计**。未修改任何业务代码、数据库结构或 Supabase 数据；未提交 commit、未 push、未创建 PR；未安装/升级依赖、未运行构建。
> 所有交付物均在本文件夹内，不含任何密钥、Token 或环境变量取值。

## 1. 审计范围

1. **Design Tokens 现状提取**：全量扫描 `src/**/*.css`（33 个文件，约 15,849 行）与 `src/**/*.ts(x)` 样式常量，覆盖 Color / Typography / Spacing / Border Radius / Border / Shadow / Opacity / Size / Breakpoint / Motion / Z-index；区分正式 Token、重复硬编码值、一次性局部值、同值异名 Token。忠实记录，未做任何改色/合并/升级。
2. **21 个功能入口核对**：显示名、真实 route、真实 page_key（主屏图标注册表键）、页面源码、真实 Supabase 查询表、默认图标形态、自定义图标机制、Expo 迁移需保留的行为。
3. **图标清单草稿核对**：对 `Hamster-Nest-ICONS.md` 草稿的 page_key / 路径 / Supabase 表逐项修正；未替选任何 Phosphor 图标，选择状态全部保持「待选」；未加回 Letters。
4. **资产审计**：背景图、装饰图、卡片边框图（不存在）、字体、Emoji、默认图标、用户上传资产链、PWA 素材。

## 2. 生成的文件

| 文件 | 内容 |
|---|---|
| `current-tokens.json` | 当前 Tokens 忠实记录（可解析 JSON）：正式 CSS 变量（全局/主题/页面级）、运行时注入变量、JS 样式常量、字体、断点、z-index、动效、重复硬编码值统计（含出现次数与 `文件:行号` 抽样）、Token 引用频次、同值异名清单、已发现的不一致点 |
| `token-audit.md` | Token 审计报告：存放位置、组织方式（三套视觉体系并存）、重复/硬编码/不一致明细（附源码路径行号）、Primitive/Semantic/Component 三层整理的候选归类（仅归类，不设计） |
| `page-icon-map.md` | 21 个功能入口总表（显示名/page_key/route/源码/Supabase 表/默认图标/自定义图标机制/备注）+ 非入口路由清单 + 自定义图标机制全链路 + 与草稿不一致的事实记录 |
| `ICONS-verified.md` | 图标清单核对版：10 个 page_key 已按代码修正（附对照表），Supabase 表按真实查询链更新，显示名沿用草稿，SVG 文件名栏/Phosphor 原名栏保留，全部「待选」，无 Letters |
| `current-assets.md` | 资产清单：每项含源码路径、使用页面、Web/Expo 共用性判断 |
| `README.md` | 本文件 |

## 3. 已由代码确认的信息

- 21 个入口的 page_key、route、页面组件与主要 Supabase 表 **全部来自实际代码**（图标注册表 `src/pages/HomePage.tsx:262-293`、路由 `src/App.tsx:1975-2341`、查询链 `src/storage/*` 与页面内 `supabase.from(...)`），逐条附行号可回溯。
- 全局 Token 仅一处：`src/styles/ui.css` 的 `:root`（15 个）+ `src/index.css` 的 `--z-popover`；另有 4 组页面/主题级变量（`--game-*`、`--pixel-*`、`--arc-*`、Forum/Home 局部）与 5 个运行时注入变量。
- 默认功能图标当前全部是 Emoji；自定义图标为「emoji 自由输入 / 本地图片上传」双路径，纯设备本地存储（IndexedDB `hamster-home-db` + localStorage `hamster_widget_prefs_v1`），不经 Supabase。
- 路由为 HashRouter（URL 形如 `/#/checkin`）。
- Letters 已不在 21 入口清单，但其代码（路由 `/letters`、页面、图标注册、实时订阅、SW 推送、边缘函数）仍完整存在于仓库。
- 字体实际加载的只有 Google Fonts 的 Nunito、Press Start 2P（index.html）与 DotGothic16/VT323（ForumPage.css @import）；仓库内无本地字体文件、无 SVG 功能图标文件、无边框贴图。

## 4. 仍需人工确认的信息（【待确认】汇总）

1. Letters 遗留代码的处置（移除时点与范围，含 SW 推送落点、未读红点）。
2. Wiki 关联表 `thought_relations`、DB 中存在但前端未用的 `codex_tasks`/`usage_quota`/`agent_heartbeats`/`device_status` 的规划用途。
3. SVG 文件名是否跟随修正后的 page_key 重命名（草稿命名规则 vs 代码连字符风格）。
4. 「零食链接」与代码显示名「零食罐罐」的最终定名。
5. Press Start 2P 字体加载但未使用：删除还是启用。
6. `--font-display/--font-rounded` 中声明未加载的字体（Rounded Mplus 1c / Quicksand / Comfortaa）是否真正引入。
7. PWA manifest 深色主题色（#1f2937/#111827）与 index.html 粉色 theme-color（#fdf2f8）的统一取值。
8. 用户上传资产（背景/Widget 图/自定义图标）在 Expo 上的存储方案（本地文件系统 vs Supabase Storage 同步）。
9. Phaser 游戏模式是否纳入 Expo 迁移范围。
10. 两份默认布局配置不一致（`homeLayout.ts:69-94` vs `HomePage.tsx:57-68`）以哪份为准。
11. `Banner.jpg`、`src/assets/react.svg`、favicon `vite.svg`（仍是 Vite 默认 logo）等疑似冗余/占位资产的处理。

## 5. 建议一并交给 Claude Design 的材料

1. 本文件夹全部 6 个文件（`current-tokens.json` 为 Tokens 整理的直接输入）；
2. 选定 Phosphor 图标后的 SVG 文件夹 + 更新过「Phosphor 原名/选择状态」的 `ICONS-verified.md`；
3. 上面 §4 中已有结论的决策项（尤其 1/3/4/7/8/9）；
4. 若需还原真实观感：本仓库任一可运行实例的截图（本审计未运行构建，未产出截图）。

## 6. 完成标准自检

- [x] `current-tokens.json` 可正常解析（生成后已用 JSON 解析器校验）；
- [x] 21 个功能入口全部出现且无 Letters（`page-icon-map.md` §1、`ICONS-verified.md` §3 均为 21 行）；
- [x] 所有 page_key 来自实际代码；未能从代码确认的信息一律标注【待确认】；
- [x] Supabase 表映射全部来自项目内真实查询代码；
- [x] 未修改任何业务代码；未提交 commit、未 push、未创建 PR；
- [x] 未输出任何密钥、Token 或环境变量取值（仅提及公开的功能开关名，如 `?noFx=1`）；
- [x] 全部交付物位于 `design-audit/`。
