# Hamster Nest Design Token 审计报告

> 审计基线：commit `00a79f7`（2026-07-26），只读提取，未修改任何业务代码。
> 数据来源：全量扫描 `src/**/*.css`（33 个文件，约 15,849 行）与 `src/**/*.ts(x)` 中的样式常量；完整数值清单见同目录 `current-tokens.json`。
> 本文件只做现状审计与整理建议输入，不给出新的视觉设计方案。

---

## 1. Tokens 当前存放位置

| 位置 | 内容 | 作用域 | 来源 |
|---|---|---|---|
| `src/styles/ui.css:1-20` | **全局主 Token**：3 个字体栈、2 个强调色、2 个文字色、玻璃拟态底/边、软阴影、3 档圆角、毛玻璃模糊、页面渐变底 | `:root` 全局 | `src/main.tsx:5` 引入 |
| `src/index.css:2` | `--z-popover: 5000`（唯一 z-index Token） | `:root` 全局 | `src/main.tsx:4` 引入 |
| `src/index.css:68-71` | 低特效模式覆盖：`--blur: 0px`、`--page-bg: #f8fafc` | `html.no-fx` | `?noFx=1` 或 `VITE_NO_FX=1` 触发（`src/main.tsx:9-15`） |
| `src/game/gameHud.css:1-28` | 游戏机像素风 27 个 `--game-*` 变量（色板、边框宽、像素圆角、渐变） | **`:root` 全局**（见 §4 问题 6） | 游戏模式 HUD |
| `src/pages/ChatPage.css:1002-1010` | 像素聊天主题 9 个 `--pixel-*` 变量 | `.chat-page--pixel`（游戏模式进聊天时 `chatTheme='pixel'`，`src/App.tsx:2123`） | 页面级主题 |
| `src/pages/ArchivePage.css:3-13, 30-40` | 系统档案双主题各 11 个 `--arc-*` 变量（默认粉色 / `.archive-page--syzygy` 蓝色） | 页面容器级 | 页面级主题 |
| `src/pages/ForumPage.css:920-921` | `--forum-reply-indent`、`--forum-reply-indent-mobile` | `.forum-reply-tree` | 布局参数 |
| `src/pages/HomePage.css:3-5` | `--icon-tile-bg`、`--page-overlay-bg`、`--home-background-image` 默认值 | `.home-page` | 会被用户设置覆盖 |
| 运行时内联注入 | `--app-background-image`（`src/App.tsx:1973`）、`--home-background-image`/`--icon-tile-bg`/`--page-overlay-bg`（`src/pages/HomePage.tsx:1155-1159`）、`--forum-reply-depth`（`src/components/forum/ForumReplyTree.tsx:47`） | 组件 style 属性 | 用户个性化 / 布局计算 |
| JS/TS 常量 | 主页个性化默认值（`HomePage.tsx:72-77`）、图片压缩参数（`HomePage.tsx:76-77,135,151`）、Phaser 底色（`src/game/config.ts:8`）、客厅角色色板（`src/constants/loungeRoles.ts`）、知识图谱色板（`src/pages/KnowledgeLibraryPage.tsx:56-89`） | JS | 见 `current-tokens.json → jsConstants` |
| 平台元数据 | `theme-color #fdf2f8`（`index.html:21`）、manifest `theme_color #1f2937` / `background_color #111827`（`public/manifest.webmanifest`） | 平台 | 见 §4 问题 3 |

**项目没有 Tailwind、CSS-in-JS 或主题库**；除上述变量外，其余样式全部为各页面 CSS 文件中的手写字面值。

## 2. 当前 Token 体系的组织方式

1. **单层扁平命名**：`--accent`、`--radius-card` 这类"用途即名字"的扁平变量，无 Primitive/Semantic 分层，无命名空间约定（`--game-*`、`--pixel-*`、`--arc-*` 是事实上的模块前缀）。
2. **三套并存的视觉体系**：
   - **粉色玻璃拟态**（主体系）：`ui.css` 的 `--accent/--glass-*/--blur` + `.glass-card/.glass-panel/.btn-*/.input-glass` 工具类（`src/styles/ui.css:37-111`）；
   - **奶油像素风**（游戏模式 + 像素聊天 + Forum）：`--game-*`、`--pixel-*` 两套变量 + Forum 页的 VT323/DotGothic16 像素字体（`src/pages/ForumPage.css:1`）；
   - **页面级配色主题**（系统档案粉/蓝双主题 `--arc-*`）。
3. **Token 采用度低**：`var()` 引用统计（`current-tokens.json → tokenUsageFrequency`）显示，除 `--text-main`（21 次）、`--glass-border`（16 次）、`--accent`（12 次）、`--page-bg`（12 次）外，多数 Token 引用次数为个位数；圆角 Token `--radius-card/tile/btn` 在 ui.css 自身之外几乎未被使用（3/1/1 次），而字面圆角 `12px` 出现 79 次、`999px` 出现 147 次。**各页面 CSS 实际上是"复制值"而不是"引用 Token"。**
4. **响应式**：无断点 Token。13 种媒体查询散布在各文件，`max-width: 560px`（18 处，含 1 处未加空格的 `max-width:560px`）与 `640px`（9 处）是事实主断点，另有 420/480/520/680/720/760/768/900/901px 与 1 处 JS `matchMedia('(max-width: 900px)')`（`src/pages/HomePage.tsx:248`）。
5. **动效**：无动效 Token。时长以 `160ms`（27 处）、`0.2s`（18 处）、`140ms`（17 处）为主，缓动几乎全是 `ease`（98 处）；像素风用 `steps(1)/steps(2)`。10 个 `@keyframes` 全部为局部命名（气泡、打字指示、TTS 转圈等）。支持 `prefers-reduced-motion`（`src/pages/LoungePage.css`）与全局 no-fx 开关。

## 3. 重复值 / 硬编码情况（要点）

完整计数见 `current-tokens.json → hardcodedRepeatedValues`。以下为最值得抽 Token 的重复字面值：

### 3.1 高频重复色（未 Token 化）

| 值 | 次数 | 语义（事实用途） | 示例位置 |
|---|---|---|---|
| `#fff` / `#ffffff` | 133 / 26 | 纯白面板底 | 全仓 |
| `#ffd6e7` | 93 | 主粉（≡ `--accent`，但大量直接写死） | `src/index.css:38`、`src/pages/CheckinPage.css` 等 |
| `#5c5c5c` | 74 | HamsterConsole 文字灰 | `src/pages/HamsterConsolePage.css` |
| `#fffbf5` | 53 | 奶油白（≡ 4 个 Token 名，见 §3.3） | gameHud/ChatPage/Forum |
| `#fdf4e8` | 53 | 奶油底 | gameHud/ChatPage/Forum |
| `#fffdf9` | 41 | Forum 纸面白 | `src/pages/ForumPage.css` |
| `#f6d7d4` | 39 | 像素粉 | gameHud/ChatPage |
| `#86827d` | 36 | 像素描边灰 | gameHud/ChatPage/Forum |
| `#68485e` / `#7d5d70` / `#5c4152` / `#4f3f4a` | 31/31/22/16 | 玫瑰棕文字系（页面标题/正文） | Timeline、Todo、Wallet、Memo 等 |
| `rgba(255, 214, 231, 0.85/0.88/0.9/0.35)` | 24/24/16/14 | 粉色边框/描边族 | 各页面卡片边框 |
| `#b27f98` | 20 | 玫瑰灰 kicker 文字 | 多页 |
| `#b13f4d` | 17 | 危险/删除红（另有 `#b91c1c` 14 次同语义） | 各页删除按钮 |
| `#0f172a` / `#334155` / `#475569` | 15/15/6 | slate 系文字（与玫瑰棕系并存的第二套中性色） | App.css、AuthPage、SettingsPage 等 |

### 3.2 其他高频重复值

- **圆角**：`999px`×147（胶囊）、`12px`×79、`10px`×48、`14px`×39、`18px`×38、`16px`×35、`24px`×17、`20px`×17、`8px`×15 —— 与 `--radius-*` 三档 Token 脱节。
- **阴影**：粉色系投影族高度重复但每处微调，如 `0 8px 18px rgba(255,214,231,0.24)`×7、`0 10px 20px rgba(255,214,231,0.2)`×4、focus 环 `0 0 0 2px rgba(255,214,231,0.35)`×5 等（145 种 distinct 阴影，绝大多数为一次性微调值）。
- **渐变**：`linear-gradient(180deg,#fffbf5 0%,#fdf4e8 100%)`×33、`(180deg,#ffeef6 0%,#ffe1ef 100%)`×15、`(180deg,#fffbf5 0%,#f6d7d4 100%)`×10 等。
- **毛玻璃**：`blur(12px)`×6、`blur(10px)`×4、`blur(8px)`×3（与 `--blur:16px` Token 并存多档字面值）。
- **间距**：`gap: 8px`×125、`10px`×74、`6px`×68、`12px`×47；padding/margin 高频值 `12px`×53、`10px`×50、`8px`×32、组合值 `10px 12px`×29、`8px 10px`×28 —— 事实上存在 2/4/6/8/10/12/14/16px 的隐性间距刻度，但 px 与 rem（`0.5rem/0.6rem` 等）混用。
- **字号**：`12px`×120、`13px`×89、`11px`×57、`14px`×55、`16px`×21、`15px`×21、`10px`×18、`18px`×12，混有大量 rem/em 与 6 处 `clamp()` 大标题。字重集中在 600/700/800。
- **z-index**：`5000(--z-popover)` 之外散布 `-2,-1,0,1,3,4,10,12,20,25,28,30,35,40,60,100,1200,1500,1600,1650` 与 `calc(var(--z-popover)+100)`（`src/components/ConfirmDialog.css:9`）；抽屉层 1600/1650（`SessionsDrawer.css:10,33`）、toast 1200（`App.css:35`）、聊天浮层 1500（`ChatPage.css:101,718`）。

### 3.3 同值异名 Token（重复定义）

| 值 | 挂了几个名字 | 位置 |
|---|---|---|
| `#fffbf5` | `--game-shell-light` = `--game-panel-light` = `--game-screen-glow` = `--pixel-cream` | `gameHud.css:5,6,12`、`ChatPage.css:1010` |
| `#86827d` | `--game-shell-edge` = `--game-screen-bezel` = `--pixel-border` = `--pixel-subtle` | `gameHud.css:4,11`、`ChatPage.css:1002,1009` |
| `#5a5551` | `--game-text` = `--pixel-text` | `gameHud.css:13`、`ChatPage.css:1008` |
| `#c8b8aa` | `--game-shell-shadow` = `--pixel-shadow` | `gameHud.css:3`、`ChatPage.css:1003` |
| `#f6d7d4` | `--game-panel-mid` = `--game-accent` | `gameHud.css:7,8` |
| `#ffd6e7` | `--accent` = `--arc-accent` | `ui.css:8`、`ArchivePage.css:3` |
| 奶油渐变 | `--game-control-bg` = `--pixel-panel` = `--pixel-panel-strong`；`--game-control-accent-bg` = `--pixel-panel-accent` | `gameHud.css:26,27`、`ChatPage.css:1004-1006` |
| 像素圆角 | `--game-pixel-radius-lg/md/sm (18/12/8px)` 与字面 `18px/12px/8px` 大量并存 | `gameHud.css:17-19` |

`--pixel-*` 组基本是 `--game-*` 组的子集复刻（像素聊天主题与游戏 HUD 视觉同源、变量独立维护）。

## 4. 不一致点（逐条可查证）

1. `--text-main` 定义为 `#111827`（`src/styles/ui.css:10`），但 `src/index.css:5` 写的回退值是 `var(--text-main, #0f172a)`，且 `src/App.css:12` 直接硬编码 `color: #0f172a` —— 主文字色事实上存在 `#111827` 与 `#0f172a` 两个来源。
2. 中性色双体系并存：slate 系（`#0f172a/#334155/#475569/#64748b`，Auth/Settings/App 壳）与玫瑰棕系（`#68485e/#7d5d70/#5c4152/#4f3f4a`，多数功能页），语义相同（标题/正文/次要文字）。
3. PWA `manifest.webmanifest` 的 `theme_color #1f2937`、`background_color #111827` 是深色系，与 `index.html:21` 的 `theme-color #fdf2f8`（粉白）互相矛盾。
4. `--accent-strong #f8bad4`（`ui.css:9`）与 `--arc-accent-strong #f5b3d2`（`ArchivePage.css:4`）、按钮阴影里的 `rgba(249,168,212,…)` 家族三者非常接近但不相等。
5. 危险色三套：`--btn-danger` 用 `#fee2e2/#b91c1c`（`ui.css:90-93`），多页删除按钮用 `#b13f4d`（17 处），KnowledgeLibrary 用 `#ef4444`（`KnowledgeLibraryPage.tsx:87`）。
6. `--game-*` 27 个变量定义在 `:root`（`src/game/gameHud.css:1`）而非游戏容器类上，CSS 打包后全局生效，与主题系统串味（`--pixel-*`/`--arc-*` 则正确地做了容器作用域）。
7. `Press Start 2P` 在 `index.html:11-14` 加载但全仓未发现使用（Forum 像素字体实际用的是 `ForumPage.css:1` @import 的 VT323/DotGothic16）——【待确认：是否可移除】。
8. `--font-display` 首选 `'Rounded Mplus 1c'`、`--font-rounded` 含 Quicksand/Comfortaa，均未实际加载，运行时全部回退到 Nunito/系统字体 —— 设计意图与实际渲染不一致。
9. 断点 `560/640` 为主，但同类布局在不同页面分别断在 480/520/560/640/680/720/760/768，无规律可循。
10. `src/storage/homeLayout.ts:79` 的 page2 默认图标序（9 项，缺 todo/knowledge/lounge）与 `src/pages/HomePage.tsx:67` 的 `DEFAULT_PAGE2_ICON_ORDER`（12 项）不一致 —— 两份默认布局配置并存（详见 `page-icon-map.md` 备注）。

## 5. 适合交给 Claude Design 分层整理的候选（仅归类现状，不重新设计）

**Primitive 候选**（当前已在代码中反复出现的原子值）：
- 色板：粉系（`#ffd6e7 → #f8bad4/#f5b3d2 → rgba(255,214,231,α) 族`）、奶油像素系（`#fffbf5/#fdf4e8/#f6d7d4/#efc2bc/#d98a7c/#c8b8aa/#86827d/#5a5551`）、玫瑰棕文字系（`#68485e/#7d5d70/#5c4152/#4f3f4a/#b27f98`）、slate 系（`#0f172a/#111827/#334155/#475569/#6b7280`）、Forum 纸白 `#fffdf9`、危险红族（`#b13f4d/#b91c1c/#ef4444/#fee2e2`）、档案蓝主题族（`#cfe6ff/#a7cdf5/#eef6ff/#3d5675…`）；
- 间距刻度：2/4/6/8/10/12/14/16/20px（事实高频值）；
- 圆角刻度：8/10/12/14/16/18/20/24/28px + 999px 胶囊 + 50%；
- 字号刻度：10/11/12/13/14/15/16/18/22px + clamp 大标题；字重 400/600/700/800；
- 时长：120/140/160/200ms 与 0.2s/0.25s；缓动 ease、steps(1|2)；
- 模糊：8/10/12/14/16px；断点：560/640/768/900（事实主档）。

**Semantic 候选**（现有名字已具语义，可直接映射）：
`--accent/--accent-strong`、`--text-main/--text-subtle`、`--glass-bg/--glass-border`、`--shadow-soft`、`--page-bg`、`--blur`、`--z-popover`，以及"危险色、focus 环 `0 0 0 2px rgba(255,214,231,0.35)` 族、卡片边框 `rgba(255,214,231,0.85-0.9)` 族"这三组事实语义。

**Component 候选**（现有组件级样式集中地）：
- `.glass-card/.glass-panel/.btn-primary/.btn-secondary/.btn-danger/.input-glass/.textarea-glass/.top-nav/.app-shell`（`src/styles/ui.css:37-158`）；
- 主页图标格 `.app-icon-slot/.app-icon-button/.icon-emoji/.icon-image/.icon-label`（`src/pages/HomePage.css`）；
- 像素风组件组（`--game-*`/`--pixel-*` 全组 + `steps()` 动效 + 3px/4px 边框宽）；
- 档案页双主题组（`--arc-*` 两套，是现成的"页面主题=同名变量换值"范式，可推广为 App 主题机制）；
- 会话抽屉/Toast/确认弹窗的 z-index 组（1200/1500/1600/1650/5000/+100）。

**三套视觉体系（玻璃粉、奶油像素、档案双主题）建议作为并列的 Theme/Context 处理**，Letters 遗留样式（`src/pages/LettersPage.css`，键盘/纸张风）是否纳入迁移范围【待确认】。

## 6. 审计方法与局限

- 数值统计由脚本对 CSS 全文提取（正则匹配声明），`count` 为文本出现次数，未按选择器权重去重；
- 单次出现的局部值（如 145 种阴影中的长尾、75 种字号中的一次性 em/rem 值）未逐条列入 JSON，只保留统计口径与代表样本；
- JS 内联样式中的零散字面值（少量 `style={{...}}`）未全部枚举，已覆盖成规模的常量组（色板/默认值/压缩参数）；
- 本文所有行号以 commit `00a79f7` 为准。
