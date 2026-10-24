// getCurrentPositionOrNull:靜默向瀏覽器要一次目前位置,任何失敗(不支援、拒絕、逾時、丟例外)一律回 null。
// 原本 /ai-plan 與登入後(useMapState)各寫一份幾乎相同的程式,
// 現在三個入口(planning/preview、planning/member/phone、planning/member/desktop)的 useCurrentLocation 共用這一份。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getCurrentPositionOrNull, GEOLOCATION_TIMEOUT_MS, GEOLOCATION_MAX_AGE_MS } from './currentLocation'

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'geolocation')

function setGeolocation(value: unknown) {
  Object.defineProperty(globalThis.navigator, 'geolocation', { value, configurable: true })
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis.navigator, 'geolocation', original)
  else delete (globalThis.navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('getCurrentPositionOrNull', () => {
  it('瀏覽器不支援定位:回 null', async () => {
    setGeolocation(undefined)
    expect(await getCurrentPositionOrNull()).toBeNull()
  })

  it('定位成功:回 { lat, lng }', async () => {
    setGeolocation({
      getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: 25.03, longitude: 121.56 } }),
    })
    expect(await getCurrentPositionOrNull()).toEqual({ lat: 25.03, lng: 121.56 })
  })

  it('使用者拒絕、逾時等失敗:回 null,不往上拋', async () => {
    setGeolocation({ getCurrentPosition: (_ok: unknown, fail: () => void) => fail() })
    expect(await getCurrentPositionOrNull()).toBeNull()
  })

  it('getCurrentPosition 同步丟例外:回 null', async () => {
    setGeolocation({
      getCurrentPosition: () => {
        throw new Error('boom')
      },
    })
    expect(await getCurrentPositionOrNull()).toBeNull()
  })

  it('逾時 5 秒、允許用 1 分鐘內的舊結果(冷啟動較慢的裝置更容易成功)', async () => {
    const spy = vi.fn((ok: (p: { coords: { latitude: number; longitude: number } }) => void, _fail?: unknown, _options?: unknown) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    )
    setGeolocation({ getCurrentPosition: spy })
    await getCurrentPositionOrNull()
    expect(spy.mock.calls[0][2]).toEqual({ timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS })
    expect(GEOLOCATION_TIMEOUT_MS).toBe(5000)
    expect(GEOLOCATION_MAX_AGE_MS).toBe(60_000)
  })
})
