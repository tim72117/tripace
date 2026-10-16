import type { IdeaDoc } from '../../types'

export const DESIGN_UX_10: IdeaDoc = {
  id: 'design-ux-10',
  group: 'design-discussion',
  order: 110,
  title: '分階段落地建議與介面元素一覽',
  summary:
    '把設計拆成 Phase 1「看得懂」、Phase 2「改得動」、Phase 3「排得好」三階段,列出各階段前端項目、後端依賴與風險,並附新增介面元素一覽表。',
  sections: [
    {
      heading: 'Phase 1:「看得懂」——地理脈絡與回饋補全',
      paragraphs: [
        '前端:地理脈絡列 + 地圖面板(collapsed/half/full)+ 聚焦日聯動 + 編號 marker/動線(直線)+ 間隙標籤(Haversine 粗估)+ 時間可行性警示 + 推薦面板併入地圖與「加入」+ 回執卡與 update-undo + 新增/刪除的差集動畫 + WS 重連 + 待回覆 chip + 快速時間 chips。',
        '後端依賴(皆為小改,但缺一不可):',
      ],
      bullets: [
        'AI 對話新增(現行 `trip_entry_add`)的座標覆蓋問題(一切地圖功能的前提)——依 6.2 判斷的方向落地:或是幫裝置端旅程清單/`trip_entry_add` 補上 location/lat/lng 欄位,或是改讓 AI 新增最終落地 Postgres entry 重用既有的 `tripsvc.Record` 座標補齊機制;此項工程量已不是單純的欄位小改,需先確認產品方向(見 6.2 的兩種路徑說明)。',
        '`handleUpdateEntry` 補廣播 `entries_updated`(已完成,見狀態與邊界情況一章)+ location 變更時重新 geocode(仍待補)。',
        '存量條目座標補跑腳本(`POST /internal/entries/{id}/geocode` 已提供單筆補座標的端點,見 `server/internal/api/entry_geocode.go`,腳本可直接套用)。',
        '註:新增/刪除的 REST 端點(`POST /v1/trips/{id}/entries`、`DELETE /v1/trips/{id}/entries/{entryID}`)已存在,原本排在 Phase 2 的「新增/刪除表單直連 REST」不再受後端阻塞,可視資源提前到 Phase 1。',
      ],
      note: '風險:Maps JS API 動態載入量(約 $7/1000 次,月免 10k)——地圖 lazy mount(首次展開才載)+ 單例復用,一般使用量在免費額度內。',
    },
    {
      heading: 'Phase 2:「改得動」——手動編輯閉環與精確資料',
      paragraphs: [
        '前端:新增/刪除表單直連 REST、完整 undo(含 add/delete)、跨日拖曳(+ 視資源做同日拖曳)、gap 精確模式(步行/大眾運輸並列)、編輯表單小地圖、ask_user 擴充 time/place。',
        '後端依賴:',
      ],
      bullets: [
        '`POST /v1/trips/{id}/entries`、`DELETE /v1/entries/{id}`——已完成:`POST /v1/trips/{id}/entries`(`handleCreateTripEntry`)、`PUT /v1/trips/{id}/entries/{entryID}`(`handleUpdateTripEntry`)、`DELETE /v1/trips/{id}/entries/{entryID}`(`handleDeleteTripEntry`),前端 `api.ts` 也已有 `createTripEntry`/`updateTripEntry`/`deleteTripEntry`。實際路徑是 trip-scoped 而非本文原先提議的 entry-scoped。',
        'PATCH 語意修正:缺鍵=不改、null=清空(undo 完整性所繫)。',
        '`POST /v1/geo/route-summary` 代理 + DB 快取(Routes API 計費與 TOS 快取限制見 6.7,上線前過一次覆核)。',
        'assist 完成事件改由 WS 全量推送,前端徹底移除輪詢。',
      ],
    },
    {
      heading: 'Phase 3:「排得好」——主動的地理智慧與多人強健性',
      paragraphs: [
        '前端:繞路偵測與 AI 重排、跨日均衡視覺、ask_choice 迷你地圖、409 衝突對比 UI。',
        '後端依賴:entry 加 `updatedAt` + 樂觀鎖(migration);`ask_choice` options 帶座標;(選配)重排建議的伺服器端計算。',
      ],
      note: '風險:繞路提示的信任成本——直線距離的建議若常「不準」會反噬信任,故閾值保守、文案克制、永遠可復原,先小流量驗證再放大。',
    },
    {
      heading: '附:本設計新增/變更的介面元素一覽',
      table: {
        headers: ['元素', '章節', '依賴後端'],
        rows: [
          ['地理脈絡列(map context bar)', '2.2/6.3', '座標補齊'],
          ['地圖面板三檔 + 聚焦日聯動', '2.2/6.4/6.5', '座標補齊'],
          ['移動間隙標籤 + 時間可行性警示', '6.3', '無(粗估)/route-summary(精確)'],
          ['操作回執卡 + undo 膠囊', '3.2', 'DELETE/POST entries(✅ 已存在,trip-scoped)'],
          ['待回覆 chip', '3.3', '無'],
          ['推薦面板(地圖+加入)', '5.2/5.3', '無(走 assist)/POST entries(✅ 已存在)'],
          [
            '編輯表單升級(kind/chips/小地圖/刪除)',
            '4.1',
            'DELETE entries(✅ 已存在)、PATCH 重新 geocode(仍待補)',
          ],
          ['日期列新增入口', '4.2', 'POST entries(✅ 已存在,可直連)'],
          ['拖曳改期', '4.3', '無(走 PATCH)'],
          ['繞路提示與 AI 重排', '6.6', '無(走 assist)'],
        ],
      },
    },
  ],
  tags: ['行程 UX', '分階段', '路線圖'],
  source: ['docs/itinerary-ux-design.md'],
}
