// handDrawnMapStyle.ts — 手繪可愛風地圖樣式(google.maps.MapTypeStyle[])。
//
// 緣起(2026-10):使用者要求「地圖有沒有辦法做到類似手繪或是可愛風格」,
// 並明確選擇「用 map sdk 繪製」而非走 Google Cloud Console 手動設定
// Cloud-based Map Style(那個管道需要人工在 Console 網頁操作,無法由
// CLI/程式自動建立或編輯)。這份樣式改用 JS Maps API 原生支援的 inline
// styles 選項(google.maps.Map 的 styles 參數),直接在程式碼裡定義完整
// 配色/地物規則,不需要 Console 存取權限。
//
// 重要限制(見 planning/map/NativeMapBase.tsx styles prop 的完整說明):
// Google 官方文件規定 mapId(Cloud-based styling)與 inline styles 兩者
// 互斥——地圖一旦帶 mapId,Console 設定的 Cloud Style 會覆蓋/忽略這裡的
// inline styles。使用這份樣式的呼叫端必須把這個陣列傳給 NativeMapBase
// 的 styles prop、且不傳 mapId,NativeMapBase 內部會自動在偵測到 styles
// 有值時完全不帶 mapId(連預設的 VITE_GOOGLE_MAPS_MAP_ID 也不退回)。
//
// 也必須老實說明這個方法做不到什麼:MapTypeStyle 只能調整既有地圖資料
// 的「呈現規則」(填色、線條粗細、文字可見度、地物類別開關),不能把
// 道路幾何改成不規則的手繪筆觸,也不能置換成自訂插畫圖標——底圖的形狀
// 仍是精確的真實地理資料。這份樣式能做到的是「暖色調、低飽和度、較粗
// 圓潤的道路線條、簡化掉次要資訊」這種偏向插畫感的簡化配色,是在
// Google 官方樣式系統限制內最接近「手繪可愛風」的效果,不是真正的手繪
// 插畫地圖(若要後者,需要改用靜態繪製/生成的圖片素材取代即時地圖,
// 參考 home/AiPlanPhoneDemoScreen.tsx 的 demoMapSrc 做法,但那樣就不是
// 可互動的即時地圖了)。
//
// 設計方向:
// - 底色、水域、公園都用高明度低飽和度的暖色系(米杏/奶茶/粉綠),對齊
//   這個專案既有的 --ios-* 暖色調 token 氣質,不是套用隨便一個現成的
//   「可愛風」範本配色。
// - 道路線條加粗、圓角端點、去掉細碎的箭頭/車道標記,視覺上更接近
//   畫在紙上的粗線條地圖,而非精確測繪圖。
// - 大幅簡化 POI 標籤(只保留公園/景點大類,關掉商家/交通設施等密集
//   圖示),避免密集文字標籤破壞插畫感的留白。
export const HAND_DRAWN_MAP_STYLE: google.maps.MapTypeStyle[] = [
  // 整體底色——暖米杏色,比 Google 預設的冷白更接近紙張底色。
  { elementType: 'geometry', stylers: [{ color: '#f7f0e4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f0e4' }, { weight: 3 }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a7860' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  // 行政區界——極淡化,只當作模糊的背景分區感,不當資訊使用。
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },

  // 地貌(山林/自然景觀)——淡綠色塊,呼應手繪地圖常見的大色塊分區。
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e4ecd8' }] },

  // 公園——較飽和一點的粉綠,是這份樣式少數允許標籤的地物類別,保留
  // 「這裡有一片公園」的資訊,對齊這個行程(二子坪、冷水坑等國家公園
  // 路線)本身就是以自然景觀為主題的內容。
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d3e4bd' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6e8f4f' }] },

  // 其餘 POI(商家/醫療/學校等)——全部關閉,避免密集圖示跟文字標籤
  // 破壞插畫感的留白,呼應 home/InteractiveExploreMap.tsx LANDING_MAP_ID
  // 「只呈現我們自己畫的站點,不被底圖原生圖示干擾視覺焦點」的既有取捨。
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.sports_complex', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.government', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  // 道路——加粗、圓潤,暖棕色線條模擬粗蠟筆/麥克筆畫出來的路網,不是
  // 細瘦的測繪線。高速公路/主幹道用較深的焦糖色區分層級,一般道路用
  // 淺一階的米褐色,但整體色相維持同一個暖色系,不用對比色區分。
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#efe0c8' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d9c4a0' }, { weight: 0.5 }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8c79a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#c99f68' }, { weight: 1 }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#f0ddba' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },

  // 交通設施(轉運站圖示等)——關閉,理由同其餘 POI。
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  // 水域——粉藍帶一點粉彩感,跟暖色調的陸地形成柔和對比,不用飽和的
  // 正藍色(那會顯得過於寫實/工具感)。
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e0e8' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6b96a3' }] },
]

// HAND_DRAWN_DARK_COLORS——淺色版每個顏色對應的暗色版顏色。
//
// 為什麼要有暗色版:手繪配色走的是 inline styles、不帶 mapId,而 Google 的
// colorScheme(暗色)只對帶 mapId 的向量地圖生效——所以使用手繪配色的行程在
// 頁面切到夜間模式時,地圖仍是整片淺米色,跟暗色介面格格不入。解法是日夜
// 各給一份 styles,依 theme 切換(NativeMapBase 會在 theme/styles 變動時重建地圖)。
//
// 暗色版不是另寫一份規則,而是把淺色版的每個顏色依這張表替換:規則的結構
// (哪些地物顯示/隱藏、線條粗細)必須與淺色版完全一致,只有顏色不同,避免日夜
// 兩版的資訊量悄悄分岔。色調沿用同一個暖色系(暖褐/苔綠/灰藍),對齊專案夜間
// token(--ios-bg 深色約 #1C1815、--ios-card 深色約 #26211D)的氣質。
// 淺色版新增了表裡沒有的顏色時,handDrawnMapStyle.test.ts 會失敗提醒補這張表。
export const HAND_DRAWN_DARK_COLORS: Record<string, string> = {
  '#f7f0e4': '#26211d', // 整體底色、文字描邊
  '#8a7860': '#b3a187', // 一般文字
  '#e4ecd8': '#2d3527', // 自然地貌
  '#d3e4bd': '#34412c', // 公園
  '#6e8f4f': '#93b573', // 公園文字
  '#efe0c8': '#3b3228', // 一般道路
  '#d9c4a0': '#4d4033', // 道路描邊
  '#e8c79a': '#6a5233', // 高速公路
  '#c99f68': '#8d6c40', // 高速公路描邊
  '#f0ddba': '#44392c', // 主幹道
  '#c9e0e8': '#243840', // 水域
  '#6b96a3': '#7fa9b6', // 水域文字
}

// MapTypeStyle.stylers 的元素型別是 object(Google 型別宣告沒有細分),這裡只關心
// 有沒有 color 欄位,收斂成這個型別。
type ColorStyler = { color?: unknown }

export const HAND_DRAWN_MAP_STYLE_DARK: google.maps.MapTypeStyle[] = HAND_DRAWN_MAP_STYLE.map((rule) => ({
  ...rule,
  stylers: rule.stylers?.map((s) => {
    const color = (s as ColorStyler).color
    return typeof color === 'string' ? { ...s, color: HAND_DRAWN_DARK_COLORS[color] ?? color } : s
  }),
}))

