// terrain.ts——島體、階地、島底、河(three 渲染層,依 layout 資料建 mesh,建構一次)。
//
// 座標:layout 的 (x, z) 對應 three 的 (x, z),+y 向上。
// 擠出:ExtrudeGeometry 的 Shape 在 XY 平面、沿 +Z 擠出。繞 X 軸轉 -90° 後 (x, y, z) → (x, z, -y),
// 所以 Shape 的 y 要餵 -z(轉回來才是 z),擠出方向 +Z 變成 +Y(向上)。擠出深度 = 厚度,
// 轉完後 mesh 範圍是 y ∈ [0, depth],再平移 (頂面高度 - depth) 讓頂面落在指定高度。
import * as THREE from 'three'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { mulberry32 } from '../logic/rng'
import { delaunay } from '../logic/delaunay'
import { polygonCentroid, pointInPolygon } from '../logic/geometry'
import { slopeHeightAt, type Slope } from '../logic/terrain'
import { fieldTerrainGeometry } from './terrainField'
import { DEFAULT_GRID, splitByCell } from './world/cellSplit'

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

// slopeGeometry——斜坡:頂面(多邊形三角化,每個頂點的高度由 slopeHeightAt 算,平面斜坡因此精確)加一圈
// 往下收到 floorY 的裙邊。非索引的三角形,flatShading 時才會有低多邊形的稜面感。
// 頂面三角形一律轉成朝上(法線 y > 0),裙邊朝外,不依賴輪廓是順時針還是逆時針。
// 頂面三角形排在緩衝區最前面,geometry.groups[0] 標出它們的範圍。
//
// 峭壁(s.crag):頂面改成「輪廓上每隔 h 一個點 + 內部抖動格點」的 Delaunay 三角剖分,所以不管輪廓多大、
// 稜面大小都一致(h = 10 / 2^detail);內部點依座標雜湊決定的高度只往上長(輪廓上不動、往內依距離淡入),
// 裙邊沿著輪廓上的每個點分格,與頂面共用同樣的點,所以沒有裂縫。
export function slopeGeometry(s: Slope, floorY: number): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const crag = s.crag
  const grass = new THREE.Color(s.color ?? '#86a35a')
  const rock = new THREE.Color(crag?.rockColor ?? '#8c7f6e')
  const push = (a: number[], b: number[], c: number[], upward: boolean, color?: THREE.Color) => {
    // 叉積 y 分量 = u.z * v.x - u.x * v.z:> 0 朝上
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    if (upward === ny > 0) pos.push(...a, ...b, ...c)
    else pos.push(...a, ...c, ...b)
    if (color) for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b)
  }
  const edgeDist = (x: number, z: number) =>
    Math.min(...s.outline.map(([x1, z1], i) => {
      const [x2, z2] = s.outline[(i + 1) % s.outline.length]
      const dx = x2 - x1, dz = z2 - z1
      const len2 = dx * dx + dz * dz
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2))
      return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t))
    }))
  const hashRnd = (x: number, z: number, salt: number) =>
    mulberry32((((Math.round(x * 1000 + 1e-6) * 73856093) ^ (Math.round(z * 1000 + 1e-6) * 19349663) ^ ((crag?.seed ?? 0) * 83492791) ^ salt) >>> 0))()
  // 高度:只做垂直方向的抖動(水平不動),且只往上長
  const vert = (x: number, z: number): [number, number, number] => {
    const y = slopeHeightAt(s, x, z)
    if (!crag || crag.amp === 0) return [x, y, z]
    const fade = Math.min(1, edgeDist(x, z) / (crag.amp * 3))
    return [x, y + hashRnd(x, z, 2) * crag.amp * fade, z]
  }

  // 輪廓(裙邊沿著它;峭壁時先在每條邊上補點,間隔不超過 h)
  const h = crag ? 10 / 2 ** Math.max(0, crag.detail) : 0
  const ring: Pt[] = []
  s.outline.forEach(([x1, z1], i) => {
    const [x2, z2] = s.outline[(i + 1) % s.outline.length]
    const k = crag ? Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / h)) : 1
    for (let j = 0; j < k; j++) ring.push([x1 + ((x2 - x1) * j) / k, z1 + ((z2 - z1) * j) / k])
  })

  if (!crag) {
    const contour = s.outline.map(([x, z]) => new THREE.Vector2(x, z))
    const v0 = (i: number): [number, number, number] => [s.outline[i][0], slopeHeightAt(s, s.outline[i][0], s.outline[i][1]), s.outline[i][1]]
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) push(v0(a), v0(b), v0(c), true)
  } else {
    // 內部點:抖動格點(抖動讓稜面大小不一),離輪廓太近的不要,免得和輪廓點擠在一起
    const xs = s.outline.map((p) => p[0]), zs = s.outline.map((p) => p[1])
    const pts: Pt[] = [...ring]
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += h) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += h) {
        const px = x + (hashRnd(x, z, 8) - 0.5) * h * 0.7
        const pz = z + (hashRnd(x, z, 9) - 0.5) * h * 0.7
        if (pointInPolygon(px, pz, s.outline) && edgeDist(px, pz) > h * 0.6) pts.push([px, pz])
      }
    }
    for (const [ia, ib, ic] of delaunay(pts)) {
      // 只留中心在輪廓內的三角形(凹處的外側三角形丟掉)
      if (!pointInPolygon((pts[ia][0] + pts[ib][0] + pts[ic][0]) / 3, (pts[ia][1] + pts[ib][1] + pts[ic][1]) / 3, s.outline)) continue
      const p = vert(...pts[ia]), q = vert(...pts[ib]), r = vert(...pts[ic])
      // 陡面用岩色、平緩處用草色,每塊再依雜湊明暗不同,看得出一片片稜面
      const nx = (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1])
      const nz = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
      const ny = Math.abs((q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]))
      const steep = ny / Math.hypot(nx, ny, nz) < 0.82
      const c = (steep ? rock : grass).clone().multiplyScalar(0.88 + hashRnd(p[0] + q[0] + r[0], p[2] + q[2] + r[2], 4) * 0.24)
      push(p, q, r, true, c)
    }
  }
  const topCount = pos.length / 3

  // 裙邊朝外:輪廓面積為正(用 x,z 的鞋帶公式)時,沿頂點順序的右手側是外側
  let area2 = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i]
    const [x2, z2] = ring[(i + 1) % n]
    area2 += x1 * z2 - x2 * z1
  }
  // 側壁的列數全輪廓共用:相鄰兩段在共用的點上,格點高度才會一致(各自算會留 T 字裂縫)
  const topAt = (x: number, z: number) => slopeHeightAt(s, x, z)
  const cxz = polygonCentroid(s.outline)
  const wallRows = Math.max(1, Math.ceil((Math.max(...ring.map(([x, z]) => topAt(x, z))) - floorY) / 1.4))
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a: [number, number, number] = [ring[i][0], topAt(ring[i][0], ring[i][1]), ring[i][1]]
    const b: [number, number, number] = [ring[j][0], topAt(ring[j][0], ring[j][1]), ring[j][1]]
    const dx = b[0] - a[0], dz = b[2] - a[2]
    // 邊 a→b 的外側法線方向(水平):面積為正時是 (dz, -dx),否則反向
    const out: [number, number] = area2 > 0 ? [dz, -dx] : [-dz, dx]
    const wtri = (p: number[], q: number[], r: number[]) => {
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
      const w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
      const nx = u[1] * w[2] - u[2] * w[1]
      const nz = u[0] * w[1] - u[1] * w[0]
      if (nx * out[0] + nz * out[1] >= 0) pos.push(...p, ...q, ...r)
      else pos.push(...p, ...r, ...q)
      if (crag) {
        const c = rock.clone().multiplyScalar(0.78 + hashRnd(p[0] + q[0] + r[0], p[1] + q[1] + r[1] + p[2] + q[2] + r[2], 7) * 0.3)
        for (let m = 0; m < 3; m++) col.push(c.r, c.g, c.b)
      }
    }
    if (!crag) {
      const a0: [number, number, number] = [a[0], floorY, a[2]]
      const b0: [number, number, number] = [b[0], floorY, b[2]]
      wtri(a, a0, b)
      wtri(b, a0, b0)
      continue
    }
    // 峭壁側面也做成稜面:沿高度分 wallRows 列,內部格點朝外抖動(只往外),頂緣、底緣與兩端不動
    const grid = (c: number, r: number): [number, number, number] => {
      const t = r / wallRows
      const x = c === 0 ? a[0] : b[0], z = c === 0 ? a[2] : b[2]
      const top = c === 0 ? a[1] : b[1]
      const y = top + (floorY - top) * t
      if (crag.amp === 0 || r === 0 || r === wallRows) return [x, y, z]
      // 內部列的點朝外(遠離輪廓中心)凸出,只往外;同一個輪廓點的兩側段共用,所以相鄰段接得上
      const dx2 = x - cxz[0], dz2 = z - cxz[1], dl = Math.hypot(dx2, dz2) || 1
      const k = hashRnd(x, z + y, 5) * crag.amp
      return [x + (dx2 / dl) * k, y, z + (dz2 / dl) * k]
    }
    for (let r = 0; r < wallRows; r++) {
      wtri(grid(0, r), grid(0, r + 1), grid(1, r))
      wtri(grid(1, r), grid(0, r + 1), grid(1, r + 1))
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  if (crag) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.addGroup(0, topCount, 0)
  geo.addGroup(topCount, pos.length / 3 - topCount, 0)
  geo.computeVertexNormals()
  return geo
}

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

// cells:連續地形的頂面依世界格子切開後,每格的網格(格子鍵 → 物件),給 three/world/cellRuntime.ts 串流與 LOD 用
export type Terrain = { group: THREE.Group; water: THREE.Mesh | null; cells: Map<string, THREE.Object3D[]>; update(time: number): void }

export function buildTerrain(layout: IslandLayout, heightAt: (x: number, z: number) => number): Terrain {
  const group = new THREE.Group()
  const cells = new Map<string, THREE.Object3D[]>()
  const { palette, outline, topY, thickness } = layout

  // 島底岩石
  const under = new THREE.Mesh(undersideGeometry(outline, topY - thickness, thickness * 2.2, 7), flat(palette.dirt, { roughness: 1 }))
  under.castShadow = true
  group.add(under)

  if (layout.terrain) {
    // 連續地形:頂面網格 + 切片土層側壁(沒有階地與斜坡的疊層,也不需要平的島體頂面)
    const { top, wall } = fieldTerrainGeometry(layout, heightAt)
    const mat = flat('#ffffff', { vertexColors: true })
    // 頂面依世界格子切開(每格自己的包圍球,視錐剔除才能整格略過);側壁沿島緣一圈,不切
    for (const [key, g] of splitByCell(top, layout.grid ?? DEFAULT_GRID)) {
      const m = new THREE.Mesh(g, mat)
      m.name = `terrain-cell-${key}`
      m.receiveShadow = true
      m.castShadow = true
      group.add(m)
      cells.set(key, [m])
    }
    top.dispose()
    const w = new THREE.Mesh(wall, mat)
    w.receiveShadow = true
    w.castShadow = true
    group.add(w)
  } else {
  // 島體:頂面草地、側面泥土
  const body = new THREE.Mesh(extrudePolygon(outline, thickness, topY), [flat(palette.grass), flat(palette.dirt)])
  body.receiveShadow = true
  body.castShadow = true
  group.add(body)

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

  // 斜坡:頂面用 grassAlt 色(或自訂色),裙邊用擋土石牆色;裙邊收到島表面(topY),被階地蓋住的部分看不到
  for (const sl of layout.slopes ?? []) {
    const mesh = new THREE.Mesh(
      slopeGeometry(sl, topY - 0.25),
      sl.crag ? flat('#ffffff', { vertexColors: true }) : flat(sl.color ?? palette.grassAlt),
    )
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
  }

  } // end 舊的階地/斜坡島體

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
    cells,
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
