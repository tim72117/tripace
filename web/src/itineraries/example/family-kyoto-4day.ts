import type { SampleItinerary } from '../types'

// 由雛形(web/showcase-demo/src/itineraryShowcaseData.ts,已搬出成獨立子專案)遷移過來的範例行程。這一份只有
// 站名、時間與一句說明,沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'family-kyoto-4day',
  title: '親子京都四日慢遊',
  region: '日本・京都',
  days: 4,
  categories: ['親子', '自然景觀'],
  summary: '每天安排充足的休息時間，景點之間不排太滿，適合帶小孩的家庭出遊。',
  addedAt: '2026-10-12',
  stops: [
    { day: 1, time: '10:00', duration: '1h', name: '京都鐵道博物館', kind: '展館', desc: '小孩最愛，建議預留 3 小時' },
    { day: 2, time: '09:30', duration: '2.5h', name: '嵐山竹林', kind: '景點', desc: '建議推車可通行的步道段落' },
    { day: 2, time: '12:00', duration: '1h', name: '嵐山公園野餐', kind: '景點', desc: '預留充分休息時間，不趕行程' },
    { day: 3, time: '10:00', duration: '1h', name: '京都水族館', kind: '展館', desc: '雨天備案景點' },
  ],
}

export default itinerary
