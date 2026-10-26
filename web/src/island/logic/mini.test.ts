import { describe, expect, it } from 'vitest'
import { autoRotateEnabled, cameraDistance, miniGlow, miniLightBoost, POOL_RADIUS_MAX, POOL_RADIUS_MIN, poolRadius, presetMinutes, rotationAt, shouldDrawFrame, shouldRun } from './mini'

describe('縮小版固定光照預設', () => {
  it('亮色主題 17:30、暗色主題 19:30', () => {
    expect(presetMinutes('light')).toBe(17 * 60 + 30)
    expect(presetMinutes('dark')).toBe(19 * 60 + 30)
  })
})

describe('shouldRun(省電)', () => {
  const ok = { intersecting: true, docVisible: true, webgl: true, contextLost: false }
  it('全部條件成立才跑', () => expect(shouldRun(ok)).toBe(true))
  it('任何一項不成立都停', () => {
    expect(shouldRun({ ...ok, intersecting: false })).toBe(false)
    expect(shouldRun({ ...ok, docVisible: false })).toBe(false)
    expect(shouldRun({ ...ok, webgl: false })).toBe(false)
    expect(shouldRun({ ...ok, contextLost: true })).toBe(false)
  })
})

describe('其他', () => {
  it('減少動態時不自動旋轉', () => {
    expect(autoRotateEnabled(true)).toBe(false)
    expect(autoRotateEnabled(false)).toBe(true)
  })
  it('cameraDistance:球剛好放進視野(正方形時由垂直視角決定),窄畫面距離更遠', () => {
    const v = 28
    const d = cameraDistance(10, v, 1, 1)
    expect(d).toBeCloseTo(10 / Math.sin((v * Math.PI) / 180 / 2), 5)
    expect(cameraDistance(10, v, 0.5, 1)).toBeGreaterThan(d) // 窄:水平視角較小
    expect(cameraDistance(10, v, 2, 1)).toBeCloseTo(d, 5) // 寬:仍由垂直視角決定
    expect(cameraDistance(10, v, 1, 1.2)).toBeCloseTo(d * 1.2, 5)
    expect(cameraDistance(20, v, 1)).toBeCloseTo(cameraDistance(10, v, 1) * 2, 5)
  })
})

describe('rotationAt(只自動旋轉、不能拖曳)', () => {
  it('每一圈回到原點、半圈是 π、與幀率無關(只看時間)', () => {
    expect(rotationAt(0, 40)).toBe(0)
    expect(rotationAt(20, 40)).toBeCloseTo(Math.PI)
    expect(rotationAt(40, 40)).toBeCloseTo(0)
    expect(rotationAt(130, 40)).toBeCloseTo(rotationAt(10, 40))
  })
  it('單調遞增(同一圈內)、關閉或週期不合法時固定為 0', () => {
    let prev = -1
    for (let t = 0; t < 40; t += 1) { const a = rotationAt(t, 40); expect(a).toBeGreaterThan(prev); prev = a }
    expect(rotationAt(17, 40, false)).toBe(0)
    expect(rotationAt(17, 0)).toBe(0)
  })
})

describe('縮小版補亮係數', () => {
  it('兩套主題都比完整版亮(每個係數都大於 1),夜晚月光的補亮倍率最大', () => {
    for (const th of ['light', 'dark'] as const) {
      const b = miniLightBoost(th)
      expect(b.hemi).toBeGreaterThan(1)
      expect(b.sun).toBeGreaterThan(1)
      expect(b.exposure).toBeGreaterThan(1)
    }
    expect(miniLightBoost('dark').sun).toBeGreaterThan(miniLightBoost('light').sun)
  })
})

describe('shouldDrawFrame(30fps 節流)', () => {
  const I = 1 / 30
  it('累積不足一個間隔不畫、達到就畫(含邊界)', () => {
    expect(shouldDrawFrame(0.01, I)).toBe(false)
    expect(shouldDrawFrame(I, I)).toBe(true)
    expect(shouldDrawFrame(I - 1e-9, I)).toBe(true) // 浮點誤差內視為達到
    expect(shouldDrawFrame(0.05, I)).toBe(true)
  })
  it('間隔 <= 0 表示不節流(每幀都畫);60Hz 螢幕上約每兩幀畫一次', () => {
    expect(shouldDrawFrame(0, 0)).toBe(true)
    let acc = 0, drawn = 0
    for (let i = 0; i < 60; i++) { acc += 1 / 60; if (shouldDrawFrame(acc, I)) { drawn++; acc = 0 } }
    expect(drawn).toBeGreaterThanOrEqual(29)
    expect(drawn).toBeLessThanOrEqual(31)
  })
})

describe('miniGlow(暗色的自發光)', () => {
  it('暗色啟用點光源與地面光斑,亮色全部關閉', () => {
    const d = miniGlow('dark'), l = miniGlow('light')
    expect(d.pointLight).toBeGreaterThan(0)
    expect(d.groundPool).toBeGreaterThan(0)
    expect(l.pointLight).toBe(0)
    expect(l.groundPool).toBe(0)
  })
  it('暗色燈籠亮起的亮度大於亮色,且都大於 1(才會在色調映射後飽和發光);光斑不透明度在 0~1', () => {
    expect(miniGlow('dark').lampOn).toBeGreaterThan(miniGlow('light').lampOn)
    expect(miniGlow('light').lampOn).toBeGreaterThan(1)
    expect(miniGlow('dark').groundPool).toBeLessThanOrEqual(1)
  })
})

describe('poolRadius(地面光斑半徑)', () => {
  it('小物件取下限、大物件取上限、中間隨縮放線性成長', () => {
    expect(poolRadius(0.5)).toBe(POOL_RADIUS_MIN)
    expect(poolRadius(16)).toBe(POOL_RADIUS_MAX)
    expect(poolRadius(2.5)).toBeCloseTo(5.5)
    expect(poolRadius(3)).toBeGreaterThan(poolRadius(2))
  })
  it('結果永遠在上下限之間', () => {
    for (const sc of [0, 0.1, 1, 1.5, 4.7, 7, 14, 100]) {
      expect(poolRadius(sc)).toBeGreaterThanOrEqual(POOL_RADIUS_MIN)
      expect(poolRadius(sc)).toBeLessThanOrEqual(POOL_RADIUS_MAX)
    }
  })
})
