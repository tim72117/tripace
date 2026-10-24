import { describe, it, expect } from 'vitest'
import {
  addDay,
  countNodes,
  createEmptyTimeline,
  getNode,
  getTimeDragBounds,
  hasNode,
  insertAfter,
  isTimelineEmpty,
  listNodes,
  minutesToTime,
  moveDay,
  moveNode,
  nextStopOf,
  prevStopOf,
  removeDay,
  removeNode,
  setNodeDay,
  lastAppendTarget,
  updateNode,
  type PlanTimeline,
} from './planTimeline'
import { addedDay } from './planTimelineTestUtils'

// ids——依順序列出真實節點的 id。
function ids(timeline: PlanTimeline): string[] {
  return listNodes(timeline).map((n) => n.id)
}

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
    expect(ids(result.timeline)[0]).toBe('n1')
    expect(listNodes(result.timeline).map((n) => n.name)).toEqual(['赤崁樓'])
  })

  it('anchorId 為 null 插在既有時間軸最前面,原本的 head 被推到後面', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓', '10:00'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const t2 = insertAfter(t1.timeline, null, stop('祀典武廟', '08:00'), 'n2')
    expect(t2.ok).toBe(true)
    if (!t2.ok) return
    expect(ids(t2.timeline)).toEqual(['n2', 'n1'])
    expect(listNodes(t2.timeline).map((n) => n.name)).toEqual(['祀典武廟', '赤崁樓'])
  })

  it('依序插入三筆(皆 append 在前一筆之後),順序與 listNodes 一致', () => {
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

    expect(listNodes(timeline).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟', '大天后宮'])

    expect(ids(timeline)).toEqual(['n1', 'n2', 'n3'])
  })

  it('插入在中間(anchor 不是最後一筆),順序正確', () => {
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

    expect(listNodes(timeline).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟', '大天后宮'])
    expect(ids(timeline)).toEqual(['n1', 'n3', 'n2'])
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
    expect(listNodes(timeline).map((n) => n.name)).toEqual(['赤崁樓', '大天后宮'])
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

  it('錨點是沒有時間的 stop 時,時間驗證改往前後找最近有時間的 stop', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('午餐'), 'sec1')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    const r3 = insertAfter(timeline, 'sec1', stop('大天后宮', '12:00'), 'n2')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    // 插在沒有時間的 sec1 後面,時間必須落在 n1(08:00)與 n2(12:00)之間——
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
    timeline = updateNode(timeline, 'n2', { transitFromPrev: { icon: '🚶', mode: '步行', minutes: 5, distance: '300m' } })

    const r3 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n3')
    if (!r3.ok) throw new Error('setup failed')

    // n2 現在的前一站變成 n3(祀典武廟),原本記錄的「跟赤崁樓之間」的
    // 交通資訊不再對應正確的兩站,必須被清空。
    expect(ids(r3.timeline)).toEqual(['n1', 'n3', 'n2'])
    expect(getNode(r3.timeline, 'n2')?.transitFromPrev).toBeUndefined()
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
    expect(listNodes(timeline).map((n) => n.name)).toEqual(['赤崁樓', '大天后宮'])
    expect(ids(timeline)).toEqual(['n1', 'n3'])
    expect(hasNode(timeline, 'n2')).toBe(false)
  })

  it('移除第一個節點後,下一個節點成為第一個', () => {
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
    expect(ids(timeline)[0]).toBe('n2')
    expect(listNodes(timeline).map((n) => n.name)).toEqual(['祀典武廟'])
  })

  it('移除不存在的 id 時回傳 anchor_not_found 結構化錯誤', () => {
    const t1 = insertAfter(createEmptyTimeline(), null, stop('赤崁樓'), 'n1')
    if (!t1.ok) throw new Error('setup failed')
    const result = removeNode(t1.timeline, 'not-exist')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('anchor_not_found')
  })

  it('移除第一站後,後面的節點接上(「已在淡出、不要重複移除」改由節點狀態表擋,領域層不再有 already_removing)', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    const result = removeNode(timeline, 'n1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(hasNode(result.timeline, 'n1')).toBe(false)
    expect(ids(result.timeline)[0]).toBe('n2')
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
    timeline = updateNode(timeline, 'n3', { transitFromPrev: { icon: '🚶', mode: '步行', minutes: 5, distance: '300m' } })

    const removed = removeNode(timeline, 'n2')
    if (!removed.ok) throw new Error('remove failed')
    timeline = removed.timeline
    // n3 現在的前一站變成 n1(赤崁樓),原本記錄的「跟祀典武廟之間」的
    // 交通資訊不再對應正確的兩站,必須被清空。
    expect(ids(timeline)).toEqual(['n1', 'n3'])
    expect(getNode(timeline, 'n3')?.transitFromPrev).toBeUndefined()
  })
})

describe('updateNode', () => {
  it('合併更新指定欄位,不影響位置', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '09:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    timeline = updateNode(timeline, 'n1', { desc: '荷蘭時期普羅民遮城遺址' })
    expect(getNode(timeline, 'n1')).toMatchObject({ name: '赤崁樓', desc: '荷蘭時期普羅民遮城遺址' })
    expect(ids(timeline)).toEqual(['n1', 'n2'])
    expect(listNodes(timeline).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟'])
  })
})

// 依天分組的讀取:時間軸本身就是 days,視圖自己依 days 畫「Day N」標題;這裡驗證每個節點落在哪一天、順序如何。
describe('依天分組', () => {
  const dayIds = (t: PlanTimeline) => t.days.map((d) => d.nodes.map((n) => n.id))

  it('空時間軸沒有任何天', () => {
    expect(createEmptyTimeline().days).toEqual([])
    expect(listNodes(createEmptyTimeline())).toEqual([])
  })

  it('不同天的站各自放進自己那一天,listNodes 帶上衍生的 day', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '08:00', 1), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stopOnDay('孔廟', '09:00', 2), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    expect(dayIds(timeline)).toEqual([['n1'], ['n2']])
    expect(listNodes(timeline).map((n) => ({ type: n.type, id: n.id, day: n.day }))).toEqual([
      { type: 'stop', id: 'n1', day: 1 },
      { type: 'stop', id: 'n2', day: 2 },
    ])
  })

  it('同一天內(day 相同或都省略)只有一天', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stop('赤崁樓', '08:00'), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '09:00'), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline

    expect(dayIds(timeline)).toEqual([['n1', 'n2']])
  })

  it('連續三天的行程,依序放進三天', () => {
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

    expect(dayIds(timeline)).toEqual([['n1'], ['n2'], ['n3']])
  })

  it('錨點在較後一天、但指定較前的天:放進那一天的最後面,天的順序不變', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r1 = insertAfter(timeline, null, stopOnDay('赤崁樓', '08:00', 1), 'n1')
    if (!r1.ok) throw new Error('setup failed')
    timeline = r1.timeline
    const r2 = insertAfter(timeline, 'n1', stopOnDay('孔廟', '09:00', 2), 'n2')
    if (!r2.ok) throw new Error('setup failed')
    timeline = r2.timeline
    // 錨點是第 2 天的 n2,卻指定第 1 天:放進第 1 天最後面(不會被併進第 2 天)。
    const r3 = insertAfter(timeline, 'n2', stopOnDay('武廟愛玉', '10:00', 1), 'n3')
    if (!r3.ok) throw new Error('setup failed')
    timeline = r3.timeline

    expect(dayIds(timeline)).toEqual([['n1', 'n3'], ['n2']])
    expect(getNode(timeline, 'n3')?.day).toBe(1)
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
    // 之後的天往前補位:原本的第 3 天變成第 2 天。
    expect(getNode(result, 'd3a')?.day).toBe(2)
    expect(result.days).toHaveLength(2)
  })

  it('移除第一天時,後面的天往前補位', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('午餐', '11:30', 1), id: 'd1b' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
    ])
    const result = removeDay(timeline, 1)
    expect(ids(result)).toEqual(['d2a'])
    expect(getNode(result, 'd2a')?.day).toBe(1)
  })

  it('移除最後一天,只剩前面的天', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('孔廟', '09:00', 2), id: 'd2a' },
      { data: stopOnDay('文學館', '11:20', 2), id: 'd2b' },
    ])
    const result = removeDay(timeline, 2)
    expect(ids(result)).toEqual(['d1a'])
    expect(result.days).toHaveLength(1)
  })

  it('移除唯一的一天,時間軸變空', () => {
    const timeline = build([
      { data: stopOnDay('赤崁樓', '08:30', 1), id: 'd1a' },
      { data: stopOnDay('午餐', '11:30', 1), id: 'd1b' },
    ])
    const result = removeDay(timeline, 1)
    expect(isTimelineEmpty(result)).toBe(true)
    expect(countNodes(result)).toBe(0)
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

  it('連續多站同屬一天時全部移除', () => {
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
    expect(countNodes(result)).toBe(2)
  })

  it('空的時間軸呼叫不會爆,原樣返回', () => {
    const empty = createEmptyTimeline()
    expect(removeDay(empty, 1)).toBe(empty)
  })
})

describe('天是結構(days)', () => {
  function build(items: Array<{ id: string; day: number; time: string }>) {
    let timeline: PlanTimeline = createEmptyTimeline()
    let anchor: string | null = null
    for (const it of items) {
      const r = insertAfter(timeline, anchor, stopOnDay(it.id, it.time, it.day), it.id)
      if (!r.ok) throw new Error(r.error.message)
      timeline = r.timeline
      anchor = it.id
    }
    return timeline
  }

  it('存進時間軸的節點不帶 day,讀取時依所在天補上', () => {
    const t = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '09:00' }])
    expect(t.days).toHaveLength(2)
    expect(t.days[1].nodes[0]).not.toHaveProperty('day')
    expect(getNode(t, 'b')?.day).toBe(2)
    expect(listNodes(t).map((n) => n.day)).toEqual([1, 2])
  })

  it('insertAfter 指定的天不夠時補空的天', () => {
    const t = build([{ id: 'a', day: 3, time: '09:00' }])
    expect(t.days).toHaveLength(3)
    expect(getNode(t, 'a')?.day).toBe(3)
    expect(t.days.map((d) => d.nodes.map((n) => n.id))).toEqual([[], [], ['a']])
  })

  it('沒指定 day 時放進錨點所在的那一天', () => {
    let t = build([{ id: 'a', day: 2, time: '09:00' }])
    const r = insertAfter(t, 'a', { type: 'stop', name: 'B', time: '10:00' }, 'b')
    if (!r.ok) throw new Error('setup failed')
    t = r.timeline
    expect(getNode(t, 'b')?.day).toBe(2)
  })

  it('時間順序只在同一天內檢查,每天可以各自從清晨開始', () => {
    const t = build([{ id: 'a', day: 1, time: '20:00' }, { id: 'b', day: 2, time: '08:00' }])
    expect(ids(t)).toEqual(['a', 'b'])
  })

  describe('prevStopOf / nextStopOf', () => {
    it('同一天內找前後 stop,不跨天', () => {
      const t = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 1, time: '10:00' }, { id: 'c', day: 2, time: '09:00' }])
      expect(prevStopOf(t, 'b')?.id).toBe('a')
      expect(nextStopOf(t, 'a')?.id).toBe('b')
      expect(prevStopOf(t, 'c')).toBeUndefined()
      expect(nextStopOf(t, 'b')).toBeUndefined()
      expect(prevStopOf(t, 'not-exist')).toBeUndefined()
    })
  })

  describe('addDay', () => {
    it('預設加在最後面,是空的天,有自己的 id', () => {
      const t = addedDay(build([{ id: 'a', day: 1, time: '09:00' }]), undefined, 'dx')
      expect(t.days).toHaveLength(2)
      expect(t.days[1]).toEqual({ id: 'dx', nodes: [] })
      expect(t.days.map((d) => d.nodes.map((n) => n.id))).toEqual([['a'], []])
    })

    it('指定位置時插在那裡,原本那天與之後順延', () => {
      const t0 = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '09:00' }])
      const t = addedDay(t0, 2, 'new')
      expect(t.days.map((d) => d.id)[1]).toBe('new')
      expect(getNode(t, 'b')?.day).toBe(3)
    })

    it('位置超過天數 + 1 視為加在最後面;空時間軸可以直接加第一天', () => {
      expect(addedDay(build([{ id: 'a', day: 1, time: '09:00' }]), 9).days).toHaveLength(2)
      expect(addedDay(createEmptyTimeline()).days).toHaveLength(1)
    })

    it('空的天不算內容;最後一個站被移除時,同一次變空的最後一天會一起去掉,事先加的空天不受影響', () => {
      let t = addedDay(build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '09:00' }]))
      expect(t.days).toHaveLength(3)
      const r = removeNode(t, 'b')
      if (!r.ok) throw new Error('remove failed')
      t = r.timeline
      // b 所在的第 2 天不是最後一天(後面還有事先加的空天),所以保留
      expect(t.days).toHaveLength(3)
      expect(isTimelineEmpty(addedDay(createEmptyTimeline()))).toBe(true)
    })
  })

  describe('addDay 回傳實際插入位置', () => {
    it('省略 atDay:day 是新的最後一天,dayId 是新天的 id', () => {
      const r = addDay(build([{ id: 'a', day: 1, time: '09:00' }]), undefined, 'dx')
      expect(r).toMatchObject({ ok: true, day: 2, dayId: 'dx' })
    })

    it('指定位置:day 就是插入的位置;超過天數 + 1 時回傳實際夾住後的位置(不是請求值)', () => {
      const t0 = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '09:00' }])
      expect(addDay(t0, 1, 'x')).toMatchObject({ ok: true, day: 1, dayId: 'x' })
      expect(addDay(t0, 9, 'y')).toMatchObject({ ok: true, day: 3, dayId: 'y' })
    })

    it('atDay 不合法(NaN/小數/0/負數/Infinity)回 invalid_day,不丟例外也不改時間軸', () => {
      const t0 = build([{ id: 'a', day: 1, time: '09:00' }])
      for (const bad of [NaN, 1.5, 0, -2, Infinity]) {
        const r = addDay(t0, bad)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error.code).toBe('invalid_day')
      }
    })
  })

  describe('invalid_day:day 不合法時 insertAfter/moveNode/setNodeDay 回結構化錯誤', () => {
    const t0 = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '09:00' }])
    const data = { type: 'stop' as const, name: 'x' }

    it('insertAfter 的 data.day', () => {
      for (const bad of [NaN, 1.5, 0, -1, Infinity]) {
        const r = insertAfter(t0, null, { ...data, day: bad }, 'n')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error.code).toBe('invalid_day')
      }
      // 省略 day 與合法 day 不受影響
      expect(insertAfter(t0, null, data, 'n1').ok).toBe(true)
      expect(insertAfter(t0, null, { ...data, day: 3 }, 'n2').ok).toBe(true)
    })

    it('moveNode 的 toDay', () => {
      for (const bad of [NaN, 2.5, 0, -1]) {
        const r = moveNode(t0, 'a', null, bad)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error.code).toBe('invalid_day')
      }
    })

    it('setNodeDay 的 day', () => {
      for (const bad of [NaN, 2.5, 0, -1]) {
        const r = setNodeDay(t0, 'a', bad)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error.code).toBe('invalid_day')
      }
    })
  })

  describe('removeNode 修剪最後一個空天', () => {
    it('移除讓最後一天變空 → 那一天一併去掉(不留空的 Day N 標題)', () => {
      const t0 = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '09:00' }])
      const r = removeNode(t0, 'b')
      if (!r.ok) throw new Error('remove failed')
      expect(r.timeline.days).toHaveLength(1)
      expect(r.timeline.days.map((d) => d.nodes.map((n) => n.id))).toEqual([['a']])
    })
  })

  describe('moveNode', () => {
    it('同一天內調換順序,檢查時間順序', () => {
      const t = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 1, time: '10:00' }, { id: 'c', day: 1, time: '11:00' }])
      const bad = moveNode(t, 'c', null)
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.error.code).toBe('time_out_of_range')
      expect(ids(t)).toEqual(['a', 'b', 'c']) // 失敗時原時間軸不變
    })

    it('移到另一天的最前面(錨點為 null + toDay),節點屬於新的一天,transitFromPrev 作廢', () => {
      let t = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 1, time: '10:00' }, { id: 'c', day: 2, time: '11:00' }])
      t = updateNode(t, 'b', { transitFromPrev: { mode: '步行', minutes: 5 } })
      const r = moveNode(t, 'b', null, 2)
      if (!r.ok) throw new Error(r.error.message)
      expect(ids(r.timeline)).toEqual(['a', 'b', 'c'])
      expect(getNode(r.timeline, 'b')?.day).toBe(2)
      expect(getNode(r.timeline, 'b')?.transitFromPrev).toBeUndefined()
      expect(getNode(r.timeline, 'c')?.transitFromPrev).toBeUndefined()
    })

    it('錨點或節點找不到、錨點是自己、違反時間順序時回傳錯誤;沒有時間的節點可以移到錨點後面', () => {
      const t = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 1, time: '10:00' }])
      expect(moveNode(t, 'x', null).ok).toBe(false)
      expect(moveNode(t, 'a', 'nope').ok).toBe(false)
      expect(moveNode(t, 'a', 'a').ok).toBe(false)
      // a(09:00)移到 b(10:00)後面違反同一天的時間順序 → 失敗,時間軸不變
      const bad = moveNode(t, 'a', 'b')
      expect(bad.ok).toBe(false)
      // 沒有時間限制的節點(沒填 time 的 stop)可以移到錨點後面
      const withMsg = insertAfter(t, 'a', { type: 'stop', name: '自由活動' }, 'm')
      if (!withMsg.ok) throw new Error('setup failed')
      const moved = moveNode(withMsg.timeline, 'm', 'b')
      if (!moved.ok) throw new Error(moved.error.message)
      expect(ids(moved.timeline)).toEqual(['a', 'b', 'm'])
    })
  })

  describe('setNodeDay', () => {
    it('改到另一天,放在依時間排序的位置', () => {
      const t = build([{ id: 'a', day: 1, time: '09:00' }, { id: 'b', day: 2, time: '08:00' }, { id: 'c', day: 2, time: '12:00' }, { id: 'x', day: 1, time: '10:00' }])
      const r = setNodeDay(t, 'x', 2)
      if (!r.ok) throw new Error(r.error.message)
      expect(ids(r.timeline)).toEqual(['a', 'b', 'x', 'c'])
      expect(getNode(r.timeline, 'x')?.day).toBe(2)
    })

    it('天數不夠時補空的天;找不到節點回錯誤', () => {
      const t = build([{ id: 'a', day: 1, time: '09:00' }])
      const r = setNodeDay(t, 'a', 3)
      if (!r.ok) throw new Error(r.error.message)
      expect(r.timeline.days).toHaveLength(3)
      expect(getNode(r.timeline, 'a')?.day).toBe(3)
      expect(setNodeDay(t, 'nope', 2).ok).toBe(false)
    })
  })

  it('updateNode 的 patch.day 會被忽略(改天要用 setNodeDay)', () => {
    const t = build([{ id: 'a', day: 1, time: '09:00' }])
    const next = updateNode(t, 'a', { day: 5, name: '新名稱' })
    expect(getNode(next, 'a')).toMatchObject({ day: 1, name: '新名稱' })
    expect(next.days).toHaveLength(1)
  })
})

describe('moveDay', () => {
  function threeDays() {
    let timeline: PlanTimeline = createEmptyTimeline()
    let anchor: string | null = null
    for (const [id, day] of [['a', 1], ['b', 2], ['c', 3]] as const) {
      const r = insertAfter(timeline, anchor, { type: 'stop', name: id, time: '09:00', day }, id)
      if (!r.ok) throw new Error(r.error.message)
      timeline = r.timeline
      anchor = id
    }
    return timeline
  }

  it('把第 3 天移到第 1 天:順序重排,站點的 day 與分隔線跟著重算,天的 id 不變', () => {
    const t = threeDays()
    const idsBefore = t.days.map((d) => d.id)
    const r = moveDay(t, 3, 1)
    if (!r.ok) throw new Error(r.error.message)
    expect(ids(r.timeline)).toEqual(['c', 'a', 'b'])
    expect(getNode(r.timeline, 'c')?.day).toBe(1)
    expect(getNode(r.timeline, 'b')?.day).toBe(3)
    expect(r.timeline.days.map((d) => d.id)).toEqual([idsBefore[2], idsBefore[0], idsBefore[1]])
    expect(r.timeline.days.map((d) => d.nodes.map((n) => n.id))).toEqual([['c'], ['a'], ['b']])
  })

  it('往後移:第 1 天移到第 2 天,中間的天往前補位', () => {
    const r = moveDay(threeDays(), 1, 2)
    if (!r.ok) throw new Error(r.error.message)
    expect(ids(r.timeline)).toEqual(['b', 'a', 'c'])
  })

  it('fromDay 等於 toDay 原樣回傳同一個時間軸', () => {
    const t = threeDays()
    const r = moveDay(t, 2, 2)
    expect(r.ok && r.timeline === t).toBe(true)
  })

  it('超出範圍或不是整數:回傳錯誤並說明目前有幾天;空時間軸也回錯誤', () => {
    const t = threeDays()
    for (const [from, to] of [[0, 1], [1, 4], [2.5, 1], [-1, 2]] as const) {
      const r = moveDay(t, from, to)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.message).toContain('3 天')
    }
    expect(moveDay(createEmptyTimeline(), 1, 1).ok).toBe(false)
  })
})

describe('lastAppendTarget(接在整條時間軸最後面)', () => {
  it('完全沒有天:沒有錨點、第 1 天', () => {
    expect(lastAppendTarget(createEmptyTimeline())).toEqual({ anchorId: null, day: 1 })
  })

  it('最後一天有節點:錨點是那一天最後一個節點,day 是那一天', () => {
    const r1 = insertAfter(createEmptyTimeline(), null, { type: 'stop', name: 'A', time: '09:00' }, 'a')
    if (!r1.ok) throw new Error('setup failed')
    const t = insertAfter(r1.timeline, 'a', { type: 'stop', name: 'B', time: '10:00' }, 'm')
    if (!t.ok) throw new Error(t.error.message)
    expect(lastAppendTarget(t.timeline)).toEqual({ anchorId: 'm', day: 1 })
  })

  it('最後一天是空的:錨點為 null、day 是那一天;接上去的節點就放進那一天', () => {
    const base = insertAfter(createEmptyTimeline(), null, { type: 'stop', name: 'A', time: '09:00' }, 'a')
    if (!base.ok) throw new Error('setup failed')
    const t = addedDay(base.timeline, undefined, 'd-two')
    const target = lastAppendTarget(t)
    expect(target).toEqual({ anchorId: null, day: 2 })
    const r = insertAfter(t, target.anchorId, { type: 'stop', name: 'B', time: '10:00', day: target.day }, 'm')
    if (!r.ok) throw new Error(r.error.message)
    expect(r.timeline.days.map((d) => d.nodes.map((n) => n.id))).toEqual([['a'], ['m']])
  })

  it('錨點用 day-divider-N 這種舊的虛擬 id 不再被特別處理,視為找不到錨點', () => {
    const t = addedDay(createEmptyTimeline(), undefined, 'd-one')
    const r = insertAfter(t, 'day-divider-1', { type: 'stop', name: 'A' }, 'a')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('anchor_not_found')
  })
})
