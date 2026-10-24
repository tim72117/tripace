import type { SampleItinerary } from '../types'

// 由雛形(web/handbook/src/itineraryShowcaseData.ts,已搬出成獨立子專案)遷移過來的範例行程。這一份只有
// 站名、時間與一句說明,沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 googlePhotoUrls/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'kyoto-2day',
  title: '京都清水寺周邊兩日',
  region: '日本・京都',
  categories: ['文青', '自然景觀'],
  summary: '東山區散步路線，從清水寺一路走到八坂神社，適合喜歡慢慢走、拍照的旅人。',
  addedAt: '2026-10-11',
  timeline: {
    days: [
      {
        id: 'kyoto-2day-d1',
        nodes: [
        { id: 'kyoto-2day-s0', type: 'stop', time: '09:00', duration: '2h', name: '清水寺', kind: '景點', desc: '建議開門時間抵達，避開中午人潮' },
          { id: 'kyoto-2day-s1', type: 'stop', time: '11:00', duration: '3h', name: '二年坂・三年坂', kind: '景點', desc: '京都最具代表性的石坂路商店街' },
          { id: 'kyoto-2day-s2', type: 'stop', time: '14:00', duration: '1h', name: '高台寺', kind: '景點', desc: '賞楓/賞櫻名所，庭園造景精緻' },
        ],
      },
      {
        id: 'kyoto-2day-d2',
        nodes: [
        { id: 'kyoto-2day-s3', type: 'stop', time: '10:00', duration: '2h', name: '八坂神社', kind: '景點', desc: '祇園祭發源地' },
          { id: 'kyoto-2day-s4', type: 'stop', time: '12:00', duration: '1h', name: '花見小路', kind: '景點', desc: '傳統京町家建築群，可能遇見藝妓' },
        ],
      },
    ],
  },
}

export default itinerary
