import { describe, expect, it } from 'vitest'
import { NEW_ARTICLE_KEY, draftScope, loadArticleDraft, loadStagedPhotos, saveArticleDraft } from './draftStore'

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('draftScope', () => {
  it('取 JWT 的 sub,取不到退回 anon', () => {
    expect(draftScope(jwt({ sub: 'usr_1' }))).toBe('usr_1')
    expect(draftScope(jwt({}))).toBe('anon')
    expect(draftScope('not-a-jwt')).toBe('anon')
    expect(draftScope(null)).toBe('anon')
  })
})

describe('沒有 IndexedDB 時', () => {
  // jsdom 沒有 indexedDB:草稿是附加便利,讀回空值、寫回 false,不能丟錯影響編輯。
  it('不丟錯,讀回空值、寫回 false', async () => {
    expect(await loadArticleDraft('s', NEW_ARTICLE_KEY)).toBeNull()
    expect(await loadStagedPhotos('s')).toEqual([])
    expect(await saveArticleDraft('s', NEW_ARTICLE_KEY, { title: 't', lede: '', blocks: [], savedAt: 1 })).toBe(false)
  })
})
