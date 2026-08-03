// api.ts 的 request() 是模組內部函式(未 export),故透過已 export 的公開
// 端點函式(health/fetchTrips 等)間接測試它的行為——這樣測到的也正是
// 實際呼叫端會經歷的路徑,而非繞過 request() 直接測一個內部實作細節。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { health, fetchTrips, createTrip, onApiCall, ApiError, type ApiCall, type ClientConfig } from './api'

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('request (透過 health/fetchTrips 等公開端點間接測試)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功時回傳解析後的 JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
    const result = await health(cfg)
    expect(result).toEqual({ status: 'ok' })
  })

  it('會打對的 URL、method,且沒有 body 時不帶 Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
    await health(cfg)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/health')
    expect(init.method).toBe('GET')
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('baseURL 結尾的斜線會被去掉,不會產生雙斜線路徑', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
    await health({ baseURL: 'http://localhost:8080/', token: null })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/health')
  })

  it('cfg.token 有值時帶上 Authorization header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ trips: [] }))
    await fetchTrips({ baseURL: 'http://localhost:8080', token: 'tok_abc' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['Authorization']).toBe('Bearer tok_abc')
  })

  it('cfg.token 為 null 時不帶 Authorization header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ trips: [] }))
    await fetchTrips(cfg)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['Authorization']).toBeUndefined()
  })

  it('有 body 的請求(POST)會帶 Content-Type 且序列化 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tr_1', name: '花蓮三日' }))
    await createTrip(cfg, '花蓮三日')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ name: '花蓮三日' })
  })

  it('非 2xx 回應會拋出 ApiError,訊息取自 error.message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'not_found', message: '找不到資源' } }, 404),
    )
    await expect(health(cfg)).rejects.toThrow('找不到資源')
  })

  it('非 2xx 回應但沒有標準錯誤格式時,訊息 fallback 成 HTTP {status}', async () => {
    fetchMock.mockResolvedValue(new Response('plain text error', { status: 500 }))
    await expect(health(cfg)).rejects.toThrow('HTTP 500')
  })

  it('連線層級失敗(fetch 本身 reject)會包成 ApiError 並拋出', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(health(cfg)).rejects.toThrow('Failed to fetch')
  })

  it('拋出的 ApiError 帶有完整的 call 紀錄', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'bad', message: '壞掉了' } }, 400),
    )
    try {
      await health(cfg)
      expect.unreachable('應該要拋出錯誤')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      const err = e as ApiError
      expect(err.call.status).toBe(400)
      expect(err.call.ok).toBe(false)
      expect(err.call.method).toBe('GET')
    }
  })

  it('每次呼叫都會通知 onApiCall 訂閱者,無論成功或失敗', async () => {
    const received: ApiCall[] = []
    const unsubscribe = onApiCall((call) => received.push(call))

    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
    await health(cfg)

    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'x', message: 'y' } }, 500))
    await health(cfg).catch(() => {})

    unsubscribe()
    expect(received).toHaveLength(2)
    expect(received[0].ok).toBe(true)
    expect(received[1].ok).toBe(false)
  })

  it('unsubscribe 後不再收到通知', async () => {
    const received: ApiCall[] = []
    const unsubscribe = onApiCall((call) => received.push(call))
    unsubscribe()

    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
    await health(cfg)

    expect(received).toHaveLength(0)
  })

  it('回應內容不是合法 JSON 時,responseBody 為 null 但不拋出解析錯誤', async () => {
    fetchMock.mockResolvedValue(new Response('not json at all', { status: 200 }))
    const received: ApiCall[] = []
    const unsubscribe = onApiCall((call) => received.push(call))

    // health() 的呼叫端型別預期是 { status }, 但這裡刻意驗證的是
    // request() 本身不會因為 JSON.parse 失敗而整個炸掉,呼叫端拿到的
    // responseBody 是 null(而非拋出例外)。
    await health(cfg)

    unsubscribe()
    expect(received[0].responseBody).toBeNull()
    expect(received[0].responseText).toBe('not json at all')
  })
})
