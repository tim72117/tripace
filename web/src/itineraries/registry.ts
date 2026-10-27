// registry.ts — 把 example/ 底下每個檔案的 default export 收成一份清單。
//
// 用 import.meta.glob(eager)自動收錄(含子目錄,例如紅葉主題放在 example/momiji/):新增一份範例行程 = 在 example/ 加一個
// .ts 檔(default export 一個 SampleItinerary),不需要回來改這支檔案。這是
// 「範例行程未來會持續增加」的核心設計。2026-10 這個子目錄從 itineraries/
// 改名成 example/(使用者明確要求「web/src/itineraries/itineraries 換成
// example」)——避免外層目錄(web/src/itineraries/,2026-10 從 ai-itineraries/
// 改名而來,見 AiItinerariesRoute.tsx 的完整說明)跟這個內層資料目錄疊字
// 同名造成混淆。
//
// 檔案必須 default export 一個 SampleItinerary;沒有 default export 的檔案會被
// 略過(例如放在資料夾裡的輔助檔),但資料格式是否正確由 itineraries.test.ts 檢查。
import type { SampleItinerary } from './types'
import { sortByNewest } from './catalog'

const modules = import.meta.glob<{ default?: SampleItinerary }>('./example/**/*.ts', { eager: true })

export const SAMPLE_ITINERARIES: SampleItinerary[] = sortByNewest(
  Object.values(modules)
    .map((m) => m.default)
    .filter((it): it is SampleItinerary => !!it),
)
