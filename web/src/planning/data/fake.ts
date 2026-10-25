// fake.ts(planning/data)— PlanAiDataSource(介面見同目錄 source.ts)的
// 純前端假資料實作,固定資料來源是 conversation/attractionPool.ts 的台南
// 展示景點池,不打任何後端 API、不需要登入態。登入版是 api.ts、訪客版是 public.ts。
// 公開展示(/ai-plan 的模擬態、首頁手機展示)固定接這份實作——不是可即時切換的開關,
// 各入口各自固定選定一種實作,見 source.ts 檔頭的完整說明。
//
// id 兼作 placeId——這份假資料池本來就只有 id(PooledAttraction.id),
// 沒有 Google placeId 的概念,呼叫端(劇本、時間軸的站點解析等)
// 拿到的 placeId 字串其實就是 attractionPool.ts
// 裡的 id,placeDetails 直接用它精確查找即可,不需要另外維護一套 id
// 對應表。

import { ATTRACTION_POOL, getAttractionById } from '../conversation/attractionPool'
import type {
  PlanAiDataSource,
  PlanAiPlaceDetailsResult,
  PlanAiSearchNearbyResult,
  PlanAiTransitEstimateResult,
} from './source'

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

// FAKE_QUERY_DELAY_MS — 人為固定延遲,讓 fakePlaceDetails/fakeTransitEstimate
// 這兩個 async 函式不要「同步查完立刻 return」。呼叫端(planning/preview/Content.tsx
// 的 resolveAttractionForStep/refreshTransitForStop)在呼叫這兩個函式之前
// 都會先把對應節點標成 loading:true(縮圖骨架掃光/交通列轉圈,見
// planning/timeline/phone/HorizontalPlanTimeline.tsx、planning/timeline/PlanTimelineView.tsx
// 的 status.loading 分支與 transitRow),若這裡不延遲、單一個 microtask 就 resolve,loading 狀態存在
// 的時間短到使用者在實機上完全看不到這個效果——這是純展示頁,不需要真的
// 模擬網路延遲的隨機抖動,固定一個合理數值即可。
//
// 數值對齊原始後端(plan_sim_demo.go/plan_sim_ws.go)故意加的
// transitEstimateMinDelay/transitEstimateMaxDelay(800~1500ms)的量級,取中間
// 值附近、足以讓 loading 動畫被看見、又不會讓使用者覺得遲鈍。
//
// 與 planSimFakeSource.ts 的播放節奏相容:劇本每則 action 之間本來就有
// randomDelayMs()(900~1500ms)的 thinking 停頓,這裡的延遲是在
// addStop 同步插入節點「之後」才背景觸發的非同步查詢,跑在
// 下一則 action 送出前的這段間隔之內,不會拖慢或打亂劇本本身的播放節奏。
//
// 2026-10 從 650ms 調到 280ms(使用者明確要求「縮短地點卡的延遲時間」):
// 原本的值是對齊後端 800~1500ms 的量級訂的,但那是真的在等網路;這裡
// 資料全在前端記憶體,650ms 等於純粹讓使用者乾等。280ms 仍然足以讓
// 骨架卡被看見(人眼可辨識的最短狀態切換約 100~200ms),但不再有「卡住」
// 的感覺。
//
// 注意:卡片照片是 GCS 上的外部圖片(見上方 REAL_PHOTOS),那段下載時間
// 不受這個常數影響——調這裡只縮短「骨架轉正式卡」的等待,照片仍然要等
// 瀏覽器下載完才會顯示。
const FAKE_QUERY_DELAY_MS = 280

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

// SCRIPT_PLACE_OVERRIDES——劇本原本內嵌在子景點(舊 PlanNodeData.children)的顯示資料,
// 與 attractionPool.ts 同 id 的條目不一致的部分。節點改成只存 id 之後(planSimScript.ts 的
// places: [...]),名稱/說明/座標必須由這裡回答,否則展示畫面會悄悄變成池子裡另一組值:
//   - attr-datianhou:劇本寫「祀典大天后宮」、1663 年創建的完整說明,座標 22.9966,120.2016
//     (池子是較短的「大天后宮」,座標 23.0006,120.1998,離實際位置較遠)
//   - attr-wumiao:劇本的說明文字與座標 22.9966,120.2022(池子座標 23.0006,120.2024)
// 其餘劇本子景點(赤崁樓、武廟愛玉、鳳凰卷、冬瓜茶、阿堂、福記、孔廟、孔廟商圈)內嵌值與池子完全
// 相同,不需要覆寫。覆寫只作用在 placeDetails,不改池子本身——search_attraction 與 searchNearby
// 的既有行為(attractionPool.ts 的值)維持不變。
const SCRIPT_PLACE_OVERRIDES: Record<string, { name?: string; desc?: string; lat?: number; lng?: number }> = {
  'attr-datianhou': {
    name: '祀典大天后宮',
    desc: '1663年創建，原明寧靖王府邸，全台唯一官建列入祀典的媽祖廟，國定古蹟。',
    lat: 22.9966,
    lng: 120.2016,
  },
  'attr-wumiao': {
    desc: '全台祀典關帝廟，國定古蹟，紅牆是「出磚入石」砌法代表案例。',
    lat: 22.9966,
    lng: 120.2022,
  },
}

// fakePlaceDetails — add_attraction 插入後的背景反查:用 placeId(即
// attractionPool.ts 的 id)精確查找完整資料。查無結果時 found:false,
// 行為對齊真後端 fetchPlanAiPlaceDetailsAny。googlePhotoUrls 只在
// REAL_PHOTOS 表裡有對應項目時才給(見該常數的完整說明)——其餘假資料
// 池條目仍用 thumbBg/thumbIcon(CSS 漸層+emoji)當縮圖,呼叫端
// (planning/preview/Content.tsx)在沒有 googlePhotoUrls 時本來就會 fallback
// 顯示 thumbIcon,不需要另外處理。
async function fakePlaceDetails(placeId: string): Promise<PlanAiPlaceDetailsResult> {
  await delay(FAKE_QUERY_DELAY_MS)
  const hit = getAttractionById(placeId)
  if (!hit) return { found: false }
  const photo = REAL_PHOTOS[placeId]
  const o = SCRIPT_PLACE_OVERRIDES[placeId]
  return {
    found: true,
    name: o?.name ?? hit.name,
    summary: o?.desc ?? hit.desc,
    lat: o?.lat ?? hit.lat,
    lng: o?.lng ?? hit.lng,
    googlePhotoUrls: photo ? [photo] : undefined,
    thumbBg: hit.thumbBg,
    thumbIcon: hit.thumbIcon,
  }
}

// fakeTransitEstimate — 用 haversineKm 抓直線距離,依距離門檻挑一個
// 交通方式(純展示用的粗略規則,不是真後端的判斷邏輯):1.5km 內視為
// 步行,15km 內視為騎車,再遠視為開車,時間用一個概略均速反推。
async function fakeTransitEstimate(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<PlanAiTransitEstimateResult> {
  await delay(FAKE_QUERY_DELAY_MS)
  const km = haversineKm(from, to)
  if (km <= 1.5) {
    return { mode: '步行', icon: '🚶', minutes: Math.max(1, Math.round((km / 4.5) * 60)), distance: `${Math.round(km * 1000)}m` }
  }
  if (km <= 15) {
    return { mode: '騎車', icon: '🛵', minutes: Math.max(1, Math.round((km / 18) * 60)), distance: `${km.toFixed(1)}km` }
  }
  return { mode: '開車', icon: '🚗', minutes: Math.max(1, Math.round((km / 35) * 60)), distance: `${km.toFixed(1)}km` }
}

// NEARBY_CANDIDATE_RADIUS_KM/NEARBY_CANDIDATE_MAX——fakeSearchNearby 的
// 候選範圍(2026-10 新增,見 PlanAiDataSource.searchNearby 的完整說明:
// 供 open_ask_page 探查模式使用)。這份假資料池只有 10 筆台南景點、
// 彼此距離本來就不遠,不需要像真後端那樣精算門檻——半徑 5km 內、最多
// 6 筆,足以在這個固定池子裡展示「選出一批鄰近候選」的效果,不會因為
// 範圍抓太小而每次都查到空清單。
const NEARBY_CANDIDATE_RADIUS_KM = 5
const NEARBY_CANDIDATE_MAX = 6

// fakeSearchNearbyByCoords——依座標在 ATTRACTION_POOL 裡找鄰近候選,
// 用 haversineKm 算直線距離排序,只取 NEARBY_CANDIDATE_RADIUS_KM 範圍內
// 最近的幾筆(見該常數的完整說明)。excludeId 選填——query 模式找到
// 定位點本身後,候選清單不該把這個定位點自己也列進去(呼叫端已經知道
// 這個地點,候選應該是「附近還有哪些」而不是重複同一個)。
function fakeSearchNearbyByCoords(lat: number, lng: number, excludeId?: string): PlanAiSearchNearbyResult {
  const candidates = ATTRACTION_POOL
    .filter((a) => a.id !== excludeId)
    .map((a) => ({ attraction: a, km: haversineKm({ lat, lng }, { lat: a.lat, lng: a.lng }) }))
    .filter(({ km }) => km <= NEARBY_CANDIDATE_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_CANDIDATE_MAX)
    .map(({ attraction }) => ({ placeId: attraction.id, name: attraction.name, summary: attraction.desc, category: attraction.kind }))
  return { found: true, candidates }
}

// fakeSearchNearby——見 PlanAiDataSource.searchNearby 的完整說明。
// query 模式:這份假資料池沒有 Google Places Text Search 那種自由地名
// 查詢能力,改用最簡單的名稱包含比對(query 字串出現在 PooledAttraction.name
// 裡)在池子裡找第一筆命中的當「定位點」,取它的座標再呼叫
// fakeSearchNearbyByCoords(用 excludeId 排除定位點本身)。找不到任何
// 命中時回傳 found:false,對齊真後端查無地名時的既有語意。
// coords 模式:直接呼叫 fakeSearchNearbyByCoords,不需要 excludeId
// (呼叫端給的是一個座標,不是池子裡某一筆既有景點,沒有「排除自己」
// 的需求)。
async function fakeSearchNearby(input: { query: string } | { coords: { lat: number; lng: number } }): Promise<PlanAiSearchNearbyResult> {
  await delay(FAKE_QUERY_DELAY_MS)
  if ('coords' in input) {
    return fakeSearchNearbyByCoords(input.coords.lat, input.coords.lng)
  }
  const anchor = ATTRACTION_POOL.find((a) => a.name.includes(input.query))
  if (!anchor) return { found: false, candidates: [] }
  return fakeSearchNearbyByCoords(anchor.lat, anchor.lng, anchor.id)
}

// planAiFakeDataSource — 這個檔案唯一對外匯出的 PlanAiDataSource 實例,
// 直接是一個固定物件(不是工廠函式)——不像真後端實作需要 cfg 才能呼叫
// api.ts 的 request(),這份假資料完全不需要任何建構參數。
export const planAiFakeDataSource: PlanAiDataSource = {
  placeDetails: fakePlaceDetails,
  transitEstimate: fakeTransitEstimate,
  searchNearby: fakeSearchNearby,
}
