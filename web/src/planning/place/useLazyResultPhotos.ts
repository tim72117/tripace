import { useState } from 'react'
import type { GeoSearchResult } from '../../api'
import { requirePlacePhoto, type PlanAiDataSource } from '../data/source'

// useLazyResultPhotos——搜尋結果清單(桌面 desktop/ResultList、手機 phone/ResultList)共用的「依 placeId 延遲載入
// 照片」狀態(2026-10 從兩邊各一份相同的程式抽出)。
//
// lazyPhotos:依 placeId 延遲載入的照片快取(見 ListItemCard 的說明)——原本只有 geocode(搜尋結果)會用到,2026-08
// 起 place(附近推薦地點,見 api.ts GeoPlace.placeId 的說明)也改成同一套延遲查詢,故泛化成不分 kind、只要有
// placeId 就共用同一份快取。key 是 placeId——存在這裡(而非每個 ListItemCard 各自記憶)是因為清單重新渲染
// (hover/選取狀態變化)不該讓已經查過的照片消失重查,且同一個 placeId 若因為使用者上下捲動導致項目重新 mount,
// 也不該重複觸發查詢。value 為 undefined 代表還沒查過,null 代表查過但沒有照片,string 代表查到的照片網址。
//
// handleLoadPhoto:ListItemCard 的 onLoadPhoto——ListItemCard 是全專案通用元件,不認識 ClientConfig 與
// 規劃地圖專屬的 API,查詢本身由呼叫端負責(走資料存取層的 placePhoto),查完寫回 lazyPhotos。
export function useLazyResultPhotos(dataSource: PlanAiDataSource, results: GeoSearchResult[]) {
  const [lazyPhotos, setLazyPhotos] = useState<Record<string, string | null>>({})
  const handleLoadPhoto = (placeId: string) => {
    requirePlacePhoto(dataSource, placeId, results.find((r) => r.placeId === placeId)?.name ?? '')
      .then((result) => setLazyPhotos((prev) => ({ ...prev, [placeId]: result.googlePhotoUrls?.[0] ?? null })))
      .catch(() => setLazyPhotos((prev) => ({ ...prev, [placeId]: null })))
  }
  return { lazyPhotos, handleLoadPhoto }
}
