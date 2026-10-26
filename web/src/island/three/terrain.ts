// terrain.ts——島體、階地、島底、河(three 渲染層,依 layout 資料建 mesh,建構一次)。
//
// 座標:layout 的 (x, z) 對應 three 的 (x, z),+y 向上。
// 擠出:ExtrudeGeometry 的 Shape 在 XY 平面、沿 +Z 擠出。繞 X 軸轉 -90° 後 (x, y, z) → (x, z, -y),
// 所以 Shape 的 y 要餵 -z(轉回來才是 z),擠出方向 +Z 變成 +Y(向上)。擠出深度 = 厚度,
// 轉完後 mesh 範圍是 y ∈ [0, depth],再平移 (頂面高度 - depth) 讓頂面落在指定高度。
import * as THREE from 'three'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { mulberry32 } from '../logic/rng'
import { polygonCentroid } from '../logic/geometry'

const STONE_WALL = '#8a8478'

function extrudePolygon(outline: ReadonlyArray<Pt>, depth: number, topY: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, topY - depth, 0)
  return geo
}

const flat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...extra })

// undersideGeometry——島底:幾層逐漸內縮、高度隨機下沉的環,最後收成一個尖點,做出懸空島的岩石底。
export function undersideGeometry(outline: ReadonlyArray<Pt>, baseY: number, depth: number, seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed)
  const [cx, cz] = polygonCentroid(outline)
  const rings: Array<Array<[number, number, number]>> = []
  const levels = [{ k: 1, dy: 0 }, { k: 0.74, dy: 0.32 }, { k: 0.46, dy: 0.62 }, { k: 0.2, dy: 0.86 }]
  for (const { k, dy } of levels) {
    rings.push(outline.map(([x, z]) => {
      const j = 0.82 + rnd() * 0.36 // 每個頂點各自抖動,輪廓才參差
      return [cx + (x - cx) * k * j, baseY - depth * dy * (0.78 + rnd() * 0.44), cz + (z - cz) * k * j]
    }))
  }
  const tip: [number, number, number] = [cx + (rnd() - 0.5) * 4, baseY - depth * (1.15 + rnd() * 0.15), cz + (rnd() - 0.5) * 4]
  const pos: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c)
  const n = outline.length
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const a = rings[r][i], b = rings[r][j], c = rings[r + 1][j], d = rings[r + 1][i]
      tri(a, d, b) // 朝外的面(輪廓順時針、由上往下看)
      tri(b, d, c)
    }
  }
  const last = rings[rings.length - 1]
  for (let i = 0; i < n; i++) tri(last[i], tip, last[(i + 1) % n])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.computeVertexNormals()
  return geo
}

export type Terrain = { group: THREE.Group; water: THREE.Mesh | null; update(time: number): void }

export function buildTerrain(layout: IslandLayout, heightAt: (x: number, z: number) => number): Terrain {
  const group = new THREE.Group()
  const { palette, outline, topY, thickness } = layout

  // 島體:頂面草地、側面泥土
  const body = new THREE.Mesh(extrudePolygon(outline, thickness, topY), [flat(palette.grass), flat(palette.dirt)])
  body.receiveShadow = true
  body.castShadow = true
  group.add(body)

  // 島底岩石
  const under = new THREE.Mesh(undersideGeometry(outline, topY - thickness, thickness * 2.2, 7), flat(palette.dirt, { roughness: 1 }))
  under.castShadow = true
  group.add(under)

  // 階地:每塊往下多埋一點避免 z-fighting;頂面草色、側面是擋土石牆
  for (const t of layout.terraces ?? []) {
    const mesh = new THREE.Mesh(
      extrudePolygon(t.outline, t.y - topY + 0.25, t.y),
      [flat(t.color ?? palette.grassAlt), flat(STONE_WALL)],
    )
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
  }

  // 河:沿中線的帶狀網格,略低於地面,用滾動的條紋貼圖做流動感
  let water: THREE.Mesh | null = null
  const rp = layout.river?.points ?? []
  if (rp.length >= 2 && layout.river.width > 0) {
    const half = layout.river.width / 2
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let s = 0
    rp.forEach(([x, z], i) => {
      const [px, pz] = rp[Math.max(0, i - 1)]
      const [nx, nz] = rp[Math.min(rp.length - 1, i + 1)]
      const dx = nx - px, dz = nz - pz
      const dl = Math.hypot(dx, dz) || 1
      const ox = (-dz / dl) * half, oz = (dx / dl) * half
      if (i > 0) s += Math.hypot(x - rp[i - 1][0], z - rp[i - 1][1])
      const y = heightAt(x, z) - 0.12
      pos.push(x + ox, y, z + oz, x - ox, y, z - oz)
      uv.push(0, s / 4, 1, s / 4)
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const tex = stripeTexture(palette.water, palette.waterDeep)
    water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0, flatShading: true }))
    water.receiveShadow = true
    group.add(water)
  }

  return {
    group,
    water,
    update(time) {
      const m = water?.material as THREE.MeshStandardMaterial | undefined
      if (m?.map) m.map.offset.y = -time * 0.18
    },
  }
}

// 程式生成的條紋貼圖(河水流動用):水色與深水色的橫向波紋,可重複。
export function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = a
  g.fillRect(0, 0, 64, 128)
  g.strokeStyle = b
  g.lineWidth = 5
  for (let i = 0; i < 4; i++) {
    g.beginPath()
    for (let x = 0; x <= 64; x += 4) {
      const y = i * 32 + 16 + Math.sin((x / 64) * Math.PI * 2 + i) * 5
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
