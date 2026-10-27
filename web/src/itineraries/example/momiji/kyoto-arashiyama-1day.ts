import type { SampleItinerary } from '../../types'

// 範例行程:嵐山・嵯峨野紅葉散策一日(日本・京都)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug kyoto-arashiyama-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'kyoto-arashiyama-1day',
  title: '嵐山・嵯峨野紅葉散策一日',
  region: '日本・京都',
  categories: ['自然景觀', '寺社', '美食'],
  summary: '從渡月橋出發,走天龍寺、竹林小徑與嵯峨野的山腰寺院,午餐吃嵯峨的湯豆腐,傍晚在渡月橋畔喝茶收尾。',
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
        id: 'kyoto-arashiyama-1day-d1',
        nodes: [
          {
            id: 'kyoto-arashiyama-1day-d1-s0',
            type: 'stop',
            time: '08:30',
            duration: '0.5h',
            name: '嵐山',
            kind: '景點',
            desc: '渡月橋與嵯峨野山麓一帶,天龍寺、竹林小徑與山腰寺院的楓葉隧道是京都賞楓最熱門的區域之一。從渡月橋畔開始一天,橋上能望見山腰的紅葉。',
            lat: 35.0128769,
            lng: 135.67777479999998,
            placeId: 'ChIJd2mRAFMHAWARPSiWJOj4FOw',
            attractions: ['lmk_f04bda2ea508', 'lmk_8fb67c07289b'],
          },
          {
            id: 'kyoto-arashiyama-1day-d1-s1',
            type: 'stop',
            time: '09:00',
            duration: '1.5h',
            name: '天龍寺',
            kind: '景點',
            desc: '足利尊氏為追悼後醍醐天皇所建的世界遺產名剎,曹源池庭園與楓葉相映。建議早一點進場,避開週末的人潮。',
            lat: 35.0158379,
            lng: 135.6737654,
            placeId: 'ChIJk54PuAGqAWARwEgz_9o-nM0',
          },
          {
            id: 'kyoto-arashiyama-1day-d1-s2',
            type: 'stop',
            time: '10:30',
            duration: '0.5h',
            name: '竹林小徑',
            kind: '景點',
            desc: '天龍寺北門一帶的竹林步道,嵐山最具代表性的散步路線。',
            lat: 35.0168187,
            lng: 135.67130129999998,
            placeId: 'ChIJrYtcv-urAWAR3XzWvXv8n_s',
          },
          {
            id: 'kyoto-arashiyama-1day-d1-s3',
            type: 'stop',
            time: '11:15',
            duration: '1h',
            name: '常寂光寺',
            kind: '景點',
            desc: '小倉山山腰的寺院,沿石階的楓樹形成紅葉隧道,可俯瞰嵯峨野。',
            lat: 35.0198102,
            lng: 135.66864049999998,
            placeId: 'ChIJHw9S2xqqAWARqO_fgtu1Nz4',
            attractions: ['lmk_09fb9da3f7d3', 'lmk_b6232763c375'],
          },
          {
            id: 'kyoto-arashiyama-1day-d1-s4',
            type: 'stop',
            time: '12:45',
            duration: '1h',
            name: '嵯峨とうふ稲 北店',
            kind: '美食',
            desc: '嵯峨的湯豆腐與湯葉料理,嵐山賞楓時常見的午餐選擇。',
            lat: 35.017267499999996,
            lng: 135.6768897,
            placeId: 'ChIJ__87Q_-pAWARyRrG6t5ZSEs',
          },
          {
            id: 'kyoto-arashiyama-1day-d1-s5',
            type: 'stop',
            time: '14:30',
            duration: '0.5h',
            name: '琴きき茶屋',
            kind: '美食',
            desc: '渡月橋畔的茶屋,全年供應的櫻餅是嵐山名物。',
            lat: 35.0136867,
            lng: 135.6777117,
            placeId: 'ChIJhRe8WVUHAWAReJAZkmBnjzw',
          },
        ],
      },
    ],
  },
}

export default itinerary
