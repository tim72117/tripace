import { describe, expect, it } from 'vitest'
import { JAPAN_LAND } from './japanLand'
import { CITY_FORECASTS, FORECAST_SOURCE } from './momijiForecast'
import { MOMIJI_SPOTS } from './momijiSpots'
import {
  AXIS_DIR, DAY_SEC, HOLD_SEC, RIPEN_DAYS, TOTAL_DAYS, WIND_PART,
  advanceClock, cityPeakDay, createJapanField, createMomijiField, dateOfDay, dayState, daysBetween, effectiveDay,
  forecastPeakDay, formatMonthDay, leafRgb, leafTarget, linePoint, monthDayToDate, mulberry32, pointInRing, rawU, redShare,
  windEnvelope,
} from './momijiFrontModel'

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]] as const
// 測試用的預測日函式:越北(lat 大)越早,範圍落在模擬日期內。
const peakAt = (lat: number) => 20 + (10 - lat) * 2

describe('時鐘', () => {
  it('播放中依 speed 前進,一天 DAY_SEC 秒', () => {
    const { clock, restarted } = advanceClock({ time: 0, hold: 0 }, DAY_SEC, 1)
    expect(clock.time).toBeCloseTo(1)
    expect(restarted).toBe(false)
    expect(advanceClock({ time: 0, hold: 0 }, DAY_SEC, 4).clock.time).toBeCloseTo(4)
  })
  it('不會超過 TOTAL_DAYS,到終點後先停 HOLD_SEC 才從頭重播', () => {
    const atEnd = advanceClock({ time: TOTAL_DAYS - 0.01, hold: 0 }, 5, 1).clock
    expect(atEnd.time).toBe(TOTAL_DAYS)
    const holding = advanceClock(atEnd, HOLD_SEC - 0.5, 1)
    expect(holding.clock.time).toBe(TOTAL_DAYS)
    expect(holding.restarted).toBe(false)
    const restart = advanceClock(holding.clock, 1, 1)
    expect(restart.clock).toEqual({ time: 0, hold: 0 })
    expect(restart.restarted).toBe(true)
  })
  it('dayState:整數天與天內進度,風前緣隨進度推進,風停後停在終點', () => {
    expect(dayState(3.5)).toMatchObject({ day: 3, frac: 0.5 })
    expect(dayState(3).windU).toBeCloseTo(-0.3)
    expect(dayState(3 + WIND_PART).windU).toBeCloseTo(1.3)
    expect(dayState(3 + 0.95).windU).toBeCloseTo(1.3)
    expect(dayState(TOTAL_DAYS)).toMatchObject({ day: TOTAL_DAYS, frac: 0 })
  })
  it('日期由預測資料推導:最早見頃日(札幌 11/4)往前 RIPEN_DAYS 天是第 0 天,最晚見頃日(和歌山 12/12)是最後一天', () => {
    expect(formatMonthDay(dateOfDay(0), '/')).toBe('10/17')
    expect(formatMonthDay(dateOfDay(TOTAL_DAYS), '/')).toBe('12/12')
    expect(TOTAL_DAYS).toBe(56)
    expect(formatMonthDay(dateOfDay(15), '月')).toBe('11月1')
  })
  it('風的強度:吹風段兩端趨近 0、中間最強;凍結為 0;拖動時固定 0.5(風停段除外)', () => {
    const on = { active: true, scrubbing: false }
    expect(windEnvelope(0, on)).toBeCloseTo(0)
    expect(windEnvelope(WIND_PART, on)).toBeCloseTo(0, 5)
    expect(windEnvelope(WIND_PART / 2, on)).toBeCloseTo(1)
    expect(windEnvelope(0.3, { active: false, scrubbing: false })).toBe(0)
    expect(windEnvelope(0.3, { active: false, scrubbing: true })).toBe(0.5)
    expect(windEnvelope(0.9, { active: false, scrubbing: true })).toBe(0)
  })
})

describe('各地變色時程', () => {
  it('leafTarget:見頃日當天剛好全紅、往前 RIPEN_DAYS 天是綠、中間線性;夾在 0..1', () => {
    expect(leafTarget(30, 30)).toBe(1)
    expect(leafTarget(30 - RIPEN_DAYS, 30)).toBe(0)
    expect(leafTarget(30 - RIPEN_DAYS / 2, 30)).toBeCloseTo(0.5)
    expect(leafTarget(-5, 30)).toBe(0)
    expect(leafTarget(99, 30)).toBe(1)
  })
  it('leafTarget 對天數不減;預測日越早、同一天越熟', () => {
    for (let d = 1; d <= TOTAL_DAYS; d++) expect(leafTarget(d, 30)).toBeGreaterThanOrEqual(leafTarget(d - 1, 30))
    expect(leafTarget(25, 20)).toBeGreaterThan(leafTarget(25, 35))
  })
  it('effectiveDay:風掃過葉子的那一刻才算進下一天;終點時一律是最後一天', () => {
    expect(effectiveDay(5.2, 0.1, 0.5)).toBe(5)
    expect(effectiveDay(5.2, 0.8, 0.5)).toBe(6)
    expect(effectiveDay(TOTAL_DAYS, 1.3, 0.9)).toBe(TOTAL_DAYS)
    expect(effectiveDay(TOTAL_DAYS, -0.3, 0.9)).toBe(TOTAL_DAYS)
  })
  it('forecastPeakDay:在都市座標上就是該都市的預測日(札幌 11/4、福岡 12/7)', () => {
    const by = (id: string) => CITY_FORECASTS.find((c) => c.id === id)!
    for (const id of ['sapporo', 'tokyo', 'fukuoka', 'kyoto']) {
      const c = by(id)
      expect(forecastPeakDay(c.lat, c.lng)).toBeCloseTo(cityPeakDay(c.momiji.peak))
    }
    expect(forecastPeakDay(by('sapporo').lat, by('sapporo').lng)).toBe(cityPeakDay('11-04'))
  })
  it('forecastPeakDay:內插值夾在所有預測日之間;越靠近某都市越接近它的預測日', () => {
    const lo = Math.min(...CITY_FORECASTS.map((c) => cityPeakDay(c.momiji.peak)))
    const hi = Math.max(...CITY_FORECASTS.map((c) => cityPeakDay(c.momiji.peak)))
    for (const [lat, lng] of [[44.5, 142.5], [37, 138], [34, 134], [31, 131], [39.5, 141]]) {
      const v = forecastPeakDay(lat, lng)
      expect(v).toBeGreaterThanOrEqual(lo)
      expect(v).toBeLessThanOrEqual(hi)
    }
    // 札幌(11/4)與仙台(11/24)之間,偏札幌的點比偏仙台的點早
    expect(forecastPeakDay(42, 141)).toBeLessThan(forecastPeakDay(39, 141))
  })
  it('整體趨勢:北海道比九州早轉紅(依來源預測日,札幌 11/4、福岡 12/7)', () => {
    expect(forecastPeakDay(43.5, 142)).toBeLessThan(forecastPeakDay(33, 131))
  })
})

describe('顏色', () => {
  it('端點:s=0 是綠(g 最大)、s=1 是深紅(r 遠大於 g/b)', () => {
    const [r0, g0, b0] = leafRgb(0, 0.5, 0)
    expect(g0).toBeGreaterThan(r0)
    expect(g0).toBeGreaterThan(b0)
    const [r1, g1, b1] = leafRgb(1, 0.5, 0)
    expect(r1).toBeGreaterThan(g1 * 3)
    expect(r1).toBeGreaterThan(b1 * 3)
  })
  it('綠色階段的個體差異只在 s<0.2 生效,轉色後 hueJ 不影響結果', () => {
    expect(leafRgb(0, 0, 0)).not.toEqual(leafRgb(0, 1, 0))
    expect(leafRgb(0.5, 0, 0)).toEqual(leafRgb(0.5, 1, 0))
  })
  it('輸入超界不會產生非法色值', () => {
    for (const s of [-1, 0, 0.5, 1, 2]) for (const v of leafRgb(s, 0.9, 0.08)) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of leafRgb(2, 0.9, 0.08)) expect(v).toBeLessThanOrEqual(255)
  })
})

describe('楓葉生成', () => {
  it('pointInRing:正方形內外', () => {
    expect(pointInRing(5, 5, SQUARE)).toBe(true)
    expect(pointInRing(11, 5, SQUARE)).toBe(false)
    expect(pointInRing(5, -1, SQUARE)).toBe(false)
  })
  it('mulberry32:同 seed 同序列、值在 [0,1)', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 20; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  it('只落在陸地內、數量正確、同 seed 結果一致', () => {
    const f1 = createMomijiField([SQUARE], 200, 1, peakAt)
    const f2 = createMomijiField([SQUARE], 200, 1, peakAt)
    expect(f1.leaves).toHaveLength(200)
    expect(f1.leaves).toEqual(f2.leaves)
    for (const l of f1.leaves) expect(pointInRing(l.lng, l.lat, SQUARE)).toBe(true)
  })
  it('u 歸一化到 0..1,且與經緯度沿風的方向的位置一致(越南 u 越大,風由北往南掃)', () => {
    const { leaves } = createMomijiField([SQUARE], 300, 2, peakAt)
    for (const l of leaves) {
      expect(l.u).toBeGreaterThanOrEqual(0)
      expect(l.u).toBeLessThanOrEqual(1)
    }
    const first = leaves.reduce((m, l) => (rawU(l.lng, l.lat) < rawU(m.lng, m.lat) ? l : m))
    const last = leaves.reduce((m, l) => (rawU(l.lng, l.lat) > rawU(m.lng, m.lat) ? l : m))
    expect(first.u).toBeCloseTo(0)
    expect(last.u).toBeCloseTo(1)
    expect(first.lat).toBeGreaterThan(last.lat) // 風的方向朝南:u=0 是北端
    expect(AXIS_DIR.y).toBeLessThan(0)
  })
  it('由北到南排序(南邊的葉子後畫)', () => {
    const { leaves } = createMomijiField([SQUARE], 100, 3, peakAt)
    for (let i = 1; i < leaves.length; i++) expect(leaves[i].lat).toBeLessThanOrEqual(leaves[i - 1].lat)
  })
  it('peakDay 在內插值上下各 1.5 天內抖動,同 seed 結果一致', () => {
    const { leaves } = createMomijiField([SQUARE], 200, 4, peakAt)
    for (const l of leaves) expect(Math.abs(l.peakDay - peakAt(l.lat))).toBeLessThanOrEqual(1.5)
  })
  it('單調:任一天轉紅的比例不會比前一天少', () => {
    const { leaves } = createMomijiField([SQUARE], 300, 5, peakAt)
    let prev = -1
    for (let d = 0; d <= 40; d++) {
      const share = redShare(leaves.map((l) => leafTarget(d, l.peakDay)))
      expect(share).toBeGreaterThanOrEqual(prev)
      prev = share
    }
    expect(prev).toBe(100)
  })
  it('linePoint:u 越大,參考點沿風的方向越往南', () => {
    const field = createMomijiField([SQUARE], 200, 6, peakAt)
    const a = linePoint(field, 0.2)
    const b = linePoint(field, 0.8)
    expect(rawU(b.lng, b.lat)).toBeGreaterThan(rawU(a.lng, a.lat))
    expect(rawU(a.lng, a.lat)).toBeCloseTo(field.uToRaw(0.2))
    expect(AXIS_DIR.x ** 2 + AXIS_DIR.y ** 2).toBeCloseTo(1)
  })
})

describe('redShare', () => {
  it('空陣列是 0;占比四捨五入成整數百分比', () => {
    expect(redShare([])).toBe(0)
    expect(redShare([0.9, 0.9, 0.1, 0.1])).toBe(50)
    expect(redShare([0.78, 0.79])).toBe(50)
  })
})

describe('預測資料檔', () => {
  it('來源標示完整,發表日是 2026-10-01', () => {
    expect(FORECAST_SOURCE.announcedOn).toBe('2026-10-01')
    expect(FORECAST_SOURCE.url).toContain('n-kishou.com')
  })
  it('14 個都市、id 不重複、座標落在日本範圍內', () => {
    expect(CITY_FORECASTS).toHaveLength(14)
    expect(new Set(CITY_FORECASTS.map((c) => c.id)).size).toBe(14)
    for (const c of CITY_FORECASTS) {
      expect(c.lat).toBeGreaterThan(30)
      expect(c.lat).toBeLessThan(46)
      expect(c.lng).toBeGreaterThan(129)
      expect(c.lng).toBeLessThan(146)
    }
  })
  it('每筆的 deltaDays 等於「預測日 − 平年日」重新計算的結果(抓抄錯日期)', () => {
    for (const c of CITY_FORECASTS) {
      for (const season of [c.momiji, c.ginkgo]) {
        expect(daysBetween(monthDayToDate(season.normal), monthDayToDate(season.peak)), `${c.name} ${season.peak}`).toBe(season.deltaDays)
      }
    }
  })
  it('抽查幾筆與來源頁一致:札幌 紅葉 11/4、東京 紅葉 11/28、京都 紅葉 12/11、福岡 黃葉 11/28', () => {
    const by = (id: string) => CITY_FORECASTS.find((c) => c.id === id)!
    expect(by('sapporo').momiji.peak).toBe('11-04')
    expect(by('tokyo').momiji.peak).toBe('11-28')
    expect(by('kyoto').momiji.peak).toBe('12-11')
    expect(by('fukuoka').ginkgo.peak).toBe('11-28')
  })
  it('日期格式 MM-DD 且都在模擬範圍內', () => {
    for (const c of CITY_FORECASTS) {
      expect(c.momiji.peak).toMatch(/^\d{2}-\d{2}$/)
      const d = cityPeakDay(c.momiji.peak)
      expect(d).toBeGreaterThanOrEqual(RIPEN_DAYS)
      expect(d).toBeLessThanOrEqual(TOTAL_DAYS)
    }
  })
})

describe('賞楓景點資料檔', () => {
  it('id 與名稱不重複、座標落在日本範圍內、必填欄位都有值', () => {
    expect(new Set(MOMIJI_SPOTS.map((s) => s.id)).size).toBe(MOMIJI_SPOTS.length)
    expect(new Set(MOMIJI_SPOTS.map((s) => s.name)).size).toBe(MOMIJI_SPOTS.length)
    for (const s of MOMIJI_SPOTS) {
      expect(s.name && s.area && s.kind, s.id).toBeTruthy()
      expect(s.lat).toBeGreaterThan(30)
      expect(s.lat).toBeLessThan(46)
      expect(s.lng).toBeGreaterThan(129)
      expect(s.lng).toBeLessThan(146)
    }
  })
  it('每個景點都落在(簡化後的)陸地範圍附近:離最近的楓葉叢不超過 0.6 度', () => {
    const { leaves } = createJapanField()
    for (const s of MOMIJI_SPOTS) {
      const near = Math.min(...leaves.map((l) => Math.hypot(l.lat - s.lat, (l.lng - s.lng) * 0.79)))
      expect(near, s.name).toBeLessThan(0.6)
    }
  })
})

describe('日本陸地資料', () => {
  it('頁面實際用的楓葉場:全部落在日本座標範圍、四大島都有葉子', () => {
    const field = createJapanField()
    expect(field.leaves).toHaveLength(300)
    for (const l of field.leaves) {
      expect(l.lat).toBeGreaterThan(30)
      expect(l.lat).toBeLessThan(46)
      expect(l.lng).toBeGreaterThan(129)
      expect(l.lng).toBeLessThan(146)
    }
    // 北海道、九州、四國、本州各自至少有一片葉子(用粗略範圍判斷)
    const has = (f: (lat: number, lng: number) => boolean) => field.leaves.some((l) => f(l.lat, l.lng))
    expect(has((lat) => lat > 42)).toBe(true) // 北海道
    expect(has((lat, lng) => lat < 33 && lng < 131.5)).toBe(true) // 九州
    expect(has((lat, lng) => lat > 33 && lat < 34 && lng > 132.5 && lng < 134)).toBe(true) // 四國
    expect(has((lat, lng) => lat > 35 && lat < 40 && lng > 137)).toBe(true) // 本州
  })
  it('每片葉子都在某個陸地多邊形內', () => {
    for (const l of createJapanField().leaves) {
      expect(JAPAN_LAND.some((ring) => pointInRing(l.lng, l.lat, ring))).toBe(true)
    }
  })
})
