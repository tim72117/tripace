// planAiFakeDataSource.ts — PlanAiDataSource(見 planAiDataSource.ts)的
// 純前端假資料實作,固定資料來源是 attractionPool.ts 既有的 10 筆台南
// 景點,不打任何後端 API、不需要登入態。這個目錄(home/plan-ai-sim/)是
// 獨立公開頁專用,使用者明確要求固定接這份實作(不是可即時切換的開關,
// 分支裡原本那一頁固定接真後端,兩者各自固定選定一種實作,見
// planAiDataSource.ts 檔頭的完整說明)。
//
// id 兼作 placeId——這份假資料池本來就只有 id(PooledAttraction.id),
// 沒有 Google placeId 的概念,呼叫端(attractionTools.ts/
// AIPlanTimelinePage.tsx)拿到的 placeId 字串其實就是 attractionPool.ts
// 裡的 id,placeDetails 直接用它精確查找即可,不需要另外維護一套 id
// 對應表。

import { getAttractionById } from './attractionPool'
import type {
  PlanAiDataSource,
  PlanAiPlaceDetailsResult,
  PlanAiTransitEstimateResult,
} from './planAiDataSource'

// REAL_PHOTOS — 使用者提供的實際拍攝照片(赤崁文化園區試做,見
// docs/research-tainan-chikan-craft-theme-2026-09.md 與另一分支
// TainanChikanPage.tsx 的照片景點標注審閱結果),只涵蓋使用者明確確認
// 過對應關係的 id;其餘 attractionPool.ts 條目沒有實拍照片可用,
// fakePlaceDetails 對它們維持原本不給 googlePhotoUrls 的行為(呼叫端
// fallback 顯示 thumbBg/thumbIcon 佔位)。圖片改放公開讀取的 GCS 目錄
// gs://shuttle-tripace-photos/plan-ai-sim/(使用者明確要求「用到的圖片
// 先上傳到 gcs 新目錄」),不再是 Vite 本地打包資源——原本
// ./photos/*.jpg 這份本機複本(來源是
// tmp/webp-output/llm-preview/ 底下對應檔名的縮圖)已個別上傳到這個
// 目錄,檔名保持一致,不需要另外維護對照表。
const REAL_PHOTOS_BASE = 'https://storage.googleapis.com/shuttle-tripace-photos/plan-ai-sim'
const REAL_PHOTOS: Record<string, string> = {
  'attr-chikanlou': `${REAL_PHOTOS_BASE}/chikanlou.jpg`, // IMG_9812
  'attr-wumiao-aiyu': `${REAL_PHOTOS_BASE}/wumiao-aiyu.jpg`, // IMG_9813
  'attr-confucius-temple': `${REAL_PHOTOS_BASE}/confucius-temple.jpg`, // IMG_9857
  'attr-confucius-temple-cultural-zone': `${REAL_PHOTOS_BASE}/confucius-zone.jpg`, // IMG_9863
  'attr-hayashi': `${REAL_PHOTOS_BASE}/hayashi.jpg`, // IMG_9854
  'attr-shennong': `${REAL_PHOTOS_BASE}/shennong.jpg`, // IMG_9817
  'attr-literature-museum': `${REAL_PHOTOS_BASE}/literature-museum.jpg`, // IMG_9849
  'attr-fire-museum': `${REAL_PHOTOS_BASE}/fire-museum.jpg`, // IMG_9844
}

// haversineKm — 兩點球面距離(公里),供 fakeTransitEstimate 估算交通
// 時間使用。真後端(fetchPlanAiTransitEstimate → handlePublicGeoTransitEstimate)
// 用的是實際路網距離,這裡只是純前端展示用的粗略估算,不需要一樣精準
// ——這個頁面本來就是「不需要後端也能跑起來的展示」,交通時間只要
// 數量級合理(走路幾分鐘、開車幾分鐘)即可。
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return R * 2 * Math.asin(Math.sqrt(h))
}

// fakePlaceDetails — add_attraction 插入後的背景反查:用 placeId(即
// attractionPool.ts 的 id)精確查找完整資料。查無結果時 found:false,
// 行為對齊真後端 fetchPlanAiPlaceDetailsAny。googlePhotoUrls 只在
// REAL_PHOTOS 表裡有對應項目時才給(見該常數的完整說明)——其餘假資料
// 池條目仍用 thumbBg/thumbIcon(CSS 漸層+emoji)當縮圖,呼叫端
// (AIPlanTimelinePage.tsx)在沒有 googlePhotoUrls 時本來就會 fallback
// 顯示 thumbIcon,不需要另外處理。
async function fakePlaceDetails(placeId: string): Promise<PlanAiPlaceDetailsResult> {
  const hit = getAttractionById(placeId)
  if (!hit) return { found: false }
  const photo = REAL_PHOTOS[placeId]
  return { found: true, name: hit.name, summary: hit.desc, lat: hit.lat, lng: hit.lng, googlePhotoUrls: photo ? [photo] : undefined }
}

// fakeTransitEstimate — 用 haversineKm 抓直線距離,依距離門檻挑一個
// 交通方式(純展示用的粗略規則,不是真後端的判斷邏輯):1.5km 內視為
// 步行,15km 內視為騎車,再遠視為開車,時間用一個概略均速反推。
async function fakeTransitEstimate(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<PlanAiTransitEstimateResult> {
  const km = haversineKm(from, to)
  if (km <= 1.5) {
    return { mode: '步行', icon: '🚶', minutes: Math.max(1, Math.round((km / 4.5) * 60)), distance: `${Math.round(km * 1000)}m` }
  }
  if (km <= 15) {
    return { mode: '騎車', icon: '🛵', minutes: Math.max(1, Math.round((km / 18) * 60)), distance: `${km.toFixed(1)}km` }
  }
  return { mode: '開車', icon: '🚗', minutes: Math.max(1, Math.round((km / 35) * 60)), distance: `${km.toFixed(1)}km` }
}

// planAiFakeDataSource — 這個目錄唯一對外匯出的 PlanAiDataSource 實例,
// 直接是一個固定物件(不是工廠函式)——不像真後端實作需要 cfg 才能呼叫
// api.ts 的 request(),這份假資料完全不需要任何建構參數。
export const planAiFakeDataSource: PlanAiDataSource = {
  placeDetails: fakePlaceDetails,
  transitEstimate: fakeTransitEstimate,
}
