import type { SampleItinerary } from '../../types'

// 範例行程:箱根紅葉兩日:芦ノ湖與強羅(日本・神奈川)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug hakone-2day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'hakone-2day',
  title: '箱根紅葉兩日:芦ノ湖與強羅',
  region: '日本・神奈川',
  categories: ['溫泉', '自然景觀', '美食'],
  summary: '第一天走芦ノ湖畔的箱根神社與杉並木,第二天上大涌谷、強羅,紅葉依海拔由高往低變色。',
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
        id: 'hakone-2day-d1',
        nodes: [
          {
            id: 'hakone-2day-d1-s0',
            type: 'stop',
            time: '10:00',
            duration: '1h',
            name: '箱根神社',
            kind: '景點',
            desc: '湖畔的古社,湖中的平和鳥居是熱門拍照點。',
            lat: 35.2048263,
            lng: 139.0253782,
            placeId: 'ChIJtcIqzYuYGWARmuDHR2ij5Ko',
          },
          {
            id: 'hakone-2day-d1-s1',
            type: 'stop',
            time: '11:15',
            duration: '0.5h',
            name: '元箱根杉並木',
            kind: '景點',
            desc: '舊東海道留下的杉樹林蔭道,元箱根一帶的散步路線。',
            lat: 35.198995499999995,
            lng: 139.0297555,
            placeId: 'ChIJMVyclmSYGWARjhNR0fySWLo',
          },
          {
            id: 'hakone-2day-d1-s2',
            type: 'stop',
            time: '12:00',
            duration: '1.5h',
            name: '芦ノ湖',
            kind: '景點',
            desc: '箱根的火山湖,湖畔紅葉與海賊船、箱根神社串在同一條遊覽路線。可搭海賊船從湖上賞楓。',
            lat: 35.2095674,
            lng: 139.0034626,
            placeId: 'ChIJoT-oK-mYGWARy-ItUPA6ekk',
            attractions: ['lmk_fd88c53439f5'],
          },
        ],
      },
      {
        id: 'hakone-2day-d2',
        nodes: [
          {
            id: 'hakone-2day-d2-s0',
            type: 'stop',
            time: '09:30',
            duration: '1.5h',
            name: '大涌谷',
            kind: '景點',
            desc: '箱根火山噴氣地帶,高處紅葉比較早。',
            lat: 35.2436011,
            lng: 139.0197304,
            placeId: 'ChIJfw3hyDefGWARilyx_0ZSqKE',
          },
          {
            id: 'hakone-2day-d2-s1',
            type: 'stop',
            time: '11:30',
            duration: '1.5h',
            name: '強羅・大涌谷',
            kind: '景點',
            desc: '強羅公園與大涌谷一帶,紅葉隨海拔由高往低約持續一個月。強羅公園一帶的紅葉較晚。',
            lat: 35.2486604,
            lng: 139.0451918,
            placeId: 'ChIJVVVltv-hGWARRGEjZVZEtqs',
            attractions: ['lmk_0bce58d3f9c1'],
          },
          {
            id: 'hakone-2day-d2-s2',
            type: 'stop',
            time: '14:00',
            duration: '1.5h',
            name: '彫刻の森美術館',
            kind: '景點',
            desc: '日本第一座戶外雕刻美術館,與強羅・大涌谷常一起安排。',
            lat: 35.2451601,
            lng: 139.0507271,
            placeId: 'ChIJMfOWowSiGWARX2wK6ac5jlg',
          },
          {
            id: 'hakone-2day-d2-s3',
            type: 'stop',
            time: '16:00',
            duration: '1h',
            name: '喫茶 くるみの実',
            kind: '美食',
            desc: '強羅的老式喫茶,焼きパングラ與燉煮漢堡排是名物。',
            lat: 35.2536297,
            lng: 139.051119,
            placeId: 'ChIJL3s14vmhGWARS6NOOVoJ7-w',
          },
        ],
      },
    ],
  },
}

export default itinerary
