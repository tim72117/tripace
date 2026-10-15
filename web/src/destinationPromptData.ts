// destinationPromptData.ts — 「想去哪裡?」對話氣泡(DestinationPrompt.tsx,
// 見該檔案開頭的完整說明)用的大地區/城市清單,純資料、不含任何 UI 邏輯,
// 拆成獨立檔案方便單獨寫測試(同 plan-core/planTimeline.ts 把資料結構跟
// 渲染分開的既有慣例)。
//
// 這份清單純粹是這個對話氣泡自己的展示用內容,使用者明確要求「跟現有的
// 城市介紹頁(九份/京都/台南安平/赤崁府城,見 home/JiufenPage.tsx 等)
// 沒有直接關聯」——不是要點進去變成導去那些行銷頁面,點選城市只是把城市
// 名稱組成一句提示文字送進 onagent 對話(見 DestinationPrompt.tsx
// 呼叫端 sendPrompt 的完整說明),所以這裡不需要存任何頁面路徑/id,只要
// 「顯示用的名稱」就夠。

// 代表照片:專案自己拍的照片(赤崁樓迴廊/山海豆花/消防史料館/孔廟院落),
// 縮成 400×280 的小圖(每張約 10~26KB)放在 assets/destination/,由 Vite
// 打包,不依賴外部網址。
import heritagePhoto from './assets/destination/heritage.webp'
import foodPhoto from './assets/destination/food.webp'
import exhibitionPhoto from './assets/destination/exhibition.webp'
import outdoorPhoto from './assets/destination/outdoor.webp'

// DestinationRegion — 第一層選單的一個大地區選項,展開後對應第二層的
// 固定城市清單。
export interface DestinationRegion {
  // id——純粹給 React key/選取狀態比對用的穩定識別碼,不是任何後端資料的
  // 外鍵(這份清單整個是寫死在前端的展示資料,見檔頭說明)。
  id: string
  label: string
  cities: string[]
}

// DESTINATION_REGIONS——3~5 個大地區,使用者明確要求「不要過度擴充」。
// 選了台灣/日本/韓國/東南亞/歐洲共 5 組,涵蓋目前最常見的出遊目的地
// 類型(國內 + 幾個主要海外客群),每組底下列 3 個該地區最具代表性、
// 使用者一看城市名稱就能辨認的城市,不要求齊全或精確分類(例如「東南亞」
// 本身橫跨多國,這裡純粹是展示用的粗分類,不是嚴謹的地理資料)。
export const DESTINATION_REGIONS: DestinationRegion[] = [
  { id: 'taiwan', label: '台灣', cities: ['台北', '台中', '台南'] },
  { id: 'japan', label: '日本', cities: ['東京', '大阪', '京都'] },
  { id: 'korea', label: '韓國', cities: ['首爾', '釜山', '濟州島'] },
  { id: 'southeast-asia', label: '東南亞', cities: ['曼谷', '新加坡', '峇里島'] },
  { id: 'europe', label: '歐洲', cities: ['巴黎', '羅馬', '倫敦'] },
]

// buildDestinationPrompt——把使用者點選的城市名稱組成送進 onagent 對話的
// 提示文字。獨立成一個小函式(而非在元件裡直接內聯字串模板)方便單獨
// 測試這句文案,也讓「文案怎麼組」這個決策跟「怎麼呼叫 sendPrompt 送出」
// 這個流程控制邏輯分開。
//
// directions 是選填:使用者在最後一層選了玩法方向(古蹟/美食/展館/戶外活動,
// 見 DESTINATION_DIRECTIONS,可複選)時,把每個方向的偏好句依序接在句尾,
// 讓 AI 一開始就知道要偏重哪幾類;沒選(空陣列,即「都可以」)就維持原本的
// 單純句子。
export function buildDestinationPrompt(city: string, directions: DestinationDirection[] = []): string {
  const base = `我想去${city}玩`
  const preferences = directions.map((d) => d.promptText).filter(Boolean)
  return preferences.length > 0 ? `${base},${preferences.join(',')}` : base
}

// DestinationDirection — 最後一層「想偏重哪一種玩法?」的一個選項。
// 使用者明確要求「顯示附近獨特的旅遊項目,像是古蹟、美食、展館、戶外活動,
// 讓使用者選決定方向」。這裡只給粗分類的方向,不是列出實際景點(實際景點
// 由後續 AI 規劃對話去查);promptText 是接在「我想去○○玩」後面的偏好句,
// 「都可以」(不限定方向)不是這份清單的成員,由 DestinationPrompt 另外放一顆
// 按鈕、以空陣列表示。
export interface DestinationDirection {
  id: string
  label: string
  promptText: string
  // photo——這個方向的代表照片(使用者明確要求「每一種類型都要放該類型的熱門
  // 相片」)。目前是固定的內建代表圖、所有城市共用同一組(使用者選擇「固定圖,
  // 日後再升級」:零 API 成本、不會載入失敗;日後若要改成依所選城市即時查詢
  // 該類型的熱門地點照片,只需把這個欄位換成動態來源,版面不必重做)。
  photo?: string
}

export const DESTINATION_DIRECTIONS: DestinationDirection[] = [
  { id: 'heritage', label: '古蹟', promptText: '想多看古蹟、歷史建築', photo: heritagePhoto },
  { id: 'food', label: '美食', promptText: '想多吃在地美食', photo: foodPhoto },
  { id: 'exhibition', label: '展館', promptText: '想逛特色展館、博物館', photo: exhibitionPhoto },
  { id: 'outdoor', label: '戶外活動', promptText: '想安排戶外活動', photo: outdoorPhoto },
]
