// api.plan-ai-guest.integration.test.ts — 2026-10 新增(使用者明確要求
// 「這些元件寫前後端的整合測試,測試所有資源端點都可以正確讀取」):針對
// 本次新增 ask_travel_region/ask_transport_mode 兩支工具時連帶發現並
// 修復的「訪客端點 401」這類 bug(見 fetchPlanAiPlaceSearch/
// fetchPlanAiAttractionSearch/fetchPlanAiPlaceDetailsAny 開頭「2026-10
// 訂正」的完整說明),補一份會真的打本機 server 的整合測試,而不是像
// api.test.ts 那樣 mock fetch——mock 測得到「URL/header 組得對不對」,
// 測不到「後端這個路徑是否真的存在、是否真的沒有被 internalAuth 擋在
// 門外回 401」,而這次的 bug 正好是後者,純 mock 測試完全無法發現。
//
// 這份測試只負責「端點本身有沒有正常運作」這一層,刻意不渲染任何元件
// (不 import React/@testing-library)——跟 AskPage.candidates.
// integration.test.tsx(render AskPage + 真實後端,斷言渲染結果)是
// 故意分開的兩層,各自驗證不同的失敗模式,見後者檔案開頭的完整說明。
//
// 這三支函式是 AskPage.tsx 顯示「感興趣地點」(CandidatesPanel)唯一會
// 呼叫的訪客查詢端點(search_attraction 工具查 place-search/
// attraction-search、AskPage 背景補完整資料查 place-details-any),
// ask_travel_region/ask_transport_mode 兩支工具本身不打後端(選項由
// LLM 自己傳入或後端固定列舉,見 askPageTools.ts 開頭「第五輪」的完整
// 說明),不需要額外的端點整合測試。
//
// 執行方式:需要本機 localhost:8080 真的跑著(含真實 PostgreSQL、
// GOOGLE_PLACES_API_KEY,見 server/.env 範例),不是一般 `npm test` 會
// 跑到的範圍(見 vite.config.ts exclude 設定的完整說明)——
//   npm run test:integration
// server 是否在跑的探測邏輯抽成共用 helper(見
// testUtils/integrationServerCheck.ts 的完整說明:為什麼用 top-level
// await、為什麼 server 沒跑時用 it.skip 而非 it() 內部 return)。
//
// 節流考量:這三支端點各自套用不同嚴格程度的後端節流(place-search 是
// 全站共用 10 秒 1 次,見下方各案例註解的完整說明),所以這份測試刻意
// 每支端點只呼叫一次、不重複呼叫同一支端點驗證多種情境,也不用
// Promise.all 同時打多支——避免測試執行本身就把自己的配額用光,導致
// 間歇性失敗(這類失敗看起來像 bug,實際只是測試設計沒考慮到節流)。
import { expect } from 'vitest'
import {
  fetchPlanAiAttractionSearch,
  fetchPlanAiPlaceDetailsAny,
  fetchPlanAiPlaceSearch,
  type ClientConfig,
} from './api'
import { maybeDescribe } from './testUtils/integrationServerCheck'

const guestCfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

// TAIPEI_101——固定用真實座標/Google Place ID(用 fetchPlanAiPlaceSearch
// 實際查過一次核對,不是憑記憶編造),attraction-search/place-details-any
// 兩個案例直接用這組固定值,不依賴 place-search 案例的結果——這三支
// 端點各自有獨立的後端節流配額,用固定值讓每個案例互相獨立,不會因為
// 其中一個被節流擋下就連帶讓其他案例也查不到資料。這組值跟
// AskPage.candidates.integration.test.tsx 共用同一個 placeId,不是巧合
// ——兩份測試驗證的是同一個真實地點在不同層次(端點本身/元件渲染)的
// 行為,用同一組固定值方便互相對照。
const TAIPEI_101 = { lat: 25.0341222, lng: 121.5640212, placeId: 'ChIJraeA2rarQjQRPBBjyR3RxKw' }

await maybeDescribe('訪客端點(/public/geo/plan-ai/*)——真打本機 server', (it) => {
  // fetchPlanAiPlaceSearch 對應的後端全域限流是 10 秒內全站共用 1 次
  // (見 server/internal/api/api.go publicPlaceSearchEndpoint 的
  // SetLimitForKey 設定)——這份測試檔案只在這一個案例呼叫它一次,不在
  // 其餘案例重複呼叫,避免同一次執行就自己把自己的配額用光。
  it(
    'fetchPlanAiPlaceSearch:查詢真實地名回傳 200 且 found:true,不是 401',
    async () => {
      const result = await fetchPlanAiPlaceSearch(guestCfg, '台北101')
      expect(result.found).toBe(true)
      expect(typeof result.lat).toBe('number')
      expect(typeof result.lng).toBe('number')
    },
    15000,
  )

  // fetchPlanAiAttractionSearch 對應的後端全域限流是 500ms 內全站共用
  // 1 次(見 nearbyAttractionSearchEndpoint 的 SetLimitForKey 設定),
  // 比 place-search 寬鬆,但同一份測試檔案仍只呼叫一次,不疊加風險。
  it(
    'fetchPlanAiAttractionSearch:用座標查附近候選回傳 200,attractions 是陣列',
    async () => {
      const result = await fetchPlanAiAttractionSearch(guestCfg, TAIPEI_101.lat, TAIPEI_101.lng)
      expect(Array.isArray(result.attractions)).toBe(true)
    },
    15000,
  )

  // fetchPlanAiPlaceDetailsAny 沒有獨立的全域限流,只有 per-IP 的
  // throttleGeoQueryByIP(60 秒內 300 次,見該函式的完整說明),遠比前兩支
  // 寬鬆,這裡不特別節制呼叫次數。
  it(
    'fetchPlanAiPlaceDetailsAny:查詢真實 placeId 回傳 200 且 found:true,不是 401',
    async () => {
      const result = await fetchPlanAiPlaceDetailsAny(guestCfg, TAIPEI_101.placeId)
      expect(result.found).toBe(true)
    },
    15000,
  )
})
