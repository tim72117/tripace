# 縮小版 3D 島進入首頁 hero:版面與整合設計

> **路徑對照(2026-10-27)**:本文寫於這個功能還是獨立子專案 `web/island-demo/` 的時候。現在已搬進主網站並轉為正式,
> 文中的 `web/island-demo/…` 請對照下表(內容本身沒有改寫,只在這裡標註路徑):
>
> | 文中的路徑 | 現在的位置 |
> |---|---|
> | `web/island-demo/src/logic/`、`three/`、`models/`、`mini/`、`ui/` | `web/src/island/logic/`、`three/`、`models/`、`mini/`、`ui/` |
> | `web/island-demo/src/island/`(`layoutTypes.ts`、`layout.ts`) | `web/src/island/data/` |
> | `web/island-demo/docs/source-night-jiufen.json` | `web/src/island/scenes/night-jiufen/article.json`(2026-10 場景化後的位置) |
> | `web/island-demo/docs/*.md`(本文與同系列文件) | `docs/island/*.md` |
> | `island-demo/index.html`(完整版)、`mini.html`(縮小版試作頁) | 完整版改成路由 `/island`(`web/src/island/IslandPage.tsx`);縮小版試作頁已移除,縮小版只用在首頁 hero(`web/src/home/heroIsland/`) |
> | `main.ts`、`mini/main.ts`(進入點) | `web/src/island/mountIsland.ts` 與 `IslandPage.tsx` |
> | `npm run dev` port 5177、`npm test`、`npm run test:three` | 併入主網站:`npm run test:ui`(含 `src/island`);three 已是主網站相依,`*.check.ts` 改成一般 `*.test.ts` |
> | 「橋接檔 `loadHeroIsland.ts`」「`resolve.dedupe`」「vitest 排除 `island-demo/**`」 | 已不需要(只有一份 three、一個專案) |


> **實作狀態(2026-10-27)**:使用者同意方案 A 與 Q1~Q3 後,第 10 章步驟 2~10 已實作並通過單元測試、`tsc`、建置;之後使用者要求把 island-demo 搬進 `web/src/island/` 轉為正式,
> 並選擇「開正式路由 /island」,所以工程整合與連結已與第 7 章不同:不再有橋接檔(首頁直接動態 import `island/mini/loadMini`)、不需要 `resolve.dedupe` 與 vitest 排除,
> 首頁的島改連到 `/island`(原本 Q4 的第一階段是連原文)。步驟 11(最後階段用 chrome-devtools 看畫面)與 12(依實看微調)**尚未做**——
> chrome-devtools 瀏覽器設定檔被佔用、使用者不要 Playwright。其餘差異:①`heroIslandMode`/`probeWebgl` 在 `web/src/home/heroIsland/mode.ts`;
> ②光暈、陰影、動畫的 CSS 都在 `HomePage.css`;③`<a>` 內說明文字用 `aria-hidden`,意義由 `aria-label` 承載。
> 島下方的說明文字(第 5.2 節的「遊記小島」膠囊加一行說明)已依使用者要求移除:島裡沒有可見文字,只剩 `aria-label`;原本留給它的 52px 高度釋放給島。
> 「島不可用時 hero 不跳」(code review 後修正):省流量與 WebGL 在第一次 render 就同步判斷(`available.ts`)、版位大小在 `useLayoutEffect`(繪製之前)量測,
> 所以這三種情況使用者看不到「文字先靠上、1~3 秒後跳回置中」。只有建立島時才失敗(`createMini` 丟例外)這種無法預先知道的情況,仍會在載入後才收起。
> 暗色另外加了自發光(站點點光源、地面光斑、燈籠亮度,係數在 `island/logic/mini.ts` 的 `miniGlow`)。
> 數值皆為推論,**尤其暗色光暈、陰影位置(82%)、`miniLightBoost` 與 `miniGlow` 係數必須實看後調整**。


> 範圍:只做設計,不改程式碼。以下所有「現況」都來自讀過的原始碼與 CSS,**我沒有實際看過畫面**(沒有開瀏覽器、沒有截圖)。用讀 CSS 推論的尺寸都標成「推論」,完全無法從程式碼確定的標成「未驗證」。數值都是起始值,最後要由協調者用 chrome-devtools 看一輪再微調。

讀過的檔案:

- 首頁:`web/src/home/HomePage.tsx`、`HomePage.css`、`SiteNavButtons.css`(前 240 行)、`ScrollHint.tsx`、`ScrollPlanDemo.tsx`(檔頭與 import)、`ScrollPlanDemo.module.css`(grep 結構)、`web/src/hooks/useThemeToggle.ts`、`useSystemPrefersDark.ts`、`web/src/App.tsx`(lazy 路由)、`web/index.html`(meta)
- 建置:`web/package.json`、`web/tsconfig.json`、`web/vite.config.ts`、`web/src/vite-env.d.ts`、根目錄 `Dockerfile`(web 建置段)與 `.dockerignore`
- 縮小版島:`island-demo/mini.html`、`src/mini/MiniIsland.ts`、`main.ts`、`loadMini.ts`、`mini.css`、`src/logic/mini.ts`、`mini.test.ts`、`package.json`、`vite.config.ts`、`vitest.three.config.ts`、`tsconfig.json`、`README.md`
- 設計文件:`docs/visual-plan.md`(全文)、`docs/implementation-plan.md`(第 1 章、2.5、5.8~5.10、8.1~8.2、第 10 章)

---

## 1. 現況盤點

### 1.1 首頁區塊順序(`HomePage.tsx`)

```
.kyoto-bloom(根元素,data-theme 掛這裡)
├─ SiteNavBrand / SiteNavThemeToggle / SiteNavCta×2  ← position: fixed,z-index 200
├─ section.hero                                       ← 本文件要動的地方
│   ├─ svg.hero-ridge(兩條山稜路徑)
│   ├─ div.hero-eyebrow「Travel Planning」
│   ├─ h1.hero-title「走進一個地方<br><em>而不只是到過</em>」
│   ├─ p.hero-sub
│   └─ div.hero-actions > a.hero-cta「開始探索 ↓」→ #destinations
├─ <ScrollPlanDemo />(900vh 長的捲動區,裡面 .sticky 是 100svh、背景是一張 264KB 的 PNG 地圖)
├─ section.destinations#destinations(640px 置中的文字清單,含「台灣 · 九份夜遊記」→ /u/tim72117/night-jiufen)
└─ footer.kyoto-footer
```

注意三件事:

1. **首頁沒有掛 `ScrollHint`**。`ScrollHint` 只出現在 Jiufen/Kyoto/Tainan 等城市頁,首頁 hero 底部目前沒有任何「往下捲」提示元素;唯一暗示往下的是 `.hero-cta` 裡的 ↓ 箭頭。
2. **首頁沒有使用 `useThemeToggle`**。`HomePage.tsx` 自己寫了一份等價邏輯(`theme: 'dark'|'light'|null` + 用 `useState(() => matchMedia(...).matches)` 同步讀初值的 `systemPrefersDark`)。差別:`useSystemPrefersDark` 初值是 `false`、在 effect 裡才讀系統值,首頁的版本則在第一次 render 就拿到正確值。兩者都是「初始跟隨系統,按過一次後只在亮/暗之間切換,不會回到跟隨系統」。
3. **首頁本身是 lazy 路由**(`App.tsx` 第 74 行 `lazy(() => import('./home/HomePage'))`),所以 HomePage chunk 的大小直接影響首屏。

### 1.2 hero 的 CSS 行為(`HomePage.css` 第 91~134 行)

| 元素 | 關鍵樣式 | 推論出的效果 |
|---|---|---|
| `.hero` | `position: relative; height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden;` padding `clamp(24px, 6vh, 64px) var(--edge-pad) clamp(32px, 8vh, 80px)`;背景是頂部 `--paper-dim` 的橢圓漸層疊 `--paper` | **固定一個螢幕高、超出直接裁切**。所有內容垂直置中成一欄,桌機與手機是同一套排法,只靠 clamp 縮放,沒有任何斷點。 |
| `.hero-eyebrow` | 13px、字距 0.28em、`--vermilion`,下距 `clamp(14px, 3vh, 28px)` | 約 16px 高 + 下距 |
| `.hero-title` | serif(ShipporiSerif → Noto Serif TC)、600、`clamp(30px, 6vw, 68px)`、行高 1.25、`text-wrap: balance`,第二行 `<em>` 是 `--vermilion` | 寬螢幕 68px × 2 行 ≈ 170px;375px 手機 30px × 2 行 ≈ 75px(推論) |
| `.hero-sub` | `clamp(14px, 1.6vw, 18px)`、`max-width: 46ch`、行高 1.7 | 46ch 以「0」字寬算約 25em 寬,中文 37 字在桌機約 2 行、手機約 3 行(推論) |
| `.hero-cta` | 深色膠囊、`padding: 15px 34px`、`box-shadow: var(--card-shadow)`、hover 上移 2px | 約 48~50px 高,是 hero 唯一的實心按鈕 |
| `.hero-ridge` | `position: absolute; bottom: 0; left: 0; width: 100%; height: 40%; opacity: 0.5; pointer-events: none` | 底部 40% 高的兩條山稜:上面一條 moss 色細線(路徑本身 opacity 0.18)、下面一片 ink 色填色(opacity 0.06)。乘上整體 0.5 後非常淡,是氛圍裝飾。 |

**目前的疊放關係(推論)**:`.hero` 沒有 `z-index`,子元素裡只有 `.hero-ridge` 是定位元素。依 CSS 繪製順序,沒有 z-index 的定位元素會畫在一般流內容**之上**,所以山稜其實是蓋在文字與按鈕上面的;因為它很淡又 `pointer-events: none`,視覺上大概看不出來(未驗證)。加島之後要把這個關係明確化(見 2.0)。

### 1.3 固定導覽

`SiteNavButtons.css`:品牌在左上 `top: 16px; left: 16px`,主題切換與兩顆 CTA 在右上,`:root { --site-nav-h: 52px }`。900px 以下 CTA 縮成 12px 字。導覽列沒有底板,直接浮在 hero 上;目前 hero 內容垂直置中,所以不會跟導覽撞。**若 hero 內容改成靠上排,上距必須 ≥ `var(--site-nav-h)` + 24px。**

### 1.4 空間預算(推論)

把 eyebrow+標題+副標+按鈕叫做「文字組」:

| 視窗 | 文字組高度(推論) | 上下 padding | 剩下可給島的高度 |
|---|---|---|---|
| 1440×900 | ≈ 380px | 54 + 72 | ≈ 390px(疊在下方時) |
| 1366×768 | ≈ 375px | 46 + 61 | ≈ 285px |
| 820×1180(iPad 直式) | ≈ 330px | 64 + 80 | ≈ 700px |
| 390×844(iPhone 14,扣網址列約 750 dvh) | ≈ 300px | 45 + 60 | ≈ 340px |
| 375×667(iPhone SE,扣網址列約 550 dvh) | ≈ 300px | 33 + 44 | ≈ 170px |

結論:

- **橫向的桌機/筆電**:垂直很緊、水平很空。疊在文字下方的島在 1366×768 只剩約 280px,太小;放右側並排可以到 500px 以上。
- **直向平板與一般手機**:垂直有空間,疊在文字下方剛好。
- **小手機與橫拿的手機**:放不下,島要讓位(隱藏、不載入)。
- 會衝突的位置:右上角(導覽按鈕)、正中央(文字組)、底部中央(若日後加捲動提示)。

### 1.5 縮小版島的現況(要整合時必須知道的)

- 正方形卡片 `min(440px, 92vw)`、`aspect-ratio: 1/1`、`border-radius: 28px; overflow: hidden`;canvas 透明、`pointer-events: none`;鏡頭固定、整座島 48 秒轉一圈;`setPixelRatio(min(dpr, 1.5))`、`powerPreference: 'low-power'`。
- 主題:亮色凍結在 17:30 夕陽、暗色凍結在 19:30 夜晚,燈籠全亮;`setTheme` 是立即換光照,沒有過場。
- 載入:`IntersectionObserver`(rootMargin 240px)進入畫面才 `import('./loadMini')`;離開畫面、分頁隱藏、context lost 時停止繪製(`shouldRun`)。
- **縮小版試作頁的暗色背景是深藍紫 `#14112a`**(`mini.css`),亮度係數 `miniLightBoost` 是對著這個背景調的。**首頁暗色背景是暖深棕 `--paper: #1C1815`**,夜晚的藍紫島放上去顏色關係會不一樣,要重新看(未驗證,風險見第 11 章)。
- **減少動態偏好時,迴圈其實仍在跑**:`rotationAt(..., !reducedMotion)` 讓角度固定在 0,但 `setRunning(true)` 照常啟動 `setAnimationLoop`,蒸氣/螢火蟲粒子仍在動、GPU 仍每幀繪製。整合時要改成「只畫一幀」(見步驟 3)。
- `logic/mini.ts` 的 `autoRotateEnabled` 註解寫「使用者仍可拖曳」,但縮小版不能拖曳;這個函式只在測試裡用到。屬於過時註解,順手修。
- `loadMini.ts` 用 `import.meta.glob(..., { eager: true })` 把 20 個模型全打進同一個 chunk。

---

## 2. 配置方案

### 2.0 所有方案共用的疊放規則

在 `.hero` 加 `isolation: isolate`,自成一個疊放環境(不影響外面 z-index 200 的固定導覽),內部三層:

| 層 | z-index | 元素 |
|---|---|---|
| 背景 | (`.hero` 自身背景漸層) | — |
| 0 | `--z-hero-ridge: 0` | `.hero-ridge` |
| 1 | `--z-hero-island: 1` | 新的 `.hero-stage`(島、地面陰影、光暈) |
| 2 | `--z-hero-copy: 2` | 新的 `.hero-copy`(包住 eyebrow/標題/副標/按鈕),`position: relative` |

這三個變數寫進 `.kyoto-bloom` 開頭那段 z-index 清單註解(該檔案明確要求新增層級要先登記)。順帶讓文字確實壓在山稜之上,修正 1.2 提到的隱性反向疊放。

### 方案 A:桌機左右並排、窄螢幕疊在文字下方

```
桌機 ≥1024px 且橫向(1440×900)
┌──────────────────────────────────────────────────────────────┐
│ Tripace                                  [◐] [功能介紹] [登入]│ ← 52px
│                                                              │
│   TRAVEL PLANNING                    ╭────────────────────╮  │
│                                      │        ⛰ 🏮        │  │
│   走進一個地方                        │     ▲▲ 島 ▲▲       │  │
│   而不只是到過                        │   ▲▲▲▲▲▲▲▲▲▲       │  │
│                                      │    ╲________╱      │  │
│   從地景、歷史、人文到日常生活,        │   ·  陰影橢圓  ·    │  │
│   探索城市與自然之間……               ╰────────────────────╯  │
│                                       由一篇遊記做成 · 進島看看→│
│   ( 開始探索 ↓ )                                              │
│ ～～～～～～～～～～～～ 山稜(z0) ～～～～～～～～～～～～～～～～～ │
└──────────────────────────────────────────────────────────────┘
  左欄 文字組(靠左對齊)            右欄 島 ≈ min(46vw, 100dvh−180px, 560px)

平板直式(820×1180)                手機直式(390×844)
┌──────────────────────────┐       ┌──────────────────┐
│Tripace        [◐][功][登]│       │Tripace   [◐][功][登]│
│                          │       │                  │
│     TRAVEL PLANNING      │       │ TRAVEL PLANNING  │
│      走進一個地方         │       │   走進一個地方    │
│      而不只是到過         │       │   而不只是到過    │
│   從地景、歷史、人文……    │       │ 從地景、歷史……   │
│      ( 開始探索 ↓ )       │       │  ( 開始探索 ↓ )   │
│                          │       │                  │
│     ╭──────────────╮     │       │   ╭──────────╮   │
│     │    島 440    │     │       │   │  島 ≈320 │   │
│     ╰──────────────╯     │       │   ╰──────────╯   │
│  由一篇遊記做成 · 進島看看→│       │ 由一篇遊記做成 → │
│ ～～～～ 山稜 ～～～～～～ │       │ ～～ 山稜 ～～～～ │
└──────────────────────────┘       └──────────────────┘
```

- **大小與位置**
  - 桌機(`min-width: 1024px` 且 `min-aspect-ratio: 5/4`):`.hero` 改成兩欄 grid,`grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`,欄距 `clamp(32px, 4vw, 72px)`,整體 `max-width: 1180px` 置中(對齊 footer bar 的 1180px)。右欄島的邊長 `min(46vw, calc(100dvh - 180px), 560px)`,垂直置中,往下偏 `2dvh`,讓島腳落進山稜帶。
  - 平板/手機(其餘):維持單欄,文字組靠上(上距 `calc(var(--site-nav-h) + clamp(16px, 4vh, 40px))`),島放在文字組下方、吃掉剩下的高度,邊長 `min(剩餘高度, 86vw, 440px)`,實作見 4.1。
  - 剩餘高度 < 200px 時(iPhone SE、橫拿手機)隱藏島,也不載入。
- **誰先被看到**:標題(桌機在左,依閱讀順序先看;手機在上)。島晚 1~2 秒才淡入,首屏第一眼一定是標題。
- **與山稜的疊放**:島在 z1,蓋在山稜(z0)上;桌機島腳剛好落在山稜線附近,像停在山稜上。
- **卡片或無邊框**:無邊框(理由見方案比較)。
- **優點**:寬螢幕上島最大;窄螢幕排法跟現在幾乎一樣;一套 CSS 兩種模式,邏輯清楚。
- **缺點**:桌機文字從置中改靠左,首頁的對稱感會改變(待使用者決定,第 11 章 Q1);桌機要新增斷點,首頁 hero 原本完全沒有斷點。

### 方案 B:島浮在 hero 底部,壓在山稜上像浮在雲海上

```
桌機(1440×900)
┌──────────────────────────────────────────────────────────────┐
│ Tripace                                  [◐] [功能介紹] [登入]│
│                      TRAVEL PLANNING                         │
│                       走進一個地方                            │
│                       而不只是到過                            │
│              從地景、歷史、人文到日常生活,……                  │
│                      ( 開始探索 ↓ )                           │
│                      ╭──────────╮                            │
│ ～～～～～～～～～～～～│  島 ≈380  │～～～～～～～～～～～～～～～ │ ← 山稜(z0)
│ ░░░░░░░░░░░░░░░░░░░░░│ ░░霧帶░░ │░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ← 霧帶(z1.5)蓋島底 10%
└──────────────────────────────────────────────────────────────┘

平板直式:同上,島 ≈ 440。手機直式:同上,島 ≈ min(86vw, 剩餘高度)。
變體 B2「半露出」:島只露上半部、下半部被 hero 底邊裁掉,往下捲才看到全貌。
```

- **大小與位置**:置中,底邊距 hero 底 `clamp(8px, 2vh, 24px)`;邊長 `min(剩餘高度, 86vw, 460px)`。
- **誰先被看到**:標題(在上方),島是視線往下的終點,同時暗示往下捲。
- **疊放**:山稜 z0 → 島 z1 → **新增一條霧帶 z1.5**(`linear-gradient(to top, var(--paper) 0%, transparent 100%)`,高度是島的 12%、不透明度 0.7),蓋在島底,讓島像從雲海冒出來 → 文字 z2。
- **卡片或無邊框**:必須無邊框,否則「浮在雲海」不成立。
- **優點**:完全保留現在置中對稱的構圖,所有斷點同一種排法(最少 CSS);島本身就是「往下捲」的提示。
- **缺點**:1366×768 這類筆電只剩約 280px,模型細節(燈籠、茶樓)小到看不清,「展示模型」打折;B2 半露出的島在旋轉時會一直被裁切,轉到側面時看起來像殘缺,不建議。

### 方案 C:島當作標題的大型襯底

```
桌機(1440×900)
┌──────────────────────────────────────────────────────────────┐
│ Tripace                                  [◐] [功能介紹] [登入]│
│              ╭ · · · · · · · · · · · · · · ╮                 │
│            ·       TRAVEL PLANNING            ·              │
│           ·         走進一個地方               ·              │  島 ≈ min(92vh, 900px)
│           ·  (島,opacity 0.35、模糊 0)       ·              │  置中、在文字後面
│           ·         而不只是到過               ·              │
│            ·   從地景、歷史、人文到日常生活……  ·              │
│              ·       ( 開始探索 ↓ )         ·                │
│ ～～～～～～～～～～～～～～～～～～～～～～～～～～～～～～～～～～～ │
└──────────────────────────────────────────────────────────────┘
平板/手機:同上,島 ≈ 120vw(左右超出被 hero 的 overflow: hidden 裁掉)。
```

- **大小與位置**:置中,桌機 `min(92dvh, 900px)`,手機 `120vw`;透明度 0.3~0.4。
- **誰先被看到**:理論上標題,但標題壓在旋轉的島上,移動中的背景會一直干擾閱讀。
- **疊放**:山稜 z0 → 島 z1(半透明)→ 文字 z2,文字後面還要加一層 `--paper` 的柔光底(`radial-gradient`)保證對比。
- **卡片或無邊框**:只能無邊框。
- **優點**:最有氣勢,第一眼就知道「這是一座島」。
- **缺點**:違反「不搶走標題」;半透明的低多邊形島會變成灰灰髒髒的一團,燈籠的紅也被稀釋;canvas 邊長接近 900px,dpr 1.5 下是 1350² 的繪製面積,GPU 成本約是方案 A 的 2.6 倍;標題的對比度在暗色主題下很難保證符合 WCAG AA(未驗證)。**不建議。**

### 方案 D(我提出的折衷):hero 不放島,在 hero 與 ScrollPlanDemo 之間加一段「島帶」

```
┌─────── hero(完全不動)───────┐
│  ……原本的標題與按鈕……       │
└──────────────────────────────┘
┌─────── .home-island(新區塊,約 80vh)───────┐
│   一篇遊記 · 一座島        ╭──────────────╮  │
│   〈夜遊九份〉……說明……       │    島 520    │  │
│   [ 讀這篇遊記 → ]         ╰──────────────╯  │
└──────────────────────────────────────────────┘
┌─────── ScrollPlanDemo ───────┐
```

- **優點**:首屏零風險(hero 一行都不改,島一定在首屏之外,IntersectionObserver 天然延後載入);島有自己的文案空間。
- **缺點**:不符合這次的要求(放進 hero);首頁本來就已經很長(ScrollPlanDemo 是 900vh),多一段會讓目的地清單更遠。列在這裡當作「若方案 A 實測效能不過關」的退路。

### 方案比較

| | A 並排/疊下方 | B 底部雲海 | C 大型襯底 | D 獨立區塊 |
|---|---|---|---|---|
| 展示模型(桌機島大小) | ◎ 500~560px | △ 280~380px | ◎ 但半透明 | ◎ 520px |
| 不搶標題與按鈕 | ○ | ◎ | ✕ | ◎ |
| 首屏效能風險 | ○(延後載入即可) | ○ | ✕(大畫布) | ◎ |
| 對現有構圖的改動 | 中(桌機改靠左) | 小 | 小 | 無 |
| CSS 複雜度 | 中(兩種模式) | 低 | 中 | 低 |

**卡片式還是無邊框?** 全部建議無邊框。理由:(1)首頁視覺語言是大片暖米色留白與細線,沒有任何圓角底板卡片,只有按鈕是膠囊;(2)縮小版的 canvas 本來就是透明背景,設計意圖就是「島直接浮在頁面上」;(3)卡片底板會把島框成「一個嵌入的元件」,削弱「這個地方本身」的感覺。代價是島的範圍沒有明確邊界,可點擊性要靠文字提示補(見第 5 章)。

---

## 3. 建議方案:A(桌機並排、窄螢幕疊下方),並借用 B 的落地處理

理由,依三個目標:

1. **展示模型**:寬螢幕佔首頁訪客多數(未驗證,要看 GA),A 是唯一能在 1366×768 給到 500px 以上而不遮文字的排法;窄螢幕下跟 B 一樣疊在下方,iPhone 14 約 320px、iPad 直式 440px,都夠看清燈籠與茶樓。
2. **不搶標題與按鈕**:標題永遠在閱讀順序的第一位(桌機在左、窄螢幕在上);島晚 1~2 秒才淡入;島下方只放一行小字,不放第二顆實心按鈕,「開始探索」維持 hero 唯一的主要動作。
3. **不拖慢首屏**:島的版位由 CSS 先算好(零 CLS);three 與模型等到 `load` 事件後的閒置時間才下載;canvas 不是 LCP 候選元素,LCP 仍是標題文字(細節見第 6 章)。

從 B 借來的:島腳的地面陰影與「停在山稜上」的位置(往下偏、島腳壓在山稜帶),讓並排的島不像隨便擺在右邊的插圖。B 的霧帶不採用(會蓋掉島底,並排時也沒有雲海的上下文)。

---

## 4. 視覺細節規格(方案 A)

### 4.1 版面與尺寸

新的 DOM(`HomePage.tsx` 的 hero 內部):

```
section.hero
├─ svg.hero-ridge                     (z0,不動)
├─ div.hero-copy                      (z2,新包裝,內含原本四個元素,順序不變)
└─ div.hero-stage                     (z1,新)
    └─ a.hero-island(或 div,見第 5 章)
        ├─ span.hero-island-halo      (背景光暈)
        ├─ span.hero-island-shadow    (地面陰影)
        ├─ div.hero-island-canvas     (MiniIsland 的 container,canvas 插在這裡)
        └─ span.hero-island-caption   (一行說明)
```

DOM 順序:文字組在前、島在後,所以 Tab 順序是「開始探索」→ 島。

CSS(數值):

```css
.kyoto-bloom .hero {
  /* 保留原本的 height: 100dvh、overflow: hidden、背景;新增: */
  isolation: isolate;
  justify-content: flex-start;          /* 窄螢幕:文字靠上、島吃剩下的高度 */
  padding-top: calc(var(--site-nav-h) + clamp(16px, 4vh, 40px));
  padding-bottom: clamp(16px, 3vh, 32px);
}
.kyoto-bloom .hero-ridge { z-index: 0; }
.kyoto-bloom .hero-copy  { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; }
.kyoto-bloom .hero-stage {
  position: relative; z-index: 1;
  flex: 1 1 0; min-height: 0; width: 100%;
  margin-top: clamp(12px, 3vh, 32px);
  container-type: size;                 /* 讓島用 cqw/cqh 取「剩下的寬與高」 */
  display: grid; place-items: center;
}
.kyoto-bloom .hero-island {
  --island: min(100cqw, calc(100cqh - 28px), 440px);  /* 28px 留給說明文字 */
  position: relative; width: var(--island); aspect-ratio: 1 / 1;
}
/* 剩下的高度太小:整個島讓位(JS 也據此不載入,見 6.2) */
@container (max-height: 200px) { .kyoto-bloom .hero-island { display: none; } }

/* 桌機並排 */
@media (min-width: 1024px) and (min-aspect-ratio: 5/4) {
  .kyoto-bloom .hero {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: clamp(32px, 4vw, 72px); align-items: center;
    padding-inline: max(var(--edge-pad), calc((100vw - 1180px) / 2));
    padding-bottom: clamp(32px, 8vh, 80px);
    text-align: left;
  }
  .kyoto-bloom .hero-copy { align-items: flex-start; }
  .kyoto-bloom .hero-sub  { max-width: 30em; }
  .kyoto-bloom .hero-stage { height: min(calc(100dvh - 180px), 600px); margin-top: 2dvh; }
  .kyoto-bloom .hero-island { --island: min(100cqw, calc(100cqh - 28px), 560px); }
}
```

`.hero-ridge` 是 absolute,不參與 grid,維持全寬貼底。`container-type: size` 需要 Chrome 105+/Safari 16+,舊瀏覽器不認得時 `cqw/cqh` 無效、`--island` 整條宣告失效,所以前面先寫一條 `width: min(86vw, 360px)` 當退路。flex 子元素 `flex: 1 1 0` 在 `height: 100dvh` 的容器裡會得到確定的高度,container query 才算得出來——**需以 chrome-devtools 在 5 個視窗尺寸驗證**(1440×900、1366×768、820×1180、390×844、375×667)。

### 4.2 地面陰影(CSS)

島沒有海也沒有陰影,浮在空中會沒有重量。在島下方畫一個壓扁的橢圓:

```css
.hero-island-shadow {
  position: absolute; left: 50%; top: 82%;          /* 島底在正方形內的位置:推論約 80~85%,要實測微調 */
  width: 62%; height: 9%; transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--island-shadow), transparent);
  filter: blur(6px);
}
```

- 亮色:`--island-shadow: rgba(43, 36, 32, 0.22)`(就是 `--ink` 的 RGB),跟首頁 `--card-shadow` 同色系,不會出現冷灰色的「髒」陰影。
- 暗色:陰影在深棕背景上看不見,改成**燈籠的倒影**:`--island-shadow: rgba(214, 58, 47, 0.20)`(燈籠紅 `#d63a2f`),外圈再疊一層 `rgba(255, 193, 90, 0.06)`(暖黃光 `#ffc15a`),像燈火照在下方的雲上。
- 陰影是靜態的,不跟著島轉(島是繞垂直軸旋轉,投影形狀本來就差不多)。

### 4.3 主題背景襯托(光暈)

```css
.hero-island-halo {
  position: absolute; inset: -8%; border-radius: 50%;
  background: radial-gradient(closest-side, var(--island-halo), transparent 72%);
  pointer-events: none;
}
```

- **亮色**(`--paper #F7F3EC`,島是 17:30 夕陽):島本身已經是暖橘調,放在暖米色上容易「糊在一起」、邊緣像沾到灰。光暈用比紙更亮一點的米白 `--island-halo: color-mix(in srgb, #fffaf2 85%, transparent)`,把島從背景托起來;**不要**用灰色或冷色光暈。島的黑瓦 `#2e3440` 提供足夠的明度對比。
- **暗色**(`--paper #1C1815` 暖深棕,島是 19:30 藍紫夜):島的藍紫冷色在暖棕背景上會顯得突兀(試作頁是在深藍紫 `#14112a` 上調的)。光暈用夜空藍紫 `--island-halo: rgba(43, 47, 90, 0.45)`(視覺規劃的夜空色 `#2b2f5a`),在島後面挖出一小塊「夜空」,讓冷背景、暖光點的配色策略在局部成立,紅燈籠才會跳出來。這個值**一定要實看**再調,可能要搭配調 `miniLightBoost` 的暗色係數。
- 光暈與陰影都是 CSS 漸層,不在 canvas 裡,換主題時跟著 CSS 變數立即切換。

### 4.4 進場動畫

時序(以「島的第一幀畫完」為 t=0,實際發生在頁面 `load` 之後 1~2 秒):

| 時間 | 元素 | 變化 | 緩動 |
|---|---|---|---|
| 載入前 | 光暈 + 陰影 | 首屏就已顯示(靜態,opacity 0.6),版位先佔好 | — |
| 載入前 | 骨架 | **不用試作頁的 shimmer 骨架**:放在 hero 裡會像「東西壞了正在載入」,而且一直閃會搶標題。只留光暈與陰影當佔位。 | — |
| 0 ~ 900ms | canvas | opacity 0 → 1 | `cubic-bezier(0.22, 1, 0.36, 1)` |
| 0 ~ 1200ms | canvas | `translateY(14px) scale(0.94)` → `translateY(0) scale(1)`(島從略低略小浮起) | 同上 |
| 0 ~ 1200ms | 陰影 | `scale(0.82)` opacity 0.6 → `scale(1)` opacity 1(島浮起時陰影變實) | 同上 |
| 600 ~ 1100ms | 說明文字 | opacity 0 → 1 | `ease-out` |

這條曲線就是 `ScrollPlanDemo.module.css` 的 `.stickyRevealHole` 已在用的 `cubic-bezier(0.22, 1, 0.36, 1)`,全頁動態手感一致。

**減少動態**:`HomePage.css` 既有的 `@media (prefers-reduced-motion: reduce)` 已經把 `.kyoto-bloom *` 的 transition/animation 壓到 0.01ms,會自動讓上表全部變成瞬間出現;另外 JS 端只畫一幀、不啟動迴圈(島停在角度 0,也就是從南方看、茶樓在左上的封面角度),粒子也不動。

### 4.5 視差

**不加**。理由:島已經在轉,同時再有捲動或滑鼠視差就是兩種動態疊在一起,違反首頁極簡;hero 是固定 100dvh 的區塊,捲動視差只有短短一個螢幕有效,卻要多掛一個 scroll 監聽,跟 ScrollPlanDemo 的捲動驅動邏輯搶主執行緒。也不加上下漂浮的 bob 動畫(同理,一次只做一種動態)。

### 4.6 島周圍的文字標註

**不放指向燈籠的標註**。島每 48 秒轉一圈,燈籠位置一直在移動,靜態的指示線會在大部分時間指向空處;要跟著 3D 位置移動就得把標註投影計算搬進來,成本與干擾都不值得。改成島下方一行固定說明文字(見第 5 章),內容可以提到燈籠,但不「指」。

---

## 5. 內容與文案

### 5.1 hero 主文案

**不改**。「走進一個地方 而不只是到過」講的是品牌主張,島是這個主張的一個例證,不需要為了島改寫。eyebrow「Travel Planning」也保留。

### 5.2 島下方的一行說明(`.hero-island-caption`)

樣式:13px、`--ink-soft`、字距 0.04em,置中於島下方 8px;前面接一枚跟 `.destination-tag` 同款的小膠囊(11px、`--vermilion` 字、12% 底色、35% 邊框),桌機並排時一樣置中於島下方。

**重要的誠實問題**:目前這座島的版面(`island/layout.ts`)是依照文章**人工設計**的,「由程式從文章自動生成」還只是第 10 章的構想(README 已知限制也寫「由程式生成版面都還沒做」)。所以文案**不能寫「自動生成」**,在生成管線完成前要用「依據/根據一篇遊記做成」這類說法。

| 組 | 膠囊 | 說明文字 | 適合 |
|---|---|---|---|
| 1(建議) | 遊記小島 | 〈夜遊九份〉的四個站點,做成一座會亮燈的島 → | 現在就可用,講清楚島和文章的關係 |
| 2 | 一篇遊記 · 一座島 | 傍晚上山,紅燈籠沿著石階亮起 → | 偏情緒,適合暗色主題(燈籠全亮時) |
| 3(生成管線上線後) | 由部落客文章生成 | 寫下你的旅程,它也能變成一座島 → | 等第 10 章的自動生成真的做好才換上 |

### 5.3 可不可以點?

可以,**整個 `.hero-island` 是一個 `<a>`**:

- **連到哪裡**:完整版島目前只在 island-demo 的開發伺服器(5177),主網站沒有對應路由。所以第一階段連到**原文 `/u/tim72117/night-jiufen`**(首頁目的地清單已有這一項,頁面確實存在);等完整版上線有正式路由再改連過去(第 11 章 Q4)。
- **點擊區域**:整個正方形 + 說明文字。canvas 本來就是 `pointer-events: none`,點擊會落在外層 `<a>` 上。
- **可點提示**:因為無邊框,要靠三件事讓人知道能點:說明文字結尾的 →;桌機 hover 時島 `translateY(-4px)`、陰影 `scale(1.06)`、說明文字變 `--vermilion`、箭頭右移 4px(跟 `.destination-item:hover .destination-arrow` 同一套語言),過渡 0.25s ease;觸控裝置(`@media (hover: none)`)沒有 hover,→ 常駐即可。游標 `cursor: pointer`。
- **不影響手機捲動**:`<a>` 本身不攔截觸控捲動,單指滑過島仍是捲頁面,只有「點一下」才會導頁;canvas 不收事件、不需要 `touch-action` 設定。要避免的是任何 `touchstart` 的 `preventDefault`(縮小版本來就沒有)。
- **追蹤**:點擊送 `trackEvent('landing_island_click', { target: 'article' })`,對齊既有 `landing_*` 事件命名。
- **無障礙**:
  - `<a href="/u/tim72117/night-jiufen" aria-label="夜遊九份遊記小島:依據遊記〈夜遊九份〉做成的低多邊形小島模型,紅燈籠沿著石階亮起。前往閱讀這篇遊記">`
  - 內部的 canvas container、光暈、陰影全部 `aria-hidden="true"`;說明文字因為已含在 aria-label 中,也加 `aria-hidden`,避免唸兩次。
  - 焦點樣式:`:focus-visible { outline: 2px solid var(--vermilion); outline-offset: 6px; border-radius: 24px; }`(島無邊框,焦點框是唯一能看到範圍的時候)。

---

## 6. 效能與載入策略

### 6.1 LCP 仍是標題

- LCP 候選只有圖片、影片封面、背景圖片與文字區塊;**canvas 不是候選**。所以「即時繪製的島」不會搶走 LCP,LCP 會是 `.hero-title`(或面積更大的 `.hero-sub`,未驗證哪一個較大,但都是文字、不受島影響)。
- **反過來,靜態封面圖會變成 LCP 候選**:560×560 的圖比標題(約 600×170)面積大,如果它晚於標題才畫出,最終 LCP 會被記成那張圖、時間被拉長。這是第一階段**不放封面圖**的主要理由(見 6.4)。

### 6.2 何時載入

```
首屏 HTML/JS → 標題畫出(LCP)→ window 'load'(含 ScrollPlanDemo 的 264KB 地圖 PNG)
   → requestIdleCallback(timeout 2500ms;Safari 沒有 rIC,退回 setTimeout 1200ms)
   → 檢查條件 → import('./heroIsland/loadHeroIsland')(three + 模型)→ 建立 MiniIsland → 第一幀 → 淡入
```

- **不用 IntersectionObserver 當載入時機**:島在首屏,一開頁就「在畫面中」,用 IO 等於立刻載入,會跟首屏資源搶頻寬。IO 只拿來做「離開畫面暫停」。
- 等 `load` 事件有個好處:ScrollPlanDemo 的地圖 PNG(沒有 `loading="lazy"`,首屏就會下載)已經下載完,不會互搶。
- 使用者若在載入前已經捲離 hero,仍然照樣載入(下載在背景),但不啟動迴圈;要再省可以改成「捲離時取消」,我認為不必要。
- **不載入的條件**(純函式,好測試):
  1. `navigator.connection?.saveData === true`(省流量模式);
  2. 島的容器實際邊長 < 200px(`@container` 已把它隱藏,JS 讀 `clientWidth === 0` 即可判斷);
  3. 不支援 WebGL(先用 `document.createElement('canvas').getContext('webgl2') || getContext('webgl')` 試探,成本很低);
  4. 減少動態**仍然載入**,但只畫一幀。

### 6.3 版位保留(CLS)

島的大小完全由 CSS(4.1)決定,canvas 只是填進已經有尺寸的容器、`position: absolute; inset: 0`,所以載入前後版面不動,**島帶來的 CLS = 0**(要用 chrome-devtools 的 Performance 面板確認)。

### 6.4 骨架 vs 靜態封面圖

| | 只用光暈+陰影佔位(建議第一階段) | 靜態封面圖 |
|---|---|---|
| 首屏成本 | 0 位元組 | 一張 WebP,估 30~60KB(未驗證) |
| LCP 風險 | 無 | 會成為 LCP 候選(見 6.1) |
| 不支援 WebGL / 省流量 | 只剩光暈,島的位置是空的 | 有完整的島 |
| 維護 | 無 | 島一改就要重產兩張(亮/暗) |

建議第一階段不做封面圖,失敗情況直接讓整個 `.hero-stage` 收起(`display: none`,文字組回到垂直置中,見 6.6)。若之後要做,封面圖的產出方式(**本次不產**):

1. 在 `mini.html` 加 `?capture` 參數:畫完一幀後同步呼叫 `renderer.domElement.toBlob()` 下載透明背景 PNG(與 implementation-plan 5.9 的「render 後立刻 toBlob」同一個作法;該作法也標了未驗證)。亮/暗各一張,尺寸 1120×1120(2 倍於 560)。
2. 重用 `src/three/capture.ts` 的 `captureImage`,但它是為完整版加署名浮水印設計的,要加參數關掉浮水印。
3. 轉檔:`cwebp -q 82 -alpha_q 90` 或 `avifenc`,目標 ≤ 60KB。
4. 用 `<img loading="lazy" decoding="async" width height>` 只在失敗路徑插入,降低成為 LCP 的機會(仍可能成為候選,要實測)。

### 6.5 手機降級

- 不完全不載入,而是降級:手機上島邊長最多 440px,pixelRatio 已上限 1.5;`navigator.hardwareConcurrency <= 4` 時再降到 1.25(Safari 這個值會回報實際核心數或被限制,未驗證)。
- 迴圈改成約 30fps:48 秒一圈 = 每秒 7.5°,30fps 下每幀 0.25°,肉眼看不出差別,GPU 工作量減半。做法是在 `frame` 裡累積時間,未滿 1/30 秒就跳過繪製(純函式 `shouldDrawFrame(accum, interval)` 可測)。桌機也可以一律 30fps——建議先一律套用,實看覺得卡再只對手機套。

### 6.6 省電、失敗與 context lost

- 暫停:沿用 `shouldRun`(離開畫面、分頁隱藏、context lost 時停),IO 改觀察 `.hero-island`,`rootMargin: '0px'`(不需要提前 240px,因為已經載好了)。
- **WebGL 建立失敗**(`createMini` 丟例外):`.hero` 加 class `is-island-off`,`.hero-stage` 收起,文字組恢復 `justify-content: center` 的原始排版。不留空白骨架。
- **context lost**:立刻 `setRunning(false)`,canvas 淡出 300ms;`webglcontextrestored` 時**整個 dispose 後重建一個 MiniIsland**,而不是相信 three 會自動把所有幾何重新上傳(three 在 restore 後的狀態恢復是否完整,本專案未驗證,重建最穩)。重建失敗就走上一條的收起路徑。
- 離開首頁(元件 unmount)時 `dispose()`,釋放 GPU 記憶體。

### 6.7 與 ScrollPlanDemo 的資源競爭

- ScrollPlanDemo 沒有用 WebGL(讀到的是一張靜態 PNG 地圖 `ai-plan-demo-map.png` 加 DOM 動畫),**不會搶 WebGL context**。
- 網路:島等 `load` 之後才下載,地圖 PNG 先到。
- 主執行緒:ScrollPlanDemo 靠捲動推進;使用者捲進它時 hero 已經離開畫面,島已暫停,不會同時跑。風險只在「島的場景建構(地形、散落物避障計算)是一個長任務,剛好在使用者開始捲動時發生」,會造成第一下捲動卡頓。要實測。

### 6.8 預算(可驗證的數字)

| 項目 | 預算 | 怎麼驗證 | 目前狀態 |
|---|---|---|---|
| HomePage chunk 增加量 | ≤ 3KB gzip(只有外殼元件與 CSS) | `vite build` 輸出 | 需要實測 |
| 島的 lazy chunk(three + 模型 + 縮小版) | ≤ 180KB gzip | `vite build` 輸出 | 我量了完整未 tree-shake 的 `three.module.min.js`,gzip -9 約 167KB;tree-shake 後估 120~140KB。模型 + 版面原始碼約 77KB(未壓縮),估 gzip 15~25KB。**需要實測** |
| 開始下載時間 | 不早於 `load` 事件 | Performance 面板看 three chunk 的請求起點 | — |
| LCP 元素 | `.hero-title` 或 `.hero-sub` | Performance 面板 LCP 標記 | 需要實測 |
| 島造成的 CLS | 0 | Performance 面板 Layout Shift | 需要實測 |
| 場景建構長任務 | 桌機 ≤ 50ms、中階手機 ≤ 150ms(用 CPU 4x 節流模擬) | Performance 面板 | 需要實測;超標就把 `createMini` 拆成兩段、中間讓出主執行緒 |
| 繪製呼叫 | ≤ 40 / 幀 | 試作頁 `?debug` 會顯示 calls | 未驗證(MiniIsland 註解只說「數量少」) |
| 運轉時 GPU | 30fps 下,桌機 GPU 佔用肉眼看不出、筆電風扇不起來 | 主觀 + Performance 面板 GPU 列 | 需要實測 |

---

## 7. 工程整合方案

### 7.1 三種做法比較

| | ① 主網站加 three,直接引用 island-demo 的縮小版原始碼 | ② island-demo 獨立打包,首頁用 iframe 嵌入 | ③ 維持獨立,首頁只放封面圖 + 連結 |
|---|---|---|---|
| 首頁看到的是 | 即時 3D | 即時 3D | 靜態圖 |
| 傳輸量 | three 約 130KB gzip(lazy chunk)+ 模型 | 同左,外加一份 iframe 的 HTML 與 island-demo 自己的執行環境;快取與主網站分開 | 一張圖 30~60KB |
| 主題同步 | React prop → `setTheme`,同步、零延遲 | `postMessage`,要寫雙向協定;iframe 背景透明需要 iframe 內文件 `background: transparent`(可行,未驗證各瀏覽器) | 兩張圖切換 |
| 減少動態/省電 | 直接共用 | iframe 內自己判斷,可以 | 無 |
| 部署 | 跟主網站一起 build,Dockerfile 不用改(island-demo 原始碼已隨 `COPY web/ ./` 進入建置環境;`.dockerignore` 排除 `**/node_modules/`,three 會從 `web/node_modules` 解析) | Dockerfile 要多建一個 Vite 專案、Go server 要多掛一個靜態目錄(`cmd/server/static.go` 只 embed `web/dist`)、要處理 `frame-ancestors` | 不用改 |
| 維護 | 縮小版只有一份原始碼;但主網站的 tsc 會型別檢查到被引用的 island-demo 檔案 | 兩個建置流程 | 島一改就要重產圖 |
| 對 vitest/tsc | 上層 vitest 本來就掃到 `island-demo/**/*.test.ts`(exclude 沒排除),跑的是上層 vitest 4,而 island-demo 自己是 vitest 2;加 three 之後這些測試不會再因缺 three 失敗,但仍重複執行。上層 `tsc -b` 只 include `src`,但**會沿著 import 型別檢查被引用到的 island-demo 檔案**,所以那些檔案也要通過上層 tsconfig(兩邊選項幾乎一樣:strict、noUnused*;上層有 `src/vite-env.d.ts` 提供 `import.meta.glob` 型別) | 互不影響 | 互不影響 |

### 7.2 建議:①,用相對路徑引用、不複製程式

- **為什麼不複製一份到 `web/src/island/`**:完整版還在演進(模型、光照、燈籠),複製後兩份一定會走鐘。用「主網站一個橋接檔 re-export island-demo 的 `createMini`」,縮小版只有一份原始碼,island-demo 依然能獨立開發與測試。
- **為什麼不用 iframe**:部署要多一條流程與 Go server 改動,主題同步要寫協定,換來的只是隔離,而 lazy chunk 已經提供足夠的隔離(不載入就不付成本)。iframe 留給未來「嵌入外站部落格」(implementation-plan 10.2),那是另一件事。
- **為什麼不只放圖**:首頁放島的目的就是「展示模型」,靜態圖做不到旋轉帶來的立體感;③ 適合當 ① 效能不過關時的退路。

具體做法:

1. `web/package.json` 加 `three: 0.170.0`(dependencies)、`@types/three: 0.170.0`(devDependencies),**版本鎖死跟 island-demo 一致**。
2. `web/vite.config.ts` 加 `resolve: { dedupe: ['three'] }`——本機開發時 island-demo 有自己的 `node_modules/three`,從 island-demo 原始碼 import `three` 會解析到那一份,主網站又有一份,dedupe 強制只用主網站那份,避免打包兩份 three。Docker 建置時 island-demo 沒有 node_modules,往上找會自然找到 `web/node_modules`。
3. `web/vite.config.ts` 的 `test.exclude` 加 `'island-demo/**'`,比照 `admin/**`(island-demo 的測試由它自己的 vitest 2 跑)。**這是 implementation-plan 2.5 明確寫「要使用者同意後才改」的地方。**
4. 新檔 `web/src/home/heroIsland/loadHeroIsland.ts`:唯一一行跨專案 import,`export { createMini } from '../../../island-demo/src/mini/loadMini'`。HomePage 只透過動態 `import('./heroIsland/loadHeroIsland')` 碰它,保證 three 在獨立 chunk。

---

## 8. 亮暗主題接法

- 首頁目前的狀態:`theme`(null/dark/light)+ `systemPrefersDark`,算出 `isCurrentlyDark(theme)`。這個布林值就是唯一需要傳給島的東西:`<HeroIsland theme={isCurrentlyDark(theme) ? 'dark' : 'light'} />`。
- `HeroIsland` 內部:建立時把當下的 `theme` 傳給 `createMini`;之後 `useEffect([theme])` 呼叫 `island.setTheme(theme)`。「跟隨系統」時系統切換會改 `systemPrefersDark` → 重新 render → 同一條 effect,不用另外監聽 matchMedia。
- 首頁的 `systemPrefersDark` 是同步讀初值,所以島建立時就拿到正確主題,不會先亮後暗。若日後把首頁改用 `useThemeToggle`(它的初值是 false、effect 後才更新),因為島要等 `load` + 閒置才建立,那時 effect 早已跑完,也不會閃——但要寫一條測試釘住「建立時用的是當下主題」。
- **過場**:首頁的 `--paper` 等色票切換是瞬間的(`.kyoto-bloom` 背景沒有 transition),島的 `setTheme` 也是瞬間換光照,兩者同步瞬間切換最一致。不另做淡入淡出;若實看覺得島的光照跳變太突兀,再加「canvas opacity 1 → 0.4 → 1,共 360ms」的短暫過場(減少動態時不做)。
- 縮小版試作頁的 `applyPageTheme`(改 `document.documentElement` 的 `data-theme`)是試作頁外殼的行為,不在 `createMini` 裡,不會影響主網站。

---

## 9. 可近用性與 SEO

- **它是內容還是裝飾?** 對螢幕閱讀器與爬蟲而言是**帶有說明的連結**:3D 畫面本身是裝飾(`aria-hidden`),意義由連結的 `aria-label` 與可見的說明文字承載(見 5.3)。若第一階段決定島不可點,就改成 `<figure>` + 可見 `<figcaption>`,canvas 容器 `role="img"` 加 aria-label(與試作頁 `mini.html` 一致)。
- **鍵盤**:可點時是一般的 `<a>`,Tab 順序在「開始探索」之後;焦點框見 5.3。canvas 不可聚焦、沒有任何鍵盤操作(本來就不能拖曳)。
- **減少動態**:畫一幀靜止,不跑迴圈(4.4)。
- **爬蟲**:canvas 對爬蟲是空的;說明文字與 `<a>` 的 href 是真正的 HTML 文字,會被讀到。首頁的 `<title>`/`og:*` 在 `index.html` 裡由伺服器改寫(`vite.config.ts` 註解提到 `seo_meta.go`),不需要因為島而改;`og:image` 不換成島(待使用者決定,Q6)。
- **對比**:說明文字用 `--ink-soft` 13px,在亮/暗兩種 `--paper` 上的對比沿用首頁其他 `--ink-soft` 文字,未另行量測。

---

## 10. 實作步驟

| # | 內容 | 新增/修改的檔案 | 完成標準 | 驗證 |
|---|---|---|---|---|
| 1 | 取得使用者同意:主網站加 three、vitest 排除 island-demo、桌機文字是否靠左(第 11 章 Q1~Q3) | 無 | 使用者明確回覆 | — |
| 2 | 縮小版純邏輯補強:`shouldDrawFrame`(30fps 節流)、`heroIslandMode({ saveData, webgl, sizePx, reducedMotion }) → 'off' \| 'still' \| 'live'`;修 `autoRotateEnabled` 的過時註解 | `island-demo/src/logic/mini.ts`、`mini.test.ts` | 新函式有測試涵蓋每個分支 | island-demo `npm test`、`npx tsc --noEmit` |
| 3 | MiniIsland 行為修正:減少動態時 `setRunning(true)` 不啟動迴圈(只 renderOnce);`frame` 套用 30fps 節流;canvas 加 `aria-hidden="true"` | `island-demo/src/mini/MiniIsland.ts`(必要時 `main.ts`) | 讀程式確認 reducedMotion 路徑不會呼叫 `setAnimationLoop(this.frame)` | island-demo `npm test`、`tsc`;讀程式 |
| 4 | 主網站加相依與建置設定:three/@types/three 0.170.0、`resolve.dedupe`、`test.exclude` 加 `island-demo/**` | `web/package.json`、`package-lock.json`、`web/vite.config.ts` | `npm ci` 後 `tsc -b` 通過 | `npx tsc -b`、`npx vitest run`(確認不再跑到 island-demo 測試) |
| 5 | 橋接檔 | 新增 `web/src/home/heroIsland/loadHeroIsland.ts` | 只 re-export `createMini` | `tsc -b` 通過(會一併型別檢查被引用的 island-demo 檔案) |
| 6 | 載入排程純函式:`scheduleHeroIslandLoad({ onReady, win })`(等 load → rIC/setTimeout 退路)與 WebGL 試探 | 新增 `web/src/home/heroIsland/schedule.ts`、`schedule.test.ts` | load 前不觸發;沒有 rIC 時走 setTimeout;卸載時能取消 | `npx vitest run src/home/heroIsland` |
| 7 | `HeroIsland` 元件:動態 import、建立/釋放、IO 暫停、visibilitychange、context lost 重建、theme effect、失敗時回呼 `onUnavailable` | 新增 `web/src/home/heroIsland/HeroIsland.tsx`、`HeroIsland.module.css` | 元件不直接 import three(只動態 import 橋接檔) | `HeroIsland.test.tsx`(jsdom,mock 橋接檔):載入前不呼叫 `createMini`、theme 改變時呼叫 `setTheme`、unmount 時 `dispose`、建立失敗時呼叫 `onUnavailable`、減少動態時不呼叫 `setRunning(true)` |
| 8 | 首頁 hero 結構:包 `.hero-copy`、加 `.hero-stage` 與 `<a class="hero-island">`、aria-label、trackEvent、`is-island-off` 退路 | `web/src/home/HomePage.tsx` | DOM 順序文字在前、島在後 | 新增 `HomePage.heroIsland.test.tsx`:連結 href 與 aria-label 正確、說明文字存在、`onUnavailable` 後 hero 有 `is-island-off` |
| 9 | 首頁 CSS:z-index 三層並登記到清單註解、窄螢幕/桌機兩種排法、container query、光暈/陰影/進場動畫/hover/focus-visible、暗色變數 | `web/src/home/HomePage.css` | 所有數值與第 4 章一致 | 讀 CSS 對照第 4 章;`tsc -b`、`vitest run` 全綠 |
| 10 | 建置大小檢查 | 無(只執行 `vite build`,由協調者決定是否執行) | HomePage chunk 增加 ≤ 3KB gzip、島 chunk ≤ 180KB gzip、three 只出現一份 | 讀 build 輸出 |
| 11 | 最後階段:協調者用 chrome-devtools 看一輪 | 無 | 5 個視窗尺寸 × 亮/暗 × 減少動態開/關;Performance 面板記錄 LCP 元素、CLS、three chunk 請求起點、場景建構長任務;模擬 CPU 4x 節流 | chrome-devtools |
| 12 | 依實看結果微調陰影位置(`top: 82%`)、暗色光暈值、`miniLightBoost` 暗色係數;更新 CHANGELOG(版號依慣例問使用者) | `HomePage.css`、`island-demo/src/logic/mini.ts`、`CHANGELOG.md` | 使用者確認畫面 | 重跑兩邊測試與 tsc |

---

## 11. 風險與待使用者決定的事

### 風險

1. **暗色主題配色衝突**:縮小版的夜晚島是對著深藍紫背景調的,首頁暗色是暖深棕。藍紫島放在暖棕上可能顯得像貼上去的。對策是 4.3 的藍紫光暈 + 重調 `miniLightBoost`,但**一定要實看**。
2. **首屏後的長任務**:場景建構(地形、散落物避障、實例化)在主執行緒一次做完,時間未量測;若在中階手機超過 150ms,剛好撞上使用者第一次捲動會卡。對策:實測後拆段,或手機改成「使用者第一次捲動停止後才建立」。
3. **container query 版面在舊瀏覽器退化**:Safari 15 以前沒有 `cqw/cqh`,會落到 `min(86vw, 360px)` 的退路寬度,窄螢幕可能超出剩餘高度被 `overflow: hidden` 裁切。
4. **文案誠實性**:目前島不是自動生成的,寫錯會變成誇大宣傳(已在 5.2 處理)。
5. **兩份 three 被打包**:`dedupe` 沒設好的話,本機建置可能打包兩份;步驟 10 要檢查。
6. **上層 tsc 開始檢查 island-demo 原始碼**:之後在 island-demo 裡寫了只過自己 tsconfig、不過上層 tsconfig 的程式(例如上層多了 `jsx` 設定等差異),會讓主網站 build 失敗。兩邊 tsconfig 目前幾乎相同,風險低但存在。

### 待決定

| # | 問題 | 我的預設建議 |
|---|---|---|
| Q1 | 桌機 hero 文字要從置中改成靠左(方案 A),還是維持置中、改用方案 B(島較小)? | 改靠左,用 A。若很在意置中對稱,改 B,接受筆電上島只有約 280~380px。 |
| Q2 | 同意主網站加 `three@0.170.0` 相依(lazy chunk 約 130KB gzip,首屏不載)嗎? | 同意。 |
| Q3 | 同意在 `web/vite.config.ts` 的 vitest exclude 加 `island-demo/**` 嗎? | 同意(現在已經在重複跑 island-demo 測試,且兩邊 vitest 主版本不同)。 |
| Q4 | 島點下去連到哪? | 第一階段連原文 `/u/tim72117/night-jiufen`;完整版有正式路由後改連完整版。 |
| Q5 | 島下方說明用哪一組文案? | 第 1 組「遊記小島/〈夜遊九份〉的四個站點,做成一座會亮燈的島 →」。 |
| Q6 | 要不要做靜態封面圖(給不支援 WebGL/省流量者),以及是否拿來當首頁 `og:image`? | 第一階段都不做:失敗時直接收起島;`og:image` 維持現有品牌圖。 |
| Q7 | 手機要不要載入即時 3D? | 要,但 30fps、剩餘空間 < 200px 時不載入;實測長任務超標再改成捲動後才建立。 |
| Q8 | 減少動態偏好時,島要顯示靜止的一幀,還是乾脆不載入? | 顯示靜止一幀(仍是有效的模型展示,而且不動)。 |
| Q9 | 迴圈要不要一律 30fps(桌機也是)? | 一律 30fps,實看覺得不順再只對手機套用。 |
