import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlanTimelineCore } from './usePlanTimelineCore'
import { loadTimeline, saveTimeline, PLAN_TIMELINE_STORAGE_KEY } from './planTimelineStorage'
import { createEmptyTimeline, insertAfter } from './planTimeline'
import type { PlanTimeline } from './planTimeline'

// usePlanTimelineCore 的回歸測試——這支 hook 是 /ai-plan 模擬時間軸與
// /app 正式 AI 規劃的共用資料層(見該檔案開頭的完整說明),兩邊的行為
// 差異全部收斂在 persist 與 onStopInserted 兩個選項上,這裡逐一覆蓋。

function timelineWith(name: string): PlanTimeline {
  const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', name }, `n-${name}`)
  if (!r.ok) throw new Error('fixture 建立失敗')
  return r.timeline
}

function namesOf(steps: { name?: string }[]): (string | undefined)[] {
  return steps.map((s) => s.name)
}

describe('usePlanTimelineCore 的基本操作', () => {
  beforeEach(() => {
    localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
  })

  it('插入節點後 steps 依序反映出來', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    act(() => {
      result.current.insertAttractionAfter('a', 'b', { type: 'stop', name: '安平古堡' })
    })
    expect(namesOf(result.current.steps)).toEqual(['赤崁樓', '安平古堡'])
  })

  it('clearTimeline 清空所有節點', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    expect(result.current.steps).toHaveLength(1)
    act(() => {
      result.current.clearTimeline()
    })
    expect(result.current.steps).toHaveLength(0)
  })

  it('插入 stop 時呼叫 onStopInserted,插入 message 時不呼叫', () => {
    // 這是 Sim 與 Live 兩層最主要的接縫:Live 在這裡接真 API 補查地點,
    // Sim 接假資料來源,而腳本自帶座標的節點甚至不需要補查。
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ onStopInserted }))

    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    expect(onStopInserted).toHaveBeenCalledTimes(1)
    expect(onStopInserted).toHaveBeenCalledWith('a', expect.objectContaining({ name: '赤崁樓' }))

    act(() => {
      result.current.insertAttractionAfter('a', 'm', { type: 'message', text: 'AI 的話' })
    })
    // message 不是地點,沒有東西要補查
    expect(onStopInserted).toHaveBeenCalledTimes(1)
  })

  it('插入失敗(anchor 不存在)時不呼叫 onStopInserted', () => {
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ onStopInserted }))
    let ok = true
    act(() => {
      ok = result.current.insertAttractionAfter('不存在的錨點', 'a', { type: 'stop', name: 'X' }).ok
    })
    expect(ok).toBe(false)
    expect(onStopInserted).not.toHaveBeenCalled()
  })
})

describe('persist 開關', () => {
  beforeEach(() => {
    localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
  })

  it('persist 預設關閉:異動不寫進 localStorage', () => {
    // 這個預設值是刻意的——「寫入使用者的持久化資料」該是明確選擇,
    // 不該忘了設定就自動發生。
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    expect(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)).toBeNull()
  })

  it('persist 關閉時不會蓋掉既有的持久化內容', () => {
    // 實際會踩到的情境:使用者先在 /app 排好一趟行程,再開 /ai-plan 看
    // 展示動畫,回到 /app 發現自己的行程被模擬腳本蓋掉了。
    saveTimeline(timelineWith('使用者排的'), 0)

    const { result } = renderHook(() => usePlanTimelineCore({ persist: false }))
    act(() => {
      result.current.insertAttractionAfter(null, 'sim', { type: 'stop', name: '模擬腳本的站' })
    })

    // 記憶體裡是模擬的內容
    expect(namesOf(result.current.steps)).toEqual(['模擬腳本的站'])
    // 但 localStorage 仍是使用者原本那份
    expect(namesOf([...loadTimeline().nodes.values()])).toEqual(['使用者排的'])
  })

  it('persist 開啟:初值讀回既有內容,異動寫回去', () => {
    saveTimeline(timelineWith('先前排的'), 0)

    const { result } = renderHook(() => usePlanTimelineCore({ persist: true }))
    expect(namesOf(result.current.steps)).toEqual(['先前排的'])

    act(() => {
      result.current.insertAttractionAfter('n-先前排的', 'b', { type: 'stop', name: '新增的' })
    })
    expect(namesOf([...loadTimeline().nodes.values()])).toEqual(['先前排的', '新增的'])
  })

  it('persist 開啟時 clearTimeline 也會清掉持久化內容', () => {
    // 「模擬交接給真實 AI」要用到:交接時清空時間軸,不能只清記憶體,
    // 否則重整後舊內容又回來了。
    saveTimeline(timelineWith('舊的'), 0)
    const { result } = renderHook(() => usePlanTimelineCore({ persist: true }))
    act(() => {
      result.current.clearTimeline()
    })
    expect(result.current.steps).toHaveLength(0)
    expect([...loadTimeline().nodes.values()]).toHaveLength(0)
  })
})
