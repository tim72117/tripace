// explorer.ts——探索模式的人物:玩家控制家長走動,小孩跟在後面(沿家長走過的軌跡)。
//
// 移動規則在 logic/walk.ts(純函式:高度差、碰撞、沿牆滑),這裡只負責:建構人物與固體索引(第一次進入才建)、
// 依輸入(搖桿/鍵盤的世界方向,或點地面的目標點)每幀前進、朝向與走路動畫。人物腳底高度取 walkWorld.surfaceY
// (步道上是路面/踏面,其他是地面)。
import * as THREE from 'three'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import type { PathCurve } from '../logic/pathCurve'
import { createColliderIndex, pushTrail, steerToward, trailPointBehind, tryStep, type WalkState } from '../logic/walk'
import { makeWalkWorld } from '../logic/walkWorld'
import { buildColliderPolys, type ColliderPlacement } from './colliders'
import { animateModel, buildModel, placementScale, type BuiltModel, type Model3D } from './model'

export const WALK_SPEED = 4 // 格/秒
export const PLAYER_RADIUS = 0.28
export const MAX_STEP = 0.7
const CHILD_GAP = 1.2 // 小孩落後家長的軌跡距離

export type ExplorerDeps = {
  layout: Pick<IslandLayout, 'outline' | 'path'>
  models: Record<string, Model3D>
  curve: PathCurve
  groundY: (x: number, z: number) => number
  pathY: (s: number, x: number, z: number) => number
  placements: ReadonlyArray<ColliderPlacement> // 會擋人的擺設(散落物 + 站點)
}

type Walker = { built: BuiltModel; scale: number; phase: number; weight: number; yaw: number; y: number }

export class Explorer {
  readonly group = new THREE.Group()
  private parent: Walker
  private child: Walker
  private state: WalkState = { x: 0, z: 0, y: 0 }
  private childXZ: Pt = [0, 0]
  private trail: Pt[] = []
  private target: Pt | null = null
  private world: ReturnType<typeof makeWalkWorld> | null = null
  private moving = false

  constructor(private d: ExplorerDeps) {
    const mk = (m: Model3D): Walker => {
      const built = buildModel(m)
      const scale = placementScale(m, 1) // 人物的真實身高由模型的 unit 決定
      built.root.scale.setScalar(scale)
      built.root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.castShadow = true })
      this.group.add(built.root)
      return { built, scale, phase: 0, weight: 0, yaw: 0, y: 0 }
    }
    this.parent = mk(d.models['traveler-parent'])
    this.child = mk(d.models['traveler-child'])
  }

  // 固體索引只在第一次需要時建(要把每個擺設的部件算成多邊形)
  private ensureWorld() {
    if (this.world) return this.world
    const idx = createColliderIndex(buildColliderPolys(this.d.placements, this.d.models))
    this.world = makeWalkWorld({ layout: this.d.layout, curve: this.d.curve, groundY: this.d.groundY, pathY: this.d.pathY, blocked: idx.hits })
    return this.world
  }

  get position(): THREE.Vector3 { return new THREE.Vector3(this.state.x, this.state.y, this.state.z) }
  get isMoving(): boolean { return this.moving }

  // 放在步道起點(公車站入口),面向步道前進方向
  enter() {
    const world = this.ensureWorld()
    const p0 = this.d.curve.at(0)
    this.state = { x: p0.x, z: p0.z, y: world.surfaceY(p0.x, p0.z) }
    this.parent.yaw = Math.atan2(p0.dirX, p0.dirZ)
    this.child.yaw = this.parent.yaw
    this.parent.y = this.child.y = this.state.y
    this.trail = [[p0.x - p0.dirX * CHILD_GAP * 2, p0.z - p0.dirZ * CHILD_GAP * 2], [p0.x, p0.z]]
    this.childXZ = trailPointBehind(this.trail, CHILD_GAP)
    this.target = null
    this.apply()
  }

  setTarget(x: number, z: number) { this.target = [x, z] }
  clearTarget() { this.target = null }

  // move:世界座標的移動方向(長度 0~1,0 = 沒有按);有輸入時取消點地面的目標
  update(dt: number, move: { x: number; z: number }, time: number) {
    const world = this.ensureWorld()
    let dx = 0, dz = 0
    const len = Math.hypot(move.x, move.z)
    if (len > 0.05) {
      this.target = null
      const k = (WALK_SPEED * Math.min(1, len) * dt) / len
      dx = move.x * k
      dz = move.z * k
    } else if (this.target) {
      const s = steerToward([this.state.x, this.state.z], this.target, WALK_SPEED * dt)
      dx = s.dx
      dz = s.dz
      if (s.arrived) this.target = null
    }
    let moved = false
    if (dx !== 0 || dz !== 0) {
      const r = tryStep(world, { radius: PLAYER_RADIUS, maxStep: MAX_STEP }, this.state, dx, dz)
      if (r.moved) {
        moved = true
        this.parent.yaw = turnToward(this.parent.yaw, Math.atan2(r.x - this.state.x, r.z - this.state.z), dt * 12)
        this.state = { x: r.x, z: r.z, y: r.y }
        pushTrail(this.trail, [r.x, r.z])
      } else {
        this.target = null // 撞到就放棄這個目標
      }
    }
    this.moving = moved
    this.updateChild(dt, world)
    this.animate(dt, time, moved)
    this.apply()
  }

  private updateChild(dt: number, world: NonNullable<Explorer['world']>) {
    const want = trailPointBehind(this.trail, CHILD_GAP)
    const dx = want[0] - this.childXZ[0], dz = want[1] - this.childXZ[1]
    const d = Math.hypot(dx, dz)
    if (d > 0.05) {
      const step = Math.min(d, WALK_SPEED * 1.15 * dt)
      this.childXZ = [this.childXZ[0] + (dx / d) * step, this.childXZ[1] + (dz / d) * step]
      this.child.yaw = turnToward(this.child.yaw, Math.atan2(dx, dz), dt * 12)
      this.child.weight += (1 - this.child.weight) * 0.2
      this.child.phase += (step / (this.child.built.stride * this.child.scale)) * Math.PI * 2
    } else {
      this.child.weight += (0 - this.child.weight) * 0.2
    }
    const ty = world.surfaceY(this.childXZ[0], this.childXZ[1], this.child.y)
    this.child.y += (ty - this.child.y) * Math.min(1, dt * 12)
  }

  private animate(dt: number, time: number, moved: boolean) {
    const stride = this.parent.built.stride * this.parent.scale
    if (moved) this.parent.phase += ((WALK_SPEED * dt) / stride) * Math.PI * 2
    this.parent.weight += ((moved ? 1 : 0) - this.parent.weight) * 0.2
    animateModel(this.parent.built, this.parent.phase, this.parent.weight, time)
    animateModel(this.child.built, this.child.phase, this.child.weight, time)
    this.parent.y += (this.state.y - this.parent.y) * Math.min(1, dt * 12)
  }

  private apply() {
    this.parent.built.root.position.set(this.state.x, this.parent.y, this.state.z)
    this.parent.built.root.rotation.y = this.parent.yaw
    this.child.built.root.position.set(this.childXZ[0], this.child.y, this.childXZ[1])
    this.child.built.root.rotation.y = this.child.yaw
  }
}

// 角度朝目標轉(走最短弧),每次最多轉 rate 比例
export function turnToward(cur: number, target: number, rate: number): number {
  let d = target - cur
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return cur + d * Math.min(1, rate)
}
