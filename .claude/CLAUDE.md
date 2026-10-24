# 專案慣例

- 對話一律使用繁體中文回覆。

# 測試怎麼跑(web/,依改動範圍挑)

- 型別檢查:`npx tsc --noEmit -p tsconfig.json`(要帶 `-p tsconfig.json`)。
- 改單一區域:`npm run test:<模組>` 只跑該模組,再配型別檢查。
  - `test:core` → src/plan-core(時間軸、資料 store、AI 工具)
  - `test:map` → src/geo-planning(地圖、繪製層、連線)
  - `test:plan` → src/trip-plan、home、desktop、phone(各入口與面板接線)
  - `test:itinerary` → src/itineraries(行程詳情頁)
  - `test:ui` → components、hooks、blog、momiji-front、trip
  - `test:changed` → 只跑與未提交改動相關的測試(不確定範圍時先用這個)
- 改共用層(plan-core、mapDrawLayer)、跨多個模組、或收尾/提交前:跑完整 `npm test` 加型別檢查。
- `npm run test:integration` 需要本機 server(含 PostgreSQL)在跑,沒起 server 不要跑,失敗不代表程式有問題;`test:e2e:*` 是 playwright,需要時才跑。
- 已知會失敗:`src/geo-planning/PlacePanel.test.tsx` 的 2 個測試(與近期改動無關),不用重複調查。
- 並行派子代理時:遇到不是自己造成的編譯錯誤要停下回報,不要自行修別人的部分。
