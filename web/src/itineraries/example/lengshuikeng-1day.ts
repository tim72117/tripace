import type { SampleItinerary } from '../types'

// 範例行程:冷水坑一日遊(陽明山國家公園)。沒有照片與座標——清單與詳細頁會用
// 預設圖示代替;之後有了照片/座標,直接在這個檔案補上 googlePhotoUrls/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'lengshuikeng-1day',
  title: '冷水坑七星山輕健行一日',
  region: '台灣・陽明山',
  categories: ['自然景觀', '登山健行'],
  summary: '冷水坑是陽明山海拔較高的景觀區,硫磺地景與牛奶湖特殊地貌,也是攀登七星山主峰最短的登山口之一,適合想健行又不想太操的旅人。',
  addedAt: '2026-10-14',
  timeline: {
    days: [
      {
        id: 'lengshuikeng-1day-d1',
        nodes: [
        { id: 'lengshuikeng-1day-s0', type: 'stop', time: '09:00', duration: '0.5h', name: '冷水坑遊客服務站', kind: '景點', desc: '登山口旁的服務站,出發前可補充飲水、確認步道資訊' },
          { id: 'lengshuikeng-1day-s1', type: 'stop', time: '09:30', duration: '0.5h', name: '牛奶湖', kind: '景點', desc: '因硫磺礦物質呈現乳白色的特殊湖泊,步行即可抵達' },
          { id: 'lengshuikeng-1day-s2', type: 'stop', time: '10:00', duration: '1h', name: '冷水坑溫泉浴室', kind: '活動', desc: '免費公共泡腳池,健行前後都適合放鬆' },
          { id: 'lengshuikeng-1day-s3', type: 'stop', time: '11:00', duration: '2.5h', name: '七星山主峰步道', kind: '景點', desc: '台北最高峰(1120公尺),從冷水坑登山口是最短路線,天氣好可俯瞰整個台北盆地' },
          { id: 'lengshuikeng-1day-s4', type: 'stop', time: '14:00', duration: '1h', name: '夢幻湖', kind: '景點', desc: '下山後順遊鄰近的高山湖泊,台灣水韭保護區' },
          { id: 'lengshuikeng-1day-s5', type: 'stop', time: '15:30', duration: '1h', name: '擎天崗大草原', kind: '景點', desc: '開闊草原與放牧水牛景觀,是陽明山最具代表性的風景之一' },
        ],
      },
    ],
  },
}

export default itinerary
