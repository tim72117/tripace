import type { SampleItinerary } from '../types'

// 範例行程:北海道五日遊(札幌/小樽/富良野)。沒有照片與座標——清單與詳細頁會用
// 預設圖示代替;之後有了照片/座標,直接在這個檔案補上 googlePhotoUrls/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'hokkaido-5day',
  title: '北海道五日經典路線',
  region: '日本・北海道',
  categories: ['自然景觀', '美食'],
  summary: '札幌市區、小樽運河、富良野花田——北海道最經典的中部路線,五天走完都會、港町與花海三種風景。',
  addedAt: '2026-10-14',
  timeline: {
    days: [
      {
        id: 'hokkaido-5day-d1',
        nodes: [
        { id: 'hokkaido-5day-s0', type: 'stop', time: '13:00', duration: '2h', name: '札幌站周邊・狸小路商店街', kind: '購物', desc: '抵達後先熟悉市區,狸小路是最熱鬧的商店街' },
          { id: 'hokkaido-5day-s1', type: 'stop', time: '18:00', duration: '1.5h', name: '薄野成吉思汗烤肉', kind: '美食', desc: '北海道經典羊肉料理,薄野是市區美食聚集地' },
        ],
      },
      {
        id: 'hokkaido-5day-d2',
        nodes: [
        { id: 'hokkaido-5day-s2', type: 'stop', time: '09:00', duration: '2h', name: '北海道神宮', kind: '景點', desc: '北海道總鎮守,境內綠意盎然適合散步' },
          { id: 'hokkaido-5day-s3', type: 'stop', time: '12:00', duration: '1h', name: '二条市場海鮮丼午餐', kind: '美食', desc: '在地海鮮市場,新鮮海膽、鮭魚卵丼飯必吃' },
          { id: 'hokkaido-5day-s4', type: 'stop', time: '14:00', duration: '2h', name: '大通公園・札幌電視塔', kind: '景點', desc: '市中心綠帶公園,可登塔俯瞰整個札幌' },
        ],
      },
      {
        id: 'hokkaido-5day-d3',
        nodes: [
        { id: 'hokkaido-5day-s5', type: 'stop', time: '09:00', duration: '1h', name: '小樽運河', kind: '景點', desc: '搭火車前往小樽,運河沿岸石造倉庫群是必拍景點' },
          { id: 'hokkaido-5day-s6', type: 'stop', time: '11:00', duration: '2h', name: '小樽音樂盒堂・北一硝子', kind: '購物', desc: '玻璃工藝品與音樂盒專賣店聚集的老街區' },
          { id: 'hokkaido-5day-s7', type: 'stop', time: '14:00', duration: '1.5h', name: '小樽壽司屋通午餐', kind: '美食', desc: '小樽以新鮮壽司聞名,壽司屋通一條街都是名店' },
        ],
      },
      {
        id: 'hokkaido-5day-d4',
        nodes: [
        { id: 'hokkaido-5day-s8', type: 'stop', time: '09:00', duration: '2h', name: '富良野・富田農場', kind: '景點', desc: '夏季薰衣草花田,冬季則是雪景,依季節調整玩法' },
          { id: 'hokkaido-5day-s9', type: 'stop', time: '12:00', duration: '1h', name: '富良野咖哩午餐', kind: '美食', desc: '富良野在地特色咖哩飯,農產新鮮' },
          { id: 'hokkaido-5day-s10', type: 'stop', time: '14:00', duration: '2h', name: '美瑛・拼布之路', kind: '景點', desc: '丘陵地形與農田交織的風景道,適合租車自駕' },
        ],
      },
      {
        id: 'hokkaido-5day-d5',
        nodes: [
        { id: 'hokkaido-5day-s11', type: 'stop', time: '10:00', duration: '2h', name: '白色戀人公園', kind: '景點', desc: '北海道經典伴手禮工廠,可參觀製作過程' },
          { id: 'hokkaido-5day-s12', type: 'stop', time: '13:00', duration: '1.5h', name: '新千歲機場伴手禮採購', kind: '購物', desc: '機場內購物選擇多,回程前最後採購' },
        ],
      },
    ],
  },
}

export default itinerary
