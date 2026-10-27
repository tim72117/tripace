// spotList.ts——右側景點清單的資料整理(純函式)。
//
// 有精選行程的景點(itineraryId)排在最前面,讓「查看行程」連結一進頁面就看得到;
// 其餘維持資料檔(momijiSpots.ts)的由北到南順序。穩定排序,不改動原陣列。

import type { MomijiSpot } from './momijiSpots'
import { itineraryPath } from './spotItinerary'

export interface SpotListEntry {
  id: string
  name: string
  area: string
  kind: string
  // href——有精選行程時是完整行程頁路徑(/itineraries/<id>),沒有行程則 null。
  href: string | null
}

export function spotListEntries(spots: ReadonlyArray<MomijiSpot>): SpotListEntry[] {
  const entries = spots.map((sp) => ({
    id: sp.id,
    name: sp.name,
    area: sp.area,
    kind: sp.kind,
    href: sp.itineraryId ? itineraryPath(sp.itineraryId) : null,
  }))
  return [...entries.filter((e) => e.href !== null), ...entries.filter((e) => e.href === null)]
}
