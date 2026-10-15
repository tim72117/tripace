// reducer.ts——mapMarkerLayer 的純函式判斷邏輯。2026-10 改版(見 types.ts
// 開頭的完整說明:從內部 useReducer 自主管理,改成完全受控)之後,這裡
// 不再是真正的 React reducer(沒有 action/dispatch 這回事了),只保留
// applyExpandedTheme 這個純函式——「選中的點是哪個,該展開哪個主題點」
// 這個判斷邏輯仍然值得抽出來獨立測試,不需要因為拿掉 dispatch 機制就把
// 它塞進 index.ts 內聯寫。

import type { MapMarkerPoint } from './types'

/** findPoint——在扁平 points 陣列裡依 id 找點。子景點(themeChild)本身
 *  不會獨立出現在這份陣列裡,而是巢狀在父主題點的 children 底下,所以
 *  若直接查無,再往每個 theme 點的 children 裡找一次——這是 2026-10
 *  修正:選中的 id 剛好是某個已展開子景點時,若只查 points 本身,一律
 *  查無此點,會被誤判成「選到不是主題點的一般點」而把 expandedThemeId
 *  收合,導致範圍圓圈/子景點小點選到一半自己消失,也讓 index.ts 的
 *  panTo effect 原本想處理「子景點 id」那段路徑永遠到不了
 *  (expandedThemePoint 一律是 undefined)。 */
function findPoint(points: MapMarkerPoint[], id: string): MapMarkerPoint | undefined {
  const direct = points.find((p) => p.id === id)
  if (direct) return direct
  for (const p of points) {
    if (p.kind === 'theme' && p.children?.some((c) => c.id === id)) return p
  }
  return undefined
}

/** resolveExpandedThemeId——目前選取的 id 之下,該展開哪個主題點(回傳
 *  null 代表不展開任何主題點)。
 *
 *  選中的點本身是 kind:'theme' 且 children 非空時展開(回傳該點 id);
 *  選中的點是某個主題點的子景點時,一併展開該父主題點(見 findPoint 的
 *  完整說明——否則子景點被選中時反而看不到自己所屬的範圍圓圈);選中
 *  其他任何點、或 id 是 null、或查無此點時收合(回傳 null)——對齊原本
 *  AIPlanTimelinePage.tsx expandedThemeId effect「選到其他站點或清空
 *  選取時收合」的既有行為。
 *
 *  2026-10 改版:這是純函式,直接依賴 selectedId+points 當下的值算出
 *  結果,不是 state——每次 render 用 useMemo 重算即可,不需要像舊版
 *  那樣額外處理「children 非同步晚到、selectedId 沒變但該不該重新展開」
 *  這類 state 同步時機問題,因為根本沒有需要同步的 state。 */
export function resolveExpandedThemeId(selectedId: string | null, points: MapMarkerPoint[]): string | null {
  if (selectedId == null) return null
  const point = findPoint(points, selectedId)
  if (!point) return null
  if (point.kind !== 'theme') return null
  if (!point.children || point.children.length === 0) return null
  return point.id
}
