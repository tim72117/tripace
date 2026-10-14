import { useEffect, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { ApiError, fetchPublicGeoAttractionByID, type ClientConfig } from '../api'
import type { SampleStop } from './types'

// GUEST_CFG——讀取已建檔地標的公開資料是訪客動作,不需要使用者自己的
// JWT,token 傳 null,理由同 AiItineraryDetailPage.tsx 的 GUEST_CFG。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// useStopAttractionDetails——2026-10 新增,使用者明確要求「地點用 POI
// 取得圖片」「可以直接用現有端點從 attraction 取得」:行程站點
// (SampleStop)若帶 attractionId(見該欄位的完整說明),查詢對應的
// attractions 記錄拿即時的 Google 照片(fetchPublicGeoAttractionByID),
// 取代原本把照片網址寫死存進 stops[].photos 的做法——資料只有一份來源
// (attractions/photo_assets 表),之後補拍/重新查詢照片時,行程頁會
// 自動反映最新結果,不需要回頭手動改行程 content JSON。
//
// 做法對齊 useFoodSpotDetails.ts(美食清單同樣性質的查詢 hook),差別
// 只在查詢對象:這裡查的是自家 attractions 表(用 attractionId 直接
// 查),美食清單查的是 Google Place Details(用 photoPlaceId 查)——
// 兩種資料來源不同,故是兩支獨立的 hook,不勉強合併成一支參數化的泛型
// 版本。
//
// 回傳一份 Record<stopKey, string[]>(key 見下方 stopKeyOf 的完整
// 說明),呼叫端(AiItineraryDetailPageMapView.tsx)用這份結果覆蓋對應
// 站點原本的 photos(有查到才覆蓋,查無/查詢中/查詢失敗時維持原本
// stops[].photos 靜態內容,見該檔案呼叫處的完整說明)。
export interface StopAttractionDetails {
  photos: string[]
}

// stopKeyOf——SampleStop 沒有自己的穩定 id(見 types.ts 的完整說明,
// 時間軸轉換時才由 toPlanTimeline 依陣列索引組出 id),這支 hook 需要
// 一個 key 來源才能把查詢結果跟對應的站點配對。attractionId 本身已經
// 是穩定且(在同一份行程內)唯一的字串,直接拿來當 key,不需要額外
// 發明一套 id 機制。
function stopKeyOf(stop: SampleStop): string | null {
  return stop.attractionId ?? null
}

export function useStopAttractionDetails(stops: SampleStop[]): Record<string, StopAttractionDetails> {
  const [details, setDetails] = useState<Record<string, StopAttractionDetails>>({})

  // stopsKey——同 useFoodSpotDetails.ts 的 spotsKey,避免 stops 陣列每次
  // render 若非穩定參照時重新查詢一輪已經查過的資料。
  const stopsKey = stops.map((s) => stopKeyOf(s) ?? '').join('|')

  useEffect(() => {
    let cancelled = false
    for (const stop of stops) {
      const key = stopKeyOf(stop)
      if (!key) continue
      fetchPublicGeoAttractionByID(GUEST_CFG, key)
        .then((res) => {
          if (cancelled) return
          if (!res.googlePhotoUrls || res.googlePhotoUrls.length === 0) return
          setDetails((prev) => ({ ...prev, [key]: { photos: res.googlePhotoUrls! } }))
        })
        .catch((err) => {
          if (cancelled) return
          // 404(attractionId 寫錯或該筆地標已被刪除)是呼叫端資料問題,
          // 不是這個 hook 的錯,但仍值得印出來方便排查——不像
          // useApiBackedItinerary 那支「大多數行程本來就還沒發布進資料庫、
          // 404 是預期內常態」的情境,這裡的 attractionId 是行程作者
          // 手動填的,查無資料代表內容有誤。
          if (!(err instanceof ApiError) || err.call.status !== 404) {
            console.error('[useStopAttractionDetails] fetchPublicGeoAttractionByID 失敗:', err)
          } else {
            console.error('[useStopAttractionDetails] attractionId 查無對應地標:', key)
          }
        })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey])

  return details
}
