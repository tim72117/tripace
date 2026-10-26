# island——夜遊九份島(部落客文章 → 互動 3D 旅遊小島)

由部落客文章生成的單一座低多邊形小島(three.js)。內容是平台上的真實文章「夜遊九份」(4 站),體驗是傍晚到夜晚、
紅燈籠沿步道一盞一盞亮起。兩個使用處:

- **完整版**:路由 `/island`(`IslandPage.tsx` → `mountIsland.ts`):旋轉縮放、點站看資訊卡、時間滑桿與播放、封面視角、
  導覽模式、分享圖(附署名)、「用 Tripace 排我的九份」按鈕。公開頁,有專屬 SEO(`seo.ts` ↔ 伺服器 `seo_meta.go`、`static.go`、`sitemap.xml`)。
- **縮小版**:首頁 hero(`web/src/home/heroIsland/`):固定光照、背景透明、**只自動旋轉、不能拖曳**、30fps、
  頁面 load 後閒置才載入、離開畫面暫停、減少動態時只畫靜止一幀;暗色另有自發光(`miniGlow`)。入口 `mini/loadMini.ts`。

產品想法與玩法發想見 handbook 的構想頁「構想七:文章變島」(`/ideas/product-direction-7-article-island`),
設計文件在 `docs/island/`(`implementation-plan.md`、`visual-plan.md`、`hero-integration-plan.md`)。

## 網址參數(`/island`)

`?t=19:30` 起始時間、`?q=low|mid|high` 強制品質、`?debug` 顯示 fps/繪製呼叫數與版面驗證警告。

## 測試

```
cd web
npm run test:ui                      # 含 src/island(純邏輯、真實資料整合、模型烘焙)
npx vitest run src/island src/home   # 只跑島與首頁
npx tsc -b
```

`logic/` 是純邏輯(步道曲線、光照插值、燈籠亮起排程、文章→站點、散落物避障、導覽鏡頭、版面驗證、品質偵測、縮小版預設),
不 import three;`three/` 是渲染層與總指揮 `IslandApp.ts`;`models/` 是 20 個宣告式低多邊形模型;`data/` 是版面資料與文章資料。

## 結構

- `logic/`:純邏輯與測試,`integration.test.ts` 用真實版面+文章+全部模型做整合驗證。
- `three/`:渲染層(島體、步道、天空、海面、站點、散落物實例化、燈籠、旅人、粒子、鏡頭、截圖)。`model.ts` 是宣告式模型格式(複本自 imagine 專案)。
- `models/`:低多邊形模型(四站建築、裝飾、親子旅人)。
- `data/`:`layoutTypes.ts` 是版面資料契約;`layout.ts` 是九份島的版面;`night-jiufen.json` 是文章資料。
- `mini/`:縮小版(`MiniIsland.ts`、`groundPools.ts`、`loadMini.ts`)。
- `ui/`:完整版 HUD、資訊卡、樣式(`hud.css` 全部限定在 `.island-root` 內,不影響其他頁面)。
- `islandData.ts`:模型、版面、文章 → 站點的組裝(完整版與縮小版共用)。

## 約定(改程式前先看)

- **站點清單只有一個來源**:`logic/articleToIsland.ts` 的 `displayableStops`(濾掉沒有版面站點或模型不存在的站),
  由 `islandData.loadIslandData()` 回傳為 `stops`。HUD(資訊卡、上一站/下一站)與 3D 場景(建築、標籤、導覽鏡頭、
  旅人時間表、燈籠亮度)都用同一份,「第 i 站」才會指向同一站;不要各自過濾。`three/stops.test.ts` 守住索引不錯位。
- **卸載要釋放 GPU 資源**:`three/dispose.ts` 的 `disposeObject`(幾何、材質、貼圖、實例化屬性)加 `disposeRenderer`
  (含 `forceContextLoss`,主動讓出 WebGL context)。島是會反覆掛載的元件(首頁 ↔ /island、context 還原後重建),
  新增材質或貼圖不需要另外處理,但不要繞過 `IslandApp.dispose()` / `MiniIsland.dispose()`。
- **首頁島能不能顯示要「同步」決定**:`home/heroIsland/available.ts`(省流量、WebGL)在第一次 render、
  `HeroIsland` 的 `useLayoutEffect`(版位大小)在畫面繪製之前,不能等 load 之後才發現——否則 hero 版面會跳。

## 載入邊界(重要)

首頁 `HomePage`/`HeroIsland` **只能動態 import** `island/mini/loadMini`,不可靜態 import,也不可 import `three` 或 `island/three`——
否則 three(約 130KB gzip)會併進首屏。`web/src/home/heroIsland/heroIslandBundle.test.ts` 守住這條。`/island` 頁本身是 lazy 路由。

## 已知限制

- 畫面比例、燈籠光暈強度、階地外觀、暗色自發光、首頁 hero 的版面與暗色配色,沒有經過完整的人工檢視;手機效能與場景建構耗時未量測。
- 「用 Tripace 排我的九份」按鈕帶上來源參數,但 `/ai-plan` 目前不讀這些參數。
- 署名用文章網址中的帳號名稱;文章資料沒有作者顯示名稱。
- 版面是手寫的,不是由程式從文章生成;只有一座島;嵌入外站部落格(iframe 加載入腳本)還沒做。
