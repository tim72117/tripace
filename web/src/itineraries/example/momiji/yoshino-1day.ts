import type { SampleItinerary } from '../../types'

// 範例行程:吉野山紅葉一日(日本・奈良)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug yoshino-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'yoshino-1day',
  title: '吉野山紅葉一日',
  region: '日本・奈良',
  categories: ['寺社', '自然景觀', '美食'],
  summary: '紅葉由山頂往下變色。拜訪吉水神社與金峯山寺,沿參道吃葛菓子與柿葉壽司。',
  addedAt: '2026-10-27',
  mapStyle: 'hand-drawn',
  playfulUI: false,
  sidebar: {
    sections: [
      {
        heading: '延伸閱讀',
        links: [{ label: '紅葉前線', to: '/momiji-front', hint: '各地紅葉變色時程與賞楓景點' }],
      },
    ],
  },
  timeline: {
    days: [
      {
        id: 'yoshino-1day-d1',
        nodes: [
          {
            id: 'yoshino-1day-d1-s0',
            type: 'stop',
            time: '09:30',
            duration: '1.5h',
            name: '吉野山',
            kind: '景點',
            desc: '以櫻花聞名的山,秋天紅葉由山頂奧千本往下千本約一個月逐步變色。',
            lat: 34.362836699999995,
            lng: 135.86833099999998,
            placeId: 'ChIJb5Xnrk3GBmAR9g4gNEw44O8',
            attractions: ['lmk_6fb0d6ed219e', 'lmk_03738f46e28e'],
          },
          {
            id: 'yoshino-1day-d1-s1',
            type: 'stop',
            time: '11:15',
            duration: '1h',
            name: '吉水神社',
            kind: '景點',
            desc: '中千本的神社,拜殿可一眼望見中千本、上千本,稱「一目千本」。',
            lat: 34.367237700000004,
            lng: 135.8618667,
            placeId: 'ChIJIdHM7zXGBmAR3WCOlfVrS-o',
          },
          {
            id: 'yoshino-1day-d1-s2',
            type: 'stop',
            time: '12:30',
            duration: '1h',
            name: '豆富茶屋林',
            kind: '美食',
            desc: '中千本的豆腐料理店,也有豆乳戚風蛋糕。午餐吃豆腐料理。',
            lat: 34.366855199999996,
            lng: 135.860566,
            placeId: 'ChIJcb4qDjbGBmAR_H1lvMzWK5U',
          },
          {
            id: 'yoshino-1day-d1-s3',
            type: 'stop',
            time: '14:00',
            duration: '1h',
            name: '金峯山寺',
            kind: '景點',
            desc: '修驗道根本道場,吉野山的中心寺院,紅葉季有點燈活動。',
            lat: 34.3682666,
            lng: 135.8590183,
            placeId: 'ChIJu1OjlyXHBmARXfSbFoOaa64',
          },
          {
            id: 'yoshino-1day-d1-s4',
            type: 'stop',
            time: '15:15',
            duration: '0.5h',
            name: '八十吉',
            kind: '美食',
            desc: '吉野本葛老店,葛菓子、葛湯與葛餅入拿鐵很受歡迎。',
            lat: 34.3660906,
            lng: 135.8613143,
            placeId: 'ChIJu_8SBSTGBmARCzeaXIwRWSA',
          },
        ],
      },
    ],
  },
}

export default itinerary
