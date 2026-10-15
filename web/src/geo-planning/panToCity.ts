import { fetchGeoGeocode, type ClientConfig } from '../api'
import type { GeoPanTarget } from './geoSelection'

// panMapToCity——把地圖移到某個城市(使用者明確要求「選完目的地後,地圖轉到
// 該點為中心」)。桌面版(DesktopLayout.tsx)與手機版(PlanPhoneView.tsx)的
// 「想去哪裡?」氣泡(DestinationPrompt.tsx)共用。
//
// 只查座標、用呼叫端傳入的 setPanTarget(useGeoPlanningState 的
// geo.setPanTarget,宣告式 panTarget 路徑,見 geoSelection.ts GeoPanTarget)
// 平移,不走城市搜尋框那條路徑——那條查到唯一結果時還會順帶選中結果、開
// 資訊卡、顯示候選清單,對「單純把地圖對準城市」副作用太大。
//
// 查詢失敗或查不到座標都靜默略過:平移只是附加效果,不該擋住後續流程,也
// 不該因為查不到座標而報錯給使用者。帶 nonce 讓使用者連續選同一個城市也能
// 再次觸發(理由見 GeoPanTarget 的 nonce 說明)。
export function panMapToCity(
  cfg: ClientConfig,
  city: string,
  setPanTarget: (target: GeoPanTarget) => void,
): void {
  fetchGeoGeocode(cfg, city)
    .then((result) => {
      const first = result.candidates[0]
      if (!first) return
      setPanTarget({ lat: first.lat, lng: first.lng, nonce: Date.now() })
    })
    .catch(() => {})
}
