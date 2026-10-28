import { describe, expect, it, vi } from 'vitest'
import { createSceneRegistry } from './registry'
import type { SceneDef, SceneModule } from './types'

const layout = { stops: [{ model: 'm1' }], scatter: [] } as unknown as SceneModule['layout']
const mod = (): SceneModule => ({ layout, article: { slug: 's', content: { title: 't', blocks: [] } }, byline: { name: 'x' }, pathPointY: [], modelLoaders: {} })
const def = (id: string, load: () => Promise<SceneModule> = async () => mod()): SceneDef => ({
  id, label: id, pageLabel: id, ctaLabel: id, seo: { title: id, description: id }, load,
})
const shared = { '../models/m1.ts': async () => ({ name: 'm1' }) }

describe('createSceneRegistry', () => {
  it('網址:預設場景是 /island,其餘 /island/<id>', () => {
    const r = createSceneRegistry([def('a'), def('b')], 'a', shared)
    expect(r.href('a')).toBe('/island')
    expect(r.href('b')).toBe('/island/b')
    expect(r.get('b')?.id).toBe('b')
    expect(r.get('zzz')).toBeUndefined()
  })
  it('預設場景不在清單裡就丟錯', () => {
    expect(() => createSceneRegistry([def('a')], 'x', shared)).toThrow()
  })
  it('load:只載入版面用到的模型,並去掉 modelLoaders', async () => {
    const r = createSceneRegistry([def('a')], 'a', { ...shared, '../models/other.ts': async () => { throw new Error('不該載入') } })
    const data = await r.load('a')
    expect(Object.keys(data.models)).toEqual(['m1'])
    expect('modelLoaders' in data).toBe(false)
  })
  it('同一場景只載入一次(進行中與完成後都共用)', async () => {
    const load = vi.fn(async () => mod())
    const r = createSceneRegistry([def('a', load)], 'a', shared)
    await Promise.all([r.load('a'), r.load('a')])
    await r.load('a')
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('失敗不留快取:重試會重新載入', async () => {
    const load = vi.fn<() => Promise<SceneModule>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(mod())
    const r = createSceneRegistry([def('a', load)], 'a', shared)
    await expect(r.load('a')).rejects.toThrow('offline')
    await expect(r.load('a')).resolves.toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('未知場景 load 會 reject;preload 未知或失敗都不丟錯', async () => {
    const r = createSceneRegistry([def('a', async () => { throw new Error('x') })], 'a', shared)
    await expect(r.load('nope')).rejects.toThrow()
    expect(() => r.preload('nope')).not.toThrow()
    r.preload('a')
    await new Promise((res) => setTimeout(res, 0)) // 失敗被吞掉,沒有 unhandled rejection
  })
})

describe('範例小島的 feature flag(VITE_FEATURE_ISLAND_SAMPLE)', () => {
  async function loadRegistry(flag: string) {
    vi.resetModules()
    vi.stubEnv('VITE_FEATURE_ISLAND_SAMPLE', flag)
    try { return await import('./registry') } finally { vi.unstubAllEnvs() }
  }
  it('預設(沒設或不是 "true")關閉:場景清單只有九份,範例島的網址也找不到', async () => {
    for (const flag of ['', 'false', '1']) {
      const r = await loadRegistry(flag)
      expect(r.SCENES.map((s) => s.id), `flag=${JSON.stringify(flag)}`).toEqual(['night-jiufen'])
      expect(r.getScene('sample-islet')).toBeUndefined()
      expect(r.ISLAND_SAMPLE_ENABLED).toBe(false)
    }
  })
  it('設為 "true" 才出現,並且標成實驗場景', async () => {
    const r = await loadRegistry('true')
    expect(r.SCENES.map((s) => s.id)).toEqual(['night-jiufen', 'sample-islet'])
    expect(r.getScene('sample-islet')?.experimental).toBe(true)
    expect(r.ISLAND_SAMPLE_ENABLED).toBe(true)
  })
})
