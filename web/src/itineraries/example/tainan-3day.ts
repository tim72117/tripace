import type { SampleItinerary } from '../types'

// 由雛形(web/showcase-demo/src/itineraryShowcaseData.ts,已搬出成獨立子專案)遷移過來的範例行程。這一份只有
// 站名、時間與一句說明,沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'tainan-3day',
  title: '台南小吃三日遊',
  region: '台灣・台南',
  days: 3,
  categories: ['美食', '文青'],
  summary: '赤崁型行程，每天精確安排餐期與景點動線，吃遍在地人也認證的傳統小吃。',
  addedAt: '2026-10-10',
  stops: [
    { day: 1, time: '08:00', duration: '3h', name: '赤崁樓', kind: '景點', desc: '台南最具代表性的古蹟，建議一早避開團客' },
    { day: 1, time: '11:30', duration: '1.5h', name: '度小月擔仔麵', kind: '美食', desc: '台南百年老店，午餐首選' },
    { day: 1, time: '15:00', duration: '1h', name: '林百貨', kind: '購物', desc: '日治時期百貨建築，頂樓神社參拜' },
    { day: 2, time: '09:00', duration: '3h', name: '安平古堡', kind: '景點', desc: '荷治時期城堡遺跡' },
    { day: 2, time: '12:00', duration: '1h', name: '周氏蝦捲', kind: '美食', desc: '安平必吃，建議現場候位' },
    { day: 3, time: '10:00', duration: '1h', name: '國立台灣文學館', kind: '展館', desc: '原台南州廳建築，冷氣房休息好去處' },
  ],
}

export default itinerary
