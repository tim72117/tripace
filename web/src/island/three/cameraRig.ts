// cameraRig.ts——封面視角、導覽運鏡、飛到某個關鍵幀(OrbitControls 範圍也在這裡設)。
import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { cameraAt, type CameraKey } from '../logic/tour'

export class CameraRig {
  private flight: { from: CameraKey; to: CameraKey; t0: number; ms: number } | null = null
  private tour: { keys: CameraKey[]; t0: number; ms: number; onProgress: (u: number) => void; onEnd: () => void } | null = null

  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls, islandRadius: number) {
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minPolarAngle = 0.35 // 不能從正上方看
    controls.maxPolarAngle = 1.38 // 不能看到島底以下太多(也避免海面反光帶穿幫)
    controls.minDistance = islandRadius * 0.7
    controls.maxDistance = islandRadius * 3.6
  }

  get touring(): boolean { return this.tour !== null }

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
    this.tour = null
    this.controls.enabled = false
    this.flight = { from: this.current(), to: k, t0: now, ms }
  }

  startTour(keys: CameraKey[], ms: number, now: number, onProgress: (u: number) => void, onEnd: () => void) {
    this.flight = null
    this.controls.enabled = false
    this.tour = { keys, t0: now, ms, onProgress, onEnd }
  }

  cancel() {
    const wasTouring = this.tour
    this.flight = null
    this.tour = null
    this.controls.enabled = true
    wasTouring?.onEnd()
  }

  update(now: number) {
    if (this.flight) {
      const { from, to, t0, ms } = this.flight
      const u = Math.min(1, (now - t0) / ms)
      this.apply(cameraAt([from, to], u))
      if (u >= 1) { this.flight = null; this.controls.enabled = true }
    } else if (this.tour) {
      const { keys, t0, ms, onProgress, onEnd } = this.tour
      const u = Math.min(1, (now - t0) / ms)
      this.apply(cameraAt(keys, u))
      onProgress(u)
      if (u >= 1) { this.tour = null; this.controls.enabled = true; onEnd() }
    }
  }
}
