import type { SampleItinerary } from '../types'

// 範例行程:宮古島三日遊。沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 googlePhotoUrls/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'miyakojima-3day',
  title: '宮古島三日跳島',
  region: '日本・宮古島',
  categories: ['海島', '自然景觀'],
  summary: '跨海大橋串起的離島群，與那霸的喧鬧不同，宮古島是純粹的海景跟寧靜——浮潛、兜風、看夕陽，慢慢過三天。',
  addedAt: '2026-10-14',
  timeline: {
    days: [
      {
        id: 'miyakojima-3day-d1',
        nodes: [
        { id: 'miyakojima-3day-s0', type: 'stop', time: '10:00', duration: '2h', name: '宮古機場・租車', kind: '交通', desc: '宮古島公共交通不便，建議一下機就租車' },
          { id: 'miyakojima-3day-s1', type: 'stop', time: '13:00', duration: '2h', name: '與那霸前濱海灘', kind: '景點', desc: '日本百大海灘第一名，純白沙灘與漸層海水' },
          { id: 'miyakojima-3day-s2', type: 'stop', time: '16:00', duration: '1.5h', name: '來間大橋・龍宮城展望台', kind: '景點', desc: '俯瞰橋樑與海色漸層的最佳觀景點' },
        ],
      },
      {
        id: 'miyakojima-3day-d2',
        nodes: [
        { id: 'miyakojima-3day-s3', type: 'stop', time: '09:00', duration: '3h', name: '伊良部大橋・牧山展望台', kind: '景點', desc: '日本最長免費跨海大橋，開車兜風必經' },
          { id: 'miyakojima-3day-s4', type: 'stop', time: '13:00', duration: '2h', name: '渡口之濱海灘', kind: '景點', desc: '伊良部島上最美的海灘之一，人潮較少' },
          { id: 'miyakojima-3day-s5', type: 'stop', time: '16:00', duration: '2h', name: '浮潛體驗', kind: '活動', desc: '宮古島珊瑚礁能見度極高，推薦參加浮潛行程' },
        ],
      },
      {
        id: 'miyakojima-3day-d3',
        nodes: [
        { id: 'miyakojima-3day-s6', type: 'stop', time: '10:00', duration: '1.5h', name: '池間大橋・池間島', kind: '景點', desc: '另一座知名跨海大橋，橋上海色同樣驚艷' },
          { id: 'miyakojima-3day-s7', type: 'stop', time: '12:00', duration: '1h', name: '宮古麵在地午餐', kind: '美食', desc: '沖繩麵的宮古島變化版，湯頭偏濃郁' },
          { id: 'miyakojima-3day-s8', type: 'stop', time: '14:00', duration: '1.5h', name: '雪鹽製鹽所', kind: '景點', desc: '金氏世界紀錄認證礦物質種類最多的鹽，可免費試吃' },
        ],
      },
    ],
  },
}

export default itinerary
