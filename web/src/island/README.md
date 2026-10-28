# island——互動 3D 旅遊小島(部落客文章 → 3D 小島)

由部落客文章生成的 3D 小島(three.js)。**目前的低多邊形平面著色只是初始試做**,目標是更精細、更像真實的地形與建物(寫實程度待定);下面提到「低多邊形」的地方都是指現況。引擎不綁特定島:**一座島 = 一個場景**(`scenes/<id>/`),由 `scenes/registry.ts` 登記,
見 [scenes/README.md](scenes/README.md)。目前的場景:預設的「夜遊九份」(平台上的真實文章,4 站,傍晚到夜晚、紅燈籠沿步道一盞一盞亮起),
另有受 feature flag `VITE_FEATURE_ISLAND_SAMPLE=true` 控制的「範例小島」(`sample-islet`,驗證場景切換用,預設關閉:沒有切換連結、網址也不存在)。兩個使用處:

- **完整版**:路由 `/island`(預設場景)與 `/island/:sceneId`(`IslandPage.tsx` → `mountIsland.ts`):旋轉縮放、點站看資訊卡、日夜自動滾動(一天約 3 分鐘循環,拖時間滑桿時暫停)、封面視角、
  探索模式、分享圖(附署名)、「用 Tripace 排我的……」按鈕、場景切換選單(有 2 個以上場景才顯示)。公開頁,有專屬 SEO
  (各場景 `scenes/<id>/index.ts` 的 `seo` ↔ 伺服器 `seo_meta.go`、`static.go`、`sitemap.xml`)。
- **縮小版**:首頁 hero(`web/src/home/heroIsland/`):固定光照、背景透明、**只自動旋轉、不能拖曳**、30fps、
  頁面 load 後閒置才載入、離開畫面暫停、減少動態時只畫靜止一幀;暗色另有自發光(`miniGlow`)。入口 `mini/loadMini.ts`。

產品想法與玩法發想見 handbook 的構想頁「構想七:文章變島」(`/ideas/product-direction-7-article-island`),
設計文件在 `docs/island/`(`implementation-plan.md`、`visual-plan.md`、`hero-integration-plan.md`)。

## 網址參數(`/island`、`/island/:sceneId`)

`?t=19:30` 起始時間、`?q=low|mid|high` 強制品質、`?debug` 顯示 fps/繪製呼叫數與版面驗證警告。

## 測試

```
cd web
npm run test:ui                      # 含 src/island(純邏輯、真實資料整合、模型烘焙)
npx vitest run src/island src/home   # 只跑島與首頁
npx tsc -b
```

`logic/` 是純邏輯(步道曲線、光照插值、燈籠亮起排程、文章→站點、散落物避障、導覽鏡頭、版面驗證、品質偵測、縮小版預設),
不 import three;`three/` 是渲染層與總指揮 `IslandApp.ts`;`models/` 是跨場景共用的宣告式低多邊形模型;`scenes/` 是各場景(版面、文章、專屬模型);`data/` 只放版面資料的型別契約。

## 結構

- `logic/`:純邏輯與測試,`integration.test.ts` 用真實版面+文章+全部模型做整合驗證。
- `three/`:渲染層(島體、步道、天空、海面、站點、散落物實例化、燈籠、旅人、粒子、鏡頭、截圖)。`model.ts` 是宣告式模型格式(複本自 imagine 專案)。
- `models/`:跨場景共用的低多邊形模型(裝飾、親子旅人);**按需載入**,場景只載入版面實際用到的(`scenes/modelIds.ts`)。
- **高細節 GLB 模型(選用)**:宣告式模型之外,一個模型 id 可以另外有 Blender 腳本產出的 GLB(目前只有夜遊九份的阿妹茶樓,
  腳本在 `web/tools/blender/amei_teahouse.py`,資產在 `scenes/night-jiufen/assets/`)。場景在 `data.ts` 的 `glbModels` 登記
  `{ url, unit }`(unit 把公尺縮成宣告式版的尺度,所以版面的 scale 不用改);`scenes/registry.ts` 的 `load`(完整版)載入後掛到
  同 id 模型的 `glb` 欄位,`buildModel` 有 `glb` 就畫它。**載入失敗不會壞**:沿用宣告式版當後備。首頁縮小版用 `loadBase`,
  不載入 GLB。GLB 的發光強度載入時除以 `EMISSIVE_DIVISOR`(`three/glbLoader.ts`),才能配合 `stops.ts` 的日夜連動基準。
  建模流程與即時預覽見 `web/tools/blender/` 與 `web/tools/model-preview/`。
  - **載入規則**:單一 GLB 失敗或逾時(`GLB_TIMEOUT_MS` = 30 秒)就沿用宣告式版,且這次完整版結果**不快取**,下次 `load` 會重新嘗試,不必整頁重整;全部成功才快取。載入自己 `fetch` 再 `parseAsync`(不用 `loadAsync`:three 的 FileLoader 以網址記錄進行中請求,同步丟例外會讓同網址的重試永遠卡住)。
  - **每個網格只能有一個材質**:`prepareGlbScene` 遇到多材質網格直接丟錯(`stops.ts` 的日夜發光、`bake.ts`、`colliders.ts` 都假設單一材質);`prepareGlbScene` 冪等。GLB 的幾何與材質標記 `userData.sharedResource`,場景卸載時 `disposeObject` 跳過(由 registry 快取擁有,不用每次進出重傳 GPU)。
  - **燈籠是錨點**:GLB 裡的 `lantern_*` 空節點只標位置,`three/stopLanterns.ts` 讀出來用兩個 InstancedMesh 畫燈籠(燈身發光材質由 `stops.ts` 收進 `glowMats`,隨站點亮度日夜連動);沒有 GLB(退回宣告式版)時就沒有這批燈籠。
  - **碰撞用宣告式版**:GLB 每個材質合併成一個網格,逐網格取包圍盒會變成整棟大小的隱形牆,所以 `colliders.ts` 有宣告式 `parts` 時一律用它,宣告式沒有內容才退回 GLB。
- `scenes/`:場景。`registry.ts` 註冊表(網址、載入、快取、預載)、`types.ts` 契約、`night-jiufen/`(`index.ts` 輕量描述、`data.ts` 版面與文章與載入器、`layout.ts`、`article.json`、`models/` 專屬站點模型)、`sample-islet/`(實驗場景,feature flag)、`useIslandScene.ts`(載入狀態與防競態)。
- `data/`:`layoutTypes.ts` 是版面資料契約(各場景的 `layout.ts` 依它填資料)。
- `mini/`:縮小版(`MiniIsland.ts`、`groundPools.ts`、`loadMini.ts`)。
- `ui/`:完整版 HUD、資訊卡、樣式(`hud.css` 全部限定在 `.island-root` 內,不影響其他頁面)。
- `islandData.ts`:場景資料(模型、版面、文章)→ 站點的組裝(`loadIslandData(sceneId)`);完整版與縮小版共用 registry 的載入與快取。

## 探索模式(人物可走動)

完整版有「探索」按鈕:玩家控制家長在島上走,小孩跟在後面(沿家長走過的軌跡),鏡頭跟隨且可旋轉、縮放;自動走的親子在探索時隱藏。
操作:桌面 WASD/方向鍵或點地面,觸控裝置虛擬搖桿或點地面;Esc、封面、點站都會離開探索。
- `logic/walk.ts`:移動規則(純函式)——先試完整位移、再沿牆滑、高度差超過 `maxStep`(0.7)就擋(同時擋住陡坡與斷崖;石階旁的地面被切得比踏面低,所以只能走在石階上)。
- `logic/walkWorld.ts`:世界(在島內且離島緣 0.8、腳底高度、碰撞)。站在步道路面範圍內取步道剖面高度(`logic/pathProfile.ts`,與 pathMesh 畫路面共用),其他取地面。
- `three/colliders.ts`:由擺設模型的部件算固體——人身高度帶(0.35~1.8 格)內、不發光、夠厚的部件取包圍盒投影成凸多邊形;路面/地板/階梯部件、石階模型、燈籠、貓等不擋。
- `three/explorer.ts`:人物、小孩跟隨、走路動畫;固體索引第一次進入探索才建。
- 測試:`logic/walkWorld.test.ts` 用真實九份資料驗證能沿整條步道走完、茶樓與戲院擋得住、不能離開石階。
- 已知限制:點地面是直線走過去(沒有尋路),被擋就放棄;站點的資訊卡在探索中不會因為走近而觸發。

## 地形

兩種資料模型,由版面決定:
- **連續高度場**(`layout.terrain`,九份用):`logic/heightfield.ts` 的 ramp + bump/ridge + noise,最後套用削平的平台(pad);`heightAt` 是地面高度的唯一來源,
  地表網格在 `three/terrainField.ts`(Delaunay + 頂點色 + 切片土層側壁)。設計與數值見 `docs/refactor-island-terrain-2026-10.md`。
  石階等模型的原點與地面高度不同時,散落物用 `keepY` 保留明確的腳底高度;鏡頭可用 `layout.camera` 手寫(封面會依畫面比例拉遠,`fitCoverToAspect`)。
- **疊層階地與斜坡**(`layout.terraces/slopes`,舊版,範例資料與測試仍支援):每塊多邊形擠出,斜坡可帶峭壁稜面。

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

首頁 `HomePage`/`HeroIsland` **只能動態 import** `island/mini/loadMini`(`createMini` 是非同步:先經 registry 載入預設場景資料),不可靜態 import,也不可 import `three` 或 `island/three`——
否則 three(約 130KB gzip)會併進首屏。`web/src/home/heroIsland/heroIslandBundle.test.ts` 守住這條。`/island` 頁本身是 lazy 路由。

## 已知限制

- 連續地形的網格建構約 150ms(主執行緒,首頁縮小島也會碰到);點數隨 `terrain.cell` 增加,沒有移到 worker。
- 畫面比例、燈籠光暈強度、地形外觀、暗色自發光、首頁 hero 的版面與暗色配色,沒有經過完整的人工檢視;手機效能與場景建構耗時未量測。
- 「用 Tripace 排我的九份」按鈕帶上來源參數,但 `/ai-plan` 目前不讀這些參數。
- 署名用文章網址中的帳號名稱;文章資料沒有作者顯示名稱。
- 版面是手寫的,不是由程式從文章生成;只有一座島;嵌入外站部落格(iframe 加載入腳本)還沒做。
