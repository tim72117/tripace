import type { SampleItinerary } from '../../types'

// 範例行程:奧入瀨溪流紅葉一日(日本・青森)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug oirase-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'oirase-1day',
  title: '奧入瀨溪流紅葉一日',
  region: '日本・青森',
  categories: ['自然景觀'],
  summary: '沿著奧入瀨溪流慢慢走,看銚子大滝與阿修羅の流れ,午後到十和田湖與蔦沼。',
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
        id: 'oirase-1day-d1',
        nodes: [
          {
            id: 'oirase-1day-d1-s0',
            type: 'stop',
            time: '09:00',
            duration: '4h',
            name: '奧入瀨溪流',
            kind: '景點',
            desc: '從焼山走到子ノ口約 14 公里的溪流步道,沿途瀑布與急流很多。',
            lat: 40.489961799999996,
            lng: 140.9525486,
            placeId: 'ChIJeXTDrw09m18RGrz8MCSK66s',
            attractions: ['lmk_d7f5644d23bc', 'lmk_8146a83eb1d6', 'lmk_0c0bacc5f1f8'],
          },
          {
            id: 'oirase-1day-d1-s1',
            type: 'stop',
            time: '14:00',
            duration: '1.5h',
            name: '十和田湖',
            kind: '景點',
            desc: '奧入瀨溪流的源頭,休屋可搭遊覽船。',
            lat: 40.464869,
            lng: 140.8772428,
            placeId: 'ChIJ4cjU-rUim18RLOTTZFDdfo8',
          },
          {
            id: 'oirase-1day-d1-s2',
            type: 'stop',
            time: '16:00',
            duration: '1h',
            name: '蔦沼',
            kind: '景點',
            desc: '八甲田山麓的沼澤,常與奧入瀨溪流一起安排。',
            lat: 40.600830599999995,
            lng: 140.9499649,
            placeId: 'ChIJJzJFRF0Um18RUFi4jyBFlCg',
          },
        ],
      },
    ],
  },
}

export default itinerary
