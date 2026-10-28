// loadGlbScene 的失敗路徑與 prepareGlbScene 的約束。GLTFLoader 在這支檔案裡被替換,所以不和 glbLoader.test.ts(用真實檔案)放同一檔。
import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ parseAsync: vi.fn() }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parseAsync(buffer: ArrayBuffer, path: string) {
      return loader.parseAsync(buffer, path)
    }
  },
}))

const okResponse = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) })
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { EMISSIVE_DIVISOR, SHARED_RESOURCE, loadGlbScene, prepareGlbScene } from './glbLoader'

const emissiveMesh = (intensity = 2.4) => {
  const m = new THREE.MeshStandardMaterial({ emissive: '#ffcc88', emissiveIntensity: intensity })
  return new THREE.Mesh(new THREE.BoxGeometry(), m)
}

beforeEach(() => {
  fetchMock.mockReset()
  loader.parseAsync.mockReset()
})

describe('loadGlbScene', () => {
  it('網路失敗:reject,錯誤原樣往外丟(由 registry 接住改用簡化版);失敗後同一個網址可以重試(沒有殘留狀態)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(loadGlbScene('/a/x.glb')).rejects.toThrow('Failed to fetch')
    const scene = new THREE.Group().add(emissiveMesh())
    fetchMock.mockResolvedValueOnce(okResponse())
    loader.parseAsync.mockResolvedValueOnce({ scene })
    await expect(loadGlbScene('/a/x.glb')).resolves.toBe(scene)
  })
  it('HTTP 錯誤(404):訊息帶狀態碼與網址,不會去解析錯誤頁', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
    await expect(loadGlbScene('/a/x.glb')).rejects.toThrow(/HTTP 404.*\/a\/x\.glb/)
    expect(loader.parseAsync).not.toHaveBeenCalled()
  })
  it('成功:以網址所在目錄當資源路徑,回傳處理過的場景(發光強度已換算)', async () => {
    const scene = new THREE.Group().add(emissiveMesh(2.4))
    fetchMock.mockResolvedValueOnce(okResponse())
    loader.parseAsync.mockResolvedValueOnce({ scene })
    const out = await loadGlbScene('/assets/models/x.glb')
    expect(out).toBe(scene)
    expect(loader.parseAsync.mock.calls[0][1]).toBe('/assets/models/')
    expect(((scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(2.4 / EMISSIVE_DIVISOR, 6)
  })
  it('場景裡有多材質網格:丟錯(寧可明確失敗,也不要窗光默默不隨日夜連動)', async () => {
    const bad = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()])
    bad.name = 'wall'
    fetchMock.mockResolvedValueOnce(okResponse())
    loader.parseAsync.mockResolvedValueOnce({ scene: new THREE.Group().add(bad) })
    await expect(loadGlbScene('/a/x.glb')).rejects.toThrow(/wall.*2 個材質/)
  })
})

describe('prepareGlbScene', () => {
  it('冪等:重複呼叫不會再除一次發光強度', () => {
    const scene = new THREE.Group().add(emissiveMesh(2.4))
    prepareGlbScene(scene)
    prepareGlbScene(scene)
    expect(((scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(2.4 / EMISSIVE_DIVISOR, 6)
  })
  it('多個網格共用同一個材質:只換算一次', () => {
    const mat = new THREE.MeshStandardMaterial({ emissive: '#ffffff', emissiveIntensity: 3 })
    const scene = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat))
    prepareGlbScene(scene)
    expect(mat.emissiveIntensity).toBeCloseTo(3 / EMISSIVE_DIVISOR, 6)
  })
  it('幾何與材質標記為共用資源(卸載場景時不釋放)', () => {
    const mesh = emissiveMesh()
    prepareGlbScene(new THREE.Group().add(mesh))
    expect(mesh.geometry.userData[SHARED_RESOURCE]).toBe(true)
    expect((mesh.material as THREE.Material).userData[SHARED_RESOURCE]).toBe(true)
  })
})
