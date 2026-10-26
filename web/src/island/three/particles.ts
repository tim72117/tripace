// particles.ts——蒸氣、天燈、螢火蟲(Points,CPU 每幀更新數百個點)。
//
// 都用加法混合(顏色 × 亮度 = 透明度),不用自訂 shader;數量由品質等級縮放。
import * as THREE from 'three'
import { mulberry32 } from '../logic/rng'
import { glowSpriteTexture } from './lanterns'

type Emitter = { x: number; y: number; z: number }

export type Particles = {
  group: THREE.Group
  update(time: number, dt: number, night: number): void
}

function pointsOf(count: number, size: number, tex: THREE.Texture, color: string): THREE.Points {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    map: tex, size, sizeAttenuation: true, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }))
  p.frustumCulled = false
  void color
  return p
}

export function buildParticles(
  steamEmitters: ReadonlyArray<Emitter>,
  fireflyCenter: Emitter,
  islandRadius: number,
  scale: number,
): Particles {
  const group = new THREE.Group()
  const tex = glowSpriteTexture()
  const rnd = mulberry32(99)

  // 蒸氣:每個發射點若干顆,往上飄、變大變淡、循環
  const perEmitter = Math.max(3, Math.round(12 * scale))
  const steamN = steamEmitters.length * perEmitter
  const steam = pointsOf(steamN, 2.6, tex, '#ffffff')
  const steamAge = Float32Array.from({ length: steamN }, () => rnd())
  group.add(steam)

  // 天燈:從島緣升起、緩慢搖擺,19:00 後才會亮
  const skyN = Math.max(4, Math.round(12 * scale))
  const sky = pointsOf(skyN, 4.2, tex, '#ffb060')
  const skySeed = Array.from({ length: skyN }, (_, i) => ({
    a: rnd() * Math.PI * 2, r: islandRadius * (0.55 + rnd() * 0.5), phase: rnd(), speed: 0.012 + rnd() * 0.012, i,
  }))
  group.add(sky)

  // 螢火蟲:輕便路一帶,夜間閃爍漂移
  const flyN = Math.max(8, Math.round(40 * scale))
  const fly = pointsOf(flyN, 1.5, tex, '#d8ff8a')
  const flySeed = Array.from({ length: flyN }, () => ({ ox: (rnd() - 0.5) * 16, oz: (rnd() - 0.5) * 16, oy: 0.8 + rnd() * 3, ph: rnd() * 6.28, sp: 0.4 + rnd() * 0.8 }))
  group.add(fly)

  const steamPos = steam.geometry.attributes.position as THREE.BufferAttribute
  const steamCol = steam.geometry.attributes.color as THREE.BufferAttribute
  const skyPos = sky.geometry.attributes.position as THREE.BufferAttribute
  const skyCol = sky.geometry.attributes.color as THREE.BufferAttribute
  const flyPos = fly.geometry.attributes.position as THREE.BufferAttribute
  const flyCol = fly.geometry.attributes.color as THREE.BufferAttribute

  return {
    group,
    update(time, dt, night) {
      for (let e = 0; e < steamEmitters.length; e++) {
        for (let k = 0; k < perEmitter; k++) {
          const i = e * perEmitter + k
          steamAge[i] = (steamAge[i] + dt * 0.18) % 1
          const a = steamAge[i]
          const em = steamEmitters[e]
          steamPos.setXYZ(i, em.x + Math.sin(time * 0.8 + i) * a * 0.9, em.y + a * 4.5, em.z + Math.cos(time * 0.6 + i * 1.3) * a * 0.9)
          const b = Math.sin(a * Math.PI) * 0.22 // 兩端淡出
          steamCol.setXYZ(i, b, b * 0.97, b * 0.92)
        }
      }
      steamPos.needsUpdate = true
      steamCol.needsUpdate = true

      const skyVis = Math.max(0, Math.min(1, (night - 0.55) * 2.2))
      for (const s of skySeed) {
        const t = (time * s.speed + s.phase) % 1
        skyPos.setXYZ(s.i, Math.cos(s.a + t * 0.6) * s.r + Math.sin(time * 0.7 + s.i) * 1.2, 4 + t * 55, Math.sin(s.a + t * 0.6) * s.r)
        const b = Math.sin(t * Math.PI) * skyVis
        skyCol.setXYZ(s.i, b * 1.0, b * 0.62, b * 0.25)
      }
      skyPos.needsUpdate = true
      skyCol.needsUpdate = true

      const flyVis = Math.max(0, Math.min(1, (night - 0.5) * 2))
      flySeed.forEach((f, i) => {
        flyPos.setXYZ(i, fireflyCenter.x + f.ox + Math.sin(time * f.sp + f.ph) * 1.6, fireflyCenter.y + f.oy + Math.sin(time * f.sp * 1.3 + f.ph) * 0.6, fireflyCenter.z + f.oz + Math.cos(time * f.sp + f.ph) * 1.6)
        const b = (0.35 + 0.65 * Math.max(0, Math.sin(time * 2.2 * f.sp + f.ph * 3))) * flyVis
        flyCol.setXYZ(i, b * 0.85, b, b * 0.5)
      })
      flyPos.needsUpdate = true
      flyCol.needsUpdate = true
    },
  }
}
