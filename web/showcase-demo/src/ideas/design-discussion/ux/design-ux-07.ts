import type { IdeaDoc } from '../../types'

export const DESIGN_UX_07: IdeaDoc = {
  id: 'design-ux-07',
  group: 'design-discussion',
  order: 107,
  title: '地理理解(三):順路視覺化與距離資料來源',
  summary:
    '一日動線的繞路偵測與 AI 重排設計,以及距離/移動時間的資料來源比較、成本推演、快取與 TOS 風險、分級升級策略。',
  sections: [
    {
      heading: '6.6 一日動線與順路視覺化',
      bullets: [
        '看出繞路(被動):編號 marker + 順序連線本身就是順路檢查器——連線交叉、來回折返,一眼可見。這是 Phase 1 就有的能力,零額外資料。',
        '點出繞路(主動,Phase 3):前端以直線距離計算當日訪問順序總長 d_actual 與最短排序 d_best(n ≤ 8 全排列,n > 8 最近鄰 + 2-opt;端點固定為住宿錨點)。`d_actual / d_best > 1.4` 時,日摘要亮提示:`⚠ 動線可省約 2.1 km [讓 AI 重排]`。點擊組語句送 assist(帶建議順序與各條目 entryID),agent 以 `entry_update` 批次改 startTime,卡片逐筆光影、地圖動線漸變成新順序。',
        '跨日均衡(Phase 3,選配):全螢幕地圖的「整趟模式」以三色淡染各日活動範圍 convex hull,一眼看出「第 2 天跑了兩個區」;僅視覺,不做自動搬移建議,避免過度工程。',
      ],
      note: '誠實標註:直線最佳 ≠ 路網最佳,更 ≠ 考慮營業時間/預約的最佳;故僅在「明顯」繞路(閾值 1.4,保守)時提示,文案用「可省約」不用「最佳」;重排永遠經使用者確認(AI 回執 + undo 兜底),不自動執行。',
    },
    {
      heading: '6.7 距離與移動時間的資料來源(誠實評估)',
      table: {
        headers: ['方案', '品質', '成本', '取捨'],
        rows: [
          [
            'Haversine 直線 × 1.3(前端)',
            '距離粗估可用;時間誤差大(市區 ±50%)',
            '$0',
            'Phase 1 全面採用;文案帶「約」與 tooltip 揭露',
          ],
          [
            'Google Routes API(computeRoutes / computeRouteMatrix)',
            '實際路網 + 交通方式(步行/駕車/大眾運輸——日本旅遊場景電車時間是剛需)',
            '2025 改版後 Essentials 級約 $5 / 1000 次(元素),每 SKU 每月約 10,000 次免費;Transit 屬 Advanced 級,單價更高(約 $10/1000)。以官方定價頁為準',
            'Phase 2:僅在使用者展開 gap 詳情或進入精確模式時呼叫,經後端代理 + 快取',
          ],
          [
            'OpenRouteService(免費方案)',
            '步行/駕車尚可,無日本大眾運輸',
            '免費 quota(~2000 次/日)',
            '可作步行/駕車的零成本升級,但解不了電車時間',
          ],
          [
            '自架 OSRM/Valhalla',
            '步行/駕車好;大眾運輸需另接 GTFS,工程大',
            '主機與維運成本',
            '量大之後才值得,現階段不建議',
          ],
        ],
      },
    },
    {
      heading: '6.7 量級推演與快取設計',
      paragraphs: [
        '量級推演(說明為何「快取」是成敗關鍵):一趟 10 天行程、每天 6 點 → 相鄰對 5 × 10 = 50 對;首次瀏覽 50 次元素呼叫,快取命中後為 0。月活 100 個行程 × 平均重算 3 次(編輯改時間不改地點不需重算;改地點/增刪點才失效對應段)≈ 15,000 元素/月——略超免費額度,支出在 $25/月量級。反之若不快取、隨滾動重算,單一使用者一天就能刷掉上千次。',
        '快取設計:後端新端點 `POST /v1/geo/route-summary`(批次收 [origin,destination,mode] 對,回 distance/duration),DB 快取鍵 = 座標各四捨五入到 ~11m(4 位小數)+ mode。前端另設節流:同一 gap 的精確查詢結果掛在 entry pair 上,面板重開不重查。',
      ],
      note: 'TOS 風險:Google TOS 對 Routes 結果的儲存有限制(多數內容僅允許暫時性快取;經緯度 geocode 結果允許存至 30 天)。建議只持久化 distance/duration 兩個純量、TTL 30 天,不存 polyline;上線前過一次 TOS 覆核,若認定不可行,退回 session 內記憶體快取(成本估算相應上修約 3 倍)。',
    },
    {
      heading: '6.7 分級策略總結',
      paragraphs: [
        '所有 gap 預設直線粗估(免費、即時)→ 使用者點開某段 gap 或開啟「精確模式」開關時,該段升級為 Routes 實測(步行 + 大眾運輸兩行並列)→ 已升級的段落在座標不變時永久沿用快取。成本花在使用者明確想要精確的那幾段,而不是每一段。',
      ],
    },
  ],
  tags: ['行程 UX', '地理理解', 'Routes API', '成本', '繞路偵測'],
  source: ['docs/itinerary-ux-design.md'],
}
