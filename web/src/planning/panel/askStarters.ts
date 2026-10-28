import type { AskPageCandidate } from '../conversation/asktools'
import type { StartAskInput } from './useAskPageFlow'

// askStarters——TripPlanPage 開「選擇景點 / 更換地點」詢問頁用的純函式(從元件抽出來,元件本身依賴 google.maps、無法直接測)。

export const REPLACE_ASK_REASON = '選擇要換成的地點'
export const PICK_ASK_REASON = '選擇感興趣的景點'

interface PositionedNode {
  type?: string
  lat?: number
  lng?: number
  name?: string
  placeId?: string
}

// pickBaseStop——「選擇景點」要以哪一站為中心:目前選中的那一站優先,沒有選中(或選到的不是站點)就用最後一站;行程沒有站點回 undefined。
export function pickBaseStop<T extends PositionedNode>(nodes: T[], selected: T | undefined): T | undefined {
  if (selected && selected.type === 'stop') return selected
  const stops = nodes.filter((n) => n.type === 'stop')
  return stops[stops.length - 1]
}

// candidatesFromAttractions——附近景點查詢結果轉成詢問頁候選:只留有 placeId 的,可排除指定地點(換地點時排除被換的那一站)。
export function candidatesFromAttractions(
  attractions: { placeId?: string; name: string; summary?: string; lat: number; lng: number }[],
  excludePlaceId?: string,
): AskPageCandidate[] {
  return attractions
    .filter((a) => !!a.placeId && a.placeId !== excludePlaceId)
    .map((a) => ({ placeId: a.placeId!, name: a.name, summary: a.summary, lat: a.lat, lng: a.lng }))
}

// nearbyAskInput——以某一站為中心的詢問頁輸入:有座標用 search(由前端查附近觀光地點,選完拿得到名稱);沒座標但有名稱退回
// 探查模式用站名;兩者都沒有回 null(呼叫端自行決定退路,例如改開國家選單)。
export function nearbyAskInput(opts: {
  node: PositionedNode
  reason: string
  search: (lat: number, lng: number) => Promise<AskPageCandidate[]>
}): StartAskInput | null {
  const { node, reason, search } = opts
  if (node.lat != null && node.lng != null) {
    const { lat, lng } = node
    return { reason, search: () => search(lat, lng) }
  }
  if (node.name) return { explore: { destination: node.name }, reason }
  return null
}

// shouldConfirmFromComposer——輸入框按送出時,是否視為「確認詢問頁的勾選」:一般路由會忽略(輸入框空白),
// 但詢問頁開著且已有勾選時,空白送出就是確認。有打字時照原本走(用文字回答詢問頁)。
export function shouldConfirmFromComposer(opts: { route: 'askPage' | 'prompt' | 'ignore'; text: string; showAskPage: boolean; selectionCount: number }): boolean {
  return opts.route === 'ignore' && !opts.text.trim() && opts.showAskPage && opts.selectionCount > 0
}
