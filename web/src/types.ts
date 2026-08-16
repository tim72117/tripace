// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,前端才能忠實反映後端回應。
//
// 這裡只留 Entry——被 timeline/geo-planning/chat/trip 等幾乎所有領域
// 共用的核心資料實體,沒有明確的單一功能歸屬,不適合搬進任何一個功能
// 目錄。其餘型別已依領域拆分:Trip 見 trip/types.ts,User/TripRole/
// Member/Profile/Me/AuthResponse 見 user/types.ts,Message 見
// chat/types.ts,APIErrorBody(純 API 層錯誤格式,非業務型別)已併入
// api.ts。

// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
// 可獨立存在,並可關聯多則來源訊息(多對多)。
export interface Entry {
  id: string
  tripID: string
  title: string // 事項描述
  start: string // 'YYYY-MM-DD';可空
  startTime: string // 'HH:MM';空=全日
  end?: string // 範圍結束日期;可空
  endTime?: string // 範圍結束時刻;可空
  location?: string | null // 地點(可空);目前由人工/前端填,LLM 暫不自動抽取
  lat?: number | null
  lng?: number | null
  // placeID:對應座標的 Google Place ID,只有座標來自後端 Geocoding API
  // 查詢時才會有值(見 handleGeocodeEntry);手動拖曳選點存座標時為
  // null/undefined。目前前端沒有 UI 使用這個欄位,先曝露出來供之後
  // 需要跟 Places API 其他資料關聯比對時使用。
  placeID?: string | null
  // LLM 標注(原本在 Message 上,改放 Entry;目前後端先留空)。
  // 後端標注未填時 tags 會回 null(非 []),消費端需 ?? [] 收斂。
  category: string | null
  tags: string[] | null
  note: string | null
  // kind:條目類型,對應後端 model.Entry.Kind——"stay"|"flight"|"activity"|
  // "note"|"car"|"restaurant"|"ticket",未分類時為 null。
  kind?: string | null
  createdAt: string // ISO8601
}
