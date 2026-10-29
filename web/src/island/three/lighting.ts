// lighting.ts(three)——把 LightState 套到半球光與太陽/月光(同一盞平行光,不增減燈避免重編譯)。
import * as THREE from 'three'
import type { LightState } from '../logic/lighting'
import { snapToTexel } from '../logic/world/shadowFrame'

export function sunDirection(elevDeg: number, azimDeg: number): THREE.Vector3 {
  // 方位角約定:0° = 北 = -z,順時針 90° = 東 = +x;仰角 90° 指向 +y
  const e = (elevDeg * Math.PI) / 180
  const a = (azimDeg * Math.PI) / 180
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize()
}

export type IslandLights = {
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  // sunFrom:決定太陽方向(與陰影)的光線狀態,省略 = light。呼叫端用它讓方向分段跳動、顏色亮度照常連續。
  update(light: LightState, target: THREE.Vector3, sunFrom?: LightState): THREE.Vector3
  // shadowAround——陰影範圍改成以 center 為中心、半寬 half(公尺);中心對齊陰影貼圖的像素,鏡頭移動時影子邊緣不閃。
  // 只在陰影圖要重畫時呼叫(見 IslandApp 的 SHADOW_REFRESH_S)。不呼叫就維持建立時涵蓋整座島的範圍。
  shadowAround(center: THREE.Vector3, half: number): void
}

// 太陽(平行光)放在目標點沿光線方向 140 m 處:整座島(半徑約 72 m)都在陰影相機前方
const SUN_DISTANCE = 140

export function buildLights(shadowSize: number): IslandLights {
  const hemi = new THREE.HemisphereLight('#ffffff', '#445566', 1)
  const sun = new THREE.DirectionalLight('#ffffff', 1)
  sun.castShadow = shadowSize > 0
  if (shadowSize > 0) {
    sun.shadow.mapSize.set(shadowSize, shadowSize)
    const c = sun.shadow.camera
    c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 1; c.far = 406 // 涵蓋整座島(公尺)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
  }
  // 陰影範圍的中心:shadowAround 設定後,太陽位置一律以它為基準(update 只換方向),
  // 陰影相機才不會在補畫之間被拉回別的位置;還沒設定前用 update 傳入的 target
  let shadowCenter: THREE.Vector3 | null = null
  return {
    hemi,
    sun,
    shadowAround(center, half) {
      if (shadowSize <= 0) return
      const dir = sun.position.clone().sub(sun.target.position).normalize()
      // 光源座標的兩軸(垂直於光線方向),在這兩軸上對齊像素
      const right = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
      const up = new THREE.Vector3().crossVectors(right, dir)
      const u = center.dot(right), v = center.dot(up)
      const [su, sv] = snapToTexel(u, v, half, shadowSize)
      const c = center.clone().addScaledVector(right, su - u).addScaledVector(up, sv - v)
      shadowCenter = c
      sun.position.copy(c).addScaledVector(dir, SUN_DISTANCE)
      sun.target.position.copy(c)
      const cam = sun.shadow.camera
      if (cam.right !== half) {
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half
        cam.updateProjectionMatrix()
      }
    },
    update(light, target, sunFrom = light) {
      hemi.color.set(light.hemiSky)
      hemi.groundColor.set(light.hemiGround)
      hemi.intensity = light.hemiIntensity
      const dir = sunDirection(sunFrom.sunElevationDeg, sunFrom.sunAzimuthDeg)
      const base = shadowCenter ?? target
      sun.position.copy(base).addScaledVector(dir, SUN_DISTANCE)
      sun.target.position.copy(base)
      sun.color.set(light.sun)
      sun.intensity = light.sunIntensity
      return dir
    },
  }
}
