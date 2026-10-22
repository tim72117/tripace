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
