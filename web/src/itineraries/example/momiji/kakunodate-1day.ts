import type { SampleItinerary } from '../../types'

// 範例行程:角館紅葉一日:武家屋敷與田澤湖(日本・秋田)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug kakunodate-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'kakunodate-1day',
  title: '角館紅葉一日:武家屋敷與田澤湖',
  region: '日本・秋田',
  categories: ['歷史街區', '自然景觀', '美食'],
  summary: '上午走武家屋敷通,午餐吃稲庭うどん,下午到抱返り渓谷與田澤湖。',
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
        id: 'kakunodate-1day-d1',
        nodes: [
          {
            id: 'kakunodate-1day-d1-s0',
            type: 'stop',
            time: '09:30',
            duration: '2h',
            name: '角館武家屋敷通',
            kind: '景點',
            desc: '保留江戶時代武家屋敷的城下町,黑板牆與楓樹是招牌。',
            lat: 39.59926180000001,
            lng: 140.5617163,
            placeId: 'ChIJCXDpY72bj18RIJrG6RIlrAk',
            attractions: ['lmk_0cc82e51a401', 'lmk_8684b5c4d2e4'],
          },
          {
            id: 'kakunodate-1day-d1-s1',
            type: 'stop',
            time: '11:45',
            duration: '1h',
            name: '古泉洞',
            kind: '美食',
            desc: '武家屋敷通附近的町家風餐廳,以手延稲庭うどん聞名。',
            lat: 39.5974937,
            lng: 140.56231409999998,
            placeId: 'ChIJTzNQu2iaj18RqUIO48jbcJg',
          },
          {
            id: 'kakunodate-1day-d1-s2',
            type: 'stop',
            time: '13:15',
            duration: '0.5h',
            name: 'くら吉 角館本店',
            kind: '美食',
            desc: '武家屋敷通附近的和菓子甜點店。',
            lat: 39.5989398,
            lng: 140.5601944,
            placeId: 'ChIJmZVBZG-aj18RsgEhhhAxp_w',
          },
          {
            id: 'kakunodate-1day-d1-s3',
            type: 'stop',
            time: '14:30',
            duration: '1.5h',
            name: '抱返り渓谷',
            kind: '景點',
            desc: '紅葉搭配溪谷的名所,離角館不遠。',
            lat: 39.6081292,
            lng: 140.6514587,
            placeId: 'ChIJs8O3pNeEj18RrqSAnCYnRmk',
          },
          {
            id: 'kakunodate-1day-d1-s4',
            type: 'stop',
            time: '16:30',
            duration: '1.5h',
            name: '田澤湖',
            kind: '景點',
            desc: '秋田代表性的湖,常與角館安排在同一天。',
            lat: 39.7168527,
            lng: 140.65448609999999,
            placeId: 'ChIJjzSdMoKJj18RISzxuUubhMI',
          },
        ],
      },
    ],
  },
}

export default itinerary
