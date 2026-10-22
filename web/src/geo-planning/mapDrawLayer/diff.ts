import type { Drawable } from './types'

// diff——宿主比對「地圖上現在畫著的」與「這次要畫的」,算出要新增、更新、移除哪些。純函式。
//
// 比對只看「資料」,不看函式(createContent、onClick):呼叫端每次渲染都會產生新的函式,拿它們
// 比對會讓每次渲染都觸發更新。內容是否要重做由 contentKey 決定,點擊永遠呼叫最新的 onClick。
//
// 兩種簽章:
//   - structure:建立後無法原地改的部分(種類、marker 是否可點——gmpClickable 只能在建立時決定)。
//     改變就必須移除重建。
//   - data:可以原地更新的部分(位置、標題、內容 key、群組、半徑、路徑、樣式)。改變就 update。
export type Signature = { structure: string; data: string }
export type Entry = Signature & { kind: Drawable['kind'] }

export function signatureOf(d: Drawable): Signature {
  switch (d.kind) {
    case 'marker':
      return {
        structure: `marker|clickable:${d.clickable ? 1 : 0}`,
        data: JSON.stringify([d.group, d.position, d.title ?? null, d.contentKey]),
      }
    case 'circle':
      return { structure: 'circle', data: JSON.stringify([d.group, d.center, d.radiusMeters, d.options ?? null]) }
    case 'polyline':
      return { structure: 'polyline', data: JSON.stringify([d.group, d.path, d.options ?? null]) }
    case 'overlay':
      return { structure: 'overlay', data: JSON.stringify([d.group, d.stateKey]) }
  }
}

export type DiffResult = { add: Drawable[]; update: Drawable[]; remove: string[] }

// 同一份清單裡 id 重複時以後面的為準。結構改變的項目同時出現在 remove 與 add。
export function diffDrawables(prev: Map<string, Entry>, next: Drawable[]): DiffResult {
  const nextById = new Map<string, Drawable>()
  for (const d of next) nextById.set(d.id, d)

  const add: Drawable[] = []
  const update: Drawable[] = []
  const remove: string[] = []

  for (const id of prev.keys()) {
    if (!nextById.has(id)) remove.push(id)
  }
  for (const [id, d] of nextById) {
    const before = prev.get(id)
    if (!before) {
      add.push(d)
      continue
    }
    const sig = signatureOf(d)
    if (before.structure !== sig.structure) {
      remove.push(id)
      add.push(d)
    } else if (before.data !== sig.data) {
      update.push(d)
    }
  }
  return { add, update, remove }
}
