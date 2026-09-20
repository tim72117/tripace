import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// analytics.test.ts——驗證 VITE_DISABLE_ANALYTICS 排除機制(見 analytics.ts
// 開頭 analyticsDisabled 的完整說明):本機開發設這個環境變數為 "1" 時,
// trackEvent/fireRegistrationConversion 都不該把任何事件推進
// window.dataLayer,避免誤觸發正式環境才該計入的 GA4/Ads 轉換數據。
//
// analyticsDisabled 是模組載入當下就算好的常數(讀 import.meta.env 只
// 應該發生一次,不是每次呼叫 trackEvent 都重新判斷),故每個案例都要
// vi.resetModules() 後動態 import,確保拿到的是套用當次 vi.stubEnv 值
// 重新載入的模組,而不是被其他測試快取住的舊版本。
describe('analytics', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as unknown as { dataLayer?: unknown }).dataLayer
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('VITE_DISABLE_ANALYTICS 未設定時,trackEvent 正常推進 dataLayer', async () => {
    const { trackEvent } = await import('./analytics')
    trackEvent('test_event', { foo: 'bar' })

    const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
    expect(w.dataLayer).toEqual([{ event: 'test_event', foo: 'bar' }])
  })

  it('VITE_DISABLE_ANALYTICS=1 時,trackEvent 完全不寫入 dataLayer', async () => {
    vi.stubEnv('VITE_DISABLE_ANALYTICS', '1')
    const { trackEvent } = await import('./analytics')
    trackEvent('test_event')

    const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
    expect(w.dataLayer).toBeUndefined()
  })

  it('VITE_DISABLE_ANALYTICS=1 時,fireRegistrationConversion 也不會觸發 sign_up 事件', async () => {
    vi.stubEnv('VITE_DISABLE_ANALYTICS', '1')
    const { fireRegistrationConversion } = await import('./analytics')
    fireRegistrationConversion()

    const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
    expect(w.dataLayer).toBeUndefined()
  })

  it('VITE_DISABLE_ANALYTICS 為其他非 "1" 的值時,視為未關閉(仍然追蹤)', async () => {
    vi.stubEnv('VITE_DISABLE_ANALYTICS', 'true')
    const { trackEvent } = await import('./analytics')
    trackEvent('test_event')

    const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
    expect(w.dataLayer).toEqual([{ event: 'test_event' }])
  })
})
