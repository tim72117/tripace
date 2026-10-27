import type { SampleItinerary } from '../../types'

// 範例行程:河口湖紅葉一日:紅葉回廊與富士山(日本・山梨)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug kawaguchiko-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'kawaguchiko-1day',
  title: '河口湖紅葉一日:紅葉回廊與富士山',
  region: '日本・山梨',
  categories: ['自然景觀', '美食'],
  summary: '從久保田一竹美術館走到紅葉回廊,午餐吃ほうとう,下午到大石公園看富士山與紅葉。',
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
        id: 'kawaguchiko-1day-d1',
        nodes: [
          {
            id: 'kawaguchiko-1day-d1-s0',
            type: 'stop',
            time: '09:30',
            duration: '1h',
            name: '久保田一竹美術館',
            kind: '景點',
            desc: '展示「辻が花」染織作品,離紅葉回廊近。',
            lat: 35.527324,
            lng: 138.7598324,
            placeId: 'ChIJqRQSrFReGWAR3GDrOTZ81ac',
          },
          {
            id: 'kawaguchiko-1day-d1-s1',
            type: 'stop',
            time: '10:45',
            duration: '1h',
            name: '紅葉回廊',
            kind: '景點',
            desc: '梨川沿岸約 350 公尺的楓樹步道,紅葉まつり主會場。',
            lat: 35.525818,
            lng: 138.7623326,
            placeId: 'ChIJ-RVpUlJeGWARfcMeEe58lho',
          },
          {
            id: 'kawaguchiko-1day-d1-s2',
            type: 'stop',
            time: '12:00',
            duration: '1h',
            name: '小作 河口湖店',
            kind: '美食',
            desc: '以南瓜ほうとう為代表的連鎖老店。午餐吃山梨鄉土麵食ほうとう。',
            lat: 35.4957481,
            lng: 138.7568631,
            placeId: 'ChIJF8U5CNVfGWARbWh06O9NtOU',
          },
          {
            id: 'kawaguchiko-1day-d1-s3',
            type: 'stop',
            time: '13:30',
            duration: '1.5h',
            name: '大石公園',
            kind: '景點',
            desc: '湖北岸的公園,可同時看富士山與紅葉,秋天也有不少人造訪。',
            lat: 35.522904,
            lng: 138.74575220000003,
            placeId: 'ChIJlSsLjKZfGWARBCllOgtTLqI',
          },
          {
            id: 'kawaguchiko-1day-d1-s4',
            type: 'stop',
            time: '15:30',
            duration: '1h',
            name: '河口湖',
            kind: '景點',
            desc: '富士山、湖與紅葉同框,富士河口湖紅葉まつり是秋季重點活動。在湖畔散步收尾。',
            lat: 35.5170946,
            lng: 138.7517787,
            placeId: 'ChIJTz8EpbRfGWARR30zHkuyyyk',
            attractions: ['lmk_0cd532c60454'],
          },
        ],
      },
    ],
  },
}

export default itinerary
