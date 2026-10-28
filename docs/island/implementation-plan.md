# 旅遊規劃島（夜遊九份）實作計劃

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


> 對象：要動手實作 `web/island-demo/` 的工程師。
> 前提：本文件建立在兩份既有契約之上，**不修改它們**：
> - `src/three/model.ts`（宣告式低多邊形模型格式、`buildModel` / `animateModel`）
> - `src/island/layoutTypes.ts`（`IslandLayout`、`StopAnchor`、`LightKey` 等版面型別）
>
> 美術（Fable）同時產出 `src/models/*.ts`、`src/island/layout.ts`、`docs/visual-plan.md`。撰寫本文件時這三者**尚未出現在磁碟上**（`src/models/` 是空目錄），以下對它們的描述都是「依契約假設」，實際接上時要以檔案內容為準。
>
> 文中標「未驗證」者，是我沒有在本專案實際跑過、只依 three.js 一般行為推論的部分。

---

## 0. 讀過的檔案與從中得到的事實

| 檔案 | 與本計劃相關的實際行為 |
|---|---|
| `island-demo/src/three/model.ts` | 與 imagine `feat/3d-prototype` 的 `src/three/model.ts` 內容相同（只多開頭兩行註解，已 diff 確認）。重點：①`buildGeometry` 每個 part **各自 new 一份幾何**，沒有共用；②材質用**模組層級** `materialCache`，key 是 `color|emissive`，`MeshStandardMaterial({ flatShading: true, roughness: 0.85, metalness: 0 })`；有 emissive 時 `emissiveIntensity = 0.6` 固定；③**同色同 emissive 的部件全域共用同一個材質物件**，改其中一個的 `emissiveIntensity` 會同時改到所有模型；④每個 Mesh 都 `castShadow = receiveShadow = true`；⑤`$name` 色票查不到時退回 `#ff00ff`（洋紅）；⑥`Motion` 的 `swing`/`bob` 只在 `walkWeight>0` 時作用，`sway` 隨時間持續；⑦`stride` 預設 0.6。`materialCache` 沒有 export。 |
| `island-demo/src/island/layoutTypes.ts` | 平面座標 `(x, z)`，島心 (0,0)，+x 東、+z 南（朝鏡頭）、+y 上；島半徑約 30~40 格。`terraces` 是「頂視多邊形 + 頂面高度 y」；`path.points` 只有 2D（註解說若需要高度請在 visual-plan.md 提建議）；`stops` 帶 `stopId`/`label`/`time`；`lighting` 涵蓋 16:00~22:00，相鄰線性插值、**最後一筆回接第一筆**；`river` 是必填。 |
| `island-demo/docs/source-night-jiufen.json` | 是一筆 content page 紀錄（`id`、`ownerId`、`slug: "night-jiufen"`、`status`、`content`）。`content` 內有 `title`、`eyebrow: "親子小旅行"`、`lede`、`heroStandalonePhotoId`、`blocks`，**沒有 `version` 欄位**（`version`/`slug`/`status` 不在 `content` 內，與 `ThemePageContent` 型別不完全一致）。四個 stop：`stop_1 基山街`（有 blurb）、`stop_4 豎崎路石階`、`stop_5 輕便路散步`、`stop_6 阿妹茶樓`（有 blurb）；id 不連號；`index` 為「壱/弐/参/肆」；全部沒有 `info`、`day`、座標、時間。另有開頭 paragraph 與結尾 `overlayText` 圖片。**沒有部落客顯示名稱或 handle**，只有 `ownerId: usr_ddef060f`。 |
| `web/src/blog/types.ts` | `ThemePageContent.blocks` 是扁平聯集；`StopBlock{ id, index, name, desc, blurb?, media, info?, day?, category? }`；未知 kind 應靜默略過；`scroll-timeline-anchor` 可帶 `center{lat,lng}`（目前唯一有座標的地方）；`preferredTheme`、`palette`（`paper-warm`/`ocean-cool`/`night-market`）。 |
| imagine `src/three/World3D.ts` | `WebGLRenderer({antialias, alpha:true})`、`setPixelRatio(min(dpr,2))`、`PCFSoftShadowMap`、`SRGBColorSpace`、`ACESFilmicToneMapping`（exposure 1.05）；`PerspectiveCamera(30°)`；`OrbitControls` 開阻尼、關平移、`minPolarAngle 0.35`、`maxPolarAngle 1.2`、距離依 fit 結果 0.35~1.6 倍；`CSS2DRenderer` 疊在上面且 `pointerEvents:none`；點選用 pointerdown/up 位移 ≤5px 才算點擊，再 `Raycaster.intersectObjects(groups, true)` 往上找 parent；`HemisphereLight` + 投影的 `DirectionalLight`（mapSize 2048、bias -0.0005、normalBias 0.6）；`import.meta.glob(..., { eager: true, import: 'default' })` 載模型；`visibilitychange` 回到前景時**只把物理 accumulator 歸零**（並沒有真的暫停渲染迴圈）；朝向 `Math.atan2(dx, dz)`；walkPhase 依移動距離 / (stride·size) 累積。**imagine 版沒有用 `scene.fog`**（它的「fog」是戰爭迷霧 FogMap），沒有日夜循環。 |
| imagine `src/three/Island.ts` | 地磚用兩個 `InstancedMesh`（草、泥），`setColorAt` 每格顏色，邊緣格隨機下沉、泥土深度參差做出島底；改色後設 `instanceColor.needsUpdate = true`。 |
| `web/vite.config.ts` | vitest `exclude` 只有 `tests/**`、`**/node_modules/**`、`admin/**`、`*.integration.test.*`——**沒有排除 `island-demo/**`**。上層 `package.json` 沒有 `three`。 |
| `web/.gitignore` | `node_modules`、`dist` 無前導斜線，子目錄也會被忽略。 |
| `web/src/App.tsx` / `planning/preview/Content.tsx` | `/ai-plan` 路由存在；`Content.tsx` 目前只讀 `embedded`、`skipDemo`、`debugSafeArea` 三個網址參數，**沒有任何「帶入起點站點」的參數**。`/u/:handle/:slug` 部落格路由存在，文章經 `GET /v1/blog/{handle}/{slug}` 取得。 |

---

## 1. 目標與範圍

### 1.1 目標
1. 做出一座「漂浮的低多邊形九份島」，視覺上一眼看得出：依山而建的階地、石階步道、四個站點建築、遠方海面、傍晚到夜晚的天色變化，**紅燈籠沿著步道一盞一盞亮起**是高潮。
2. 讀者可以旋轉/縮放、點每一站看資訊卡（站名、示意時間、文章摘錄、部落客署名）、拖時間滑桿或按播放看親子兩人走完四站。
3. 一鍵「封面視角」與「分享截圖」（帶署名浮水印），以及「用 Tripace 排我的九份」CTA。
4. 架構上把「文章 → 島」的對應做成純函式，為之後「部落客一鍵生成島」鋪路。

### 1.2 明確不做
- 多島 / 群島、島與島之間的導覽。
- 後端：不新增 API、不存資料庫、不做 `/embed/*` 路由；文章資料直接 import 本地 JSON。
- 精細角色邏輯：旅人沒有尋路、避碰、排隊、表情；就是沿步道曲線按時間表走。
- 真實地理座標、真實營業時間、真實地形高程。
- 編輯器（部落客拖拉調整島）、AI 自動排版島（第 10 章只寫構想）。
- 上層 `web/` 主網站的任何改動（唯一例外見 2.5，需另外取得同意）。
- React：原型用純 TypeScript + DOM（呼應 HEART 政策島的純 ES module 做法，也少一層相依）。

---

## 2. 專案骨架

### 2.1 目錄結構

```
web/island-demo/
├─ index.html                 # 單頁：#stage(canvas + CSS2D 層) + #hud(時間滑桿/按鈕/資訊卡/CTA)
├─ package.json
├─ tsconfig.json
├─ vite.config.ts             # 同時放 vitest 設定(environment: 'node')
├─ docs/
│  ├─ source-night-jiufen.json        # 既有:文章原始資料
│  ├─ visual-plan.md                   # Fable 產出(假設)
│  └─ implementation-plan.md           # 本文件
└─ src/
   ├─ main.ts                  # 進入點:讀 layout + 文章 → 組 IslandApp → 掛到 DOM
   ├─ three/
   │  ├─ model.ts              # 既有契約,不改
   │  ├─ IslandApp.ts          # 總指揮:renderer/camera/controls/loop/visibility/resize/dispose
   │  ├─ terrain.ts            # 島體 + 階地 + 島底 + 河 的 mesh 建構
   │  ├─ pathMesh.ts           # 步道帶狀網格 + 石階
   │  ├─ sea.ts                # 海面 + 夜晚反光帶
   │  ├─ sky.ts                # 天空漸層球 + 星星 + scene.fog
   │  ├─ lighting.ts           # 半球光/太陽月光/陰影相機,吃 LightState
   │  ├─ stops.ts              # 四站建築、碰撞代理、CSS2D 標籤
   │  ├─ scatter.ts            # 裝飾散落 → InstancedMesh(依模型×材質烘焙)
   │  ├─ lanterns.ts           # 燈籠發光層(unlit InstancedMesh + 光暈 Points + 少量 PointLight)
   │  ├─ travelers.ts          # 親子兩人:buildModel + animateModel
   │  ├─ particles.ts          # 蒸氣、天燈、螢火蟲
   │  ├─ cameraRig.ts          # 封面視角、導覽運鏡、OrbitControls 範圍
   │  ├─ capture.ts            # 截圖/錄影 + 浮水印合成
   │  └─ quality.ts            # 品質等級偵測與降級開關
   ├─ logic/                   # ★ 純邏輯,不 import 'three' 的 WebGL 部分,全部可在 node 測
   │  ├─ geom2d.ts             # 多邊形點內判定、點到折線距離、自交檢查、繞向
   │  ├─ heightField.ts        # heightAt(x,z)
   │  ├─ pathCurve.ts          # 平滑、弧長參數化、取樣、高度剖面、石階切分
   │  ├─ lightTimeline.ts      # 時間 → LightState 插值
   │  ├─ lanternSchedule.ts    # 每盞燈的點亮時刻與當下亮度
   │  ├─ schedule.ts           # 行程時間 → 旅人進度
   │  ├─ travelerPose.ts       # 進度 → 位置/朝向/高度
   │  ├─ scatterResolve.ts     # 散落物避障與貼地
   │  ├─ validateLayout.ts     # 版面資料驗證
   │  ├─ articleToIsland.ts    # 文章 → stops 對應
   │  ├─ tour.ts               # 導覽鏡頭關鍵幀
   │  ├─ rng.ts                # 可重現亂數(mulberry32)
   │  └─ *.test.ts
   ├─ ui/
   │  ├─ hud.ts                # 時間滑桿、播放、封面、導覽、分享按鈕
   │  ├─ infoCard.ts           # 點站資訊卡(含署名區)
   │  ├─ cta.ts                # 「用 Tripace 排我的九份」
   │  └─ hud.css
   ├─ island/
   │  ├─ layoutTypes.ts        # 既有契約,不改
   │  └─ layout.ts             # Fable 產出(假設)
   └─ models/                  # Fable 產出(假設),每檔 export default Model3D
```

### 2.2 package.json（版本對齊上層 web，避免兩邊行為差異）

```json
{
  "name": "tripace-island-demo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@types/three": "^0.170.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^4.1.10"
  }
}
```

- `vite ^5.4.11`、`typescript ^5.6.3`、`vitest ^4.1.10` 取自上層 `web/package.json`；`three`/`@types/three ^0.170.0` 取自 imagine。
- 不裝 React、不裝 jsdom（純邏輯測試跑 `environment: 'node'`；需要 DOM 的 UI 測試真的要寫時再加 `jsdom`）。
- **不加 Playwright**（理由見 7.2）。

### 2.3 vite.config.ts / tsconfig.json 要點
- `vite.config.ts`：`server.port: 5180`（避開主站 5173）、`base: './'`（之後丟到任意子路徑或 iframe 都能載入）、`test: { environment: 'node', include: ['src/**/*.test.ts'] }`。
- `tsconfig.json`：沿用上層的 `strict`、`moduleResolution: "bundler"`、`isolatedModules`、`noUnusedLocals/Parameters`，`lib: ["ES2022","DOM","DOM.Iterable"]`，`types: ["vite/client"]`（`import.meta.glob` 的型別），`resolveJsonModule: true`（直接 import 文章 JSON），`include: ["src"]`，不要 `jsx`。

### 2.4 進入點資料流
`main.ts` 做三件事：`import layout from './island/layout'`、`import article from '../docs/source-night-jiufen.json'`、`const models = import.meta.glob<Model3D>('./models/*.ts', { eager: true, import: 'default' })`（imagine 的同款寫法），然後 `validateLayout` → `articleToIsland` → `new IslandApp(...)`。網址參數 `?q=low|mid|high`、`?t=19:30`（起始時間）、`?debug`（顯示 FPS 與 draw calls）。

### 2.5 與上層 web 的隔離
- `node_modules`、`dist` 已被 `web/.gitignore` 涵蓋（無前導斜線，子目錄同樣生效）。
- 上層 `tsconfig.json` 的 `include` 只有 `src` 與 `vitest.setup.ts`，不會型別檢查到 `island-demo/`。
- **風險：上層 vitest 會掃到 `island-demo/**/*.test.ts`**。`web/vite.config.ts` 的 exclude 沒有 `island-demo/**`，而上層沒有安裝 `three`，凡是 import 到 `three` 的測試在上層 `npm test` 會失敗（純邏輯測試則會被重複執行）。處理方式比照既有的 `admin/**`：在上層 exclude 加上 `'island-demo/**'`。**這是唯一需要動到上層的地方，不在本計劃作者的權限內，要使用者同意後才改**；在改之前，island-demo 的測試檔一律不 import `three`（`logic/` 本來就不該 import），把衝擊降到「重複執行」而不是「失敗」。

---

## 3. 架構

### 3.1 分層

```
資料層(靜態)                  純邏輯層 logic/(node 可測)                 渲染層 three/(瀏覽器)           UI 層 ui/(DOM)
────────────                 ─────────────────────────                 ─────────────────             ───────────
layout.ts ─┐                 validateLayout ──► 錯誤清單(dev 時 console + 畫面紅框)
models/*.ts├──────────────►  heightAt / pathCurve / scatterResolve ──► terrain/pathMesh/scatter
article.json┘                articleToIsland ──► IslandStop[] ───────► stops.ts(標籤/代理) ───────► infoCard
                             lightTimeline(time) ──► LightState ──────► sky/lighting/sea/lanterns
                             lanternSchedule(time) ──► glow[i] ───────► lanterns.ts
                             schedule(time) → travelerPose(s) ────────► travelers.ts
                             tour(stops) ──► CameraKey[] ─────────────► cameraRig.ts
                                                     ▲
                                     IslandApp 的唯一狀態:clockMinutes(目前時間,分鐘)
                                     hud 時間滑桿 / 播放 只改這一個數字
```

**唯一的時間來源**：`IslandApp` 持有 `clockMinutes: number`。每一幀：`LightState = lightAt(clockMinutes)`、`glow = lanternGlowAt(clockMinutes)`、`traveler = travelerAt(clockMinutes)`，再交給各渲染模組的 `update(...)`。滑桿、播放、導覽、封面都只是在改 `clockMinutes` 或鏡頭，不各自持有時間，避免「滑桿與旅人脫鉤」這類問題（呼應既有待修項目「拖拉時間刻度脫鉤」的教訓）。

**渲染模組統一介面**（不是 class 繼承，只是約定）：
```ts
type SceneModule<U> = { object: THREE.Object3D; update(u: U, dt: number): void; dispose(): void }
```

### 3.2 純函式清單與要測的性質

座標型別沿用 `Pt = [x, z]`；時間一律用「自 00:00 起的分鐘數」。

| 模組 | 簽名 | 要測的性質 |
|---|---|---|
| `geom2d` | `pointInPolygon(p: Pt, poly: Pt[]): boolean`<br>`distToPolyline(p: Pt, line: Pt[]): number`<br>`isClockwise(poly: Pt[]): boolean`（以 x 右、z 下的頂視圖定義，與契約「順時針」一致，需在文件寫清楚）<br>`selfIntersects(poly: Pt[]): boolean`<br>`polygonArea(poly: Pt[]): number` | 正方形內外點；頂點/邊上點的一致規則；反轉順序後 `isClockwise` 相反；8 字形偵測為自交；距離 ≥0 且在線上為 0。 |
| `heightField` | `makeHeightField(layout: IslandLayout): (x: number, z: number) => number \| null` | 島外回 `null`；不在任何階地內回 `topY`；在多塊階地重疊處回**最高**的 y；結果只會是 `topY` 或某個 terrace.y（離散值）。 |
| `pathCurve` | `smoothPath(points: Pt[], samplesPerSeg?: number): Pt[]`（centripetal Catmull-Rom，端點保留）<br>`buildArcTable(dense: Pt[]): { s: Float64Array; total: number }`<br>`sampleAt(dense, table, s): { p: Pt; tangent: Pt }`<br>`heightProfile(dense, table, heightAt, opts: { riser: number; tread: number }): ProfileSample[]`（每個取樣的 y，階地交界處切成石階）<br>`projectToPath(dense, table, p: Pt): number`（最近點的弧長 s） | 平滑後首尾點等於原始首尾；`s` 嚴格遞增、`s[0]=0`、`total` ≈ 平滑後折線長；`sampleAt(0)` 是起點、`sampleAt(total)` 是終點、超出範圍夾住；切線為單位向量；高度剖面在平地上恆定、跨階地時出現 `ceil(dy/riser)` 級台階且每級高度差 ≤ riser、台階**落在低側**（不侵入上層平台）；`projectToPath` 對路徑上的點回原 s（誤差 < 取樣間距）。 |
| `lightTimeline` | `parseHHMM(s: string): number`<br>`lightAt(keys: LightKey[], minutes: number): LightState`（`LightState` 為 `LightKey` 去掉 `time`，顏色以 `[r,g,b]` 0~1 線性空間表示）<br>`sunDirection(elevDeg: number, azimDeg: number): [number, number, number]` | 恰好在關鍵時刻時等於該關鍵幀；兩幀正中間的數值是平均；**最後一筆回接第一筆**（跨午夜的插值區段正確、`minutes` 超出 0~1440 取模）；`keys` 未排序時先排序；`lanternGlow` 夾在 [0,1]；只有一筆 key 時回常數；顏色在線性空間插值（避免 sRGB 直接插值偏灰），`sunDirection` 為單位向量、仰角 90° 指向 +y、方位角約定（0°=北=−z，順時針 90°=東=+x）。 |
| `lanternSchedule` | `lanternOrder(lanterns: Pt[], dense, table): number[]`（每盞燈投影到步道的 s，0~1 正規化）<br>`lanternGlowAt(globalGlow: number, order: number[], opts: { spread: number; ramp: number; jitterSeed: number }): Float32Array` | `globalGlow=0` 全暗、`=1` 全亮；`globalGlow` 遞增時每盞燈亮度**單調不減**；步道上較前（s 小）的燈先亮（基山街→阿妹茶樓）；同一 seed 結果相同；任何時刻亮度都在 [0,1]。 |
| `schedule` | `buildSchedule(stopS: number[], stopMinutes: number[], opts: { dwellMin: number; startS?: number; leadMin?: number }): Schedule`<br>`progressAt(sch: Schedule, minutes: number): { s: number; walking: boolean; atStop: number \| null }` | `stopS` 必須遞增（否則丟錯）；到站時刻 `progressAt(stopMinutes[i]).s === stopS[i]`；s 隨時間單調不減；停留期間 `walking=false`、`atStop=i`；第一站前從 `startS` 走過來（`leadMin` 分鐘），最後一站後停在終點；時間早於開始或晚於結束時夾住。 |
| `travelerPose` | `poseAt(dense, table, profile, s: number, lateral: number): { x: number; y: number; z: number; heading: number }`<br>`familyPoses(base s, walking): [parent, child]`（小孩落後 0.8 格、側移 0.45 格） | `heading = atan2(tx, tz)`（與 imagine 一致：模型正面 +Z）；側移垂直切線；`y` 等於剖面高度（上石階時逐級升高，不穿模）；s 在端點時仍有合理 heading。 |
| `scatterResolve` | `resolveScatter(layout: IslandLayout, heightAt, opts: { pathClear: number; stopClear: number; edgeClear: number; radiusOf: (model: string) => number }): { kept: ResolvedPlacement[]; dropped: Array<{ p: Placement; reason: string }> }` | 結果中沒有任何物件與步道（距中心線 < width/2 + 半徑）、河道、站點建築範圍重疊；全部落在 outline 內；`y` 一律由 `heightAt` 決定（契約裡的 `Placement.y` 若有填且與 `heightAt` 差距 > 0.05 則記警告，以 `heightAt` 為準）；跨越階地邊緣（半徑內高度不一致）的物件移除；同輸入同輸出（決定性）；被移除的都附原因，方便美術調整。 |
| `validateLayout` | `validateLayout(layout: IslandLayout, modelNames: Set<string>, articleStopIds: string[]): Issue[]`（`Issue = { level: 'error' \| 'warn'; path: string; msg: string }`） | outline ≥3 點、不自交、繞向為順時針；terrace 都在 outline 內、`y > topY`、不自交；`thickness > 0`；所有 placement 的 `model` 存在於 `models/`；`stops` 數量與順序和文章一致、`time` 為合法 HH:MM 且遞增；`lighting` 覆蓋 16:00~22:00、`lanternGlow ∈ [0,1]`、`sunIntensity ≥ 0`；色票為合法 `#rrggbb`；路徑點都在 outline 內；**模型色票引用（`$name`）都能解析**（否則 model.ts 會退回洋紅 `#ff00ff`）。 |
| `articleToIsland` | 見 3.3 | 見 3.3 |
| `tour` | `tourKeyframes(stops: Array<{ x; y; z }>, islandRadius: number): CameraKey[]`<br>`cameraAt(keys: CameraKey[], u: number): { pos: [n,n,n]; target: [n,n,n] }`（u ∈ [0,1]，緩動插值） | 第一幀/最後一幀等於封面視角；每站一個關鍵幀且 target 指向站點；鏡頭仰角落在 OrbitControls 允許範圍內；`u` 夾住。 |
| `rng` | `mulberry32(seed: number): () => number` | 同 seed 同序列；值域 [0,1)。 |

> 判準：凡是「給輸入算數字」的東西都放 `logic/`，不 import `three`（`three` 的數學類別在 node 其實能跑，但為了 2.5 的上層 vitest 風險，`logic/` 一律自寫小型向量運算）。`three/` 只負責把數字變成 BufferGeometry、矩陣與 uniform。

### 3.3 文章 → 島的 stops 對應

```ts
type ArticleSource = {            // source-night-jiufen.json 的實際形狀(content 在內層)
  slug: string; ownerId: string;
  content: { title: string; eyebrow?: string; lede?: string; heroStandalonePhotoId?: string; blocks: unknown[] }
}
type IslandStop = {
  stopId: string; order: number; index: string;   // '壱'...
  name: string; excerpt: string;                    // desc 取第一句,上限 60 字
  blurb?: string; coverPhotoId?: string;            // 第一張 image 或 gallery 第一張
  time: string; timeSource: 'layout' | 'generated';
  anchor: StopAnchor | null;                        // 對應 layout.stops,沒有則 null
}
function extractStops(blocks: unknown[]): StopBlockLike[]
function excerpt(text: string, max: number): string
function generateTimes(n: number, start: string, end: string): string[]
function articleToIsland(src: ArticleSource, layout: IslandLayout, byline: Byline): { stops: IslandStop[]; meta: IslandMeta; issues: Issue[] }
```

要測的性質：
- 只取 `kind === 'stop'`，**依陣列順序**，未知 kind（例如 `scroll-timeline-*`）忽略而不丟錯（與 `types.ts` 的「未知 kind 不中斷」原則一致）。
- 以 `stopId` 對應 `layout.stops`：文章有、版面沒有 → `anchor: null` + warn；版面有、文章沒有 → warn；順序不一致 → error。
- `excerpt` 以「。！？」切第一句，超過上限加「…」，不切斷 surrogate pair（emoji 安全）。
- 時間：`layout.stops[i].time` 存在就用（`timeSource: 'layout'`），本原型就是 17:30/18:30/19:30/20:15；否則 `generateTimes` 在給定區間平均分配並對齊到 5 分鐘（`timeSource: 'generated'`，資訊卡上標「示意時間」）。
- `coverPhotoId`：stop 的第一個 media 是 image 取其 photoId，是 gallery 取 `items[0].photoId`。
- 署名：JSON 只有 `ownerId`，沒有部落客名字。`Byline = { name: string; handle?: string; articleUrl?: string }` 由 `main.ts` 傳入；原型用寫死的占位值（例如名字「九份部落客（示意）」），並在資訊卡顯示文章標題 `content.title`。之後接後端時由 `/v1/blog/{handle}/{slug}` 的回應補上（是否回傳作者顯示名稱**未驗證**，第 10 章列為開放問題）。

---

## 4. 渲染設計

成本估計以「每站/每物件的部件數」粗估，實際數字要等 Fable 的模型出來後用 `?debug` 量。

### 4.1 島體：outline 擠出、階地疊層、島底參差
- **做法**：`new THREE.Shape(outline.map(([x,z]) => new Vector2(x, -z)))` → `ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 })` → `rotateX(-Math.PI/2)` 讓擠出方向變成 −y，再平移使頂面落在 `topY`。（Shape 在 XY 平面；繞 X 轉 −90° 把 (x, y) 映到 (x, −y) 的 z，所以餵入 −z 抵銷。這段座標換算要用 bounding box 單元測試確認，**未驗證**。）
- `ExtrudeGeometry` 會產生兩個 group（0=上下蓋面、1=側面），可給材質陣列 `[grassTop, dirtSide]`，一個 mesh 兩個 draw call，免拆。
- **階地**：每個 terrace 同樣擠出，深度 = `terrace.y - topY + 0.1`（往下多埋一點，避免與底層 z-fighting），材質 `[terrace.color ?? palette.grassAlt, stoneWall]`——側面就是擋土石牆，九份感的來源。石牆要「石塊感」可在側面材質加一張程式生成的 64×64 磚紋 CanvasTexture（`flatShading` 下仍可用 map），成本極低。
- **島底參差**：純函式 `undersideRings(outline, thickness, seed)` 產生 2~3 圈逐漸內縮、y 隨機抖動的環，最後收到一個偏離中心的尖點，自建 BufferGeometry（三角帶）。imagine 的做法是方塊泥土層深度隨機，這裡因為 outline 是任意多邊形，改用環狀內縮更自然。
- **three API**：`Shape`、`ExtrudeGeometry`、`BufferGeometry`、`CanvasTexture`。
- **成本**：島體 + 階地 5~8 塊 ≈ 10~18 draw calls、數千三角形；建構一次。
- **風險**：outline 若自交，`ShapeUtils.triangulateShape` 會產生破面——由 `validateLayout` 擋下；階地多邊形若超出 outline 會懸空——驗證時 warn。
- **手機降級**：不需要。

### 4.2 階地與步道貼地（高度變化的帶狀網格 + 石階感）
- **契約限制**：`path.points` 只有 2D。做法是 `heightProfile` 用 `heightAt` 推出每個取樣點的高度，在階地交界處切成石階。若 Fable 在 `visual-plan.md` 提出路徑高度的契約擴充，渲染層改讀該欄位，`heightProfile` 保留當退路。
- **帶狀網格**：`smoothPath` 取樣（每段 8~12 點）→ 每個取樣點沿法線左右各 `width/2` 生兩個頂點 → 三角帶。y 取剖面高度 + 0.03（略高於地面防 z-fighting，並設 `polygonOffset`）。
- **石階**：在剖面中被標為 `step` 的區段，每一級生成「踏面 + 豎板」：踏面是水平四邊形，豎板是垂直四邊形，寬度同步道；兩側各加一條細長方塊當扶手石/邊石（可選）。石階顏色用 `palette.path` 交替明暗 ±6%，一眼看出一級一級。
- **貼地延伸**：步道帶在每個取樣點外擴 0.1 格的「裙邊」往下垂 0.2，蓋掉與地面相接處的縫。
- **燈籠沿線**：步道兩側每隔 N 格的位置是天然的燈籠/電線位置，`lanterns.ts` 可直接用 `sampleAt` 生成（見 4.7），不必完全依賴 `scatter` 手放。
- **成本**：1 個 mesh、約 2~4k 三角形。
- **風險**：步道急彎時左右頂點交叉（內側自折）——平滑後若轉彎半徑 < width/2 需在 `validateLayout` 警告；石階落在低側的規則若遇到「步道沿著階地邊緣平行走」會頻繁上下——同樣以 warn 提示美術調路徑。
- **河**：同樣的帶狀網格演算法，y = 所在地面高度 − 0.08，材質 `palette.water`，在頂點 shader 外用一張捲動的 CanvasTexture 法線/條紋做流動感（`texture.offset` 每幀遞增，便宜）。河若跨階地，會出現瀑布式落差——可接受，視為小瀑布，但要在 visual-plan 確認美術意圖。

### 4.3 海面與夜晚反光
- **做法**：`PlaneGeometry(400, 400, 1, 1)` 放在 `sea.y`，`MeshStandardMaterial({ color: sea.color, roughness: 0.35, metalness: 0, transparent: false })`。海面遠端顏色交給 `scene.fog` 融進天空，所以不用大的平面細節。
- **夜晚反光**（不用 `Reflector`/`Water` 這種要多渲染一次場景的作法）：
  1. **月光帶**：一條朝鏡頭方向的長條四邊形，`MeshBasicMaterial` + `AdditiveBlending` + 一張程式生成的縱向漸層/碎波 CanvasTexture，`opacity` 依 `1 - sunIntensity`；每幀讓它朝向 `sunDirection` 的水平投影。
  2. **燈火倒影**：島邊緣靠海一側的燈籠，在海面下鏡像位置放垂直拉長的光暈點（與 4.7 的光暈 Points 同一批，只是 y 翻轉、size 拉長、亮度 ×0.4）。
  3. **漁火**（選做）：遠方幾個靜態亮點，夜間 `opacity` 拉高，九份夜景的經典元素。
- **成本**：2~3 draw calls。
- **風險**：鏡頭仰角太低時反光帶會穿幫成一條板子——靠 OrbitControls 的 `maxPolarAngle` 限制。
- **手機降級**：關漁火、反光帶不做碎波貼圖。

### 4.4 四站建築與模型載入
- **載入**：`import.meta.glob<Model3D>('../models/*.ts', { eager: true, import: 'default' })`，key 轉成檔名（不含副檔名）對應 `Placement.model`。eager 讓模型隨主 bundle 一起載入、沒有非同步等待（模型都是小型宣告式資料，整批幾十 KB 等級，估計）。
- **四站**：每站呼叫一次 `buildModel(model)`，`root.position.set(x, heightAt(x,z), z)`、`rotation.y = rotY`、`scale = scale`。建築數量少（4 棟），**直接用 `buildModel` 的 Group**，不做 instancing，保留 model.ts 的 `sway` 等動畫（例如旗幟、布條），每幀 `animateModel(built, 0, 0, time)`。
- **發光部件的處理**（重要，因為 model.ts 的材質是全域共用快取）：建好後 traverse，凡是 `material.emissive` 非黑色的 Mesh，`mesh.material = mesh.material.clone()`，存進該站的 `glowMaterials[]`。這樣：①每站可以獨立控制亮起時刻；②不會改到快取裡被其他模型共用的原材質。之後每幀設 `m.emissiveIntensity = base(0.6) × k × glow_stop`，其中 `k` 是夜晚放大倍率（建議最高 2.5，配合 ACES 色調映射才有「亮」的感覺，數值需實際看畫面調，**未驗證**）。
- **陰影**：model.ts 對每個 Mesh 都開 `castShadow`。四站保留；但 `traverse` 時把 `scale` 很小（< 0.15 格）的部件關掉 castShadow，減少陰影 pass 的 draw calls。
- **成本**：每站估 15~40 個部件 → 四站 60~160 draw calls（再加陰影 pass 約同數量）。這是整個場景最貴的一塊。
- **降級**：中階手機時，把每站「同材質、無動畫」的部件用 `mergeGeometries` 合併（做法同 4.5 的烘焙），可降到每站 5~10 個 draw calls；有 motion 的部件保留獨立。

### 4.5 裝飾散落：InstancedMesh 做法
Model3D 是多部件 Group，無法直接丟進一個 InstancedMesh。兩種方案：

| | A：依「模型 × 材質」烘焙合併 | B：每個 part 一個 InstancedMesh |
|---|---|---|
| 做法 | 每種模型建一次 `buildModel` 當樣板 → `updateMatrixWorld` → 每個 Mesh 的幾何 `clone().applyMatrix4(mesh.matrixWorld)` → **依材質 key 分組** `mergeGeometries` → 每組一個 InstancedMesh | 樣板的每個 Mesh 各自建 InstancedMesh，instance 矩陣 = placement 矩陣 × part 局部矩陣 |
| draw calls | 模型種類 × 每模型顏色數（樹 2~3 色、石 1 色、長椅 2 色） | 模型種類 × 每模型部件數（常常 5~15） |
| 部件動畫 | 合併後失去個別 `sway`/`swing` | 可保留（每幀改 instanceMatrix） |
| 實作複雜度 | 中（要處理 indexed/non-indexed 混合） | 低 |

**建議 A**，再加兩個例外：
1. **有 `motion` 的部件**（例如樹冠 `sway`）從合併中排除，自成一個 InstancedMesh；桌機每幀以 CPU 更新其 instanceMatrix（數量 < 200 時每幀成本可忽略，估計），手機版直接靜止。
2. **有 `emissive` 的部件**（燈籠本體、窗戶）從合併中排除，交給 4.7 的燈籠層。

實作細節：
- `mergeGeometries`（`three/examples/jsm/utils/BufferGeometryUtils.js`）要求所有輸入「都有 index 或都沒有 index」、屬性集合相同。model.ts 的形狀中 `IcosahedronGeometry`/`DodecahedronGeometry`（PolyhedronGeometry 系）是 **non-indexed**，`BoxGeometry`/`CylinderGeometry`/`ConeGeometry` 等是 indexed——混用會失敗回 null。統一先 `toNonIndexed()` 再合併（flatShading 下本來就不共用頂點，沒有損失）。這點**未在本專案驗證**，第 6 章步驟 5 第一件事就是寫測試確認。
- 材質由渲染層自建（同樣 `MeshStandardMaterial({ flatShading: true, roughness: 0.85 })`），不走 model.ts 的快取。
- 同款模型的 `seed` 小變化：`setColorAt` 做 ±6% 亮度抖動、矩陣加 ±8% 縮放與隨機 rotY（`rotY` 未指定時）。注意 `instanceColor` 會乘到**該 InstancedMesh 所有部件**，A 方案下一個 InstancedMesh 只有一色，正好適用。
- 散落的位置/高度一律來自 `resolveScatter` 的結果。
- **陰影**：樹、建築類 castShadow；小石頭、花草關掉 castShadow，全部 receiveShadow。
- **成本**：假設 8 種裝飾模型 × 平均 2.5 色 ≈ 20 draw calls（+ 陰影 pass），三角形依數量線性增加（200 棵樹 × 150 面 ≈ 3 萬面，估計）。

### 4.6 天空漸層、霧
- **天空**：半徑 300 的 `SphereGeometry`，`side: BackSide`、`depthWrite: false`、`fog: false`，自訂 `ShaderMaterial`：依視線方向的 y 在 `skyBottom`→`skyTop` 之間插值，額外在太陽方向加一個柔和光暈（`pow(max(dot(dir, sunDir),0), 32)`），傍晚有夕陽暈染。uniform 每幀由 `LightState` 更新。
  - 為什麼不用 CSS 漸層當背景（imagine 是 `alpha: true` 透明 canvas）：**分享截圖時 canvas 只有 WebGL 內容**，CSS 背景不會進到圖裡，要另外重畫；放在場景內一次解決。
- **星星**：一組 `Points`（600 顆，手機 200 顆），`opacity` = `smoothstep(0.3, 0, sunIntensity)`。
- **霧**：`scene.fog = new THREE.Fog(color, near, far)`，`color` 每幀取 `LightState.fog`，`near/far` 依鏡頭距離設定（例如 `dist × 0.9` 到 `dist × 2.4`），讓海面遠端自然融入天空。imagine 原型**沒有**用場景霧，這是新增的部分。
- **成本**：1~2 draw calls。

### 4.7 燈籠一盞一盞亮起（視覺高潮）
**目標**：`lanternGlow` 從 0 升到 1 的這段時間裡，燈籠不是同時亮，而是從基山街開始沿步道往阿妹茶樓一路亮過去，每盞有一點隨機前後。

**排程（純邏輯）**：`lanternOrder` 把每盞燈投影到步道得到 `u ∈ [0,1]`，`lanternGlowAt` 計算
`glow_i = smoothstep(0, ramp, (globalGlow × (1 + spread) − u_i × spread − jitter_i))`
→ `globalGlow` 剛開始升起時只有 u 小的燈亮，接近 1 時全部亮。`spread` 決定「這一波」有多長，`ramp` 決定單盞從暗到亮多快。

**渲染方式比較**：

| 方案 | 做法 | 每盞獨立 | draw calls | 風險 |
|---|---|---|---|---|
| ① 分組 | 依 u 分成 K 組（例如 12 組），每組一個複製的 emissive 材質 | 否（同組一起亮） | +K | 低；K 小時看得出「一批一批」 |
| ② per-instance 屬性 + shader 修補 | `InstancedBufferAttribute('aGlow')` + `material.onBeforeCompile` 把 `totalEmissiveRadiance` 乘上 `vGlow` | 是 | +0 | 中；依賴 three 內部 shader chunk 名稱，升版可能壞 |
| ③ **unlit 發光層 + instanceColor**（建議） | 燈籠的 emissive 部件改用 `MeshBasicMaterial`（不受光照、正好像自己會發光），每盞燈是一個 instance，每幀 `setColorAt(i, lerp(offColor, onColor, glow_i))`，`instanceColor.needsUpdate = true` | 是 | 每種發光部件 1 個 | 低；`MeshBasicMaterial` 原生支援 instanceColor，不碰 shader |

**建議 ③**：
- `onColor` = 燈籠的 emissive 色 × 亮度倍率（可 >1，讓 ACES 色調映射後仍飽和）；`offColor` = 燈籠的底色 × 當下的環境亮度（取 `hemiIntensity` 與 `sunIntensity` 推一個係數），所以白天看起來像一般紅燈籠，不會像在發光。
- 燈籠的非發光部件（頂蓋、穗）照 4.5 合併進一般散落。
- **光暈**：同一批位置再放一組 `THREE.Points`，`PointsMaterial({ map: 放射漸層 CanvasTexture, vertexColors: true, blending: AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: true })`，每點顏色 = 暖橘 × glow_i。**加法混合下「顏色乘上亮度」等同不透明度**，所以不用自訂 shader 就能做到逐點淡入。海面倒影（4.3）也用這組資料。
- **真的照到地面的光**：PointLight 很貴（每多一盞，場景中**每個**受光材質的 shader 都要多算一盞），所以最多 4 盞——每站一盞，強度 = 該站附近燈籠 glow 平均。數量固定不變（只改 intensity，不增減燈），避免 shader 重新編譯造成卡頓。
- **站點建築上的發光部件**：用 4.4 的「材質 clone + emissiveIntensity」，glow 值取該站在步道上的 u 代入同一個排程公式，所以建築的窗戶/招牌也跟著那一波亮起。
- **Bloom**：預設不開（`EffectComposer` + `UnrealBloomPass` 至少多 5~6 次全螢幕 pass，手機吃不消）。桌機高品質時可選擇開啟，作為降級開關的一項。
- **成本**：③ + 光暈 + 4 PointLight ≈ 3~5 draw calls；每幀 CPU 更新 N 盞的顏色（N≈100，可忽略）。
- **燈籠數量建議**：步道沿線自動生成 60~120 盞（電線上的燈籠串），加上美術在 scatter 手放的燈籠；兩者都進同一個發光層。

### 4.8 太陽/月光、半球光、陰影相機
- `HemisphereLight(hemiSky, hemiGround, hemiIntensity)`：每幀由 `LightState` 設 `color`、`groundColor`、`intensity`。
- `DirectionalLight`：`position = target + sunDirection × 80`，`color`/`intensity` 由 `LightState` 決定。夜晚就是「月光」：仰角低、偏藍、強度低——**同一盞燈**，不另開一盞（避免增減燈造成重新編譯）。
- **陰影相機**：島半徑 30~40 → `shadow.camera` 設 `left/right/top/bottom = ±45`、`near 1`、`far 200`，`mapSize` 桌機 2048、手機 1024；`bias -0.0005`、`normalBias` 依新尺度重新調（imagine 的 0.6 是給像素尺度的世界，這裡要小很多，估計 0.02~0.05，**需實測**）。
- 太陽方向改變時陰影會游移，屬預期效果。
- **夜間陰影**：不要切 `castShadow`（會觸發重新編譯）；`sunIntensity` 很低時陰影本來就淡，保持開啟即可。手機若吃緊，在 `sunIntensity < 0.15` 時改成「`shadow.autoUpdate = false` 並停止更新」，省掉每幀的陰影 pass。
- **色調映射**：沿用 imagine 的 `ACESFilmicToneMapping`、`SRGBColorSpace`；`toneMappingExposure` 改成隨時間：傍晚 1.05、夜晚 1.2（夜晚稍微拉高曝光才看得見島體）。

### 4.9 粒子：蒸氣、天燈、螢火蟲
- **蒸氣**（基山街小吃攤、阿妹茶樓茶壺）：每處 12~20 個 `Points`，CPU 每幀上升 + 擴散 + 淡出，循環重生；淡出透過加法混合下調暗顏色實現（同 4.7 技巧）。
- **天燈**：8~15 個小型 InstancedMesh（四角錐 + 底部發光），從島邊緩慢上升、輕微搖擺，只在 19:00 後出現；底部光用光暈 Points。
- **螢火蟲**：輕便路一帶 30~50 個 Points，夜間出現，位置用 sin 疊加做漂移，亮度閃爍。
- **成本**：每類 1~2 draw calls，CPU 每幀數百個點的更新。
- **降級**：手機數量減半；最低品質全關。

---

## 5. 互動

### 5.1 OrbitControls 範圍
- `target` 固定在島心略上方（例如 `(0, 中層階地高度, 0)`），`enablePan = false`、`enableDamping = true`（照 imagine）。
- `minPolarAngle 0.35`、`maxPolarAngle 1.25`（比 imagine 的 1.2 略放，讓人能看到島底參差，但不能看到海面以下）。
- 距離：依島半徑與視窗比例 fit（照 imagine `fitCamera` 的思路：同時滿足水平與垂直視角），`minDistance = fit × 0.4`、`maxDistance = fit × 1.5`。
- `PerspectiveCamera(30°, aspect, 0.5, 800)`（near/far 依新尺度調整；imagine 的 10/8000 是給像素尺度）。
- 手機：`touchAction: none` 已由 imagine 做法處理；一指旋轉、兩指縮放是 OrbitControls 預設。

### 5.2 點選站點
- 沿用 imagine 的「pointerdown 記位置、pointerup 位移 ≤5px 才算點擊」。
- **碰撞代理**：每站一個看不見的 `CylinderGeometry`（半徑 = 建築外框 × 1.2，高 = 建築高 + 標籤），`material.visible = false`。Raycaster 只對這 4 個代理 `intersectObjects(proxies, false)`，比對整棟建築的所有部件快很多，也比較好點（手機手指大）。
  - Raycaster 是否會略過 `visible=false` 的**物件**：我記得 three 的 `intersectObject` 只檢查 layers 不檢查 `object.visible`，但沒有在 r170 確認過，所以改用「**材質**不可見、物件可見」的方式，`Mesh.raycast` 不看材質可見性。**未驗證**——第 6 章步驟 9 要有一個在 node 跑的 raycast 單元測試確認（Raycaster 是純數學，不需要 WebGL）。
- hover（桌機）：指到代理時，建築下方顯示一個脈動光圈（照 imagine 的 `RingGeometry` 選取圈），游標變手指。
- 旅人也可以點（代理同法），點了顯示「親子兩人目前在 ○○」。

### 5.3 CSS2D 標籤
- 每站一個 `CSS2DObject`：`壱 基山街 · 17:30`（`index` + `label` + `time`），`center(0.5, 1)` 放在建築頂上方。
- 標籤 DOM 本身 `pointer-events: auto` 也能點（同樣開資訊卡）；外層 CSS2D 容器維持 imagine 的 `pointerEvents: none`。
- 夜晚標籤底色改深色半透明；目前時間所在的站標籤加亮。
- CSS2D 不會被 3D 物體遮擋：鏡頭轉到建築背面時標籤仍浮在上面。原型接受；若要處理，每幀從鏡頭對標籤錨點做一次 raycast（只對島體與建築的簡化代理），被擋就降低透明度——4 個標籤的成本可接受，但列為選做。

### 5.4 點站後的資訊卡
HTML 浮層（不用 CSS2D，因為要能捲動、在手機上要變成底部抽屜）：
```
┌────────────────────────────┐
│ 壱  基山街          17:30 示意時間 │
│ [封面圖 coverPhotoId]           │ ← 原型若拿不到圖片網址就顯示站名漸層占位
│ 摘錄:九份最熱鬧的主要街道…        │ ← excerpt(desc)
│ 「小朋友本來還在猶豫…」            │ ← blurb(有才顯示,引言樣式)
│ ── 署名 ──────────────────     │
│ 文/ 九份部落客(示意)             │ ← Byline.name
│ 《夜遊九份——傍晚上山,點一盞燈火…》 → 讀全文 │ ← content.title,連到 /u/{handle}/{slug}(原型占位)
│ [‹ 上一站]  [下一站 ›]  [用 Tripace 排我的九份] │
└────────────────────────────┘
```
- 桌機：右側卡片；手機（寬 < 640px）：底部抽屜，高度 45vh，可下拉關閉。
- 開卡片時鏡頭緩動飛到該站（`cameraAt` 的單站版本），時間**不跳**（避免改到使用者正在看的光影），但可提供「跳到 17:30」小按鈕。
- 圖片：`photoId` 要經後端 `fetchPublicBlogPhotosByIDs` 才能換成網址；原型沒有後端，先顯示占位，**不要**硬寫上傳檔路徑。
- 可近用性：卡片 `role="dialog"`、`aria-labelledby`、Esc 關閉、開啟時焦點移到標題。

### 5.5 導覽模式
- 按「導覽」→ `tourKeyframes` 產生「封面 → 壱 → 弐 → 参 → 肆 → 封面」；每站停 3 秒，站與站之間 2.5 秒緩動（`easeInOutCubic`），同時把 `clockMinutes` 推進到該站時間，燈籠隨之亮起，所以導覽本身就是一段「傍晚到夜晚」的短片。
- 導覽期間 `controls.enabled = false`；使用者一拖動或按 Esc 立即中止，`controls` 從目前鏡頭位置接手（要把 `controls.target` 同步成目前 target，否則會跳）。
- 每到一站自動開該站資訊卡（精簡版）。

### 5.6 時間滑桿與播放
- 範圍：`lighting` 第一筆到最後一筆（預期 16:00~22:00），步進 5 分鐘；刻度標出四站時間。
- 播放：1 秒 = 4 分鐘（6 小時約 90 秒）；×2 / ×4 切換。播放到結尾停在 22:00。
- 拖動時即時更新（直接改 `clockMinutes`），放開不做額外動作——因為只有一個時間來源，旅人、燈籠、天色天然同步。

### 5.7 旅人（親子兩人）
- 模型：`models/` 中假設有 `parent` 與 `child`（名稱以 Fable 實際產出為準），`buildModel` 各一份；child 用 `scale` 小一號。
- 每幀：`progressAt(clockMinutes)` → `familyPoses` → 設位置、`rotation.y = heading`（imagine 用 `lerpAngle` 平滑轉向，這裡照搬）；`walkPhase += Δs / (stride × scale) × 2π`，`walkWeight` 依 `walking` 平滑趨近 0/1，呼叫 `animateModel(built, walkPhase, walkWeight, time)`——正是 model.ts 設計好的介面。
- 拖滑桿時 Δs 可能很大，`walkPhase` 增量要夾住（每幀最多 +π），避免四肢瘋狂抽動。
- 旅人手上可以拿一盞小燈籠（夜間發光，同 4.7 第 ③ 方案的一個 instance）。

### 5.8 封面視角
- 一鍵按鈕：鏡頭回到固定的「封面位置」（3/4 俯角、略偏東南、構圖讓四站全入鏡且燈籠最多的一側朝鏡頭），時間設 19:45（燈籠全亮、天色仍有一點藍），隱藏 HUD 0.4 秒做轉場。
- 封面位置寫在 layout 之外的 `cameraRig.ts` 常數；若 Fable 在 `visual-plan.md` 指定構圖，以那份為準。
- 封面也是分享截圖與 OG 圖的預設構圖。

### 5.9 分享用截圖 / 錄影
**截圖**（優先做）：
1. 不開 `preserveDrawingBuffer`（開了會讓每幀多一份緩衝保留，行動裝置效能較差）。改成：在同一個同步流程內 `renderer.render(scene, camera)` 後立刻 `canvas.toBlob(...)`/`drawImage(canvas)`。WebGL canvas 在同一個 task 內、尚未合成到畫面前，繪圖緩衝仍保有內容——這是常見作法，**未在本專案驗證**，需實測（失敗的退路就是只在截圖那一刻臨時建一個 `preserveDrawingBuffer: true` 的離屏 renderer，成本高但只做一次）。
2. 輸出尺寸：暫時 `renderer.setPixelRatio(1)` + `setSize(1080, 1350)`（IG 直式）或 `1200×630`（OG），渲染一次後還原。CSS2D 標籤不在 canvas 裡，截圖時改用 2D canvas 依 `vector.project(camera)` 的螢幕座標**重畫**標籤。
3. 合成：建一個 2D canvas，`drawImage(webglCanvas)` → 下方漸層遮罩 → 文字：文章標題、`文/ 部落客名`、Tripace 標誌與網址（浮水印放右下角、40% 不透明）。
4. 輸出：`navigator.share({ files: [file] })` 支援時用系統分享（手機），否則下載 PNG。

**錄影**（選做）：`MediaRecorder(compositeCanvas.captureStream(30))`。要讓影片也帶浮水印，必須錄「合成用的 2D canvas」，每幀把 WebGL canvas 畫上去再疊字，等於每幀多一次全畫面 drawImage——桌機可接受、手機不建議。編碼格式：Chrome 用 `video/webm`；Safari 的 `MediaRecorder` 支援格式與版本有關，**未驗證**，要先 `MediaRecorder.isTypeSupported` 檢查。建議錄影固定跑一次 15 秒導覽，產出可直接發限動的短片。

### 5.10 「用 Tripace 排我的九份」CTA
- **位置**：桌機右下角常駐的膠囊按鈕；手機在時間滑桿上方、置中；資訊卡底部再放一次；導覽結束畫面放大版。不要在使用者剛進來就彈出，第一次點站或導覽結束後才加強提示（輕微發光）。
- **連結**：`${TRIPACE_ORIGIN}/ai-plan?from=island&article=night-jiufen&stops=stop_1,stop_4,stop_5,stop_6`，`TRIPACE_ORIGIN` 由 `import.meta.env.VITE_TRIPACE_ORIGIN` 設定（開發預設 `http://localhost:5173`）。
- **現況限制**：`/ai-plan`（`planning/preview/Content.tsx`）目前只讀 `embedded`、`skipDemo`、`debugSafeArea`，上述 `from`/`article`/`stops` 參數**會被忽略**，原型只是把人帶過去；真正「帶著站點當起點」是第 10 章的後續工作。
- 在 iframe 嵌入情境下要 `target="_top"`（或 `_blank`），不然會在 iframe 裡開整個規劃頁。

---

## 6. 實作步驟

每步都可獨立驗收。驗證方式以 **vitest 單元測試 + `tsc --noEmit` + 最後階段人工/chrome-devtools 看畫面** 為主（理由見 7.2）。標「看畫面」的項目，開發中先用 `?debug` 疊層文字（FPS、draw calls、三角形數、目前時間）輔助判斷，到整批最後再一起檢查。

| # | 步驟 | 要新增/改的檔案 | 完成標準 | 驗證 |
|---|---|---|---|---|
| 1 | **骨架 + 空場景** | `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.ts`、`three/IslandApp.ts`、`logic/rng.ts` | `npm run dev` 出現天藍背景與一個方塊；resize 正常；`visibilitychange` 切到背景時 `setAnimationLoop(null)`、回來恢復（imagine 只歸零 accumulator，這裡要**真的停止**渲染以省電）；`dispose` 清乾淨 | `tsc`、`vitest`（rng）；看畫面 |
| 2 | **版面驗證 + 高度場** | `logic/geom2d.ts`、`logic/heightField.ts`、`logic/validateLayout.ts` + 測試 | 對 Fable 的 `layout.ts` 跑驗證，零 error；dev 模式下有 error 時畫面左上角紅框列出 | `vitest`（3.2 的性質） |
| 3 | **看到島** | `three/terrain.ts`、`three/sky.ts`（先只有漸層，固定 18:00 的色） | 島體擠出、島底參差、階地疊層與石牆側面可見；漂浮在空中 | 單元測試：擠出後 bounding box 的 x/z 範圍等於 outline、頂面 y = topY（在 node 用 BufferGeometry 計算，不需 WebGL）；看畫面 |
| 4 | **步道與石階、河** | `logic/pathCurve.ts` + 測試、`three/pathMesh.ts` | 步道平滑貼地、跨階地處有一級一級的石階、沒有懸空或埋地；河有流動感 | `vitest`：弧長、剖面、石階級數與高度差；看畫面 |
| 5 | **四站建築** | `three/stops.ts`、`logic/articleToIsland.ts` + 測試 | 四站模型出現在正確位置與高度；發光材質已 clone；CSS2D 標籤顯示 `壱 基山街 · 17:30` 等 | `vitest`：文章對應（順序、缺漏、摘錄、時間來源）；單元測試：「所有模型的 `$` 色票都能解析」（掃 `models/` 的 palette 引用）；看畫面 |
| 6 | **裝飾散落** | `logic/scatterResolve.ts` + 測試、`three/scatter.ts` | 所有 scatter 以 InstancedMesh 呈現，draw calls 符合 4.5 估計；沒有東西擋在步道上或懸在階地邊 | `vitest`：避障性質；**`mergeGeometries` 對 model.ts 全部 7 種形狀混合後不回 null**（node 可跑）；看畫面 + `?debug` draw calls |
| 7 | **光影與日夜** | `logic/lightTimeline.ts` + 測試、`three/lighting.ts`、`sky.ts` 補完、`three/sea.ts` | 時間由網址 `?t=` 控制；16:00 / 18:30 / 20:30 三個時刻光影明顯不同；海面夜晚有月光帶；霧把海平線融入天空 | `vitest`：插值、回接、方位角；看畫面（三個時刻各一張） |
| 8 | **燈籠一盞一盞亮起** | `logic/lanternSchedule.ts` + 測試、`three/lanterns.ts`、`three/particles.ts` | `?t=18:00→20:00` 期間從基山街往阿妹茶樓依序亮起；光暈、4 盞 PointLight、站點窗戶同步；蒸氣/天燈/螢火蟲 | `vitest`：單調性、順序、邊界；看畫面（錄一段播放觀察） |
| 9 | **互動：時間、點站、資訊卡** | `ui/hud.ts`、`ui/infoCard.ts`、`ui/hud.css`、`stops.ts` 加碰撞代理 | 滑桿/播放驅動全部時間相關效果；點站開卡片（含署名區與上一站/下一站）；手機為底部抽屜 | `vitest`：Raycaster 對 `material.visible=false` 的代理能命中（node）；看畫面（桌機、手機寬度各一） |
| 10 | **旅人 + 導覽 + 封面** | `logic/schedule.ts`、`logic/travelerPose.ts`、`logic/tour.ts` + 測試、`three/travelers.ts`、`three/cameraRig.ts` | 親子兩人隨時間走、到站停留、上石階高度正確；導覽一鍵跑完並可中斷；封面一鍵 | `vitest`：3.2 的進度、位姿、關鍵幀性質；看畫面 |
| 11 | **分享截圖 + CTA** | `three/capture.ts`、`ui/cta.ts` | 下載的 PNG 有完整場景、重畫的標籤、標題與署名浮水印；CTA 帶正確參數連到 `/ai-plan` | 單元測試：CTA 網址組裝（純函式）；人工下載檢查 PNG；錄影為選做 |
| 12 | **效能與降級** | `three/quality.ts`、各模組讀品質旗標 | 三個品質等級可由 `?q=` 強制；自動偵測生效；`?debug` 數字符合第 8 章預算 | 中階手機實機跑一次（若無實機，明說「未在實機驗證」） |

---

## 7. 測試策略

### 7.1 vitest 負責什麼
所有 `logic/` 的純函式，以及「不需要 WebGL 也能檢查的幾何結果」（BufferGeometry 的 bounding box、mergeGeometries 回傳非 null、Raycaster 命中代理）。目標是：美術改 `layout.ts` 或模型後，跑 `npm test` 就能知道有沒有把東西擺壞。

### 7.2 截圖負責什麼，以及為什麼不用 Playwright
- 使用者在 tripace 專案明確表示過**不要用 Playwright 做視覺測試或截圖**，畫面檢查只在整批工作的最後階段用 chrome-devtools MCP 做一輪精簡檢查。本計劃遵循這個慣例：不加 `@playwright/test`，不做像素比對。
- 截圖只負責「人看得出來的事」：構圖、燈籠高潮好不好看、色調是否太暗。WebGL 截圖在不同 GPU 上像素本來就不穩定，不適合當自動化斷言。
- 最後階段檢查清單（精簡版）：桌機 1440×900 的 `?t=16:30`、`?t=19:45`（封面）；手機 390×844 的封面與開資訊卡；共 4 張。
- 原型要讓使用者自己看效果時，提供網址參數（`?t=`、`?q=`、`?debug`、`?tour=1` 自動導覽）。

### 7.3 具體測試案例清單
**geom2d.test.ts**
1. 單位正方形：內點 true、外點 false、遠點 false。
2. 反轉頂點順序 → `isClockwise` 結果相反。
3. 8 字形 → `selfIntersects` true；凸多邊形 → false。
4. `distToPolyline`：線上點 = 0；垂直距離正確；超出端點取端點距離。

**heightField.test.ts**
5. 島外回 null；平地回 topY。
6. 兩塊階地重疊處回較高者。
7. 對 Fable 的 `layout.ts`：每個 stop 位置的高度都是某個合法層級（不是 null）。

**pathCurve.test.ts**
8. 平滑後首尾點不變；弧長表遞增、`s[0]=0`。
9. `sampleAt(0)`、`sampleAt(total)`、`sampleAt(-1)`、`sampleAt(total+1)` 的夾住行為。
10. 切線長度 = 1（容差 1e-6）。
11. 平地路徑的剖面高度恆等於 topY。
12. 跨過 1.2 高的階地、`riser=0.3` → 4 級，每級差 ≤0.3，石階在低側。
13. `projectToPath` 對路徑上的點回原 s。
14. 真實 layout：四站投影的 s 嚴格遞增（否則旅人會倒著走）。

**lightTimeline.test.ts**
15. `parseHHMM('17:30') = 1050`；非法字串丟錯。
16. 在關鍵時刻上取值等於該幀。
17. 兩幀中點 = 平均（數值欄位）。
18. 最後一筆 → 第一筆的回接區段（例如 22:00 → 隔天 16:00）連續。
19. `lanternGlow` 結果夾在 [0,1]。
20. `sunDirection(90, *)` ≈ (0,1,0)；`sunDirection(0, 90)` ≈ (1,0,0)（東）。
21. 真實 layout：16:00 的 `lanternGlow` < 20:30 的 `lanternGlow`。

**lanternSchedule.test.ts**
22. `globalGlow=0` 全 0、`=1` 全 1。
23. 對 `globalGlow` 從 0 到 1 掃 100 步，每盞燈亮度單調不減。
24. u 較小的燈在任何時刻亮度 ≥ u 較大的燈（關掉 jitter 時）。
25. 同 seed 結果相同、不同 seed 不同。

**schedule.test.ts / travelerPose.test.ts**
26. 在 17:30/18:30/19:30/20:15 時旅人正好在對應站的 s。
27. s 對時間單調不減；停留期間 `walking=false`。
28. 時間早於開始/晚於結束時夾住。
29. `stopS` 非遞增時丟錯。
30. 上石階時 pose 的 y 逐級上升；heading 與切線一致；小孩落後且在側邊。

**scatterResolve.test.ts**
31. 擺在步道正中的樹被移除且原因為 `path`。
32. 擺在階地邊上的石頭被移除且原因為 `edge`。
33. 所有保留物件在 outline 內，y = heightAt。
34. 決定性：同輸入同輸出。

**validateLayout.test.ts**
35. 合法最小 layout 無 error。
36. 引用不存在的模型 → error。
37. stop 時間不遞增 → error；lighting 未涵蓋 16:00~22:00 → warn。
38. 模型 palette 引用 `$foo` 不存在 → error（防洋紅）。
39. 真實 layout + 真實 models 無 error（這條是美術交付的守門員）。

**articleToIsland.test.ts**
40. 用 `docs/source-night-jiufen.json`：取出 4 站，順序 `stop_1, stop_4, stop_5, stop_6`，index `壱弐参肆`。
41. `stop_1`、`stop_6` 有 blurb；`stop_4`、`stop_5` 沒有。
42. `stop_4` 的 coverPhotoId 取自 gallery 第一張 `upf_0bec6d960b1d`。
43. 摘錄 ≤60 字且以第一句為主。
44. 混入未知 kind 的 block 不丟錯。
45. layout 有、文章沒有的 stopId → warn；順序對調 → error。
46. layout 沒時間時 `generateTimes(4, '17:30', '20:30')` 平均分配且對齊 5 分鐘。

**three 層（node 可跑的部分）**
47. `ExtrudeGeometry` 換算後的 bounding box 與 outline 一致。
48. 七種形狀各一的 Model3D，經「烘焙合併」後每個材質組回傳非 null、頂點數 = 各部件 non-indexed 頂點數總和。
49. Raycaster 命中 `material.visible=false` 的代理。
50. CTA 網址組裝：帶 `from`、`article`、`stops`，正確 encode。

---

## 8. 效能預算

### 8.1 目標
- 桌機（內顯筆電以上）：60fps，1440×900、pixelRatio ≤2。
- 中階手機（約 3~4 年前的中階 Android / iPhone 11 等級，估計）：30fps，pixelRatio 上限 1.5。

### 8.2 粗估（高品質，桌機）

| 項目 | draw calls（主 pass） | 陰影 pass | 三角形 |
|---|---|---|---|
| 島體 + 階地 + 島底 | 12~18 | 12~18 | 5k |
| 步道 + 石階 + 河 | 2~3 | 2 | 6k |
| 四站建築（未合併） | 60~160 | 40~120 | 15k |
| 散落（A 方案） | 20~30 | 12~20 | 30~60k |
| 燈籠發光層 + 光暈 | 3~5 | 0 | 10k |
| 旅人 ×2 | 20~30 | 20~30 | 2k |
| 天空 + 星星 + 海 + 反光 | 4~6 | 0 | 3k |
| 粒子 | 4~6 | 0 | — |
| **合計** | **約 130~260** | **約 90~190** | **約 70~110k** |

主要壓力來自四站建築與旅人「每部件一個 Mesh」（model.ts 的設計）。手機版靠 4.4 的合併把建築降到 20~40。

### 8.3 品質等級與降級開關（`quality.ts`）

| 開關 | high | mid | low |
|---|---|---|---|
| pixelRatio 上限 | 2 | 1.5 | 1 |
| antialias | 開 | 開 | 關 |
| 陰影 | 2048、PCFSoft | 1024、PCF | 關 |
| 夜間停更陰影 | 否 | 是 | — |
| 站點建築合併 | 否 | 是 | 是 |
| 散落動畫（sway） | 開 | 關 | 關 |
| PointLight 數 | 4 | 2 | 0 |
| 粒子數量 | 100% | 50% | 0 |
| 星星 | 600 | 300 | 150 |
| 海面反光碎波/漁火 | 開 | 關 | 關 |
| Bloom（選做） | 可開 | 關 | 關 |

**自動判斷**：初始依 `navigator.hardwareConcurrency`、`devicePixelRatio`、螢幕寬度、`matchMedia('(pointer: coarse)')` 給預設等級；執行中量測前 3 秒的平均幀時間，低於目標的 85% 就降一級（只降不升，避免來回切換造成畫面閃動與重新編譯）。`?q=` 可強制。

**其他固定做法**：背景分頁時停止渲染迴圈；鏡頭與時間都沒動、也沒有播放時，降到每秒 30 幀（粒子仍在動所以不完全停）；`prefers-reduced-motion` 時關掉自動導覽與天燈。

---

## 9. 風險與開放問題

### 風險
1. **四站建築與旅人的 draw calls**（最大風險）：model.ts 一部件一 Mesh、全部投影，部件多時手機吃緊。對策：4.4 的合併 + 小部件不投影；最壞情況把旅人改成單一合併 mesh（失去四肢擺動）。
2. **燈籠高潮好不好看**：取決於 ACES 下的亮度倍率、光暈大小、spread 參數，只能實際看畫面調；沒有 Bloom 時「發光感」可能不足。對策：光暈 Points 先做足，Bloom 當桌機選項。
3. **model.ts 材質全域共用**：若有人忘了 clone 就改 `emissiveIntensity`，會讓所有同色模型一起變。對策：只在 `stops.ts` 一處做 clone，其他地方不准改從 `buildModel` 拿到的材質；寫一個測試確認 clone 後原快取材質未被改動。
4. **步道只有 2D 點**：階地交界處的石階是推導出來的，若美術的路徑與階地邊界幾乎平行，會出現很多細碎台階。對策：驗證時 warn；請 Fable 在 visual-plan 決定是否擴充契約。
5. **`mergeGeometries` indexed/non-indexed 混用**：見 4.5，已列入步驟 6 的第一個測試。
6. **截圖時繪圖緩衝已被清空**：見 5.9，有離屏 renderer 的退路。
7. **上層 vitest 掃到 island-demo 測試**：見 2.5，需要使用者同意在上層 exclude 加一行。
8. **Fable 產出尚未存在**：`layout.ts` 的實際尺度、模型名稱、旅人模型是否存在都未知；步驟 1~4 可用一份最小測試 layout 先行，步驟 5 起依賴美術交付。

### 開放問題
1. 部落客名字從哪裡來？JSON 只有 `ownerId`；`/v1/blog/{handle}/{slug}` 回應是否含作者顯示名稱未驗證。原型先用占位。
2. 文章照片在島上要不要出現（例如站點旁的小相框、資訊卡封面）？需要後端照片網址解析，原型先不接。
3. 示意時間（17:30/18:30/19:30/20:15）要不要在 UI 明說是「示意」？建議要，避免讀者當成真實建議行程。
4. 路徑高度要不要正式進契約（`path.points` 帶 y 或另給 `steps` 區段）？等 visual-plan.md。
5. 原型最終要放在哪裡給人看？靜態部署（`vite build` 產物）或之後併進主站 `/embed/island/:slug`？影響 `base` 與 CTA 網址。
6. CTA 帶的 `article`/`stops` 參數，`/ai-plan` 要怎麼接（見第 10 章）。

---

## 10. 與部落客工作流的整合構想

### 10.1 從文章自動生成島
輸入是現有的 `ThemePageContent`（加上作者資訊），輸出是一份 `IslandLayout` + 每站的資訊卡資料。核心就是 3.3 的 `articleToIsland` 再往前推一步：**由程式生成 layout，而不是美術手寫**。

| 文章元素 | 島上元素 | 規則 |
|---|---|---|
| `stop` 區塊 | 站點建築 | 依 `name`/`desc`/`category` 關鍵字選建築模型（「茶樓」「茶屋」→茶樓、「老街」「街」→街屋群、「石階」「路」→牌樓或階梯地標、「寺」「廟」→廟、「海」「港」→燈塔/碼頭）；比對不到用通用「站點亭」。最終由 LLM 分類補強（比關鍵字穩），但要有規則版當退路。 |
| 站點順序 | 步道走向 | 依陣列順序；位置用「螺旋上山」或「沿海岸」等版型模板排出 N 個錨點，步道依序串連。 |
| 站數 | 島的大小與階地層數 | 3~6 站最佳；>6 站拆成「上午島 / 下午島」或提示部落客精簡（呼應「多島」暫不做）。 |
| `desc` | 資訊卡摘錄 | 第一句 + 60 字上限；部落客可在發佈前改。 |
| `blurb` | 資訊卡引言 | 原樣。 |
| `media` 第一張 | 資訊卡封面、站點旁相框 | 經後端換網址。 |
| `eyebrow`（例如「親子小旅行」） | 旅人角色組合 | 親子→大人+小孩、情侶→兩人、長輩→加拐杖角色、獨旅→一人。 |
| `preferredTheme`、`palette` | 預設時段與色調 | `dark` 或 `night-market` → 預設夜景時段；`ocean-cool` → 海島風格包。 |
| `scroll-timeline-anchor.center` | 真實座標（若有） | 用來決定站點在島上的**相對方位**（經緯度投影後正規化到島半徑內），不追求比例正確。 |

**缺座標時**：用版型模板（螺旋上山、沿海岸、繞湖一圈、直線老街）依站數排錨點；有部分座標時以有座標的站當定錨，其餘內插。
**缺時間時**：`generateTimes` 依風格包預設時段（夜景包 17:00~21:00、古城包 09:00~17:00）平均分配，介面標「示意時間」。部落客可在發佈前的預覽裡拖動調整。

**地區風格預設包**（每包 = 地形版型 + 模型組 + 色票 + 光照關鍵幀 + 粒子組）：

| 風格包 | 地形 | 主要模型 | 光照 | 高潮演出 |
|---|---|---|---|---|
| 山城夜景（九份、平溪） | 多層階地 + 石階 + 遠海 | 街屋、紅燈籠、茶樓、電線 | 傍晚→夜 | 燈籠沿路亮起、天燈 |
| 海島（澎湖、綠島、小琉球） | 低平 + 沙灘 + 礁岩 + 大面積海 | 燈塔、漁船、珊瑚礁、仙人掌 | 白天→夕陽 | 夕陽落海、海面金光 |
| 古城（台南、鹿港） | 平地 + 城牆 + 巷弄格網 | 廟、紅磚屋、城門、榕樹 | 白天 | 廟口香煙、小吃攤蒸氣 |
| 溫泉鄉（北投、礁溪、谷關） | 山谷 + 溪流 + 冒煙池 | 湯屋、木棧道、楓樹 | 傍晚→夜 | 溫泉蒸氣、溪面燈影 |

**選用方式**：①規則：依站名/文章關鍵字與 `palette` 打分；②LLM 從四個包挑一個並說明理由；③部落客在預覽中可手動切換。預設信任規則+LLM，但永遠可改。

### 10.2 部落客如何發佈與嵌入
1. **在 Tripace 內**：部落客文章頁 `/u/{handle}/{slug}` 上方或「站點卡片」段落前加一個「在島上看這趟行程」入口，開全螢幕島（同網域，最簡單）。
2. **嵌到外站部落格**（延續 Tripace 已記錄的方案 A）：
   - 部落客貼上：`<div data-tripace-widget="island" data-slug="night-jiufen" data-handle="xxx"></div><script async src="https://tripace.io/embed/loader.js"></script>`
   - `loader.js`（很小，只做 DOM 操作）：找 `data-tripace-widget` 占位 div → 插入 `<iframe src="https://tripace.io/embed/island/{handle}/{slug}" loading="lazy">` → 監聽 `postMessage` 回報的高度調整 iframe。
   - iframe 內在 tripace.io 網域執行，WebGL、Google 地圖 API key 網域限制都不受外站影響。
   - 嵌入版的行為：進入畫面才建立 WebGL（`IntersectionObserver`）、離開畫面暫停、手勢採 cooperative（單指捲頁面、雙指才轉島，避免綁架外站捲動）、預設顯示封面截圖 + 「點我進島」按鈕（第一次點擊才啟動 3D，省流量與電）。
   - 待確認（沿用既有記錄）：伺服器要放行 `/embed/*` 被外部框住的標頭（CSP `frame-ancestors`）；是否開放所有外部網站嵌入。
3. **Tripace 自家文章內**：文章 JSON 不能塞任意 script（XSS），只能用白名單區塊，例如 `EmbedBlock{ kind: 'embed', widget: 'island', height, params }`。這需要改 `web/src/blog/types.ts` 與渲染端——依既有記錄，嵌入相關改動使用者表示晚點再研究，本原型**不動**。

### 10.3 讀者端轉換路徑
```
外站文章 → 看到島的封面截圖 → 點進島(iframe 內) → 拖時間看燈籠亮、點站看卡片
   → 「用 Tripace 排我的九份」(target=_top)
   → tripace.io/ai-plan?from=island&article={handle}/{slug}&stops=...
   → AI 排程頁以這四站當起點(預填),讀者可加減站點、改日期、改交通
   → 存成自己的行程(需登入)→ 之後可回頭分享「我的島」
```
- 需要的後續工作：`/ai-plan` 讀 `article`/`stops` 參數並向後端取文章站點當初始資料（目前 `Content.tsx` 不讀這些參數）。站點要能對應到真實地標才排得出交通時間——文章的 stop 沒有地標 id，需要「站名 → 地標」的比對（可用既有地標資料搜尋，比對結果讓讀者確認）。
- 歸因：網址帶 `from=island&ref={handle}`，讓部落客之後看得到「我的島帶來多少人排行程」，這是部落客分潤構想（既有發文工具產品線第 4 階段）的資料基礎。

### 10.4 分享與 SEO
- **OG 圖**：發佈時在伺服器端或部落客瀏覽器端產生封面截圖（用 5.9 的流程，1200×630），上傳到既有圖片儲存，存成文章的 `islandCoverPhotoId`。由部落客瀏覽器產生最簡單（不用伺服器 GPU），代價是要部落客打開預覽一次。
- **文字可被爬蟲讀取**：3D 內容對爬蟲是空白。島頁/嵌入頁的 HTML 要同源輸出：文章標題、四站名稱與摘錄、作者、原文連結（`<noscript>` 或在 canvas 下方的可見文字清單，同時兼作可近用性的替代內容）。主站目前是 SPA，`og:*` meta 是否由伺服器輸出**未驗證**；若沒有，社群預覽抓不到 OG 圖，需要伺服器對 `/embed/island/*` 與 `/u/*` 輸出最小 HTML head。
- **canonical**：嵌入頁 `canonical` 指向部落客原文（外站或 `/u/{handle}/{slug}`），避免與原文搶排名——對部落客友善是推廣的前提。

### 10.5 衡量指標
| 漏斗階段 | 指標 |
|---|---|
| 曝光 | 嵌入載入次數、封面截圖曝光（iframe 進入畫面） |
| 互動 | 「點我進島」率、平均停留時間、點站次數、完成導覽率、拖動時間軸率 |
| 分享 | 截圖下載/系統分享次數、帶 `ref` 的回流 |
| 轉換 | CTA 點擊率、進 `/ai-plan` 後完成一份行程的比例、註冊數 |
| 供給端 | 生成島的部落客數、每位部落客的島數、從島回訪文章的點擊 |
| 效能健康 | 首幀時間、平均 FPS 分佈、自動降級比例、WebGL 建立失敗率 |

北極星建議：**「由島帶來的、完成至少一份行程的新使用者數」**。

---

## 11. 旅遊業玩法與推廣發想

標記：🟢 適合先做　🔧 需要後端　📜 需要授權或第三方資料

### 旅客端
1. **島上打卡集章**：每站點開資訊卡就蓋一個章，四章集滿解鎖「九份夜遊完成」徽章與可分享卡片。🟢（本地狀態即可；跨裝置保存才需要 🔧）
2. **親子/長輩友善標記**：石階段標「階梯多、推車不便」、站點標「有座位/廁所」，用島上小圖示表示；與「親子小旅行」這類文章天生契合。🔧 📜（無障礙資訊需可靠資料來源）
3. **「我的版本」島**：讀者在 `/ai-plan` 改完行程後，產生一座屬於自己的島，可分享給同行家人。🔧
4. **出發前倒數島**：存好的行程每天開一次島，天氣/日落時間套進光照（真的日落時刻決定燈籠何時亮）。🔧 📜（天文/天氣資料）
5. **雨天備案切換**：島上下雨粒子 + 自動切到室內站點的替代路線。🔧

### 部落客端
6. **一鍵文章變島**：發文後按一下就產生島與封面截圖，可嵌入自己的部落格。🟢（原型就是這個的第一步）🔧（正式產品需要）
7. **島的觀看數據面板**：部落客看到每站被點幾次、哪一站最多人看，回饋下一篇寫作。🔧
8. **分潤歸因**：讀者從島點 CTA 註冊或訂房，歸因到部落客（呼應既有分潤構想）。🔧 📜（訂房/票券需合作方）
9. **系列文拼成群島**：同一作者的「台灣夜景」系列，每篇一座島，拼成群島地圖，讀者沿航線逛。🔧（多島屬本原型明確不做，列為後續）
10. **季節限定島**：同一地點換季皮膚——紅葉島、櫻花島、雪島，部落客更新文章時順便換季，帶動回訪。🟢（換色票與粒子即可）

### 旅行社與業者端
11. **業者贊助站點**：在島上某站放業者招牌與「這家店」資訊卡，清楚標示「贊助」。🔧 📜
12. **票券/訂房小攤位**：島邊一個小攤位建築，點開是票券或住宿連結（例如九份周邊民宿）。🔧 📜
13. **一日遊商品島**：旅行社把一個一日遊行程（建築 = 站點、路徑 = 動線、時間軸 = 行程表）做成島放在商品頁，比文字行程表更好理解。🔧
14. **在地店家認領**：店家認領島上的自家建築，補上營業時間與特色，經審核後顯示「店家認證」。🔧

### 內容與行銷端
15. **封面截圖/短影片素材自動產出**：每座島自動產出 IG 直式截圖與 15 秒導覽短片（帶部落客署名 + Tripace 浮水印），部落客拿去發社群。🟢（原型 5.9 已涵蓋）
16. **「燈籠亮起」時刻直播式推播**：在真實日落時刻推「九份的燈籠要亮了」並附上島。🔧 📜
17. **主題策展島**：編輯部策展「全台十大夜景」，每個都是一座島，做成專題頁。🔧
18. **島的拼圖/明信片**：截圖做成可下載明信片、或實體明信片印刷合作。📜
19. **與既有「紅葉前線」頁聯動**：紅葉前線地圖上點一個地點，跳出那裡的紅葉島。🔧

### 資料與營運端
20. **熱門站點熱度圖**：彙整所有島的點擊，找出讀者最想去的站點，反饋給 AI 排程的推薦權重。🔧
21. **站點標準化**：把各篇文章的站名對應到同一個地標 id（「阿妹茶樓」各種寫法），累積地標知識庫，同時解決 10.3 的「站名 → 地標」問題。🔧
22. **島的健康檢查**：AI 定期檢查島上的資訊是否過期（店家歇業、步道封閉），提醒部落客更新（呼應既有「AI 檢查行程正確性」願景）。🔧 📜

### 哪些對「推廣 Tripace 軟體」最直接有效
1. **#6 一鍵文章變島 + #15 自動素材**：部落客最在意流量與好看的素材，給他們「別人沒有的互動內容與社群素材」，每一次嵌入與分享都帶著 Tripace 浮水印與 CTA——**這是成本最低、擴散最快的獲客管道**，而且原型已經涵蓋大半。
2. **10.3 的 CTA 轉換路徑（看島 → 帶著站點進 /ai-plan）**：這是把「看熱鬧的讀者」轉成「Tripace 使用者」的唯一關鍵橋梁；沒有它，島只是好看的內容。
3. **#3「我的版本」島**：讓新使用者排完行程後也有一座島可以分享，形成「讀者 → 使用者 → 分享者」的循環。
4. **#8 分潤歸因 / #7 數據面板**：讓部落客有持續嵌入的理由（既有發文工具產品線的第 4 階段）。

先做順序建議：#6、#15、#1、#10（都標 🟢，原型延伸即可），同時開始規劃 10.3 的 `/ai-plan` 參數接收。
