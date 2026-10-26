// sea.ts——海面與夜晚月光/燈火反光帶(不用 Reflector 這類要多渲染一次場景的做法)。
import * as THREE from 'three'
import type { LightState } from '../logic/lighting'

export type Sea = { group: THREE.Group; update(light: LightState, camAzimuth: number): void }

function glitterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256
    const w = 4 + Math.random() * 26
    g.globalAlpha = 0.25 + Math.random() * 0.6
    g.fillRect(32 - w / 2 + (Math.random() - 0.5) * 14, y, w, 2 + Math.random() * 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function buildSea(seaY: number, color: string): Sea {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.05, flatShading: true })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat)
  plane.rotation.x = -Math.PI / 2
  plane.position.y = seaY
  plane.receiveShadow = true
  group.add(plane)

  // 月光/燈火反光帶:朝鏡頭方向的長條,夜間才顯示,加法混合
  const gm = new THREE.MeshBasicMaterial({
    map: glitterTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffd9a0', fog: false,
  })
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(26, 120), gm)
  strip.rotation.x = -Math.PI / 2
  strip.position.y = seaY + 0.05
  group.add(strip)

  return {
    group,
    update(light, camAzimuth) {
      // 夜間(太陽強度低)才出現;帶子朝向鏡頭所在的方向
      gm.opacity = Math.max(0, Math.min(0.85, (0.9 - light.sunIntensity) * 1.1)) * (0.4 + light.lanternGlow * 0.6)
      strip.position.x = Math.sin(camAzimuth) * -70
      strip.position.z = Math.cos(camAzimuth) * -70
      strip.rotation.z = -camAzimuth
      gm.color.set(light.lanternGlow > 0.5 ? '#ffc880' : '#bcd0ff')
    },
  }
}
