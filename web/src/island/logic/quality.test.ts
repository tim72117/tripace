import { describe, expect, it } from 'vitest'
import { buildCtaUrl } from './cta'
import { configFor, detectQuality } from './quality'

describe('品質偵測', () => {
  const desktop = { width: 1440, coarsePointer: false, cores: 10 }
  it('?q= 強制優先,非法值忽略', () => {
    expect(detectQuality('?q=low', desktop)).toBe('low')
    expect(detectQuality('?q=high', { width: 390, coarsePointer: true, cores: 4 })).toBe('high')
    expect(detectQuality('?q=ultra', desktop)).toBe('high')
  })
  it('桌機高核心 high、低核心 mid;手機低核心 low、高核心 mid', () => {
    expect(detectQuality('', desktop)).toBe('high')
    expect(detectQuality('', { ...desktop, cores: 4 })).toBe('mid')
    expect(detectQuality('', { width: 390, coarsePointer: true, cores: 6 })).toBe('low')
    expect(detectQuality('', { width: 390, coarsePointer: true, cores: 8 })).toBe('mid')
  })
  it('等級越低,陰影與粒子與像素比越少', () => {
    const [l, m, h] = [configFor('low'), configFor('mid'), configFor('high')]
    expect(l.shadowSize).toBe(0)
    expect(l.shadowSize).toBeLessThan(m.shadowSize)
    expect(m.shadowSize).toBeLessThan(h.shadowSize)
    expect(l.particleScale).toBeLessThan(m.particleScale)
    expect(m.particleScale).toBeLessThan(h.particleScale)
    expect(l.pixelRatioMax).toBeLessThanOrEqual(m.pixelRatioMax)
  })
})

describe('CTA 連結', () => {
  it('帶來源與站名參數', () => {
    const u = new URL(buildCtaUrl('https://tripace.io', { slug: 'night-jiufen', stopNames: ['基山街', '阿妹茶樓'] }))
    expect(u.pathname).toBe('/ai-plan')
    expect(u.searchParams.get('from')).toBe('island')
    expect(u.searchParams.get('article')).toBe('night-jiufen')
    expect(u.searchParams.get('stops')).toBe('基山街|阿妹茶樓')
  })
  it('沒有站名時不帶 stops', () => {
    expect(new URL(buildCtaUrl('https://tripace.io', { slug: 'x', stopNames: [] })).searchParams.has('stops')).toBe(false)
  })
})
