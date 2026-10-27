import type { SampleItinerary } from '../../types'

// 範例行程:宮島紅葉一日:嚴島神社到彌山(日本・廣島)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug miyajima-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'miyajima-1day',
  title: '宮島紅葉一日:嚴島神社到彌山',
  region: '日本・廣島',
  categories: ['寺社', '自然景觀', '美食'],
  summary: '從嚴島神社走到表參道商店街吃小吃,下午到紅葉谷公園與彌山賞楓,傍晚回宮島口吃穴子飯。',
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
        id: 'miyajima-1day-d1',
        nodes: [
          {
            id: 'miyajima-1day-d1-s0',
            type: 'stop',
            time: '10:00',
            duration: '1.5h',
            name: '宮島',
            kind: '景點',
            desc: '世界遺產嚴島神社所在的島,紅葉谷公園是島上的賞楓中心。嚴島神社的海上鳥居是象徵。',
            lat: 34.295989600000006,
            lng: 132.3198285,
            placeId: 'ChIJj23HfgTjGmARkNW10PcocjU',
          },
          {
            id: 'miyajima-1day-d1-s1',
            type: 'stop',
            time: '11:45',
            duration: '1.25h',
            name: '表參道商店街',
            kind: '美食',
            desc: '通往嚴島神社的商店街,牡蠣、穴子與紅葉饅頭等小吃集中。',
            lat: 34.298974699999995,
            lng: 132.32183559999999,
            placeId: 'ChIJ1zjNPLGwWjURgwBo1M8ikLw',
            attractions: ['lmk_55b032fc2a1d', 'lmk_d7d0c06ff8cc'],
          },
          {
            id: 'miyajima-1day-d1-s2',
            type: 'stop',
            time: '14:00',
            duration: '1.5h',
            name: '紅葉谷公園',
            kind: '景點',
            desc: '約 700 棵楓樹的公園,紅葉橋一帶最有人氣。',
            lat: 34.2942053,
            lng: 132.324065,
            placeId: 'ChIJdS8mkbewWjUR580CS14cuiI',
          },
          {
            id: 'miyajima-1day-d1-s3',
            type: 'stop',
            time: '15:45',
            duration: '2h',
            name: '彌山',
            kind: '景點',
            desc: '宮島最高點,彌山纜車本身也被列為賞楓名所。',
            lat: 34.2795127,
            lng: 132.3198084,
            placeId: 'ChIJGUy2HtSwWjURk5ao-WBFAf0',
          },
          {
            id: 'miyajima-1day-d1-s4',
            type: 'stop',
            time: '18:00',
            duration: '1h',
            name: 'あなごめし うえの',
            kind: '美食',
            desc: '明治 34 年創業的穴子飯名店,位於宮島口。回到宮島口享用穴子飯。',
            lat: 34.3115065,
            lng: 132.30351539999998,
            placeId: 'ChIJH_vewlq3WjURmvDGpczFQB4',
          },
        ],
      },
    ],
  },
}

export default itinerary
