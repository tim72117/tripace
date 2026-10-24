import type { IdeaDoc } from '../../types'

export const DESIGN_UX_04: IdeaDoc = {
  id: 'design-ux-04',
  group: 'design-discussion',
  order: 104,
  title: '推薦整合流程',
  summary:
    '把推薦彈窗升級為「地圖 + 卡片 + 加入」的雙區面板,與當日行程同圖對照,並設計加入後由 AI 或使用者排時間的流程。',
  sections: [
    {
      heading: '5.1 現況鏈路與缺口',
      paragraphs: [
        '現況鏈路:`✦ 推薦`鈕 → 固定語句「推薦附近的景點」進 assist → agent 呼叫 `recommend_nearby`(Places Nearby,回 name/address/lat/lng/primaryType)→ WS `recommended_places` → `RecommendedPlacesModal` 卡片列表。',
        '缺口:',
      ],
      bullets: [
        '卡片純展示,沒有任何動作,看完關掉就散。',
        '有座標卻沒地圖,「這些推薦在我行程的哪一邊」無從判斷。',
        '推薦中心點由 agent 從語句猜,沒有利用畫面上的聚焦日脈絡。',
      ],
    },
    {
      heading: '5.2 設計:推薦面板 = 地圖 + 卡片 + 加入',
      paragraphs: [
        '`RecommendedPlacesModal` 升級為上圖下卡的雙區面板(手機底部滿寬彈起,桌面沿用置中 modal;地圖複用 `RecommendedPlacesMap`,終於從 demo 轉正)。版面:',
      ],
      bullets: [
        '標題列:「推薦景點 · 8 個(晴空塔周邊)」與關閉鈕。',
        '上方地圖:數字 marker = 當日既有行程(沙棕);字母 ◇ = 推薦候選(琥珀);既有動線與推薦同圖呈現,順路一眼可辨。',
        '下方卡片:手機橫向滑動、桌面兩欄;滑到哪張,地圖對應 ◇ 放大。每張卡含照片、編號與名稱(例如 a 仲見世、b 今戶神社)、評分(★4.4、★4.3)、與最近行程點的直線距離(例如「距② 400m」「距② 1.1km」,前端算)、[＋ 加入] 鈕。',
        '與行程對照是本面板的靈魂:把聚焦日既有條目(灰調編號 marker + 細動線)畫在同一張地圖上,推薦候選用琥珀菱形區隔。「b 就在 ② 旁邊、a 要過河」不需要任何文字說明。',
        '卡片增列「距最近行程點 ○○」——用既有條目座標與候選座標做 Haversine,純前端,零成本。',
        '推薦鈕的固定語句升級為帶脈絡:「推薦 {聚焦日已有條目的地區} 附近的景點」;若使用者先選中了某張卡片再按推薦,則以該卡地點為中心(「推薦晴空塔附近的餐廳」式的語句由前端組出,agent 端零改動)。',
      ],
    },
    {
      heading: '5.3 「加入」之後:時間怎麼排',
      paragraphs: ['點「＋ 加入」後的流程:'],
      bullets: [
        '彈極簡確認條(非整頁表單):`加入哪一天? [6/29(聚焦日)▾]  [加入並讓 AI 排時間] [自己選時間]`。',
        'AI 排時間(預設、推薦):前端組語句送 assist——「把『今戶神社』(東京都台東區今戶1-5-22,lat/lng)加入 6/29 行程,幫我排合理時間」。agent 的既有時間推斷規則(景點上午 9:00/下午 14:00 等,見 `assistant_agent.go`)會排出時刻,還會在與既有條目衝突時追問。面板不關閉,該卡片變成「加入中…」海浪態,WS `entries_updated` 後打勾,時間軸同步出現新卡進場動畫。可連續加入多個。',
        '自己選時間:開 4.2 的新增表單,標題/地點/座標預填。',
      ],
      note: '誠實標註:走 assist 時,座標能否落地取決於 6.2 的座標補齊方案——現行 AI 對話寫入工具 `trip_entry_add` 連 location 都不是輸入欄位,座標更無從談起,是必須先修的洞(見 6.2 現況說明)。修好後,加入語句中的座標可由 agent 原樣寫入,不必重查 geocode。若走「自己選時間」的表單路徑,則已可直接 `POST /v1/trips/{id}/entries` 帶齊 location(端點已存在,見 4.2),不受這個洞影響。',
    },
  ],
  tags: ['行程 UX', '推薦', '地圖'],
  source: ['docs/itinerary-ux-design.md'],
}
