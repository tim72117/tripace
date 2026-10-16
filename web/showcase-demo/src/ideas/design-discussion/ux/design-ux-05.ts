import type { IdeaDoc } from '../../types'

export const DESIGN_UX_05: IdeaDoc = {
  id: 'design-ux-05',
  group: 'design-discussion',
  order: 105,
  title: '地理理解(一):三層問題與座標資料基礎',
  summary:
    '把地理問題分成「在哪、多遠、順不順」三層並對應不同呈現強度,同時盤點三條寫入路徑的座標覆蓋現況,指出 AI 對話路徑根本沒有座標欄位這個必須先解的資料洞。',
  sections: [
    {
      heading: '6.1 三層地理問題,三種呈現強度',
      table: {
        headers: ['問題', '使用者情境', '呈現', '何處'],
        rows: [
          [
            '這個點在哪?',
            '看到「淺草寺」想確認位置',
            '卡片地點行、地圖單點聚焦、外開導航(現有 NavButton)',
            '時間軸卡片 + 地圖',
          ],
          [
            '這兩點多遠?',
            '「淺草寺 10:00 → 晴空塔 13:00」中間夠不夠',
            '移動間隙標籤(距離+粗估時間)',
            '時間軸內嵌',
          ],
          [
            '這一天順不順?',
            '排完一天想檢查動線',
            '日摘要 + 地圖動線 + 繞路提示',
            '地理脈絡列 + 地圖',
          ],
        ],
      },
      paragraphs: [
        '分層的用意:第一、二層不開地圖就能得到答案(內嵌在時間軸),地圖只為第三層與「想仔細看」的時刻服務——這是「地理脈絡一瞥可得,但地圖不常駐佔屏」原則的具體化。',
      ],
    },
    {
      heading: '6.2 資料基礎:座標覆蓋現況與補齊(一切的前提)',
      paragraphs: [
        '誠實盤點三條寫入路徑的座標行為。現況更新:原本直寫 Postgres 的 `entry_add`/`BindSink`/`RecordedEntry` 工具已刪除(見 `server/internal/wanttools/entry_add.go` 等檔案的移除紀錄,assistant 現在的白名單裡也沒有 `entry_add`,見 `assistant_agent.go` 的 `init()`),下表已改用目前實際存在的三條路徑重新盤點:',
      ],
      table: {
        headers: ['寫入路徑', 'location 落地?', 'lat/lng 落地?'],
        rows: [
          [
            'AI 對話(`trip_entry_add`/`trip_entry_update`,經 clienttools 轉發到瀏覽器分頁,見 `web/src/clienttools/tools/tripEntryAdd.ts`)',
            '❌ `TripEntry` 型別只有 `id/title/date/time/note`,location 根本不是欄位,寫進的是裝置端旅程清單(`web/src/deviceDB.ts`),不是 Postgres entry',
            '❌ 同上,lat/lng 不存在於這條路徑的資料模型裡,agent 的 `geocode` 呼叫查到座標也只能寫進回覆文字給使用者看,無處可存',
          ],
          [
            'CLI/internal(`tripsvc.Record`,寫 Postgres `model.Entry`)',
            '✅',
            '✅ 非同步 geocode 補寫',
          ],
          [
            '手動 PATCH(`handleUpdateEntry`,寫 Postgres `model.Entry`)',
            '✅',
            '❌ geo 注入為 nil,改地點不重新定位',
          ],
        ],
      },
    },
    {
      heading: '6.2 結論與補齊路徑',
      paragraphs: [
        '結論:目前主力路徑(AI 對話)寫入的不是 Postgres entry,而是裝置端旅程清單,這份清單的資料模型裡根本沒有 location/lat/lng 欄位——比「座標沒落地」更根本,是「座標這個概念在這條路徑上還不存在」。',
        '地圖要能畫出 AI 新增的項目,前提是先決定 `trip_entry_add`/裝置端旅程清單要不要納入 location/座標,或是改讓 AI 新增的項目最終仍落地成 Postgres entry。這不是 UI 問題,是 Phase 1 必須先想清楚方向的資料洞,可能的路徑(擇一或並行,需先確認產品方向,不是單純的欄位補齊):',
      ],
      bullets: [
        '擴充裝置端旅程清單:`TripEntry`(`web/src/clienttools/tripEntryTools.ts`)與 `trip_entry_add`/`trip_entry_update` 的 args 增列 `location`/`lat`/`lng`,`web/src/deviceDB.ts` 對應存欄位;agent 流程本來就會先跑 `geocode` 確認地點,查到的座標可順手帶入(prompt 小改)。地圖若要畫出這批項目,還需要前端另外把裝置端清單的座標資料接進地圖元件(目前地圖只讀 Postgres entry)。',
        '改讓 AI 新增最終落地 Postgres entry:例如 `trip_entry_add` 完成後,由前端或後端把該筆同步寫入 `tripsvc.Record`(等同手動新增表單走的路徑),藉此重新掛上既有的 Postgres 座標補齊機制(見上表 CLI/internal 那列)。工程量較大,但能讓 AI 新增與手動新增共用同一份地圖資料來源。',
        '`handleUpdateEntry` 注入 geo client,location 變更時重新定位(4.1 已述)——這一項與 AI 對話路徑無關,獨立成立,仍可先做。',
        '存量條目:提供一次性補跑腳本(遍歷 Postgres 裡有 location 無 lat/lng 的 entry 呼叫 geocode);量小,一次付費在免費額度內。',
        '前端對「無座標條目」的優雅降級:卡片照常,地圖面板該點缺席並在日摘要註記「1 個地點未定位 [補定位]」,點擊觸發 geocode(經後端代理)。',
      ],
    },
  ],
  tags: ['行程 UX', '地理理解', '座標', 'geocode'],
  source: ['docs/itinerary-ux-design.md'],
}
