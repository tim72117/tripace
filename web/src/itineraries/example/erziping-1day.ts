import type { SampleItinerary } from '../types'

// 範例行程:二子坪一日遊(陽明山國家公園)。2026-10 補上真實座標——這份行程
// 要走地圖基底展示版面(AiItineraryDetailPageMapView),站點需要 lat/lng
// 才能在地圖上畫出圓點,否則地圖底圖雖然仍會顯示,但畫面上不會有任何站點標記。
// mapStyle:'hand-drawn' ——2026-10 補上(見 AiItineraryDetailPage.tsx 泛化
// 改版的完整說明):走地圖版面的判斷改成讀這個欄位,不再是前端寫死的 id
// 白名單,這份行程本來就是手繪可愛風樣式的唯一驗證案例,需要明確宣告。
const itinerary: SampleItinerary = {
  id: 'erziping-1day',
  title: '二子坪輕鬆一日親子行',
  region: '台灣・陽明山',
  days: 1,
  categories: ['自然景觀', '親子'],
  summary: '全程平緩柏油步道、輪椅與嬰兒車都能走,是陽明山國家公園內最適合親子與長輩的路線,沿途蝴蝶、流水與大屯山群峰相伴。',
  addedAt: '2026-10-14',
  mapStyle: 'hand-drawn',
  stops: [
    { day: 1, time: '09:30', duration: '0.5h', name: '二子坪遊客服務站', kind: '景點', desc: '停車場旁的服務站,可先了解當日步道狀況與生態導覽資訊', lat: 25.1673, lng: 121.5376 },
    { day: 1, time: '10:00', duration: '1.5h', name: '二子坪步道', kind: '景點', desc: '全長約1.8公里的環形步道,平緩好走,沿途可見大屯山、面天山稜線', lat: 25.1689, lng: 121.5359 },
    { day: 1, time: '11:30', duration: '0.5h', name: '二子坪生態池', kind: '景點', desc: '步道中段的生態池,蝴蝶與蜻蜓季節常見,適合拍照休息', lat: 25.1701, lng: 121.5341 },
    { day: 1, time: '12:30', duration: '1h', name: '野餐午餐', kind: '美食', desc: '遊客中心旁有涼亭與草坪,適合自備輕食野餐', lat: 25.1675, lng: 121.5378 },
    { day: 1, time: '14:00', duration: '1h', name: '大屯自然公園', kind: '景點', desc: '鄰近二子坪的生態公園,水生植物與賞鳥熱點', lat: 25.1648, lng: 121.5312 },
  ],
}

export default itinerary
