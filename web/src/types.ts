// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,前端才能忠實反映後端回應。
//
// 這裡只留 Entry——被 timeline/planning/chat/trip 等幾乎所有領域
// 共用的核心資料實體,沒有明確的單一功能歸屬,不適合搬進任何一個功能
// 目錄。其餘型別已依領域拆分:Trip 見 trip/types.ts,User/TripRole/
// Member/Profile/Me/AuthResponse 見 user/types.ts,Message 見
// chat/types.ts,APIErrorBody(純 API 層錯誤格式,非業務型別)已併入
// api.ts。

// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
// 可獨立存在,並可關聯多則來源訊息(多對多)。
//
// 時間欄位(2026-07 從字串改為 ISO 8601 timestamp,見後端
// server/internal/store/entity.go 的完整說明):startAt/endAt 是 UTC 絕對
// 時刻,tz 是事件所屬的 IANA 時區(如 "Asia/Tokyo")。顯示前一律要用
// timefmt.ts 的 formatLocal/formatLocalDisplay 依 tz 換算,不要直接把
// startAt 當本地時間讀——旅遊行程的時間是「目的地當地時間」,不是「檢視者
// 所在地時間」,兩者在使用者抵達目的地前後會不一致。allDay=true 時 startAt
// 是當日在 tz 時區的 00:00,顯示應忽略時刻部分。
// Go 的 `omitempty` 讓這些欄位在對應零值(nil/""/false)時整個從 JSON
// 消失,故都宣告成 optional(?),而非 string | null。
export interface Entry {
  id: string
  tripID: string
  title: string // 事項描述
  startAt?: string // ISO 8601(UTC);不存在=無時間資訊
  endAt?: string // ISO 8601(UTC);不存在=無結束時間
  tz?: string // IANA 時區名,如 "Asia/Tokyo"
  allDay?: boolean // true=全日事件(忽略 startAt 的時刻部分)
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
