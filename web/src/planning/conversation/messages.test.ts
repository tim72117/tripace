import { describe, it, expect } from 'vitest'
import {
  appendMessage,
  clearConversation,
  createEmptyConversation,
  hasMessage,
  staleAllMessages,
  type PlanConversation,
} from './messages'

function conv(...msgs: { id: string; text?: string; stale?: boolean; ephemeral?: boolean }[]): PlanConversation {
  return { messages: msgs.map((m) => ({ text: m.id, ...m })) }
}

describe('planConversation 基本讀寫', () => {
  it('空對話沒有訊息', () => {
    const c = createEmptyConversation()
    expect(c.messages).toEqual([])
  })

  it('appendMessage 依發生順序接在最後,不改動原物件', () => {
    const a = appendMessage(createEmptyConversation(), { id: 'a', text: '一' })
    const b = appendMessage(a, { id: 'b', text: '二' })
    expect(b.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(a.messages.map((m) => m.id)).toEqual(['a'])
  })

  it('appendMessage 遇到重複 id 原樣回傳同一個參照', () => {
    const a = conv({ id: 'a' })
    expect(appendMessage(a, { id: 'a', text: '重送' })).toBe(a)
  })

  it('hasMessage', () => {
    const c = conv({ id: 'a', text: '你好' })
    expect(hasMessage(c, 'a')).toBe(true)
    expect(hasMessage(c, 'x')).toBe(false)
  })
})

describe('淡化(stale)', () => {
  it('staleAllMessages 把全部未淡化的訊息標成 stale', () => {
    const next = staleAllMessages(conv({ id: 'a' }, { id: 'b', stale: true }, { id: 'c' }))
    expect(next.messages.map((m) => m.stale)).toEqual([true, true, true])
  })

  it('staleAllMessages 沒有要改的就原樣回傳同一個參照', () => {
    const c = conv({ id: 'a', stale: true })
    expect(staleAllMessages(c)).toBe(c)
    const empty = createEmptyConversation()
    expect(staleAllMessages(empty)).toBe(empty)
  })

  it('不改動其他欄位', () => {
    const next = staleAllMessages(conv({ id: 'a', text: 'keep' }, { id: 'b' }))
    expect(next.messages[0]).toMatchObject({ id: 'a', text: 'keep', stale: true })
  })
})

describe('清空', () => {
  it('clearConversation 清空;已空則原樣回傳', () => {
    expect(clearConversation(conv({ id: 'a' })).messages).toEqual([])
    const empty = createEmptyConversation()
    expect(clearConversation(empty)).toBe(empty)
  })
})
