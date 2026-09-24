import { describe, it, expect } from 'vitest'
import {
  createEmptyTimeline,
  insertAfter,
  removeNode,
  toRenderList,
  updateNode,
  type PlanTimeline,
} from './planTimeline'

// stop — 組一筆 stop 型 PlanNodeData 的簡寫,測試裡大量重複用到,只帶
// 測試實際關心的 name/time 欄位,其餘欄位留空(型別上都是 optional)。
function stop(name: string, time?: string) {
  return { type: 'stop' as const, name, time }
}

describe('insertAfter', () => {
  it('空的時間軸插入第一筆(anchorId 為 null),成為 head', () => {
    const empty = createEmptyTimeline()
    const result = insertAfter(empty, null, stop('赤崁樓', '08:30'), 'n1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timeline.headId).toBe('n1')
    expect(toRenderList(result.timeline).map((n) => n.name)).toEqual(['赤崁樓'])
  })

  it('anchorId 為 null 插在既有時間軸最前面,原本的 head 被推到後面', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓', '10:00'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const t2 = insertAfter(t1.timeline, null, stop('祀典武廟', '08:00'), 'n2')
    expect(t2.ok).toBe(true)
    if (!t2.ok) return
    expect(t2.timeline.headId).toBe('n2')
    expect(toRenderList(t2.timeline).map((n) => n.name)).toEqual(['祀典武廟', '赤崁樓'])
  })

  it('依序插入三筆(皆 append 在前一筆之後),鏈結順序與 toRenderList 一致', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:30'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '09:30'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'n2', stop('大天后宮', '10:30'), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟', '大天后宮'])

    // 鏈結本身的 prevId/nextId 也要正確,不是只有 toRenderList 的結果
    // 剛好對——這裡直接檢查每個節點的指標,確保雙向鏈結完整。
    const n1 = timeline.nodes.get('n1')!
    const n2 = timeline.nodes.get('n2')!
    const n3 = timeline.nodes.get('n3')!
    expect(n1).toMatchObject({ prevId: null, nextId: 'n2' })
    expect(n2).toMatchObject({ prevId: 'n1', nextId: 'n3' })
    expect(n3).toMatchObject({ prevId: 'n2', nextId: null })
  })

  it('插入在中間(anchor 不是最後一筆),前後節點的指標都正確更新', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('大天后宮', '12:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    // 在 n1、n2 之間插入 n3(09:00,落在 08:00~12:00 之間,合法)
    const r3 = insertAfter(timeline, 'n1', stop('祀典武廟', '09:00'), 'n3')
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    timeline = r3.timeline

    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟', '大天后宮'])
    expect(timeline.nodes.get('n1')).toMatchObject({ prevId: null, nextId: 'n3' })
    expect(timeline.nodes.get('n3')).toMatchObject({ prevId: 'n1', nextId: 'n2' })
    expect(timeline.nodes.get('n2')).toMatchObject({ prevId: 'n3', nextId: null })
  })

  it('anchorId 找不到對應節點時回傳 anchor_not_found 錯誤,時間軸不變', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓', '08:30'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const result = insertAfter(t1.timeline, 'not-exist', stop('祀典武廟', '09:00'), 'n2')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('anchor_not_found')
  })

  // 2026-09 真實踩坑記錄:LLM 曾經連續把 search_attraction 回傳的
  // attractionId(例如 "lmk_..." 這種景點候選 id)誤當成 anchorId 傳給
  // add_attraction,原本的錯誤訊息只說「找不到這個 id」,沒有指出這是
  // 「傳錯種類的 id」,導致 LLM 重試時又犯了同樣的錯——這個測試驗證
  // 修正後的訊息會列出目前時間軸上實際可用的節點 id,並明確說明
  // anchorId 不能是 attractionId,讓呼叫端能分辨出問題所在。
  it('anchorId 找不到對應節點時,錯誤訊息列出目前可用的節點 id 並提示 anchorId 與 attractionId 的差異', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓', '08:30'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const result = insertAfter(t1.timeline, 'lmk_c78a4800ebd2', stop('祀典武廟', '09:00'), 'n2')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('"n1"')
    expect(result.error.message).toContain('赤崁樓')
    expect(result.error.message).toContain('attractionId')
  })

  it('anchorId 找不到對應節點、且時間軸目前是空的,錯誤訊息提示可以省略 anchorId', () => {
    const result = insertAfter(createEmptyTimeline(), 'lmk_c78a4800ebd2', stop('赤崁樓', '08:30'), 'n1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('是空的')
  })

  it('time 格式不合法(非 "HH:MM")時回傳 invalid_time_format 錯誤', () => {
    const result = insertAfter(createEmptyTimeline(), null, stop('赤崁樓', '9:30am'), 'n1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_time_format')
  })

  it('新節點時間早於錨點前一站,回傳 time_out_of_range 錯誤', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '10:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('大天后宮', '12:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    // 想插在 n1(10:00)之後,但新節點時間 09:00 比 n1 還早——超出範圍。
    const result = insertAfter(timeline, 'n1', stop('祀典武廟', '09:00'), 'n3')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('time_out_of_range')
    // 驗證失敗不應該真的插入,鏈結維持插入前的樣子。
    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['赤崁樓', '大天后宮'])
    // 訊息要帶明確的指引跟必要資訊(使用者明確要求):具體的邊界時間值、
    // 對應節點的 id/名稱,不能只說「太早」——這樣呼叫端(LLM)才能不用
    // 猜測就直接算出下一次該用的時間或錨點。
    expect(result.error.message).toContain('n1')
    expect(result.error.message).toContain('10:00')
    expect(result.error.message).toContain('赤崁樓')
  })

  it('新節點時間晚於錨點後一站,回傳 time_out_of_range 錯誤,訊息帶具體邊界值', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('大天后宮', '10:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    // 想插在 n1、n2 之間,但新節點時間 11:00 比 n2(10:00)還晚——超出範圍。
    const result = insertAfter(timeline, 'n1', stop('祀典武廟', '11:00'), 'n3')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('time_out_of_range')
    expect(result.error.message).toContain('n2')
    expect(result.error.message).toContain('10:00')
    expect(result.error.message).toContain('大天后宮')
  })

  it('anchorId 為 null、時間晚於既有第一站時,訊息明確指出該改用哪個 anchorId(重現真實 log 踩過的失敗模式)', () => {
    // 重現 docs 提到的真實案例:LLM 想把「安平天后宮」接在「安平樹屋」
    // (11:30)之後,卻沒有帶 anchorId(誤以為省略代表「接在最後面」,
    // 實際語意是「插在最前面」),導致連續多次嘗試不同時間都失敗在
    // 同一個原因——訊息應該直接點出「anchorId 是 null」這個根因、並
    // 給出該用哪個 id 當錨點,而不是只描述「時間太晚」讓呼叫端盲目重試。
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('安平樹屋', '11:30'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline

    const result = insertAfter(timeline, null, stop('安平天后宮', '13:00'), 'n2')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('time_out_of_range')
    expect(result.error.message).toContain('anchorId')
    expect(result.error.message).toContain('null')
    expect(result.error.message).toContain('n1')
    expect(result.error.message).toContain('安平樹屋')
  })

  it('剛好等於邊界時間視為合法(含頭尾)', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('大天后宮', '10:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    const result = insertAfter(timeline, 'n1', stop('祀典武廟', '08:00'), 'n3')
    expect(result.ok).toBe(true)
  })

  it('插入沒有 time 的 stop 不做時間範圍驗證(還沒決定幾點,允許插在任何位置)', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('大天后宮', '10:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    const result = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n3')
    expect(result.ok).toBe(true)
  })

  it('錨點是 section(沒有時間)時,時間驗證改往前後找最近的 stop', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', { type: 'section' as const, label: '午餐' }, 'sec1')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'sec1', stop('大天后宮', '12:00'), 'n2')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    // 插在 section(sec1)後面,時間必須落在 n1(08:00)與 n2(12:00)之間——
    // 09:00 合法。
    const okResult = insertAfter(timeline, 'sec1', stop('祀典武廟', '09:00'), 'n3')
    expect(okResult.ok).toBe(true)

    // 13:00 超出 n2(12:00)的上界,即使緊鄰的 anchor 本身沒有時間。
    const failResult = insertAfter(timeline, 'sec1', stop('阿堂鹹粥', '13:00'), 'n4')
    expect(failResult.ok).toBe(false)
    if (failResult.ok) return
    expect(failResult.error.code).toBe('time_out_of_range')
  })

  it('插入到中間時,原本緊接在插入點後面的站點 transitFromPrev 被清空(它的前一站變了)', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('大天后宮'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    // n2(大天后宮)手動掛一筆 transitFromPrev,模擬它跟 n1(赤崁樓)之間
    // 已經查過交通資訊。
    timeline = {
      ...timeline,
      nodes: new Map(timeline.nodes).set('n2', {
        ...timeline.nodes.get('n2')!,
        transitFromPrev: { icon: '🚶', mode: '步行', minutes: 5, distance: '300m' },
      }),
    }

    const r3 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n3')
    if (!r3.ok) throw new Error('setup failed')

    // n2 現在的前一站變成 n3(祀典武廟),原本記錄的「跟赤崁樓之間」的
    // 交通資訊不再對應正確的兩站,必須被清空。
    expect(r3.timeline.nodes.get('n2')).toMatchObject({ prevId: 'n3', transitFromPrev: undefined })
  })
})

describe('removeNode', () => {
  it('移除中間節點後,前後節點直接銜接', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'n2', stop('大天后宮'), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    timeline = removeNode(timeline, 'n2')
    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['赤崁樓', '大天后宮'])
    expect(timeline.nodes.get('n1')).toMatchObject({ nextId: 'n3' })
    expect(timeline.nodes.get('n3')).toMatchObject({ prevId: 'n1' })
    expect(timeline.nodes.has('n2')).toBe(false)
  })

  it('移除 head 節點後,headId 正確轉移到下一個節點', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    timeline = removeNode(timeline, 'n1')
    expect(timeline.headId).toBe('n2')
    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['祀典武廟'])
  })

  it('移除不存在的 id 時原樣返回', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const result = removeNode(t1.timeline, 'not-exist')
    expect(toRenderList(result).map((n) => n.name)).toEqual(['赤崁樓'])
  })

  it('移除中間站點後,新的下一站 transitFromPrev 被清空(舊資料不再對應正確的兩站)', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'n2', stop('大天后宮'), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline
    // n3(大天后宮)手動掛一筆 transitFromPrev,模擬它跟 n2(祀典武廟)
    // 之間已經查過交通資訊。
    timeline = {
      ...timeline,
      nodes: new Map(timeline.nodes).set('n3', {
        ...timeline.nodes.get('n3')!,
        transitFromPrev: { icon: '🚶', mode: '步行', minutes: 5, distance: '300m' },
      }),
    }

    timeline = removeNode(timeline, 'n2')
    // n3 現在的前一站變成 n1(赤崁樓),原本記錄的「跟祀典武廟之間」的
    // 交通資訊不再對應正確的兩站,必須被清空。
    expect(timeline.nodes.get('n3')).toMatchObject({ prevId: 'n1', transitFromPrev: undefined })
  })
})

describe('updateNode', () => {
  it('合併更新指定欄位,不影響鏈結位置', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '09:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    timeline = updateNode(timeline, 'n1', { desc: '荷蘭時期普羅民遮城遺址' })
    expect(timeline.nodes.get('n1')).toMatchObject({ name: '赤崁樓', desc: '荷蘭時期普羅民遮城遺址', nextId: 'n2' })
    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟'])
  })
})

describe('toRenderList', () => {
  it('空時間軸回傳空陣列', () => {
    expect(toRenderList(createEmptyTimeline())).toEqual([])
  })
})
