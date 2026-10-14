import type { SampleItinerary } from '../types'

// 範例行程:日月潭一日遊。沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'sun-moon-lake-1day',
  title: '日月潭環湖一日遊',
  region: '台灣・南投',
  days: 1,
  categories: ['自然景觀'],
  summary: '搭船環湖、纜車俯瞰、九族文化村周邊——台灣最知名的高山湖泊,一天體驗船遊、步道與纜車三種視角。',
  addedAt: '2026-10-14',
  stops: [
    { day: 1, time: '09:00', duration: '1h', name: '水社碼頭搭船', kind: '交通', desc: '環湖遊船起點,購買一日環湖船票' },
    { day: 1, time: '10:00', duration: '1.5h', name: '玄光寺・玄奘寺', kind: '景點', desc: '湖畔山坡上的寺廟,可俯瞰日月潭全景' },
    { day: 1, time: '12:00', duration: '1h', name: '伊達邵碼頭午餐', kind: '美食', desc: '邵族部落碼頭商圈,總統魚、山豬肉香腸在地名產' },
    { day: 1, time: '13:30', duration: '2h', name: '日月潭纜車', kind: '活動', desc: '連接伊達邵與九族文化村,空中俯瞰湖景' },
    { day: 1, time: '16:00', duration: '1.5h', name: '向山遊客中心・自行車步道', kind: '景點', desc: '清水模建築地標,鄰近環湖自行車道最美路段' },
    { day: 1, time: '18:00', duration: '1h', name: '水社商圈晚餐', kind: '美食', desc: '返回水社碼頭周邊,商圈餐廳選擇多元' },
  ],
}

export default itinerary
