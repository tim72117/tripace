import { describe, it, expect } from 'vitest'
import {
  initialAttractionZoomState,
  reduceAttractionZoomState,
  type AttractionZoomState,
} from './geoAttractionZoomState'

// 逐一套用一串事件到初始狀態,回傳每一步驟後的狀態快照——理由同
// geoAreaSearchState.test.ts 的 run(),斷言整條「動作順序」而非只看
// 最終結果。
function run(events: Parameters<typeof reduceAttractionZoomState>[1][]): AttractionZoomState[] {
  const snapshots: AttractionZoomState[] = []
  let state = initialAttractionZoomState
  for (const event of events) {
    state = reduceAttractionZoomState(state, event)
    snapshots.push(state)
  }
  return snapshots
}

describe('reduceAttractionZoomState', () => {
  it('初始狀態:沒有任何景點區域處於縮小狀態', () => {
    expect(initialAttractionZoomState).toBeNull()
  })

  it('點擊帶 radiusMeters 的景點區域(fit-bounds)→ 該景點區域的 key 進入縮小狀態', () => {
    const [afterClick] = run([
      { type: 'attraction-clicked', key: 'attraction:古城區:18.7:98.9', planKind: 'fit-bounds' },
    ])
    expect(afterClick).toBe('attraction:古城區:18.7:98.9')
  })

  it('點擊沒有 radiusMeters 的單點地標(pan-and-zoom)→ 不進入縮小狀態', () => {
    const [afterClick] = run([
      { type: 'attraction-clicked', key: 'attraction:101:25.03:121.56', planKind: 'pan-and-zoom' },
    ])
    expect(afterClick).toBeNull()
  })

  it('先點一個 fit-bounds 景點區域、再點另一個 pan-and-zoom 單點地標:縮小狀態應該清空,不殘留上一個的縮小效果', () => {
    const [, afterSecondClick] = run([
      { type: 'attraction-clicked', key: 'attraction:古城區:18.7:98.9', planKind: 'fit-bounds' },
      { type: 'attraction-clicked', key: 'attraction:101:25.03:121.56', planKind: 'pan-and-zoom' },
    ])
    expect(afterSecondClick).toBeNull()
  })

  it('連續點擊兩個都是 fit-bounds 的景點區域:縮小狀態應該切換成最新那一個,不是同時兩個都縮小', () => {
    const [afterFirst, afterSecond] = run([
      { type: 'attraction-clicked', key: 'attraction:古城區:18.7:98.9', planKind: 'fit-bounds' },
      { type: 'attraction-clicked', key: 'attraction:尼曼區:18.8:98.9', planKind: 'fit-bounds' },
    ])
    expect(afterFirst).toBe('attraction:古城區:18.7:98.9')
    expect(afterSecond).toBe('attraction:尼曼區:18.8:98.9')
  })

  it('關閉 AttractionInfoPanel(panel-closed)→ 無條件清空縮小狀態', () => {
    const [, afterClose] = run([
      { type: 'attraction-clicked', key: 'attraction:古城區:18.7:98.9', planKind: 'fit-bounds' },
      { type: 'panel-closed' },
    ])
    expect(afterClose).toBeNull()
  })

  it('還沒點過任何景點區域就先收到 panel-closed:維持初始狀態(null),不出錯', () => {
    const [afterClose] = run([{ type: 'panel-closed' }])
    expect(afterClose).toBeNull()
  })

  it('完整順序:點 A(fit-bounds)→ 關閉面板 → 再點 A(fit-bounds)一次:第二次點擊應該重新進入縮小狀態,不會因為是「同一個」而被跳過', () => {
    const [afterFirstClick, afterClose, afterReclick] = run([
      { type: 'attraction-clicked', key: 'attraction:古城區:18.7:98.9', planKind: 'fit-bounds' },
      { type: 'panel-closed' },
      { type: 'attraction-clicked', key: 'attraction:古城區:18.7:98.9', planKind: 'fit-bounds' },
    ])
    expect(afterFirstClick).toBe('attraction:古城區:18.7:98.9')
    expect(afterClose).toBeNull()
    expect(afterReclick).toBe('attraction:古城區:18.7:98.9')
  })
})
