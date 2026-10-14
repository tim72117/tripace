import type { SampleItinerary } from '../types'

// 範例行程:釜山三日遊。沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'busan-3day',
  title: '釜山海港三日遊',
  region: '韓國・釜山',
  days: 3,
  categories: ['海景', '美食'],
  summary: '韓國第二大城,依山傍海——甘川洞的彩色階梯、海雲台的沙灘、札嘎其市場的生猛海鮮,三天走遍釜山的港都風情。',
  addedAt: '2026-10-14',
  stops: [
    { day: 1, time: '10:00', duration: '2h', name: '甘川文化村', kind: '景點', desc: '依山而建的彩色階梯社區,釜山的「馬丘比丘」' },
    { day: 1, time: '13:00', duration: '1h', name: '札嘎其市場午餐', kind: '美食', desc: '韓國最大海鮮市場,樓下買樓上現煮' },
    { day: 1, time: '15:00', duration: '2h', name: '龍頭山公園・釜山塔', kind: '景點', desc: '市區制高點,可俯瞰整個釜山港' },
    { day: 1, time: '18:00', duration: '1.5h', name: '南浦洞・BIFF廣場', kind: '購物', desc: '釜山國際電影節舉辦地,周邊小吃攤聚集' },
    { day: 2, time: '09:30', duration: '1.5h', name: '海東龍宮寺', kind: '景點', desc: '韓國少見的海邊寺廟,建議早上避開人潮' },
    { day: 2, time: '12:00', duration: '1h', name: '機張市場午餐', kind: '美食', desc: '帝王蟹與海鮮鍋的在地名店聚集地' },
    { day: 2, time: '14:00', duration: '2h', name: '海雲台海水浴場', kind: '景點', desc: '釜山最知名沙灘,沿岸咖啡廳林立' },
    { day: 2, time: '17:00', duration: '2h', name: '東釜山天空膠囊列車', kind: '活動', desc: '沿海岸線行駛的觀光列車,夕陽時段景色最美' },
    { day: 3, time: '10:00', duration: '2h', name: '太宗臺', kind: '景點', desc: '斷崖絕壁與燈塔,搭乘園內小火車遊覽全區' },
    { day: 3, time: '13:00', duration: '1.5h', name: '松島海上纜車', kind: '活動', desc: '透明底艙纜車跨越海灣,可俯瞰松島海水浴場' },
    { day: 3, time: '15:30', duration: '2h', name: '西面商圈', kind: '購物', desc: '釜山最熱鬧的購物/美食聚集區,返程前最後採購' },
  ],
}

export default itinerary
