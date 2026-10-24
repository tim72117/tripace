import type { SampleItinerary } from '../types'

// 由雛形(web/showcase-demo/src/itineraryShowcaseData.ts,已搬出成獨立子專案)遷移過來的範例行程。這一份只有
// 站名、時間與一句說明,沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 googlePhotoUrls/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'tokyo-shopping-2day',
  title: '東京購物兩日衝刺',
  region: '日本・東京',
  categories: ['購物'],
  summary: '澀谷到銀座，精確規劃每個時段該去哪個商場，適合有明確購物清單的旅人。',
  addedAt: '2026-10-08',
  timeline: {
    days: [
      {
        id: 'tokyo-shopping-2day-d1',
        nodes: [
        { id: 'tokyo-shopping-2day-s0', type: 'stop', time: '10:00', duration: '3h', name: '澀谷 SCRAMBLE SQUARE', kind: '購物', desc: '新開幕展望台，建議先上去拍照' },
          { id: 'tokyo-shopping-2day-s1', type: 'stop', time: '13:00', duration: '1h', name: '原宿竹下通', kind: '購物', desc: '年輕流行文化聚集地' },
        ],
      },
      {
        id: 'tokyo-shopping-2day-d2',
        nodes: [
        { id: 'tokyo-shopping-2day-s2', type: 'stop', time: '10:00', duration: '3h', name: '銀座三越', kind: '購物', desc: '高端精品購物首選' },
          { id: 'tokyo-shopping-2day-s3', type: 'stop', time: '15:00', duration: '1h', name: '秋葉原', kind: '購物', desc: '電器/動漫周邊愛好者必訪' },
        ],
      },
    ],
  },
}

export default itinerary
