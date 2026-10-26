// lighting.ts(three)——把 LightState 套到半球光與太陽/月光(同一盞平行光,不增減燈避免重編譯)。
import * as THREE from 'three'
import type { LightState } from '../logic/lighting'

export function sunDirection(elevDeg: number, azimDeg: number): THREE.Vector3 {
  // 方位角約定:0° = 北 = -z,順時針 90° = 東 = +x;仰角 90° 指向 +y
  const e = (elevDeg * Math.PI) / 180
  const a = (azimDeg * Math.PI) / 180
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize()
}

export type IslandLights = {
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  update(light: LightState, target: THREE.Vector3): THREE.Vector3
}

export function buildLights(shadowSize: number): IslandLights {
  const hemi = new THREE.HemisphereLight('#ffffff', '#445566', 1)
  const sun = new THREE.DirectionalLight('#ffffff', 1)
  sun.castShadow = shadowSize > 0
  if (shadowSize > 0) {
    sun.shadow.mapSize.set(shadowSize, shadowSize)
    const c = sun.shadow.camera
    c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 1; c.far = 260
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
  }
  return {
    hemi,
    sun,
    update(light, target) {
      hemi.color.set(light.hemiSky)
      hemi.groundColor.set(light.hemiGround)
      hemi.intensity = light.hemiIntensity
      const dir = sunDirection(light.sunElevationDeg, light.sunAzimuthDeg)
      sun.position.copy(target).addScaledVector(dir, 90)
      sun.target.position.copy(target)
      sun.color.set(light.sun)
      sun.intensity = light.sunIntensity
      return dir
    },
  }
}
