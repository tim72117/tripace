// spotItinerary.ts——紅葉景點對應的精選行程:延遲載入與連結。
//
// 行程資料沿用 itineraries/example/<id>.ts(registry.ts 用 eager glob 收全部,
// 這裡改用「非 eager」glob):只有使用者點開某個景點時才載入那一份檔案,紅葉頁
// 本身不會因此變大。檔名即行程 id 的約定與 registry.ts 一致。
//
// 這裡讀的是專案內的靜態行程檔;精選行程頁 /itineraries/<id> 本身是「API 優先、
// 靜態退回」,資料庫裡的版本可能比這份新,摘要卡片可能跟完整頁的細節略有出入
// (卡片只用標題、地區、天數、站數與簡介)。

import { isSampleItineraryShape } from '../itineraries/catalog'
import type { SampleItinerary } from '../itineraries/types'

const loaders = import.meta.glob<{ default: unknown }>('../itineraries/example/*.ts')

export function itineraryPath(id: string): string {
  return `/itineraries/${id}`
}

// loadSpotItinerary——載入行程;找不到檔案、格式不對、或檔案裡的 id 與檔名不符都回 null。
export async function loadSpotItinerary(id: string): Promise<SampleItinerary | null> {
  const key = Object.keys(loaders).find((k) => k.endsWith(`/${id}.ts`))
  if (!key) return null
  const mod = await loaders[key]()
  const data = mod.default
  return isSampleItineraryShape(data) && data.id === id ? data : null
}
