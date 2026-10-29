// lanterns.ts——燈籠層:一盞一盞沿步道亮起(視覺高潮)。
//
// 做法(計劃 4.7 的方案 ③):燈的部件用不受光照的 MeshBasicMaterial,頂點色 = 亮起時的顏色,
// 每個擺放(每盞)一個 instance,每幀用 instanceColor 的亮度控制「暗 → 亮」;不碰 shader,
// 每種模型的燈只多 1 次繪製呼叫。再疊一層加法混合的光暈 Points(顏色 × 亮度 = 淡入),
// 以及固定數量(不增減,避免 shader 重編譯)的 PointLight 真的照亮站點附近的地面與建築。
import * as THREE from 'three'
import type { LampSource } from './scatter'
import { lanternGlowAt, lanternJitter } from '../logic/lanternSchedule'

export type Lanterns = {
  group: THREE.Group
  lights: THREE.PointLight[]
  // opts.on:亮起時的亮度(預設 1.75);opts.lightScale:PointLight 強度倍率(預設 1)
  update(globalGlow: number, daylight: number, opts?: { on?: number; lightScale?: number }): void
  // 每盞燈的位置與當下亮度(粒子/反光用)
  glowAtPoint(x: number, z: number, radius: number): number
}

export function glowSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

type Source = {
  mesh: THREE.InstancedMesh
  order: number[]
  jitter: number[]
  glow: Float32Array
  pointStart: number // 這個來源的光暈點在總 Points 裡的起始索引
  pointsPerInstance: number
}

export function buildLanterns(
  sources: ReadonlyArray<LampSource>,
  orderOf: (x: number, z: number) => number, // (x,z) → 沿步道 u(0..1)
  stopLights: ReadonlyArray<{ x: number; y: number; z: number }>,
  opts: { pointLights: number; glowSize: number },
): Lanterns {
  const group = new THREE.Group()
  const srcs: Source[] = []
  const pointPos: number[] = []
  const tmp = new THREE.Vector3()

  sources.forEach((src, si) => {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true })
    const mesh = new THREE.InstancedMesh(src.lamps.geo, mat, src.matrices.length)
    src.matrices.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, new THREE.Color(0.4, 0.4, 0.4)) })
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    group.add(mesh)
    const pointStart = pointPos.length / 3
    src.matrices.forEach((m) => {
      for (const c of src.lamps.centers) { tmp.copy(c).applyMatrix4(m); pointPos.push(tmp.x, tmp.y, tmp.z) }
    })
    srcs.push({
      mesh,
      order: src.positions.map(([x, z]) => orderOf(x, z)),
      jitter: lanternJitter(src.matrices.length, 100 + si),
      glow: new Float32Array(src.matrices.length),
      pointStart,
      pointsPerInstance: src.lamps.centers.length,
    })
  })

  // 光暈 Points:顏色 × 亮度(加法混合下等同透明度),所以不用自訂 shader 就能逐點淡入
  const pg = new THREE.BufferGeometry()
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pointPos, 3))
  const pcol = new Float32Array(pointPos.length)
  pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3))
  const points = new THREE.Points(pg, new THREE.PointsMaterial({
    map: glowSpriteTexture(), size: opts.glowSize, sizeAttenuation: true, vertexColors: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }))
  points.frustumCulled = false
  group.add(points)

  // 固定數量的 PointLight(只改 intensity,不增減)
  const lights: THREE.PointLight[] = []
  for (let i = 0; i < Math.min(opts.pointLights, stopLights.length); i++) {
    const l = new THREE.PointLight('#ffb35c', 0, 47, 1.5)
    l.position.set(stopLights[i].x, stopLights[i].y + 6.25, stopLights[i].z)
    group.add(l)
    lights.push(l)
  }

  const warm = new THREE.Color('#ff9a3c')
  const col = new THREE.Color()
  return {
    group,
    lights,
    update(globalGlow, daylight, opts) {
      // 暗時(白天)像一般紅燈籠,亮時超過 1 讓 ACES 色調映射後仍飽和
      const off = 0.32 + 0.55 * Math.max(0, Math.min(1, daylight))
      const on = opts?.on ?? 1.75
      for (const s of srcs) {
        s.glow = lanternGlowAt(globalGlow, s.order, s.jitter)
        for (let i = 0; i < s.glow.length; i++) {
          s.mesh.setColorAt(i, col.setScalar(off + (on - off) * s.glow[i]))
          for (let k = 0; k < s.pointsPerInstance; k++) {
            const pi = (s.pointStart + i * s.pointsPerInstance + k) * 3
            const g = s.glow[i] * 0.9
            pcol[pi] = warm.r * g; pcol[pi + 1] = warm.g * g; pcol[pi + 2] = warm.b * g
          }
        }
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true
      }
      pg.attributes.color.needsUpdate = true
      // 每盞 PointLight 的強度 = 該站附近燈籠的平均亮度
      const lightScale = opts?.lightScale ?? 1
      // 半徑與強度是 1 格 = 1 m 換算後的值(換算前 14 格、26):點光源衰減 decay 1.5,距離放大 1.5625 倍時強度要乘 1.5625^1.5 才一樣亮
      lights.forEach((l) => { l.intensity = this.glowAtPoint(l.position.x, l.position.z, 21.875) * 50.8 * lightScale })
    },
    glowAtPoint(x, z, radius) {
      let sum = 0, n = 0
      for (const s of srcs) {
        const positions = sources[srcs.indexOf(s)].positions
        for (let i = 0; i < positions.length; i++) {
          if (Math.hypot(positions[i][0] - x, positions[i][1] - z) <= radius) { sum += s.glow[i]; n++ }
        }
      }
      return n === 0 ? 0 : sum / n
    },
  }
}
