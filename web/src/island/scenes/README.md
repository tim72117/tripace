# scenes——場景(一座島 = 一個場景)

引擎(`three/`、`logic/`、`ui/`)不認識任何特定場景,只吃 `SceneData`(版面、文章、署名、模型)。場景放在 `scenes/<id>/`,
由 `registry.ts` 登記。型別契約見 `types.ts`。

## 兩層載入

| 層 | 內容 | 時機 |
|---|---|---|
| `SceneInfo`(`<id>/index.ts`) | id、選單名稱、頁名、CTA 文字、SEO 文案 | 同步,隨 IslandPage chunk |
| `SceneModule`(`<id>/data.ts`) | 版面、文章 JSON、署名、場景專屬模型載入器 | 進場景才動態 `import()`,各場景獨立 chunk |
| 模型 | 版面實際用到的(`neededModelIds`:站點、散落物、旅人) | 場景載入時一起載;共用模型在 `../models/`,專屬在 `<id>/models/`(同名時專屬優先) |

`registry.load(id)` 同一場景只載入一次(含進行中)、失敗不留快取(重試會重新載入);`preload(id)` 給選單 hover/focus 預載。

## 網址

預設場景 = `/island`;其他 = `/island/<id>`(`registry.href`)。預設場景的 id 網址(`/island/night-jiufen`)前端導回 `/island`,
不存在的 id 也導回 `/island`。伺服器 `static.go` 的 `^/island(/[a-z0-9]+(-[a-z0-9]+)*)?$` 不列舉場景,場景 id 是否存在由前端判斷。

## 切換的生命週期

`IslandPage` 用 `key={sceneId}` 讓切換場景整個重掛:舊場景的 `IslandApp.dispose()`(釋放 GPU、`forceContextLoss`)與 HUD 先卸載,
才建立新的,不會同時有兩個 WebGL context。載入狀態在 `useIslandScene`:狀態記著「哪個場景、第幾次嘗試」,舊場景較晚回來的結果不會蓋掉新場景。
測試:`IslandPage.test.tsx`(路由導向、載入中/失敗/重試、卸載順序、快速切換)、`registry.test.ts`、`modelIds.test.ts`。

## 新增一個場景

1. 建 `scenes/<id>/`:`index.ts`(`SceneDef`:id 只用小寫英數與連字號、label、pageLabel、ctaLabel、seo)與 `data.ts`(預設匯出 `SceneModule`:
   `layout`(依 `../../data/layoutTypes`)、`article`(`ArticleSource`,stop 區塊 id 要與 `layout.stops[].stopId` 對上)、`byline`、`pathPointY`、
   `modelLoaders: import.meta.glob('./models/*.ts', { import: 'default' })`)。
2. 場景專屬的模型放 `<id>/models/`;通用的放 `../models/`(其他場景也能用)。
3. 在 `registry.ts` 的 `ALL` 加一行。`integration.test.ts` 會自動驗證所有已登記場景(載入、版面零 error、站點全部可顯示)。
4. 對外場景另外要:`server/cmd/server/seo_meta.go` 的 `seoMetaByPath["/island/<id>"]`(title/description 與 `index.ts` 的 `seo` 逐字相同,
   `scenes/seo.test.ts` 會比對)、`web/public/sitemap.xml` 加網址。
5. 實驗場景標 `experimental: true`,並在 `registry.ts` 用編譯時 feature flag(`VITE_FEATURE_*` === 'true',預設關閉,見 `.env.example`)的條件式加進 `ALL`(旗標關閉的正式建置會把它整個丟掉;範例小島用 `VITE_FEATURE_ISLAND_SAMPLE`)。

## 已知限制

- 場景資料動態載入後,頁面文字摘要(給爬蟲與螢幕閱讀器的站點列表)要等載入完成才出現,載入前只有標題與說明。
- 夜間專屬的演出(燈籠亮起、星空等)目前仍是引擎預設行為,以版面的 `lighting`(例如 `lanternGlow` 全 0)間接關掉,還沒有場景層級的「氛圍」選項;
  第二個真實場景做出來後再決定哪些要參數化。
