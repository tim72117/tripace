// IslandApp.ts——總指揮:renderer / camera / controls / 迴圈 / 可見性暫停 / resize / dispose。
//
// 整個場景只有一個時間來源 clockMinutes(目前時間,分鐘):滑桿、播放、導覽都只改這個數字,
// 每一幀由它算出光照、燈籠亮度、旅人位置,再交給各渲染模組的 update。不各自持有時間,
// 避免「滑桿與旅人脫鉤」這類問題。
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { IslandLayout } from '../data/layoutTypes'
import { displayableStops, type IslandMeta, type IslandStop } from '../logic/articleToIsland'
import { lanternGlowAt } from '../logic/lanternSchedule'
import { parseTime, sampleLight } from '../logic/lighting'
import { buildPathCurve } from '../logic/pathCurve'
import { configFor, type Quality } from '../logic/quality'
import { resolveScatter } from '../logic/scatterResolve'
import { heightAt as heightAtLayout } from '../logic/terrain'
import { coverKey, timeAt, tourKeyframes, type CameraKey } from '../logic/tour'
import { activeStopIndex, travelerArc } from '../logic/travel'
import { buildLanterns, type Lanterns } from './lanterns'
import { buildLights } from './lighting'
import { buildParticles } from './particles'
import { buildPathMesh } from './pathMesh'
import { buildScatter } from './scatter'
import { buildSea, type Sea } from './sea'
import { buildSky } from './sky'
import { buildStops, type Stops } from './stops'
import { buildTerrain } from './terrain'
import { buildTravelers } from './travelers'
import { CameraRig } from './cameraRig'
import { captureImage } from './capture'
import { disposeObject, disposeRenderer } from './dispose'
import type { Model3D } from './model'

export type IslandAppOptions = {
  container: HTMLElement
  layout: IslandLayout
  models: Record<string, Model3D>
  stops: IslandStop[]
  meta: IslandMeta
  quality: Quality
  startMinutes: number
  debug: boolean
  controlY?: ReadonlyArray<number>
  onSelect?: (index: number) => void
  onTime?: (minutes: number, playing: boolean) => void
  onTourEnd?: () => void
}

const MINUTES_PER_SECOND = 4 // 播放時 1 秒 = 4 分鐘(17:30 → 20:15 約 41 秒)
const FLY_MS = 1400
const TOUR_MS = 28000

export class IslandApp {
  readonly scene = new THREE.Scene()
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  private labels: CSS2DRenderer
  private controls: OrbitControls
  private rig: CameraRig
  private stops: Stops
  private lanterns: Lanterns
  private sea: Sea | null
  private terrain: ReturnType<typeof buildTerrain>
  private skyM: ReturnType<typeof buildSky>
  private lights: ReturnType<typeof buildLights>
  private particles: ReturnType<typeof buildParticles>
  private travelers: ReturnType<typeof buildTravelers> | null = null
  private raycaster = new THREE.Raycaster()
  private clock = new THREE.Clock()
  private resizeObs: ResizeObserver
  private debugEl: HTMLElement | null = null
  private frames = 0
  private fpsT = 0

  private minutes: number
  private playing = false
  private selected = -1
  private tourKeys: CameraKey[]
  private tourTimes: number[]
  private stamps: Array<{ minutes: number; arc: number }>
  // 島上實際顯示的站——整個類別所有「第 i 站」的索引都以這份清單為準(views[i]、stamps[i]、tourKeys[i+1]、HUD 的 i)
  private stopList: IslandStop[]
  private orderOf: (x: number, z: number) => number
  private minMinutes: number
  private maxMinutes: number
  private cleanup: Array<() => void> = []
  readonly radius: number

  constructor(private o: IslandAppOptions) {
    const cfg = configFor(o.quality)
    const { layout } = o
    const w = Math.max(1, o.container.clientWidth)
    const h = Math.max(1, o.container.clientHeight)
    this.minutes = o.startMinutes
    // 防禦:呼叫端(mountIsland)已經用 displayableStops 過濾過;這裡再過濾一次確保 views/stamps/導覽鏡頭的索引一致。
    // 若兩邊清單長度不同,HUD 的「第 i 站」會與場景對不上,所以警告。
    this.stopList = displayableStops(o.stops, o.models)
    if (this.stopList.length !== o.stops.length) console.warn(`[island] 傳入 ${o.stops.length} 站,其中 ${o.stops.length - this.stopList.length} 站無法顯示(沒有版面站點或模型),HUD 的站點索引可能與場景不一致`)

    this.radius = Math.max(...layout.outline.map(([x, z]) => Math.hypot(x, z)))
    const heightAt = (x: number, z: number) => heightAtLayout(layout, x, z)

    // ---- renderer / camera ----
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.pixelRatioMax))
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = cfg.shadowSize > 0
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', touchAction: 'none' })
    o.container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.setSize(w, h)
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    o.container.appendChild(this.labels.domElement)

    this.camera = new THREE.PerspectiveCamera(32, w / h, 1, 2200)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.rig = new CameraRig(this.camera, this.controls, this.radius)
    this.rig.setInstant(coverKey(this.radius))
    this.scene.fog = new THREE.Fog('#ffffff', 50, 400)

    // ---- 場景模組 ----
    this.skyM = buildSky(cfg.stars)
    this.scene.add(this.skyM.group)
    this.lights = buildLights(cfg.shadowSize)
    this.scene.add(this.lights.hemi, this.lights.sun, this.lights.sun.target)
    this.terrain = buildTerrain(layout, heightAt)
    this.scene.add(this.terrain.group)
    this.sea = layout.sea ? buildSea(layout.sea.y, layout.sea.color) : null
    if (this.sea) this.scene.add(this.sea.group)

    const curve = buildPathCurve(layout.path.points)
    const pathMesh = buildPathMesh(layout, curve, heightAt, o.controlY)
    this.scene.add(pathMesh.mesh)
    this.orderOf = (x, z) => (curve.length === 0 ? 0 : curve.nearestArc(x, z) / curve.length)

    // 散落物:避障貼地後再實例化
    const resolved = resolveScatter(layout.scatter, layout, {
      pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
      pathWidth: layout.path.width,
      stopClear: 4,
      edgeClear: 1,
      radiusOf: (p) => Math.min(1.2, 0.3 * (p.scale ?? 1)),
    })
    if (o.debug) console.info(`[island] scatter 保留 ${resolved.kept.length}、剔除 ${resolved.dropped.length}`, resolved.dropped.slice(0, 8))
    const scatter = buildScatter(resolved.kept, o.models, { shadows: cfg.shadowSize > 0 })
    this.scene.add(scatter.group)

    this.stops = buildStops(this.stopList, o.models, heightAt, (i) => this.select(i))
    this.scene.add(this.stops.group)
    const views = this.stops.views

    this.lanterns = buildLanterns(
      scatter.lampSources,
      this.orderOf,
      views.map((v) => ({ x: v.center.x, y: v.root.position.y, z: v.center.z })),
      { pointLights: cfg.pointLights, glowSize: cfg.glowSize },
    )
    this.scene.add(this.lanterns.group)

    // 旅人
    if (o.models['traveler-parent'] && o.models['traveler-child']) {
      this.travelers = buildTravelers(o.models['traveler-parent'], o.models['traveler-child'], curve, pathMesh.heightAtArc)
      this.scene.add(this.travelers.group)
    }

    // 粒子
    const steamModels = new Set(['deco-stall', 'deco-steam', 'deco-teapot'])
    const emitters = resolved.kept.filter((p) => steamModels.has(p.model)).slice(0, 12).map((p) => ({ x: p.x, y: p.y + 1.2, z: p.z }))
    const tea = views.find((v) => v.stop.anchor?.model.includes('teahouse'))
    if (tea) emitters.push({ x: tea.center.x, y: tea.topY - 1, z: tea.center.z })
    const fireflyAt = views[2]?.center ?? new THREE.Vector3(0, 6, 0)
    this.particles = buildParticles(emitters, { x: fireflyAt.x, y: fireflyAt.y, z: fireflyAt.z }, this.radius, cfg.particleScale)
    this.scene.add(this.particles.group)

    // 時間表與導覽
    this.stamps = this.stopList.map((s) => ({ minutes: parseTime(s.time), arc: curve.nearestArc(s.anchor!.x, s.anchor!.z) }))
    const anchored = views.map((v) => ({ x: v.center.x, y: v.center.y, z: v.center.z }))
    this.tourKeys = tourKeyframes(anchored, this.radius)
    const stopMins = this.stamps.map((s) => s.minutes)
    this.tourTimes = [stopMins[0] - 25, ...stopMins, stopMins[stopMins.length - 1] + 30]
    const lightMins = layout.lighting.map((k) => parseTime(k.time))
    this.minMinutes = Math.min(...lightMins)
    this.maxMinutes = Math.max(...lightMins)

    // ---- 互動 ----
    const el = this.renderer.domElement
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; if (this.rig.touring) this.rig.cancel() }
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      const r = el.getBoundingClientRect()
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
      const hit = this.stops.pick(this.raycaster)
      this.select(hit) // 點空白(-1)取消選取
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    this.cleanup.push(() => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp) })

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(o.container)

    // 分頁隱藏時真的停止迴圈(不只是歸零累積器),回來恢復
    const onVis = () => {
      if (document.visibilityState === 'hidden') this.renderer.setAnimationLoop(null)
      else { this.clock.getDelta(); this.renderer.setAnimationLoop(this.frame) }
    }
    document.addEventListener('visibilitychange', onVis)
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis))

    if (o.debug) {
      this.debugEl = document.createElement('div')
      this.debugEl.className = 'island-debug'
      o.container.appendChild(this.debugEl)
    }

    this.renderer.setAnimationLoop(this.frame)
  }

  // ===== 對外 API =====
  get time(): number { return this.minutes }
  get isPlaying(): boolean { return this.playing }
  get range(): [number, number] { return [this.minMinutes, this.maxMinutes] }
  get selectedIndex(): number { return this.selected }

  setTime(m: number) {
    this.minutes = Math.max(this.minMinutes, Math.min(this.maxMinutes, m))
    this.o.onTime?.(this.minutes, this.playing)
  }
  setPlaying(p: boolean) {
    this.playing = p
    if (p && this.minutes >= this.maxMinutes - 1) this.minutes = this.minMinutes
    this.o.onTime?.(this.minutes, this.playing)
  }
  select(i: number) {
    this.selected = i
    if (i >= 0 && this.tourKeys[i + 1]) {
      this.rig.flyTo(this.tourKeys[i + 1], FLY_MS, performance.now())
      const s = this.stopList[i]
      if (s) this.minutes = Math.max(this.minMinutes, Math.min(this.maxMinutes, parseTime(s.time)))
    }
    this.o.onSelect?.(i)
    this.o.onTime?.(this.minutes, this.playing)
  }
  cover() { this.selected = -1; this.rig.flyTo(this.tourKeys[0], FLY_MS, performance.now()); this.o.onSelect?.(-1) }
  startTour() {
    this.selected = -1
    this.o.onSelect?.(-1)
    this.playing = false
    this.rig.startTour(this.tourKeys, TOUR_MS, performance.now(),
      (u) => { this.minutes = timeAt(this.tourTimes, u); this.o.onTime?.(this.minutes, false) },
      () => this.o.onTourEnd?.())
  }
  stopTour() { if (this.rig.touring) this.rig.cancel() }
  get touring(): boolean { return this.rig.touring }

  capture(): Promise<Blob | null> {
    const spots = this.stops.views.map((v) => ({ text: `${v.stop.index} ${v.stop.name}`, position: v.label.position }))
    return captureImage(this.renderer, this.scene, this.camera, spots, {
      title: this.o.meta.title,
      byline: `文・${this.o.meta.byline.name}`,
      brand: 'Tripace',
    })
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.resizeObs.disconnect()
    this.cleanup.forEach((f) => f())
    this.controls.dispose()
    disposeObject(this.scene) // 幾何、材質、貼圖、實例化屬性(three 不會自動釋放)
    disposeRenderer(this.renderer) // 並主動讓出 WebGL context,反覆進出頁面才不會累積
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
    this.debugEl?.remove()
  }

  private resize() {
    const w = Math.max(1, this.o.container.clientWidth)
    const h = Math.max(1, this.o.container.clientHeight)
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ===== 每幀 =====
  private frame = () => {
    const dt = Math.min(0.1, this.clock.getDelta())
    const t = this.clock.elapsedTime
    if (this.playing && !this.rig.touring) {
      this.minutes += dt * MINUTES_PER_SECOND
      if (this.minutes >= this.maxMinutes) { this.minutes = this.maxMinutes; this.playing = false }
      this.o.onTime?.(this.minutes, this.playing)
    }

    const { layout } = this.o
    const light = sampleLight(layout.lighting, this.minutes)
    const dir = this.lights.update(light, new THREE.Vector3(0, 4, 0))
    this.skyM.update(light, dir)
    const dist = this.camera.position.distanceTo(this.controls.target)
    const fog = this.scene.fog as THREE.Fog
    fog.color.set(light.fog)
    fog.near = dist * 0.9
    fog.far = dist * 3.4
    const dark = 1 - Math.max(0, Math.min(1, light.sunIntensity / 1.2))
    this.renderer.toneMappingExposure = 1.05 + 0.25 * dark
    const camAz = Math.atan2(this.camera.position.x, this.camera.position.z)
    this.sea?.update(light, camAz)
    this.terrain.update(t)

    this.lanterns.update(light.lanternGlow, 1 - dark)
    // 以「站點索引」為鍵(不是 views 的順序):stops.update 用 v.index 取值
    const glowPerStop: number[] = []
    for (const v of this.stops.views) {
      const u = v.stop.anchor ? this.orderOf(v.stop.anchor.x, v.stop.anchor.z) : 0
      glowPerStop[v.index] = lanternGlowAt(light.lanternGlow, [u], [0])[0]
    }
    const active = activeStopIndex(this.stamps, this.minutes)
    this.stops.update(t, glowPerStop, active, this.selected)
    this.travelers?.update(travelerArc(this.stamps, this.minutes), t)
    this.particles.update(t, dt, dark)

    this.rig.update(performance.now())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)

    if (this.debugEl) {
      this.frames++
      this.fpsT += dt
      if (this.fpsT >= 0.5) {
        const i = this.renderer.info.render
        this.debugEl.textContent = `${Math.round(this.frames / this.fpsT)} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(1)}k tris · ${Math.floor(this.minutes / 60)}:${String(Math.round(this.minutes % 60)).padStart(2, '0')}`
        this.frames = 0
        this.fpsT = 0
      }
    }
  }
}
