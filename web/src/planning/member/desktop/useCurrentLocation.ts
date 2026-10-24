import { getCurrentPositionOrNull, useLocateWhenWanted } from '../../shared/currentLocation'
import type { UseCurrentLocation } from '../../shared/currentLocationContract'
// useCurrentLocation(登入後桌面版)——與 /ai-plan 的 planning/preview/useCurrentLocation、登入後手機的 planning/member/phone/useCurrentLocation
// 同名同介面(planning/shared/currentLocationContract.ts),政策是這個入口自己的:
// 要取目前位置時(wanted:旅程沒有任何帶座標的行程,見 useMapState 的 locationWanted)直接問瀏覽器,
// 會跳授權提示——使用者已經登入、在規劃自己的旅程,問位置是預期內的行為。
export const useCurrentLocation: UseCurrentLocation = ({ wanted, onLocated }) =>
  useLocateWhenWanted({
    wanted,
    locateAuto: getCurrentPositionOrNull,
    locateOnRequest: getCurrentPositionOrNull,
    onLocated,
  })
