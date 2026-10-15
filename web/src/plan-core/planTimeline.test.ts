import { describe, it, expect } from 'vitest'
import {
  createEmptyTimeline,
  getTimeDragBounds,
  insertAfter,
  minutesToTime,
  removeDay,
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

// stopOnDay — 同上,額外帶 day 欄位,供「多天行程」測試使用(見
// PlanNodeData.day 的完整說明)。
function stopOnDay(name: string, time: string, day: number) {
  return { type: 'stop' as const, name, time, day }
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

  describe('day(多天行程)', () => {
    it('day 不同時,新節點的時間可以早於前一站(不比較跨天的時間先後)', () => {
      let timeline: PlanTimeline = createEmptyTimeline()
      // day 1 最後一站到 23:00。
      const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '08:00', 1), 'n1')
      if (!r1.ok) throw new Error('setup failed')
      timeline = r1.timeline
      const r2 = insertAfter(timeline, 'n1', stopOnDay('晚餐', '23:00', 1), 'n2')
      if (!r2.ok) throw new Error('setup failed')
      timeline = r2.timeline

      // day 2 第一站是 09:00,遠早於 n2 的 23:00——若跨天也比較時間會
      // 被判定 time_out_of_range,但 day 不同時不該比較,預期成功。
      const result = insertAfter(timeline, 'n2', stopOnDay('孔廟', '09:00', 2), 'n3')
      expect(result.ok).toBe(true)
    })

    it('省略 day 的節點視為第 1 天,跟明確傳 day: 1 行為一致', () => {
      let timeline: PlanTimeline = createEmptyTimeline()
      const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
      if (!r1.ok) throw new Error('setup failed')
      timeline = r1.timeline

      // 省略 day 的新節點(視為 day 1)時間早於 n1,仍然要走同一天的
      // 時間驗證,回傳 time_out_of_range。
      const result = insertAfter(timeline, 'n1', stop('大天后宮', '07:00'), 'n2')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('time_out_of_range')
    })

    it('同一天內時間驗證依然生效,不因為加了 day 欄位就整體失效', () => {
      let timeline: PlanTimeline = createEmptyTimeline()
      const r1 = insertAfter(timeline, null, stopOnDay('孔廟', '09:00', 2), 'n1')
      if (!r1.ok) throw new Error('setup failed')
      timeline = r1.timeline
      const r2 = insertAfter(timeline, 'n1', stopOnDay('孔廟商圈', '10:00', 2), 'n2')
      if (!r2.ok) throw new Error('setup failed')
      timeline = r2.timeline

      // 同樣是 day 2,08:00 早於 n1(09:00),應該失敗。
      const result = insertAfter(timeline, 'n1', stopOnDay('台灣文學館', '08:00', 2), 'n3')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('time_out_of_range')
    })
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

    const removed = removeNode(timeline, 'n2')
    if (!removed.ok) throw new Error('remove failed')
    timeline = removed.timeline
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

    const removed = removeNode(timeline, 'n1')
    if (!removed.ok) throw new Error('remove failed')
    timeline = removed.timeline
    expect(timeline.headId).toBe('n2')
    expect(toRenderList(timeline).map((n) => n.name)).toEqual(['祀典武廟'])
  })

  it('移除不存在的 id 時回傳 anchor_not_found 結構化錯誤', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const result = removeNode(t1.timeline, 'not-exist')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('anchor_not_found')
  })

  it('移除已標記 removing:true 的節點時回傳 already_removing 結構化錯誤', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    timeline = updateNode(timeline, 'n1', { removing: true })

    const result = removeNode(timeline, 'n1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('already_removing')
    // 原本的節點仍在(真正摘除延遲到動畫播完,這裡只驗證沒有被誤摘除)。
    expect(timeline.nodes.has('n1')).toBe(true)
  })

  it('opts.allowRemoving:true 時,已標記 removing:true 的節點仍能被真正摘除', () => {
    // 這是 removeStep(TripPlanPage.tsx/AIPlanTimelinePage.tsx 都有同一套
    // 兩段式流程,見這兩處呼叫端的完整說明)「完成移除」那一步的真實使用
    // 情境:先標記 removing:true 觸發淡出動畫,動畫播完後用
    // allowRemoving:true 呼叫 removeNode 做真正的摘除——這個旗標曾經
    // 漏掉,導致 already_removing 檢查誤判這次合法呼叫,節點永遠卡在
    // removing:true 不會真的消失(實際發生過的 regression,見
    // RemoveNodeResult/removeNode opts.allowRemoving 的完整說明)。
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    timeline = updateNode(timeline, 'n1', { removing: true })

    const result = removeNode(timeline, 'n1', { allowRemoving: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timeline.nodes.has('n1')).toBe(false)
    expect(result.timeline.headId).toBe('n2')
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

    const removed = removeNode(timeline, 'n2')
    if (!removed.ok) throw new Error('remove failed')
    timeline = removed.timeline
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

  it('day 不同的相鄰 stop 之間自動插入跨天分隔線(不需要呼叫端手動送 section)', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '08:00', 1), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stopOnDay('孔廟', '09:00', 2), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    const rendered = toRenderList(timeline)
    expect(rendered.map((n) => ({ type: n.type, id: n.id, name: n.name }))).toEqual([
      { type: 'stop', id: 'n1', name: '赤崁樓' },
      { type: 'section', id: 'day-divider-2', name: undefined },
      { type: 'stop', id: 'n2', name: '孔廟' },
    ])
  })

  it('同一天內(day 相同或都省略)不插入任何分隔線', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '09:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    expect(toRenderList(timeline).map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('連續三天的行程,依序插入 Day 2/Day 3 兩條分隔線', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '08:00', 1), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stopOnDay('孔廟', '09:00', 2), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'n2', stopOnDay('安平古堡', '09:00', 3), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    const rendered = toRenderList(timeline)
    expect(rendered.map((n) => n.id)).toEqual(['n1', 'day-divider-2', 'n2', 'day-divider-3', 'n3'])
  })

  it('day 非遞增(接在較後一天的站之後)也要插入分隔線,不能被靜默併入前一段', () => {
    // 這是實際修過的 bug 的回歸測試:toRenderList 原本只在
    // nodeDay > currentDay 時插入分隔線,day 變小(非遞增)的情況完全
    // 不會插入、currentDay 也不會回退,該站會被誤渲染成前一天的一部分。
    // insertAfter 本身不驗證跨天的先後順序(day 不同時直接跳過時間比較,
    // 見 nearestStopNode 的完整說明),所以這種非遞增鏈結是合法可達的
    // 狀態,不是只存在於理論上。
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '08:00', 1), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stopOnDay('孔廟', '09:00', 2), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    // 刻意接在 day 2 的 n2 之後,卻插入一筆 day 1 的站。
    const r3 = insertAfter(timeline, 'n2', stopOnDay('武廟愛玉', '10:00', 1), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    const rendered = toRenderList(timeline)
    expect(rendered.map((n) => n.id)).toEqual(['n1', 'day-divider-2', 'n2', 'day-divider-1', 'n3'])
  })
})

describe('minutesToTime', () => {
  it('把當日分鐘數轉回 "HH:MM" 字串,固定兩位數補零', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(9 * 60 + 5)).toBe('09:05')
    expect(minutesToTime(23 * 60 + 59)).toBe('23:59')
  })
})

describe('getTimeDragBounds', () => {
  // 這組測試對應使用者明確要求的「時間軸的小圓點可以拖拉,上下拉動時
  // 調整時間」功能——getTimeDragBounds 算出的範圍是 PlanTimelineView.tsx
  // 拖拉手勢即時 clamp 用的依據,範圍算錯會讓使用者能拖出跟 insertAfter
  // 驗證邏輯矛盾的時間(例如拖出比前一站還早的時間卻沒被擋下)。
  it('中間節點:下界是前一站時間,上界是後一站時間', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '09:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '10:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'n2', stop('大天后宮', '11:00'), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    const bounds = getTimeDragBounds(timeline, 'n2')
    expect(bounds).toEqual({ minMinutes: 9 * 60, maxMinutes: 11 * 60 })
  })

  it('第一個節點:下界不限(null),上界是下一站時間', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '09:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '10:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    const bounds = getTimeDragBounds(timeline, 'n1')
    expect(bounds).toEqual({ minMinutes: null, maxMinutes: 10 * 60 })
  })

  it('最後一個節點:上界不限(null),下界是前一站時間', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '09:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '10:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    const bounds = getTimeDragBounds(timeline, 'n2')
    expect(bounds).toEqual({ minMinutes: 9 * 60, maxMinutes: null })
  })

  it('唯一節點:上下界都不限', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '09:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline

    const bounds = getTimeDragBounds(timeline, 'n1')
    expect(bounds).toEqual({ minMinutes: null, maxMinutes: null })
  })

  it('跨天:只在同一天的範圍內找邊界,不同天的前後站不當作限制', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '20:00', 1), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stopOnDay('祀典武廟', '09:00', 2), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    // n2 是第 2 天唯一的站,即使 n1(第 1 天 20:00)在鏈結上緊接在它
    // 前面,也不該被當成下界(不同天不比較時間先後)。
    const bounds = getTimeDragBounds(timeline, 'n2')
    expect(bounds).toEqual({ minMinutes: null, maxMinutes: null })
  })

  it('找不到對應 id 或節點不是 stop 時,回傳上下界都不限的保守預設值', () => {
    const timeline = createEmptyTimeline()
    expect(getTimeDragBounds(timeline, 'not-exist')).toEqual({ minMinutes: null, maxMinutes: null })
  })
})

describe('removeDay', () => {
  // build — 依序插入給定節點,回傳時間軸與每筆的 id。removeDay 的
  // 測試幾乎都要先組一份多天的時間軸,這裡抽成共用。
  function build(
    items: Array<{
      data:
        | ReturnType<typeof stopOnDay>
        | ReturnType<typeof stop>
        | { type: 'message'; text: string }
      id: string
    }>,
  ) {
    let timeline: PlanTimeline = createEmptyTimeline()
    let anchor: string | null = null
    for (const item of items) {
      const result = insertAfter(timeline, anchor, item.data, item.id)
      if (!result.ok) throw new Error(`插入 ${item.id} 失敗: ${result.error.message}`)
      timeline = result.timeline
      anchor = item.id
    }
    return timeline
  }

  // ids — 把時間軸依鏈結順序走訪成 id 陣列,驗證「剩下哪些、順序對不對」。
  // 不用 toRenderList——那會插入衍生的 Day 分隔線,不是真實節點。
  function ids(timeline: PlanTimeline): string[] {
    const out: string[] = []
    let cursor = timeline.headId
    const seen = new Set<string>()
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error('鏈結成環')
      seen.add(cursor)
      out.push(cursor)
      cursor = timeline.nodes.get(cursor)?.nextId ?? null
    }
    return out
  }

  it('移除中間那一天,前後兩天接起來', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('午餐', '11:30', 1), id: 'd1b' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
      { data: stopOnDay('文學館', '11:20', 2), id: 'd2b' },
      { data: stopOnDay('安平古堡', '09:30', 3), id: 'd3a' },
    ])
    const result = removeDay(timeline, 2)
    expect(ids(result)).toEqual(['d1a', 'd1b', 'd3a'])
    // 鏈結要雙向一致——只改 nextId 沒改 prevId 的話往回走會斷掉。
    expect(result.nodes.get('d3a')?.prevId).toBe('d1b')
    expect(result.nodes.get('d1b')?.nextId).toBe('d3a')
  })

  it('移除第一天時 headId 往後移', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('午餐', '11:30', 1), id: 'd1b' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
    ])
    const result = removeDay(timeline, 1)
    expect(result.headId).toBe('d2a')
    expect(ids(result)).toEqual(['d2a'])
    expect(result.nodes.get('d2a')?.prevId).toBeNull()
  })

  it('移除最後一天,前一天的 nextId 歸 null', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
      { data: stopOnDay('文學館', '11:20', 2), id: 'd2b' },
    ])
    const result = removeDay(timeline, 2)
    expect(ids(result)).toEqual(['d1a'])
    expect(result.nodes.get('d1a')?.nextId).toBeNull()
  })

  it('移除唯一的一天,時間軸變空', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('午餐', '11:30', 1), id: 'd1b' },
    ])
    const result = removeDay(timeline, 1)
    expect(result.headId).toBeNull()
    expect(result.nodes.size).toBe(0)
  })

  it('message 節點跟著它前面那個 stop 的天數一起被移除', () => {
    // message 自己沒有 day 欄位,歸屬靠前一個 stop 決定(見 removeDay
    // 的完整說明)。d2note 夾在兩個 day 2 的站點之間,應該一起消失;
    // d1note 在 day 1 的站點之後,要留下來。
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: { type: 'message' as const, text: '第一天的備註' }, id: 'd1note' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
      { data: { type: 'message' as const, text: '第二天的備註' }, id: 'd2note' },
      { data: stopOnDay('文學館', '11:20', 2), id: 'd2b' },
      { data: stopOnDay('安平古堡', '09:30', 3), id: 'd3a' },
    ])
    const result = removeDay(timeline, 2)
    expect(ids(result)).toEqual(['d1a', 'd1note', 'd3a'])
  })

  it('沒有 day 欄位的節點視為第一天', () => {
    // normalizedDay 把 undefined 當 1(見該函式),removeDay 要一致。
    const timeline = build([
      { data: { type: 'stop' as const, name: '赤崁樓', time: '08:30' }, id: 'noday' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
    ])
    const result = removeDay(timeline, 1)
    expect(ids(result)).toEqual(['d2a'])
  })

  it('該天沒有任何節點時原樣返回同一個物件參照', () => {
    // 讓呼叫端的記憶化不會因為一次沒有實際效果的呼叫而失效重算。
    const timeline = build([{ data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' }])
    expect(removeDay(timeline, 5)).toBe(timeline)
  })

  it('連續多站同屬一天時全部移除(鏈結要一路跳過,不是只跳一格)', () => {
    // 這個案例守住 skipForward/skipBackward 的迴圈——只跳一格的實作
    // 會讓 d1a.nextId 指向 d2b(同樣已被刪除的 id),走訪時就會斷掉。
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
      { data: stopOnDay('文學館', '11:20', 2), id: 'd2b' },
      { data: stopOnDay('消防史料館', '12:30', 2), id: 'd2c' },
      { data: stopOnDay('林百貨', '13:30', 2), id: 'd2d' },
      { data: stopOnDay('安平古堡', '09:30', 3), id: 'd3a' },
    ])
    const result = removeDay(timeline, 2)
    expect(ids(result)).toEqual(['d1a', 'd3a'])
    expect(result.nodes.size).toBe(2)
  })

  it('空的時間軸呼叫不會爆,原樣返回', () => {
    const empty = createEmptyTimeline()
    expect(removeDay(empty, 1)).toBe(empty)
  })
})
