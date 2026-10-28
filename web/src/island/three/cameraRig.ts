// cameraRig.ts——封面視角、飛到某個關鍵幀(OrbitControls 範圍也在這裡設)。
import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { cameraAt, type CameraKey } from '../logic/tour'

// 最遠距離是島半徑的幾倍(OrbitControls.maxDistance;封面依畫面比例拉遠時也要在這之內)
export const MAX_DISTANCE_FACTOR = 3.6

export class CameraRig {
  private flight: { from: CameraKey; to: CameraKey; t0: number; ms: number } | null = null

  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls, islandRadius: number) {
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minPolarAngle = 0.35 // 不能從正上方看
    controls.maxPolarAngle = 1.38 // 不能看到島底以下太多(也避免海面反光帶穿幫)
    controls.minDistance = islandRadius * 0.35 // 導覽的站點鏡頭比封面近很多,下限太大會在導覽中被彈開
    controls.maxDistance = islandRadius * MAX_DISTANCE_FACTOR
  }

  get flying(): boolean { return this.flight !== null }

  // 探索模式要貼近人物,放寬縮放範圍;離開時還原
  setDistanceLimits(min: number, max: number) { this.controls.minDistance = min; this.controls.maxDistance = max }
  get distanceLimits(): [number, number] { return [this.controls.minDistance, this.controls.maxDistance] }

  current(): CameraKey {
    const t = this.controls.target
    const p = this.camera.position
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }
  }

  private apply(k: CameraKey) {
    this.camera.position.set(...k.pos)
    this.controls.target.set(...k.target)
    this.camera.lookAt(this.controls.target)
  }

  setInstant(k: CameraKey) { this.cancel(); this.apply(k) }

  flyTo(k: CameraKey, ms: number, now: number) {
    this.controls.enabled = false
    this.flight = { from: this.current(), to: k, t0: now, ms }
  }

  cancel() {
    this.flight = null
    this.controls.enabled = true
  }

  update(now: number) {
    if (!this.flight) return
    const { from, to, t0, ms } = this.flight
    const u = Math.min(1, (now - t0) / ms)
    this.apply(cameraAt([from, to], u))
    if (u >= 1) { this.flight = null; this.controls.enabled = true }
  }
}
