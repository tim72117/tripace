import type { SampleItinerary } from '../../types'

// 範例行程:日光紅葉兩日:二社一寺與奧日光(日本・栃木)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug nikko-2day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'nikko-2day',
  title: '日光紅葉兩日:二社一寺與奧日光',
  region: '日本・栃木',
  categories: ['寺社', '自然景觀'],
  summary: '第一天走日光二社一寺,第二天上奧日光看中禪寺湖與華厳の滝,途經いろは坂,紅葉由高處往下變色。',
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
        id: 'nikko-2day-d1',
        nodes: [
          {
            id: 'nikko-2day-d1-s0',
            type: 'stop',
            time: '09:00',
            duration: '2h',
            name: '日光二社一寺',
            kind: '景點',
            desc: '東照宮、二荒山神社與輪王寺合稱二社一寺,是日光世界遺產的核心。',
            lat: 36.7580878,
            lng: 139.5987466,
            placeId: 'ChIJNSAhU8WmH2ARlA7wenFbUKs',
            attractions: ['lmk_f121cbf470a8'],
          },
          {
            id: 'nikko-2day-d1-s1',
            type: 'stop',
            time: '11:30',
            duration: '1h',
            name: '輪王寺',
            kind: '景點',
            desc: '二社一寺之一,三佛堂供奉三尊大佛。',
            lat: 36.7551464,
            lng: 139.6005262,
            placeId: 'ChIJj4uzDgCnH2ARS4PyPilzBOY',
          },
          {
            id: 'nikko-2day-d1-s2',
            type: 'stop',
            time: '13:00',
            duration: '1h',
            name: '大猷院',
            kind: '景點',
            desc: '德川家光的靈廟,日光 1 泊 2 日行程常以此收尾。',
            lat: 36.758302799999996,
            lng: 139.5956096,
            placeId: 'ChIJJUq5YsOmH2ARDWfKwpesiUE',
          },
        ],
      },
      {
        id: 'nikko-2day-d2',
        nodes: [
          {
            id: 'nikko-2day-d2-s0',
            type: 'stop',
            time: '08:30',
            duration: '0.5h',
            name: 'いろは坂',
            kind: '景點',
            desc: '通往中禪寺湖的連續彎道,以紅葉車景聞名,連假常大塞車。',
            lat: 36.7444555,
            lng: 139.5140737,
            placeId: 'ChIJc7vsn7WoH2ARcgymVWM8Aeg',
          },
          {
            id: 'nikko-2day-d2-s1',
            type: 'stop',
            time: '09:30',
            duration: '1.5h',
            name: '中禪寺湖',
            kind: '景點',
            desc: '奧日光的湖泊,標高高、紅葉較早,日光變色最早的區域。',
            lat: 36.7329036,
            lng: 139.4821986,
            placeId: 'ChIJVe3KYi2sH2ARcHgBO2EHmhg',
            attractions: ['lmk_f6ce4e8547cb'],
          },
          {
            id: 'nikko-2day-d2-s2',
            type: 'stop',
            time: '11:30',
            duration: '1h',
            name: '華厳の滝',
            kind: '景點',
            desc: '日本三名瀑之一,紅葉季常與中禪寺湖、いろは坂一起安排。',
            lat: 36.7380893,
            lng: 139.501941,
            placeId: 'ChIJwb6wwMioH2ARjVZDylifnCc',
          },
          {
            id: 'nikko-2day-d2-s3',
            type: 'stop',
            time: '13:00',
            duration: '1h',
            name: 'カフェレストラン ムーンボウ',
            kind: '美食',
            desc: '中禪寺溫泉附近的咖啡餐廳,漢堡排受當地人支持。',
            lat: 36.7394346,
            lng: 139.5000179,
            placeId: 'ChIJx_reic6oH2ARrUMWIyAFpMw',
          },
        ],
      },
    ],
  },
}

export default itinerary
