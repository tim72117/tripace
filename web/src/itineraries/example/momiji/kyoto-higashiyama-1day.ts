import type { SampleItinerary } from '../../types'

// 範例行程:京都東山紅葉一日:東福寺到八坂神社(日本・京都)。2026-10-27 新增——這份檔案是資料庫
// (itinerary_pages,slug kyoto-higashiyama-1day)內容的靜態備份,對外顯示以 API 為優先、查無資料
// (404)才退回這裡(見 AiItineraryDetailPage.tsx 的 useApiBackedItinerary);紅葉前線
// (momiji-front)的景點卡片也是讀這份檔案(見 spotItinerary.ts)。
// 站點的名稱、座標、placeId 與 attractions(周邊景點 id)都對應資料庫已建立的景點
// (attraction,lmk_… id);正式站資料庫尚未同步這批景點前,attractions 查不到會只顯示 id。
// 時間與時長是依地理順序粗排,沒有核對營業時間與交通時間。
// mapStyle/playfulUI 的完整說明見 types.ts SampleItinerary 對應欄位。
const itinerary: SampleItinerary = {
  id: 'kyoto-higashiyama-1day',
  title: '京都東山紅葉一日:東福寺到八坂神社',
  region: '日本・京都',
  categories: ['寺社', '自然景觀', '美食'],
  summary: '從東福寺的通天橋開始,往泉涌寺、清水寺走,最後經過二年坂與高台寺到八坂神社,一路從東山南側走到祇園。',
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
        id: 'kyoto-higashiyama-1day-d1',
        nodes: [
          {
            id: 'kyoto-higashiyama-1day-d1-s0',
            type: 'stop',
            time: '08:30',
            duration: '2h',
            name: '東福寺',
            kind: '景點',
            desc: '以通天橋下的楓葉海聞名的京都紅葉名所,楓葉季人潮很多。紅葉季人潮多,開門後馬上進場比較從容。',
            lat: 34.976025,
            lng: 135.7737627,
            placeId: 'ChIJrZ8NkJJIAWARwRVgbKoRx2I',
            attractions: ['lmk_134c8e27589f'],
          },
          {
            id: 'kyoto-higashiyama-1day-d1-s1',
            type: 'stop',
            time: '10:45',
            duration: '1h',
            name: '泉涌寺',
            kind: '景點',
            desc: '東山南側的皇室菩提寺,與東福寺常一起安排。',
            lat: 34.9780836,
            lng: 135.7813121,
            placeId: 'ChIJP4zluCQPAWARFnbbm1_GZZs',
            attractions: ['lmk_c6fbfd2ab28a'],
          },
          {
            id: 'kyoto-higashiyama-1day-d1-s2',
            type: 'stop',
            time: '12:15',
            duration: '0.5h',
            name: '大谷園茶舗',
            kind: '美食',
            desc: '宇治茶專門店附設喫茶,有宇治茶霜淇淋與聖代。午餐前後可以在這裡喝杯宇治茶。',
            lat: 34.9836776,
            lng: 135.77412569999998,
            placeId: 'ChIJDfTpPjQPAWAR-N5f_Sel_Z8',
          },
          {
            id: 'kyoto-higashiyama-1day-d1-s3',
            type: 'stop',
            time: '14:00',
            duration: '2h',
            name: '清水寺',
            kind: '景點',
            desc: '778年僧延鎮於音羽の滝上結庵祀觀音,798年坂上田村麻呂建佛殿成為敕願寺。懸崖地形逼出「舞台造」懸空木構工法,山中湧泉音羽の滝自創建以來持續湧流。從舞台望出去的紅葉是東山的代表景色。',
            lat: 34.9949,
            lng: 135.785,
            placeId: 'ChIJB_vchdMIAWARujTEUIZlr2I',
            attractions: ['lmk_0e6bafd9676e', 'lmk_5e7f446885a2', 'lmk_950b58252886'],
          },
          {
            id: 'kyoto-higashiyama-1day-d1-s4',
            type: 'stop',
            time: '16:30',
            duration: '1h',
            name: '高台寺',
            kind: '景點',
            desc: '1606年豐臣秀吉正室北政所（寧寧）為弔念秀吉建立,德川家康因政治考量提供鉅額資助。與清水寺、八坂の塔同屬沿東山山麓分布的寺院系列。沿二年坂的路線再往北走。',
            lat: 35.0007687,
            lng: 135.78127179999998,
          },
          {
            id: 'kyoto-higashiyama-1day-d1-s5',
            type: 'stop',
            time: '17:45',
            duration: '1h',
            name: '八坂神社',
            kind: '景點',
            desc: '社傳天神降臨於東山山麓祇園林,選址與山麓森林直接相關。祇園祭起源明確可溯及869年疫病祈禳,970年左右成為固定年度祭典,是祇園祭發源地。走到祇園,順著花見小路散步。',
            lat: 35.0037,
            lng: 135.7784,
            placeId: 'ChIJqewQoHkIAWAR6RokWp3Iesc',
            attractions: ['lmk_1914e13ef52e', 'lmk_a165a5604833'],
          },
        ],
      },
    ],
  },
}

export default itinerary
