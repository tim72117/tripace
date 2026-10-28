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

  describe('高細節 GLB', () => {
    const withGlb = (): SceneModule => ({ ...mod(), glbModels: { m1: { url: '/m1.glb', unit: 0.5 } } })
    const scene = { name: 'fake-scene' } as never
    const mk = (loadGlb: (url: string) => Promise<never>) => createSceneRegistry([def('a', async () => withGlb())], 'a', shared, loadGlb)

    it('load:把 GLB 掛在同 id 的模型上(連同 unit),宣告式欄位保留', async () => {
      const r = mk(async () => scene)
      const data = await r.load('a')
      expect(data.models.m1).toMatchObject({ name: 'm1', glb: { scene, unit: 0.5 } })
    })
    it('loadBase:不載入 GLB(首頁縮小版不該為它下載)', async () => {
      const loadGlb = vi.fn(async () => scene)
      const r = mk(loadGlb)
      const data = await r.loadBase('a')
      expect(data.models.m1).toEqual({ name: 'm1' })
      expect(loadGlb).not.toHaveBeenCalled()
    })
    it('GLB 載入失敗:沿用宣告式後備、不 reject、只記警告', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const r = mk(async () => { throw new Error('404') })
      const data = await r.load('a')
      expect(data.models.m1).toEqual({ name: 'm1' })
      expect(warn).toHaveBeenCalledOnce()
      warn.mockRestore()
    })
    it('GLB 載入失敗不留快取:下次 load 會重新嘗試高細節版,成功後才快取', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const loadGlb = vi.fn<(url: string) => Promise<never>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(scene)
      const r = mk(loadGlb)
      const first = await r.load('a')
      expect(first.models.m1).toEqual({ name: 'm1' }) // 第一次:簡化版
      const second = await r.load('a')
      expect(second.models.m1).toMatchObject({ glb: { scene, unit: 0.5 } }) // 重試成功
      expect(loadGlb).toHaveBeenCalledTimes(2)
      await r.load('a')
      expect(loadGlb).toHaveBeenCalledTimes(2) // 成功後才快取
      warn.mockRestore()
    })
    it('GLB 逾時視同失敗:沿用簡化版、不卡住場景,且不快取這次結果', async () => {
      vi.useFakeTimers()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const loadGlb = vi.fn<(url: string) => Promise<never>>(() => new Promise(() => {})) // 永遠不回
      const r = createSceneRegistry([def('a', async () => withGlb())], 'a', shared, loadGlb, 1000)
      const pending = r.load('a')
      await vi.advanceTimersByTimeAsync(1001)
      const data = await pending
      expect(data.models.m1).toEqual({ name: 'm1' })
      expect(warn).toHaveBeenCalledOnce()
      const again = r.load('a')
      await vi.advanceTimersByTimeAsync(1001)
      await again
      expect(loadGlb).toHaveBeenCalledTimes(2) // 沒被快取,第二次又試了一次
      warn.mockRestore()
      vi.useRealTimers()
    })
    it('基本版與完整版各自快取,GLB 只載一次;基本版的結果不被完整版改動', async () => {
      const loadGlb = vi.fn(async () => scene)
      const r = mk(loadGlb)
      const base = await r.loadBase('a')
      await Promise.all([r.load('a'), r.load('a')])
      await r.load('a')
      expect(loadGlb).toHaveBeenCalledTimes(1)
      expect((await r.loadBase('a')).models.m1).toEqual({ name: 'm1' })
      expect(base.models.m1).toEqual({ name: 'm1' })
    })
    it('版面沒用到的模型 id 不載入它的 GLB', async () => {
      const loadGlb = vi.fn(async () => scene)
      const r = createSceneRegistry([def('a', async () => ({ ...mod(), glbModels: { unused: { url: '/x.glb', unit: 1 } } }))], 'a', shared, loadGlb)
      await r.load('a')
      expect(loadGlb).not.toHaveBeenCalled()
    })
  })
})
