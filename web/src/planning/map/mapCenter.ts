// mapCenter——地圖初始中心的三態轉換。
//
// PlanMap 的 initialCenter 有三種值:
//   - undefined:呼叫端還在決定(旅程座標查詢中),地圖要等,先不建
//   - null:查無可用座標(新旅程、剛登入的常態路徑),退回預設起點
//   - 座標:直接使用
// NativeMapBase 的 center 只接受「座標或 undefined」,不接受 null。PlanMap 換成
// NativeMapBase 組合時用這個函式轉換,「等待」與「退回預設」兩個語意才不會混在一起
// (轉錯會變成地圖永遠不建,或建在 undefined 上)。
export const DEFAULT_MAP_CENTER = { lat: 35.0, lng: 135.76 }

export function resolveMapCenter(
  initialCenter: { lat: number; lng: number } | null | undefined,
): { lat: number; lng: number } | undefined {
  if (initialCenter === undefined) return undefined
  return initialCenter ?? DEFAULT_MAP_CENTER
}

// centerOfPoints——一組座標的中心(各點經緯度的平均);沒有任何點回傳 null(對應 initialCenter 的「沒有可用座標」,
// 由 resolveMapCenter 退回預設起點)。初始中心的共通算法:登入後依旅程既有地點算(useMapState 的 tripCenter)、
// 行程詳情頁依行程站點算,都用這一個,不再各自寫一份(原本登入後是平均、行程詳情頁是第一站)。
// 用算術平均而不是 bounds 中心:城市尺度的距離下兩者差異很小,且不需要處理跨 180 度經線。
export function centerOfPoints(points: ReadonlyArray<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (points.length === 0) return null
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length
  return { lat, lng }
}
