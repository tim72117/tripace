import type { SampleItinerary } from '../types'

// 範例行程:東京兩日(哈利波特影城 + 吉卜力美術館),兩個主題樂園各佔一天。
// 沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了照片/座標,直接在這個
// 檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'tokyo-hp-ghibli-2day',
  title: '東京哈利波特×吉卜力兩日朝聖',
  region: '日本・東京',
  days: 2,
  categories: ['主題樂園', '親子'],
  summary: '兩個影迷必訪聖地各佔一天——Day1 沉浸在霍格華茲的魔法世界，Day2 走進龍貓與神隱少女的手繪場景，適合動畫/電影迷的朝聖行程。',
  addedAt: '2026-10-14',
  stops: [
    { day: 1, time: '09:00', duration: '0.5h', name: '豐島園站集合', kind: '交通', desc: '哈利波特影城專屬車站，提前預約門票時段' },
    { day: 1, time: '09:30', duration: '6h', name: '華納兄弟哈利波特影城', kind: '景點', desc: '霍格華茲大廳、禁忌森林、對角巷實景布置，建議預留一整個白天' },
    { day: 1, time: '16:00', duration: '1.5h', name: '影城周邊紀念品選購', kind: '購物', desc: '奶油啤酒、魔杖、學院圍巾等限定商品' },
    { day: 1, time: '18:00', duration: '1.5h', name: '池袋晚餐', kind: '美食', desc: '影城鄰近池袋，交通方便，選擇多元' },
    { day: 2, time: '10:00', duration: '2.5h', name: '三鷹之森吉卜力美術館', kind: '景點', desc: '需提前一個月於官網抽票/預約，館內禁止拍照，建議放慢腳步細看' },
    { day: 2, time: '13:00', duration: '1h', name: '美術館附設麥稈帽子咖啡廳', kind: '美食', desc: '館內限定餐廳，建議提早入場排隊' },
    { day: 2, time: '15:00', duration: '1.5h', name: '井之頭恩賜公園', kind: '景點', desc: '美術館旁的自然公園，《龍貓》等作品的靈感場景之一' },
    { day: 2, time: '17:00', duration: '1h', name: '吉祥寺商店街', kind: '購物', desc: '美術館周邊的熱鬧商圈，咖啡廳與雜貨店林立' },
  ],
}

export default itinerary
