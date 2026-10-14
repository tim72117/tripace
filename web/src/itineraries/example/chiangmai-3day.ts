import type { SampleItinerary } from '../types'

// 範例行程:清邁三日遊。沒有照片與座標——清單與詳細頁會用預設圖示代替;之後有了
// 照片/座標,直接在這個檔案補上 photos/lat/lng 即可。
const itinerary: SampleItinerary = {
  id: 'chiangmai-3day',
  title: '清邁古城慢活三日',
  region: '泰國・清邁',
  days: 3,
  categories: ['文青', '美食'],
  summary: '泰北古都的悠閒步調——古城寺廟、大象保育營、週日夜市,三天體驗清邁慢活的生活感。',
  addedAt: '2026-10-14',
  stops: [
    { day: 1, time: '10:00', duration: '1.5h', name: '契迪龍寺', kind: '景點', desc: '古城內最大佛塔遺跡,清邁地標之一' },
    { day: 1, time: '12:00', duration: '1h', name: '古城內泰式料理午餐', kind: '美食', desc: '古城內小巷聚集許多在地小吃店' },
    { day: 1, time: '14:00', duration: '1.5h', name: '帕辛寺', kind: '景點', desc: '蘭納建築風格代表作,金碧輝煌的大殿' },
    { day: 1, time: '18:00', duration: '2h', name: '塔佩門夜市', kind: '購物', desc: '古城東門周邊的日常夜市,小吃與手工藝品' },
    { day: 2, time: '08:00', duration: '4h', name: '大象自然保育營', kind: '活動', desc: '友善大象的保育營,餵食、洗澡、近距離互動不騎乘' },
    { day: 2, time: '13:00', duration: '1h', name: '保育營內泰北餐', kind: '美食', desc: '多數保育營行程含在地風味午餐' },
    { day: 2, time: '16:00', duration: '2h', name: '寧曼路', kind: '購物', desc: '文青咖啡廳與設計小店聚集的時髦街區' },
    { day: 3, time: '09:00', duration: '2h', name: '素帖山雙龍寺', kind: '景點', desc: '俯瞰清邁市區的山頂名寺,需爬三百多階金龍梯' },
    { day: 3, time: '13:00', duration: '1h', name: '湄登路午餐', kind: '美食', desc: '清邁知名咖哩麵(Khao Soi)多間名店所在地' },
    { day: 3, time: '15:00', duration: '2h', name: '週日夜市(Walking Street)', kind: '購物', desc: '僅週日營業的大型市集,從古城東門延伸整條街' },
  ],
}

export default itinerary
