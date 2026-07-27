# Hamster Nest 当前 UI 资产审计

> 审计基线：commit `00a79f7`（2026-07-26）。范围：仓库内打包资产 + 运行时用户上传资产 + 外链字体。
> 「Expo 共用性」为迁移可行性判断（基于文件形态与加载方式），非最终技术决策。

## 1. 背景图

| 资产 | 源码路径 | 使用页面 | 说明 | Web/Expo 共用性 |
|---|---|---|---|---|
| 页面渐变底 `--page-bg` | `src/styles/ui.css:19`（CSS 渐变，非图片） | 全局（body、.app-shell） | `linear-gradient(180deg,#fdf2f8 0%,#f8fafc 52%,#f3f4f6 100%)`；no-fx 模式退化为 `#f8fafc`（`src/index.css:70`） | ✅ 是渐变值不是图片，可直接进 Tokens；RN 需 expo-linear-gradient 实现 |
| 用户上传主屏背景 | 运行时资产：IndexedDB `hamster-home-db`/`home_assets`（`src/storage/homeLayout.ts:63-65`） | 主屏（`.home-page`，`HomePage.tsx:1155-1157`）+ 全局壳 `.app-shell`（`--app-background-image`，`src/App.tsx:1973`、`App.css:9-11`） | 上传时 canvas 压到宽 ≤1080 webp@0.86（`HomePage.tsx:133-155`）；仅存本地设备，不同步 Supabase | ⚠️ 机制需保留，但存储层必须替换（Expo 无 IndexedDB → FileSystem/AsyncStorage 或 Supabase Storage）【待确认方案】 |
| 无内置背景图片文件 | — | — | 仓库内没有任何打包的背景位图 | — |

## 2. 装饰图

| 资产 | 源码路径 | 使用页面 | 说明 | Web/Expo 共用性 |
|---|---|---|---|---|
| 登录页装饰纹样（粉色蝴蝶结形 SVG） | `src/pages/AuthPage.css:72`（**内联 data-URI SVG**，fill `#ffd6e7`/`#fff8fc`） | AuthPage | 唯一一处 CSS 引用的装饰图形 | ⚠️ data-URI 藏在 CSS 里，建议迁移前抽出为独立 SVG 资产（本审计未改动） |
| 用户上传装饰 Widget 图片 | 运行时资产：同 IndexedDB 存储（`homeLayout.ts` `DecorativeWidget.type='image'`） | 主屏 Widget 网格（`HomePage.tsx:76-77`：≤1800px webp@0.84） | 用户自有内容 | ⚠️ 同背景图，存储层需替换 |
| Banner | `Banner.png`（876K）、`Banner.jpg`（452K，仓库根目录） | 仅 `README.md:4` 引用（Banner.png）；Banner.jpg 未发现引用 | 品牌横幅，不进应用运行时 | ✅ 可共用作品牌素材；Banner.jpg 疑似冗余【待确认】 |
| 游戏模式精灵图 | `public/assets/game/floor_tile.png`、`chuan1.png`、`syzygy1.png`（各 ~4K） | Phaser `HomeScene`（`src/game/scenes/HomeScene.ts:32-36` 预加载）；游戏模式为 displayMode='game' 的整屏形态 | 地板贴图 + 两个角色立绘 | ✅ 普通 PNG 可直接共用；但 Phaser 游戏模式是否迁 Expo 是独立决策【待确认】 |

## 3. 卡片边框图

**不存在**。全仓无 `border-image`、无边框贴图文件；所有卡片边框均为纯 CSS（`border` + `border-radius` + 阴影 + 毛玻璃），像素风的"游戏机边框"也是 CSS 变量组实现（`src/game/gameHud.css`、`src/pages/ChatPage.css:1002-1010`）。→ 迁移时无需处理边框图资产，只需迁移对应 Tokens。

## 4. 字体

| 字体 | 加载方式 | 使用处 | Web/Expo 共用性 |
|---|---|---|---|
| Nunito 400/600/700/800 | Google Fonts `<link>`（`index.html:7-10`） | `--font-sans/--font-rounded/--font-display` 首选实际生效字体（`src/styles/ui.css:2-7`） | ⚠️ Expo 需改为 expo-font 本地打包（Nunito 有 OFL 许可）；仓库内**无本地字体文件** |
| Press Start 2P | Google Fonts `<link>`（`index.html:11-14`） | **未发现任何使用**（全仓无该 font-family 声明） | ❓ 疑似冗余加载【待确认：删或用】 |
| DotGothic16 + VT323 | CSS `@import`（`src/pages/ForumPage.css:1`） | Forum 像素风 12 处 font-family（ForumPage.css 多处，如 36/54/87/181…） | ⚠️ 同上需本地化；@import 位于页面 CSS，加载时机随页面样式 |
| 'Rounded Mplus 1c'、Quicksand、Comfortaa、'Avenir Next Rounded'、'Arial Rounded MT Bold' | **未加载**，仅存在于 `--font-rounded/--font-display` 栈中（`ui.css:5-7`） | 运行时实际回退到 Nunito/系统字体 | ❗ 设计意图与实际渲染不一致，迁移前需决定是否真正引入【待确认】 |
| 'Noto Serif SC','Source Han Serif SC','Songti SC',serif | 系统字体栈（`src/pages/NovelPage.css:80,85`） | 小说阅读器正文/编辑器 | ⚠️ 依赖设备自带字体，iOS/Android 表现会不同 |
| 'Comic Sans MS','Bradley Hand','Marker Felt',cursive | 系统字体栈（`src/pages/SnacksPage.css:88`) | 零食页手写体元素 | ⚠️ 同上，Android 基本无这些字体 |

## 5. Emoji（作为 UI 元素）

| 用途 | 位置 | 说明 |
|---|---|---|
| **21+1 个功能入口默认图标** | `src/pages/HomePage.tsx:264-291`（💬✅🧠🍪📘🎭⚙️📦💭📝🗓️🌷🪺📚📖🏛️🛋️💰🎛️📮🗂️ + 遗留 💌letters） | 当前唯一的"默认功能图标"形态；逐项映射见 `page-icon-map.md` / `ICONS-verified.md` |
| 来信 Toast 图标 | `src/App.tsx:1961,2345`（💌） | Letters 遗留 |
| 页面内装饰/状态 Emoji | 全仓 TSX 共约 126 行含 Emoji；密集处：HomePage(24)、SettingsPage(16)、WalletPage(10)、TodoPage(10)、`src/lib/agentFeed.ts`(9，feed 类型图标)、ArchivePage(6)、loungeRoles.ts(6，角色头像) | 迁移时需注意 Android/iOS Emoji 字形差异；清单原始数据在审计过程记录（scratchpad emoji-lines.json，未入库） |

## 6. 默认功能图标

现状 = 上表 Emoji 方案；**仓库中不存在任何 SVG 功能图标文件**。Phosphor SVG 方案（`ICONS-verified.md`）为规划中的替换目标，落地时需新增图标资产目录并接入渲染路径（当前渲染点：`HomePage.tsx:1682-1695` 的 emoji/图片双分支）。

## 7. 用户上传图标相关资源（运行时资产链）

| 环节 | 位置 | 说明 |
|---|---|---|
| 配置结构 | `src/storage/homeLayout.ts:22-31`（`AppIconConfig`） | emoji 或 image(imageKey+imageDataUrl) |
| 图片存储 | IndexedDB `hamster-home-db`/`home_assets`（`homeLayout.ts:63-65,396-408`）；回退 localStorage `hamster_home_assets_fallback_v1`（`homeLayout.ts:66,151-161`） | DataURL 原图存储（图标不压缩） |
| 布局+配置持久化 | localStorage `hamster_widget_prefs_v1`（`homeLayout.ts:60,341-379`） | JSON 含 `appIconConfigs`（内含 DataURL 冗余） |
| 上传/编辑入口 | `/home-layout`（`HomePage.tsx:1359-1418`，settings 模式） | Emoji 输入 / 本地上传 / 恢复默认 |
| 回显 | `HomePage.tsx:700-775`（异步取图）→ `1634-1695`（渲染） | 优先级：自定义图片 > 自定义 emoji > 默认 emoji |
| **同步范围** | 仅本设备（无 Supabase 同步） | Expo 迁移的关键行为差异点，见 `page-icon-map.md` §3 |

## 8. 其他影响 App 视觉迁移的资产

| 资产 | 路径 | 使用 | 备注 |
|---|---|---|---|
| PWA 图标 | `public/icons/pwa-180.png`(36K)/`pwa-192.png`(40K)/`pwa-512.png`(204K) | `index.html:17`（apple-touch-icon）、`public/manifest.webmanifest`、SW 推送通知图标（`public/sw.js:6`） | 是目前唯一的"App 图标"素材，Expo 的 app icon/splash 可由 512 版派生【待确认视觉是否沿用】 |
| favicon | `public/vite.svg` | `index.html:15` | **仍是 Vite 默认 logo**，品牌化缺口 |
| `src/assets/react.svg` | — | 未发现引用 | 模板遗留，疑似可清理【待确认】 |
| PWA manifest | `public/manifest.webmanifest` | name "Hamster Nest" / short_name "HamNest"；`theme_color #1f2937`、`background_color #111827` 与粉色系视觉不一致（见 token-audit §4-3） | Expo app.json 的对应物 |
| Service Worker | `public/sw.js` | 壳缓存 + 推送通知（落点 `/#/letters`，Letters 遗留）；通知 icon 用 pwa-192 | 推送导航契约里已预留 native `screen` 字段（sw.js 注释） |
| 主题色 meta | `index.html:21`（#fdf2f8） | 移动端状态栏底色 | 与 manifest 冲突，迁移时需统一【待确认取值】 |

## 9. 结论摘要

1. 视觉几乎完全由 **CSS + Emoji + 用户上传内容**构成，仓库内位图资产只有：3 张游戏精灵图、3 张 PWA 图标、2 张 README Banner、1 个 data-URI 装饰 SVG——迁移包袱很轻。
2. 最大的迁移工作量在**运行时资产链**（IndexedDB/localStorage 的背景图、Widget 图、自定义图标）与**字体本地化**（4 个在用 web 字体 + 2 组系统字体栈 + 3 个"声明未加载"字体）。
3. 默认功能图标从 Emoji → Phosphor SVG 的替换没有存量 SVG 需要兼容，属于纯新增。
