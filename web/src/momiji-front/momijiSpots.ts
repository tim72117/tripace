// momijiSpots.ts——日本知名賞楓景點(資料檔),頁面上用楓葉徽章標在地圖上。
//
// 這是人工挑選的代表性景點清單(各地區挑一到兩處長年被列為賞楓名所的地方),
// 不是來源預測資料的一部分,也不是排名——日本氣象的預測頁另有約 700 個景點的
// 預測日,這份檔案沒有收。座標是景點的概略位置(溪谷、山岳、寺社群這類有
// 範圍的地方取中心附近),只用來在地圖上放標記,不要拿來導航。
//
// kind 是景點性質的簡短標籤(溪谷/湖/山岳/寺社/溫泉/庭園),純顯示用。

export interface MomijiSpot {
  id: string
  name: string // 繁體中文顯示名
  area: string // 所在都道府縣
  kind: string
  lat: number
  lng: number
}

export const MOMIJI_SPOTS: ReadonlyArray<MomijiSpot> = [
  { id: 'jozankei', name: '定山溪', area: '北海道', kind: '溫泉溪谷', lat: 42.9667, lng: 141.1667 },
  { id: 'oirase', name: '奧入瀨溪流', area: '青森', kind: '溪谷', lat: 40.5, lng: 140.95 },
  { id: 'kakunodate', name: '角館', area: '秋田', kind: '武家屋敷', lat: 39.5983, lng: 140.5633 },
  { id: 'urabandai', name: '裏磐梯', area: '福島', kind: '湖沼', lat: 37.65, lng: 140.08 },
  { id: 'nikko', name: '日光', area: '栃木', kind: '山岳・寺社', lat: 36.75, lng: 139.5986 },
  { id: 'hakone', name: '箱根', area: '神奈川', kind: '溫泉山岳', lat: 35.2333, lng: 139.1 },
  { id: 'kawaguchiko', name: '河口湖', area: '山梨', kind: '湖', lat: 35.5, lng: 138.7667 },
  { id: 'kurobe', name: '黑部峽谷', area: '富山', kind: '溪谷', lat: 36.8, lng: 137.65 },
  { id: 'kamikochi', name: '上高地', area: '長野', kind: '山岳', lat: 36.2486, lng: 137.6372 },
  { id: 'arashiyama', name: '嵐山', area: '京都', kind: '寺社・渡月橋', lat: 35.0094, lng: 135.6667 },
  { id: 'tofukuji', name: '東福寺', area: '京都', kind: '寺社', lat: 34.9764, lng: 135.7733 },
  { id: 'yoshino', name: '吉野山', area: '奈良', kind: '山岳', lat: 34.3667, lng: 135.8583 },
  { id: 'miyajima', name: '宮島紅葉谷', area: '廣島', kind: '山岳・神社', lat: 34.2958, lng: 132.3186 },
  { id: 'daisen', name: '大山', area: '鳥取', kind: '山岳', lat: 35.3711, lng: 133.5403 },
  { id: 'yabakei', name: '耶馬溪', area: '大分', kind: '溪谷', lat: 33.4667, lng: 131.1833 },
]
