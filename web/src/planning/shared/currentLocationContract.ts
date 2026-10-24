// currentLocationContract——「目前位置」的共同介面(2026-10)。
//
// 目前位置藍點在三個入口的「畫法」早就共用(統一繪製層的 currentLocationLayer),但「何時取座標、要不要跳授權提示、
// 取到之後做什麼」各入口的政策不同。這些判斷不放在同一個函式裡用 if 切換,而是各入口一個同名實體、同一個介面:
//
//   planning/preview/useCurrentLocation.ts  /ai-plan:已授權才靜默取,不主動跳授權提示(訪客進得來,載入時跳提示嚇人)
//   planning/member/phone/useCurrentLocation.ts             登入後手機:要取時直接問瀏覽器(會跳授權提示)
//   planning/member/desktop/useCurrentLocation.ts           登入後桌面:同上
//
// 三個實體共用的狀態機(wanted 變 true 時取一次、變 false 清空、卸載後不寫入)在 planning/shared/currentLocation.ts,
// 各實體只提供自己的取座標政策。型別層級的符合檢查在 planning/shared/layerContracts.test.tsx。
export type LatLng = { lat: number; lng: number }

export interface CurrentLocationArgs {
  // wanted:入口認為「現在需要目前位置」。/ai-plan 是交接進推論態;登入後是旅程沒有任何帶座標的行程。
  // 變成 false 時座標清空。
  wanted: boolean
  // onLocated:取到座標時通知入口(登入後用它把地圖平移過去;/ai-plan 不傳,藍點不移動鏡頭)。
  onLocated?: (position: LatLng) => void
}

export interface CurrentLocation {
  // 取到才有值;藍點據此繪製(null 不畫)。
  currentPosition: LatLng | null
  // request:由使用者手勢呼叫的主動定位(會跳授權提示)。wanted 為 false 或政策不允許時回 null,不丟例外。
  request: () => Promise<LatLng | null>
}

export type UseCurrentLocation = (args: CurrentLocationArgs) => CurrentLocation
