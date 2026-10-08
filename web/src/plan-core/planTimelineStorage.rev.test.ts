import { describe, it, expect, beforeEach } from 'vitest'
import { loadTimeline, loadTimelineWithRev, readRev, saveTimeline, PLAN_TIMELINE_STORAGE_KEY } from './planTimelineStorage'
import { createEmptyTimeline, insertAfter } from './planTimeline'
import type { PlanTimeline } from './planTimeline'

// 版次(rev)機制的回歸測試——針對一個實際的資料遺失路徑:
//
// TripPlanPage 會同時有兩份實例掛載(地圖對話小匡常駐掛載 + 切到
// /app/plan-ai 時的全頁版)。兩份各自在掛載當下讀一次 localStorage 之後
// 就不再重讀,於是在全頁版規劃完切回地圖,小匡那份仍是掛載時的舊內容
// (常常是空的),它下一次寫入就會把剛規劃好的全部蓋掉。
//
// rev 讓後寫的那一方能先察覺「我手上這份已經過期」,改以磁碟上的較新
// 內容為基準重算,而不是直接覆蓋。

function timelineWith(name: string): PlanTimeline {
  const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', name }, `n-${name}`)
  if (!r.ok) throw new Error('fixture 建立失敗')
  return r.timeline
}

function namesOf(t: PlanTimeline): string[] {
  return [...t.nodes.values()].map((n) => n.name ?? '')
}

describe('planTimelineStorage 的版次機制', () => {
  beforeEach(() => {
    localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
  })

  it('沒存過時 readRev 回 0', () => {
    expect(readRev()).toBe(0)
  })

  it('每次寫入都讓版次前進,並回傳新版次', () => {
    expect(saveTimeline(timelineWith('A'), 0)).toBe(1)
    expect(readRev()).toBe(1)
    expect(saveTimeline(timelineWith('B'), 1)).toBe(2)
    expect(readRev()).toBe(2)
  })

  it('另一份實例寫入後,落後的那份能從版次看出自己過期', () => {
    // 實例一(小匡)掛載:讀到空的,記住版次 0
    const instanceOneRev = readRev()
    expect(instanceOneRev).toBe(0)

    // 實例二(全頁版)規劃了一站並寫入
    saveTimeline(timelineWith('赤崁樓'), 0)

    // 實例一此刻要寫入:先比對版次,發現磁碟上比自己新
    expect(readRev()).toBeGreaterThan(instanceOneRev)

    // 正確行為:以磁碟內容為基準,而不是拿自己手上的空 timeline 覆蓋
    const base = loadTimeline()
    expect(namesOf(base)).toEqual(['赤崁樓'])
  })

  it('舊格式(沒有 rev 欄位)讀起來是 0,不會因此丟棄內容', () => {
    // 模擬這個機制加入前就存在的資料
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 1, headId: 'n-舊', nodes: [['n-舊', { id: 'n-舊', type: 'stop', name: '舊', prevId: null, nextId: null }]] }),
    )
    expect(readRev()).toBe(0)
    expect(namesOf(loadTimeline())).toEqual(['舊'])
  })

  it('寫入失敗時回傳 null(而非 baseRev),讓呼叫端能分辨', () => {
    // 這是 rev 機制最脆弱的那一點:若失敗時回傳 baseRev,呼叫端無法分辨
    // 「寫成功」與「靜默降級」,會把自己的版次推進到一個磁碟上並不存在
    // 的值。一旦 revRef 高於磁碟 rev,「我是否過期」的判斷從此永遠為
    // false,這份實例再也不會察覺別的實例寫過——rev 機制對它完全失效,
    // 退回修復前的原始 bug。觸發條件只要一次 QuotaExceededError。
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    try {
      expect(saveTimeline(timelineWith('A'), 3)).toBeNull()
    } finally {
      Storage.prototype.setItem = original
    }
    // 失敗不該留下任何痕跡:版次維持原狀
    expect(readRev()).toBe(0)
  })

  it('loadTimelineWithRev 的內容與版次來自同一次讀取', () => {
    saveTimeline(timelineWith('赤崁樓'), 0)
    const { timeline, rev } = loadTimelineWithRev()
    expect(namesOf(timeline)).toEqual(['赤崁樓'])
    expect(rev).toBe(1)
    // 與分別呼叫的結果一致(此處沒有交錯寫入,兩者應相同)
    expect(rev).toBe(readRev())
  })

  it('loadTimelineWithRev 在沒存過時回空時間軸與 rev 0', () => {
    const { timeline, rev } = loadTimelineWithRev()
    expect(namesOf(timeline)).toEqual([])
    expect(rev).toBe(0)
  })

  it('內容損毀時 readRev 回 0,不拋例外', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, '{ 不是 json')
    expect(readRev()).toBe(0)
  })
})
