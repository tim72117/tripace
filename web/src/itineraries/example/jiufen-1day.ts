import type { SampleItinerary } from '../types'

// 由雛形(web/showcase-demo/src/itineraryShowcaseData.ts,已搬出成獨立子專案)遷移過來的範例行程。這一份只有
// 站名、時間與一句說明,沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'jiufen-1day',
  title: '九份一日散策',
  region: '台灣・九份',
  days: 1,
  categories: ['美食', '文青'],
  summary: '沿著老街階梯往上走，茶樓、山城夜景、手沖咖啡——不用精確到幾點幾分，隨興散步的一天。',
  addedAt: '2026-10-09',
  stops: [
    { day: 1, time: '10:00', duration: '0.5h', name: '九份老街入口', kind: '景點', desc: '從輕便路開始，避開中午人潮高峰前先逛半小時' },
    { day: 1, time: '10:30', duration: '1.5h', name: '阿妹茶樓', kind: '美食', desc: '《神隱少女》取景地，建議拍照後再進去喝茶' },
    { day: 1, time: '12:00', duration: '1.5h', name: '九份芋圓', kind: '美食', desc: '在地排隊名店，建議外帶邊走邊吃' },
    { day: 1, time: '14:00', duration: '2.5h', name: '昇平戲院', kind: '景點', desc: '台灣現存最古老戲院之一，免費參觀' },
    { day: 1, time: '16:30', duration: '1.5h', name: '基山街小吃', kind: '美食', desc: '黃昏前的山城光線最適合拍照' },
    { day: 1, time: '18:00', duration: '1h', name: '豎崎路看夜景', kind: '景點', desc: '華燈初上，九份最經典的階梯夜景角度' },
  ],
}

export default itinerary
