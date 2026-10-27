import type { SampleItinerary } from '../../types'

// 範例行程:宇奈月溫泉與黑部峽谷紅葉一日(日本・富山)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug unazuki-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'unazuki-1day',
  title: '宇奈月溫泉與黑部峽谷紅葉一日',
  region: '日本・富山',
  categories: ['溫泉', '自然景觀', '美食'],
  summary: '從宇奈月溫泉街出發搭黑部峽谷鐵道,回程在溫泉街吃釜飯、看うなづき湖。',
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
        id: 'unazuki-1day-d1',
        nodes: [
          {
            id: 'unazuki-1day-d1-s0',
            type: 'stop',
            time: '09:00',
            duration: '1h',
            name: '宇奈月溫泉',
            kind: '景點',
            desc: '黑部峽谷鐵道的門戶,溫泉街有土產店、咖啡店與足湯。',
            lat: 36.8162422,
            lng: 137.58279160000004,
            placeId: 'ChIJtQnBORSx918Rwezr9GTRMUs',
            attractions: ['lmk_bc69bde06fff'],
          },
          {
            id: 'unazuki-1day-d1-s1',
            type: 'stop',
            time: '10:15',
            duration: '4h',
            name: '黑部峽谷鐵道 宇奈月站',
            kind: '景點',
            desc: '搭乘トロッコ電車進入黑部峽谷的起點。',
            lat: 36.814879499999996,
            lng: 137.5862,
            placeId: 'ChIJt0t4iRWx918RQkUwbsbMSYI',
          },
          {
            id: 'unazuki-1day-d1-s2',
            type: 'stop',
            time: '14:30',
            duration: '1h',
            name: '河鹿',
            kind: '美食',
            desc: '釜飯與關東煮為主,釜飯可在店頭自動販賣機買。',
            lat: 36.815795,
            lng: 137.5827564,
            placeId: 'ChIJce1OLBSx918RKnIVYR-kfWY',
          },
          {
            id: 'unazuki-1day-d1-s3',
            type: 'stop',
            time: '15:45',
            duration: '1h',
            name: 'うなづき湖',
            kind: '景點',
            desc: '宇奈月一帶的賞楓景點,鐵道沿線的人造湖。',
            lat: 36.807324799999996,
            lng: 137.59274299999998,
            placeId: 'ChIJm9njU-qx918RiVKZK4J5OJc',
          },
          {
            id: 'unazuki-1day-d1-s4',
            type: 'stop',
            time: '17:00',
            duration: '0.5h',
            name: 'ALPEN CHEESECAKE',
            kind: '美食',
            desc: '宇奈月溫泉站內的起司蛋糕專賣店,用在地黑部食材。',
            lat: 36.8156734,
            lng: 137.583541,
            placeId: 'ChIJJ0Tou3ex918RrIxrvFX13Uc',
          },
        ],
      },
    ],
  },
}

export default itinerary
