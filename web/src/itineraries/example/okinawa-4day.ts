import type { SampleItinerary } from '../types'

// 範例行程:沖繩本島四日遊。沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 googlePhotoUrls/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'okinawa-4day',
  title: '沖繩本島四日親子遊',
  region: '日本・沖繩',
  categories: ['海島', '親子'],
  summary: '那霸市區、美麗海水族館、古宇利島跨海大橋——沖繩本島南北縱走,海景跟親子景點都兼顧的四日行程。',
  addedAt: '2026-10-14',
  timeline: {
    days: [
      {
        id: 'okinawa-4day-d1',
        nodes: [
        { id: 'okinawa-4day-s0', type: 'stop', time: '11:00', duration: '1h', name: '那霸機場・租車', kind: '交通', desc: '沖繩租車自駕是主流玩法,建議一下機先取車' },
          { id: 'okinawa-4day-s1', type: 'stop', time: '13:00', duration: '2h', name: '首里城公園', kind: '景點', desc: '琉球王國的王城遺跡,世界遺產' },
          { id: 'okinawa-4day-s2', type: 'stop', time: '16:00', duration: '2h', name: '國際通', kind: '購物', desc: '那霸最熱鬧的商店街,晚餐與伴手禮一次解決' },
        ],
      },
      {
        id: 'okinawa-4day-d2',
        nodes: [
        { id: 'okinawa-4day-s3', type: 'stop', time: '09:00', duration: '1.5h', name: '萬座毛', kind: '景點', desc: '象鼻狀的海蝕崖地形,沖繩代表性景觀之一' },
          { id: 'okinawa-4day-s4', type: 'stop', time: '11:30', duration: '3h', name: '沖繩美麗海水族館', kind: '景點', desc: '世界第二大水族館,巨大鯨鯊水槽必看' },
          { id: 'okinawa-4day-s5', type: 'stop', time: '15:30', duration: '1h', name: '備瀨福木林道', kind: '景點', desc: '百年福木林蔭道,水族館附近的清幽散步路線' },
        ],
      },
      {
        id: 'okinawa-4day-d3',
        nodes: [
        { id: 'okinawa-4day-s6', type: 'stop', time: '09:30', duration: '1.5h', name: '古宇利大橋', kind: '景點', desc: '跨海大橋沿線海色漸層,沖繩兜風必經路段' },
          { id: 'okinawa-4day-s7', type: 'stop', time: '11:30', duration: '1.5h', name: '古宇利海洋塔', kind: '景點', desc: '可搭電動步道上塔,眺望整座古宇利島海景' },
          { id: 'okinawa-4day-s8', type: 'stop', time: '14:00', duration: '2h', name: '今歸仁城跡', kind: '景點', desc: '另一座琉球王國城跡,遊客較少、視野開闊' },
        ],
      },
      {
        id: 'okinawa-4day-d4',
        nodes: [
        { id: 'okinawa-4day-s9', type: 'stop', time: '10:00', duration: '2h', name: '殘波岬', kind: '景點', desc: '沖繩本島最西端,斷崖燈塔與海景壯闊' },
          { id: 'okinawa-4day-s10', type: 'stop', time: '13:00', duration: '2h', name: '美國村', kind: '購物', desc: '美式風格購物商圈,摩天輪與海景咖啡廳' },
          { id: 'okinawa-4day-s11', type: 'stop', time: '16:00', duration: '1h', name: '瀨長島海中溫泉', kind: '活動', desc: '機場附近的海景溫泉,回程前放鬆的最後一站' },
        ],
      },
    ],
  },
}

export default itinerary
