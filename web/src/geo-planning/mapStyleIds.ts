// mapStyleIds——地圖 Cloud Style Map ID 的唯一定義處(NativeMapBase 的 mapId prop 用)。
//
// SIMPLE_MAP_ID:簡化樣式——完全不顯示任何 Google 原生 POI 標籤(商家/地標/景點圖示),只留路網與地名,
// 讓畫面焦點集中在我們自己畫的站點圓點、主題點光暈與側欄卡片上。使用者明確要求「所有的 POI 都關閉」
// (見 docs/map-style/*-simple.json 的樣式快照)。用在不需要正式規劃功能那種完整 POI 細節的展示/唯讀場景:
// 主題介紹頁(home/InteractiveExploreMap.tsx)、/ai-plan(home/plan-ai-sim/Content.tsx,使用者
// 明確要求「/ai-plan 則用主題介紹頁的地圖」)、行程詳情頁地圖(itineraries/AiItineraryDetailPageMapView.tsx,
// 使用者明確要求「換成簡單版的地圖」)。原本這三處各宣告一份同值的常數(各自叫 LANDING_MAP_ID、
// SIMPLE_MAP_ID),改成這裡一份。
//
// 正式規劃功能(PlanMap 等)不傳 mapId,沿用 NativeMapBase 預設的 VITE_GOOGLE_MAPS_MAP_ID。
//
// 那份 JSON 只是 Google Cloud Console → Maps Platform → Map Management 後台設定的快照記錄,repo 裡改它
// 本身不會讓地圖實際變化——要讓新設定生效,需要登入 Console 找到 VITE_GOOGLE_MAPS_LANDING_MAP_ID 對應的
// Map Style 手動調整。環境變數未設定時是 undefined,NativeMapBase 的 mapId prop 會自動退回
// VITE_GOOGLE_MAPS_MAP_ID,不會讓地圖建立失敗。
export const SIMPLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_LANDING_MAP_ID as string | undefined
