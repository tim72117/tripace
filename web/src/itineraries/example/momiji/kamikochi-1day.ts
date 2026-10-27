import type { SampleItinerary } from '../../types'

// 範例行程:上高地紅葉一日:大正池到明神池(日本・長野)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug kamikochi-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'kamikochi-1day',
  title: '上高地紅葉一日:大正池到明神池',
  region: '日本・長野',
  categories: ['自然景觀'],
  summary: '從大正池沿梓川走到河童橋、明神池,落葉松的黃葉與山景是重點。',
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
        id: 'kamikochi-1day-d1',
        nodes: [
          {
            id: 'kamikochi-1day-d1-s0',
            type: 'stop',
            time: '09:00',
            duration: '1.5h',
            name: '大正池',
            kind: '景點',
            desc: '上高地入口處的池,枯木與穗高連峰的倒影是名景。',
            lat: 36.228983,
            lng: 137.618765,
            placeId: 'ChIJC8XxEJAOHWARBzhcrx9Cbpo',
          },
          {
            id: 'kamikochi-1day-d1-s1',
            type: 'stop',
            time: '10:30',
            duration: '1h',
            name: '田代湿原',
            kind: '景點',
            desc: '梓川旁的濕原,沿木棧道散步。',
            lat: 36.236508799999996,
            lng: 137.6237352,
            placeId: 'ChIJGdeuYzpHHWARA2w04x5yDDM',
          },
          {
            id: 'kamikochi-1day-d1-s2',
            type: 'stop',
            time: '11:45',
            duration: '1h',
            name: '上高地',
            kind: '景點',
            desc: '北阿爾卑斯山的高地,河童橋一帶是代表性景點,落葉松的黃葉很有名。河童橋是象徵。',
            lat: 36.2488752,
            lng: 137.63777539999998,
            placeId: 'ChIJFZWVcbRFHWARUByCssooFhk',
            attractions: ['lmk_90123c2e74d2', 'lmk_d543175c48aa'],
          },
          {
            id: 'kamikochi-1day-d1-s3',
            type: 'stop',
            time: '13:00',
            duration: '1h',
            name: '五千尺ホテル上高地',
            kind: '美食',
            desc: '河童橋旁的飯店,館內有餐廳與咖啡廳 LOUNGE。河童橋旁用餐。',
            lat: 36.2487698,
            lng: 137.6383587,
            placeId: 'ChIJh-62VNZFHWAREt0Vige4P0M',
          },
          {
            id: 'kamikochi-1day-d1-s4',
            type: 'stop',
            time: '14:15',
            duration: '1.5h',
            name: '明神池',
            kind: '景點',
            desc: '上高地深處的神社池,穗高神社奧宮所在。',
            lat: 36.254017999999995,
            lng: 137.66382049999999,
            placeId: 'ChIJC8XxEJAOHWARBzhcrx9Cbpo',
          },
          {
            id: 'kamikochi-1day-d1-s5',
            type: 'stop',
            time: '16:15',
            duration: '0.5h',
            name: 'ラ・ベルフォーレ テラス',
            kind: '美食',
            desc: '原木裝潢的安靜茶室,英式紅茶與大份蒙布朗被介紹。安靜的茶室。',
            lat: 36.2493771,
            lng: 137.6372991,
            placeId: 'ChIJrQS24NZFHWAR5tLl9hwUvHQ',
          },
        ],
      },
    ],
  },
}

export default itinerary
