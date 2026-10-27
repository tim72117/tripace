import type { SampleItinerary } from '../../types'

// 範例行程:定山溪溫泉街紅葉散策一日遊(北海道)。2026-10 新增——這份檔案
// 是目前資料庫(itinerary_pages,slug jozankei-1day)內容的靜態備份,不是
// 這份行程實際對外顯示的資料來源:AiItineraryDetailPage.tsx 的
// useApiBackedItinerary 無條件先打 API,只有 API 查無資料(404)才會退回
// 讀這裡——見該處「寬所有 id 都先試 API,404 再退回靜態檔案」的完整說明。
// 保留這份靜態版本的理由同 tainan-chikan-2day(刪除前)的既有先例已經
// 改變:使用者明確要求「排好的行程清單用參數控制要不要顯示範例,預設
// 關閉」+「先把定山溪設定寫回 example」,這份檔案的用途是資料庫故障時的
// 離線備援,以及本機開發/測試不依賴資料庫就能檢視這份行程的完整內容。
//
// mapStyle/playfulUI/cardTheme 三個欄位的完整說明見 types.ts
// SampleItinerary 對應欄位。這份行程用手繪地圖配色(mapStyle)與秋日泡湯主題
// 卡片(cardTheme);playfulUI 設為 false——外框裝飾只剩寶藏地圖(指北針+羊皮紙)
// 一種(楓葉相框已於 2026-10-27 移除),那是使用者先前明確不要的,所以要關掉
// playfulUI 才不會畫任何外框。
//
// stops[].googlePhotoUrls 是寫死的 GCS 落地網址快照(建檔當下 tripace-cli
// attraction photo-update 查到的 Google 照片)——資料庫版本的這些站點
// 另外還有 attractionId 可以即時查詢最新照片(見
// useStopAttractionDetails.ts 的完整說明,2026-10 新增,解決「網址寫死
// 會跟 photo_assets 實際狀態脫鉤」的問題),但這份靜態備份檔案故意只留
// 照片網址快照、不帶 attractionId——離線備援情境下,即時查詢 API 本來就
// 不可用,帶 attractionId 也查不到東西,不如直接存快照網址,至少資料庫
// 完全掛掉時這份行程還能顯示有照片的樣子(即使可能是舊照片)。
const itinerary: SampleItinerary = {
  id: 'jozankei-1day',
  title: '定山溪溫泉街紅葉散策一日遊',
  region: '日本・北海道',
  categories: ['溫泉', '自然景觀', '美食'],
  summary: '從西到東走一圈定山溪溫泉街,紅葉季最值得散步的六個停靠站——紅色吊橋、免費足湯、山洞觀音、現烤麵包,全程輕鬆步行就能走完。',
  addedAt: '2026-10-14',
  mapStyle: 'hand-drawn',
  playfulUI: false,
  cardTheme: 'onsen-autumn',
  timeline: {
    days: [
      {
        id: 'jozankei-1day-d1',
        nodes: [
        {
        id: 'jozankei-1day-s0',
        type: 'stop',
        time: '09:00', duration: '0.5h', name: '二見吊橋', kind: '景點',
        desc: '溫泉街散策路上最好認的地標——全長23公尺的紅色吊橋,站上橋面能俯瞰豐平川,還能望見「夫婦岩」與傳說中河童出沒的河童淵。紅葉季(10月中下旬到11月初)站在橋上拍照,兩岸楓紅配紅色吊橋,是這趟散策最經典的一張照片。',
        lat: 42.9638623, lng: 141.1581486,
        placeId: 'ChIJH3hLJRTTCl8R-T4DCRkDNxM',
      },
          {
        id: 'jozankei-1day-s1',
        type: 'stop',
        time: '09:45', duration: '0.5h', name: '定山溪物產館', kind: '美食',
        desc: '1926年開業的溫泉饅頭老店,每天早上現做的溫泉饅頭有黑糖、艾草兩種口味,常常中午前就賣完,想吃要趁早。店裡也賣手工醃菜跟各種河童主題的伴手禮。全年無休,早上8點開到晚上9點。',
        lat: 42.9655304, lng: 141.1613145,
        placeId: 'ChIJ29iDnBjSCl8RTL06P31o840',
      },
          {
        id: 'jozankei-1day-s2',
        type: 'stop',
        time: '10:30', duration: '0.5h', name: '定山源泉公園', kind: '景點',
        desc: '溫泉街中心、月見橋畔的免費足湯,不用門票、7點開到晚上9點。園內還有個特別的「溫玉之湯」——直接用公園裡80度以上的高溫源泉,自己動手煮一顆溫泉蛋。立著溫泉發現者美泉定山的雕像,配上一旁的美泉瀑布。',
        lat: 42.9649782, lng: 141.1631326,
        placeId: 'ChIJDW51fBjSCl8RMIw2GYXOnR4',
      },
          {
        id: 'jozankei-1day-s3',
        type: 'stop',
        time: '11:15', duration: '0.5h', name: '岩戸觀音堂', kind: '景點',
        desc: '這站比較特別——不是廟宇的正殿,是一座深120公尺的山洞,裡面安置了33尊觀音像。1936年為了紀念定山溪到小樽道路工程中殉職的工人而建,現在的洞窟本體是1967年重建的。民間傳說對考試、戀愛、生意興隆特別靈驗。',
        lat: 42.9664738, lng: 141.1608163,
        placeId: 'ChIJVVX2qhjSCl8RQf5zfOVkAag',
      },
          {
        id: 'jozankei-1day-s4',
        type: 'stop',
        time: '12:00', duration: '0.5h', name: '定山溪神社', kind: '景點',
        desc: '1911年創立,供奉大己貴神、少彦名神等六柱神明,就在溫泉街步行圈內,散策途中順路就能參拜。每年9月10日的例祭日前後造訪,可以感受到在地溫泉鄉的節慶氣氛。',
        lat: 42.9648685, lng: 141.1671718,
        placeId: 'ChIJ8UjQxCLSCl8RvZLZ5_pkYIo',
      },
          {
        id: 'jozankei-1day-s5',
        type: 'stop',
        time: '13:00', duration: '1h', name: 'Exclamation Bakery', kind: '美食',
        desc: '溫泉街以北「山之風町」園區裡的現烤麵包坊,用北海道產小麥、倶知安石川養雞場的雞蛋跟北海道奶油,每天新鮮出爐。最特別的是可以邊吃麵包邊泡免費足湯。四季會更換顏色的大暖簾是找店的招牌標誌,營業到下午5點。',
        lat: 42.972399, lng: 141.1665847,
        placeId: 'ChIJR_Q9Mu3TCl8ROhV9u_WOP0o',
      },
        ],
      },
    ],
  },
}

export default itinerary
