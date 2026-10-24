// AskPage.candidates.integration.test.tsx — 2026-10 新增(使用者明確
// 要求「我主要要測試元件有沒有正確請求端點,端點有沒有正常運作,還有
// 資料取回後有沒有正確渲染」,並確認要獨立補這個「元件 + 真實後端」
// 層級的案例,對應感興趣地點工具/CandidatesPanel)。
//
// 這份測試跟另外兩層刻意分開、各自只負責一件事,不要互相取代:
//   1. AskPage.test.tsx——mock dataSource,斷言「元件有沒有用正確參數
//      呼叫 dataSource.placeDetails/searchNearby」,不碰真實網路。
//   2. api.plan-ai-guest.integration.test.ts——不渲染任何元件,直接呼叫
//      api.ts 的函式打真實後端,斷言「端點本身回應正不正常(200/不是
//      401)」。
//   3. 這份檔案——render AskPage,dataSource 用真實的
//      createPlanAiApiDataSource(cfg)(不 mock),斷言「元件觸發的真實
//      請求回來之後,畫面最終有沒有正確渲染出資料(名稱/照片)」——這是
//      唯一同時經過「元件觸發請求」+「真實網路」+「渲染結果」三個環節
//      都不被 mock 掉的一層,之前的 fetchPlanAiPlaceDetailsAny 401 bug
//      正好只有這一層測得出來:mock 版本的 placeDetails 永遠回傳
//      mock 準備好的資料,測不出真實端點掛掉時畫面會卡在「查詢中…」。
//
// 執行方式同 api.plan-ai-guest.integration.test.ts(見該檔案開頭的
// 完整說明):需要本機 localhost:8080 真的跑著,`npm run test:integration`
// 執行,一般 `npm test` 不會掃到(見 vite.config.ts exclude 設定)。
import { expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AskPage } from './AskPage'
import { createPlanAiApiDataSource } from '../data/api'
import type { ClientConfig } from '../../api'
import { maybeDescribe } from '../../testUtils/integrationServerCheck'

const BASE_URL = 'http://localhost:8080'
const guestCfg: ClientConfig = { baseURL: BASE_URL, token: null }

// TAIPEI_101——跟 api.plan-ai-guest.integration.test.ts 用同一組固定
// 真實值(見該檔案 TAIPEI_101 常數的完整說明:已用 fetchPlanAiPlaceSearch
// 實際查過一次核對,不是憑記憶編造)。這裡只用得到 placeId——
// CandidatesPanel 掛載時會拿這個 placeId 呼叫 dataSource.placeDetails
// 背景補完整資料(見 AskPage.tsx CandidatesPanel 的完整說明)。
const TAIPEI_101_PLACE_ID = 'ChIJraeA2rarQjQRPBBjyR3RxKw'

await maybeDescribe('AskPage candidates 模式——render 元件 + 真打本機 server', (it) => {
  it(
    '帶一筆真實 placeId 的候選,掛載後背景查完整資料,最終畫面顯示真實名稱(不是查詢中/暫時標題)',
    async () => {
      const dataSource = createPlanAiApiDataSource(guestCfg)
      render(
        <AskPage
          dataSource={dataSource}
          input={{ candidates: [{ placeId: TAIPEI_101_PLACE_ID }] }}
          onDone={() => {}}
        />,
      )

      // 初始應該先看到候選卡片本身(以暫時標題或「查詢中…」呈現),
      // 等背景查詢完成後换成真實名稱——這裡直接等最終狀態,不逐一斷言
      // 中間的 loading 畫面(loading 文案已經在 AskPage.test.tsx 的
      // mock 版本驗證過,這份測試的重點是「真實查詢最終有沒有查到」)。
      //
      // 斷言用「台北101」而非 place-search 查到的「台北101購物中心」——
      // 這個 placeId 對應資料庫已建檔的景點(place-details-any 回應帶
      // attractionId),資料庫建檔的 name 欄位跟 Google Places 原始
      // 名稱不完全一致是正常情況,這裡要驗證的是「place-details-any
      // 查到的名稱」而不是「place-search 查到的名稱」,兩支端點對同一
      // placeId 回傳的 name 不保證相同。
      await waitFor(
        () => expect(screen.getByText('台北101')).toBeInTheDocument(),
        { timeout: 10000 },
      )

      // 查到的候選卡片要是可點選的按鈕(aria-pressed 可操作),不是純文字
      // ——用這個順便確認 CandidatesPanel 整段互動邏輯(不只是查詢)在
      // 真實資料下仍然正常渲染。照片也要真的渲染出來(不是空白
      // directionCard)——這正是本次 place-details-any 401 bug 實際
      // 損壞的那個環節,訪客呼叫一律 401 時這張卡片會卡在查無完整
      // 資料的暫時標題、沒有照片。
      const card = screen.getByRole('button', { name: /台北101/ })
      expect(card).toHaveAttribute('aria-pressed', 'false')
      const photo = card.querySelector('img')
      expect(photo).not.toBeNull()
      expect(photo?.getAttribute('src')).toMatch(/^https:\/\//)
    },
    15000,
  )
})
