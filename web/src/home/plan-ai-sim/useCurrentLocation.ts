import { useRef } from 'react'
import { getCurrentPositionOrNull, useLocateWhenWanted } from '../../plan-core/currentLocation'
import type { LatLng, UseCurrentLocation } from '../../plan-core/currentLocationContract'
// useCurrentLocation(/ai-plan)——與登入後手機的 phone/useCurrentLocation、登入後桌面的 desktop/useCurrentLocation
// 同名同介面(plan-core/currentLocationContract.ts),政策是這個入口自己的。
//
// 為什麼不能像登入後那樣直接問:/ai-plan 是公開頁、訪客也進得來,且播放態是首頁展示,載入時跳出授權提示既嚇人又
// 與頁面目的無關。所以:
//   1. wanted=false(播放態)完全不碰 geolocation / permissions;
//   2. wanted=true 後只用 permissions.query 判斷,已 granted 才靜默取得(不會有任何提示);
//   3. prompt 狀態不主動取得,request() 交給呼叫端在「使用者主動操作」(例如點定位按鈕)時呼叫,授權提示只會由使用者
//      手勢觸發;目前沒有任何入口呼叫它,要讓新訪客看到藍點需要另外加一顆定位按鈕,是待決定的產品項目;
//   4. denied / 不支援 permissions API / 不支援 geolocation 一律不取得、不丟例外。
// 不移動鏡頭,藍點只畫一顆點(鏡頭由 useMapSafeArea 管),所以不使用 onLocated。

type Permission = 'unknown' | 'granted' | 'prompt' | 'denied' | 'unsupported'

async function queryPermission(): Promise<Permission> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unsupported'
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state
  } catch {
    // 部分瀏覽器(舊 Safari)對 geolocation 的 query 會丟錯,視為不支援
    return 'unsupported'
  }
}

export const useCurrentLocation: UseCurrentLocation = ({ wanted, onLocated }) => {
  const permissionRef = useRef<Permission>('unknown')
  const locateAuto = async (): Promise<LatLng | null> => {
    permissionRef.current = await queryPermission()
    return permissionRef.current === 'granted' ? getCurrentPositionOrNull() : null
  }
  // 已拒絕時瀏覽器不會再問,直接略過;成功就記成 granted。
  const locateOnRequest = async (): Promise<LatLng | null> => {
    if (permissionRef.current === 'denied') return null
    const pos = await getCurrentPositionOrNull()
    if (pos) permissionRef.current = 'granted'
    return pos
  }
  return useLocateWhenWanted({ wanted, locateAuto, locateOnRequest, onLocated })
}
