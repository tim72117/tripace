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
import { EDGE_CLEAR, MAX_SCATTER_RADIUS, resolveScatter, STOP_CLEAR } from '../logic/scatterResolve'
import { heightAt as heightAtLayout } from '../logic/terrain'
import { coverKey, fitCoverToAspect, tourKeyframes, type CameraKey } from '../logic/tour'
import { activeStopIndex, travelerArc } from '../logic/travel'
import { buildLanterns, type Lanterns } from './lanterns'
import { buildLights, sunDirection } from './lighting'
import { buildParticles } from './particles'
import { buildPathMesh, pathCoverTest } from './pathMesh'
import { buildScatter } from './scatter'
import { createCellRuntime, type CellRuntime } from './world/cellRuntime'
import { DEFAULT_GRID } from './world/cellSplit'
import { DEFAULT_GOVERNOR, initGovernor, stepGovernor, type GovernorState } from '../logic/world/governor'
import { quantizeHalf, shadowHalfSize, type ShadowFrameCfg } from '../logic/world/shadowFrame'
import { buildSea, type Sea } from './sea'
import { buildSky } from './sky'
import { buildStops, type Stops } from './stops'
import { buildTerrain } from './terrain'
import { buildTravelers } from './travelers'
import { CameraRig, MAX_DISTANCE_FACTOR } from './cameraRig'
import { Explorer } from './explorer'
import { buildPathProfile } from '../logic/pathProfile'
import { captureImage } from './capture'
import { disposeObject, disposeRenderer } from './dispose'
import { placementScale, type Model3D } from './model'

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
  onTime?: (minutes: number) => void // 時間自動往前走(每過一分鐘通知一次)與手動設定時都會呼叫
  onExplore?: (on: boolean) => void // 進入/離開探索模式(HUD 切換按鈕與搖桿)
}

// 日夜自動滾動:1 秒 = 8 分鐘,一天(24 小時)約 3 分鐘循環;傍晚 17:30 → 20:15 約 20 秒
const MINUTES_PER_SECOND = 8
const MINUTES_PER_DAY = 1440
const FLY_MS = 1400
// 太陽方向每 SUN_STEP_MINUTES 分鐘(遊戲時間;× MINUTES_PER_SECOND 換算約 1.25 秒)才跳一次,陰影圖只在跳的時候重畫。
// 顏色、亮度與天空上看得到的太陽照常連續變化。調大更省、陰影每次跳動的位移也更明顯(日出日落時太陽低,影子變化最大)。
const SUN_STEP_MINUTES = 10
// 旅人、探索中的人物會動,陰影圖在太陽沒跳的期間也每隔這麼久補畫一次(秒),影子才跟得上人
const SHADOW_REFRESH_S = 0.1

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
  // 探索模式:玩家控制家長在島上走動,鏡頭跟隨(OrbitControls 的 target 每幀往人物靠)
  private explorer: Explorer | null = null
  private exploring = false
  private savedLimits: [number, number] | null = null
  private keys = new Set<string>()
  private stick = { x: 0, y: 0 } // 虛擬搖桿(HUD 推進來),x 右、y 前,各 -1~1
  private pickables: THREE.Object3D[] = [] // 點地面移動時射線要打的(地形、步道)
  private raycaster = new THREE.Raycaster()
  private clock = new THREE.Clock()
  private resizeObs: ResizeObserver
  private debugEl: HTMLElement | null = null
  private frames = 0
  private fpsT = 0

  private minutes: number
  private scrubbing = false // 使用者正在拖時間滑桿:暫停自動滾動
  private readonly cells: CellRuntime
  private readonly pixelRatios: number[]
  private governor: GovernorState
  private readonly shadowCfg: ShadowFrameCfg
  private sunStep = -1 // 目前太陽方向所在的分段(見 SUN_STEP_MINUTES);-1 = 還沒畫過陰影
  private shadowAt = -Infinity // 上次重畫陰影圖的時間(clock 秒)
  private selected = -1
  private tourKeys: CameraKey[]
  private stamps: Array<{ minutes: number; arc: number }>
  // 島上實際顯示的站——整個類別所有「第 i 站」的索引都以這份清單為準(views[i]、stamps[i]、tourKeys[i+1]、HUD 的 i)
  private stopList: IslandStop[]
  private orderOf: (x: number, z: number) => number
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
    // 效能調節器的等級 = 像素密度,由低到高,最高是這台裝置與畫質允許的上限;從最高開始,太慢才往下降
    const prMax = Math.min(window.devicePixelRatio, cfg.pixelRatioMax)
    this.pixelRatios = [...new Set([1, 1.25, 1.5, 2].filter((r) => r < prMax).concat(prMax))]
    this.governor = initGovernor(this.pixelRatios.length - 1)
    this.renderer.setPixelRatio(prMax)
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = cfg.shadowSize > 0
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false // 由 frame() 決定何時重畫(見 SUN_STEP_MINUTES)
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', touchAction: 'none' })
    o.container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.setSize(w, h)
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    o.container.appendChild(this.labels.domElement)

    this.camera = new THREE.PerspectiveCamera(32, w / h, 1, 2200)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.rig = new CameraRig(this.camera, this.controls, this.radius)
    this.shadowCfg = { mapSize: Math.max(1, cfg.shadowSize), minHalf: 20, maxHalf: this.radius * 1.05, distanceFactor: 0.8 }
    this.rig.setInstant(this.coverNow())
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
    // 散落物:避障貼地後再實例化(先算,步道要知道哪些石階真的有畫出來)
    const resolved = resolveScatter(layout.scatter, layout, {
      pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
      pathWidth: layout.path.width,
      stopClear: STOP_CLEAR,
      edgeClear: EDGE_CLEAR,
      radiusOf: (p) => Math.min(MAX_SCATTER_RADIUS, 0.3 * placementScale(o.models[p.model], p.scale)),
    })
    // 步道在「自己畫路面的模型」(石階)範圍內沉下去:只算站點與保留下來的擺放,被剔除的不算
    const pathMesh = buildPathMesh(layout, curve, heightAt, o.controlY, pathCoverTest([...layout.stops, ...resolved.kept], o.models))
    this.scene.add(pathMesh.mesh)
    const pathProfile = buildPathProfile(layout.path.points, curve, heightAt, o.controlY)
    this.orderOf = (x, z) => (curve.length === 0 ? 0 : curve.nearestArc(x, z) / curve.length)

    if (o.debug) console.info(`[island] scatter 保留 ${resolved.kept.length}、剔除 ${resolved.dropped.length}`, resolved.dropped.slice(0, 8))
    const scatter = buildScatter(resolved.kept, o.models, { shadows: cfg.shadowSize > 0, grid: layout.grid })
    this.scene.add(scatter.group)
    // 世界格子:地形與散落物依格子登記,每幀依鏡頭焦點更新串流與 LOD(目前預設全部載入,見 three/world/cellRuntime.ts)
    this.cells = createCellRuntime(layout.grid ?? DEFAULT_GRID)
    for (const [cell, objects] of this.terrain.cells) this.cells.add(cell, { objects })
    for (const [cell, instances] of scatter.cellInstances) this.cells.add(cell, { instances })

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

    // 探索模式的人物(平時隱藏;固體索引第一次進入探索才建)
    if (o.models['traveler-parent'] && o.models['traveler-child']) {
      this.explorer = new Explorer({
        layout,
        models: o.models,
        curve,
        groundY: heightAt,
        pathY: pathProfile.at,
        placements: [
          ...resolved.kept.map((p) => ({ model: p.model, x: p.x, y: p.y, z: p.z, rotY: p.rotY, scale: p.scale })),
          ...this.stopList.flatMap((s) => (s.anchor ? [{ model: s.anchor.model, x: s.anchor.x, y: s.anchor.y ?? heightAt(s.anchor.x, s.anchor.z), z: s.anchor.z, rotY: s.anchor.rotY, scale: s.anchor.scale }] : [])),
        ],
      })
      this.explorer.group.visible = false
      this.scene.add(this.explorer.group)
    }
    this.pickables = [...this.terrain.group.children, pathMesh.mesh]

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
    this.tourKeys = tourKeyframes(anchored, this.radius, layout.camera)

    // ---- 互動 ----
    const el = this.renderer.domElement
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      const r = el.getBoundingClientRect()
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
      if (this.exploring) {
        // 探索模式:點地面 = 走過去(點到站點建築不選站,避免鏡頭被拉走)
        const g = this.raycaster.intersectObjects(this.pickables, false)[0]
        if (g) this.explorer?.setTarget(g.point.x, g.point.z)
        return
      }
      // 點建築模型不選站(選站只能點標籤);點畫面其他地方 = 取消選取
      this.select(-1)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    this.cleanup.push(() => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp) })

    // 探索模式的鍵盤:WASD / 方向鍵(只在探索中、且不是在輸入框裡時作用)
    const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!this.exploring || !MOVE_KEYS.has(k) || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      this.keys.add(k)
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()) }
    const onBlur = () => this.keys.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    this.cleanup.push(() => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur) })

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
  get range(): [number, number] { return [0, MINUTES_PER_DAY] } // 時間滑桿涵蓋整天(光照關鍵幀是環狀的,22:00 → 06:00 會平順接回)

  setTime(m: number) {
    this.minutes = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
    this.o.onTime?.(this.minutes)
  }
  // 拖時間滑桿期間暫停自動滾動,放開後從拖到的時間繼續
  setScrubbing(on: boolean) { this.scrubbing = on }
  select(i: number) {
    if (this.exploring) this.setExplore(false)
    this.selected = i
    if (i >= 0 && this.tourKeys[i + 1]) {
      this.rig.flyTo(this.tourKeys[i + 1], FLY_MS, performance.now())
      const s = this.stopList[i]
      if (s) this.minutes = parseTime(s.time) // 點站:時間跳到那一站的示意時間,之後繼續自動滾動
    }
    this.o.onSelect?.(i)
    this.o.onTime?.(this.minutes)
  }
  // 封面鏡頭:版面手寫的封面(layout.camera.cover)依目前畫面比例拉遠到放得下整座島;沒手寫的用預設推算
  private coverNow(): CameraKey {
    const custom = this.o.layout.camera?.cover
    if (!custom) return coverKey(this.radius)
    const halfWidth = Math.max(...this.o.layout.outline.map(([x]) => Math.abs(x)))
    return fitCoverToAspect(custom, halfWidth, this.camera.fov, this.camera.aspect, this.radius * MAX_DISTANCE_FACTOR * 0.95)
  }
  cover() { this.setExplore(false); this.selected = -1; this.rig.flyTo(this.coverNow(), FLY_MS, performance.now()); this.o.onSelect?.(-1) }

  // ===== 探索模式:玩家控制家長在島上走動 =====
  get canExplore(): boolean { return this.explorer !== null }
  get isExploring(): boolean { return this.exploring }

  // 虛擬搖桿(HUD 的手機操作):x 右、y 前,各 -1~1
  setStick(x: number, y: number) { this.stick.x = x; this.stick.y = y }

  setExplore(on: boolean) {
    if (!this.explorer || on === this.exploring) return
    this.exploring = on
    this.keys.clear()
    this.stick = { x: 0, y: 0 }
    if (this.travelers) this.travelers.group.visible = !on // 自動走的親子換成玩家控制的
    this.explorer.group.visible = on
    if (on) {
      this.rig.cancel()
      this.selected = -1
      this.o.onSelect?.(-1)
      this.explorer.enter()
      this.savedLimits = this.rig.distanceLimits
      this.rig.setDistanceLimits(5, 70)
      // 鏡頭飛到人物後上方(保持目前的方位角,不突然轉向)
      const p = this.explorer.position
      const t = this.controls.target
      const az = Math.atan2(this.camera.position.x - t.x, this.camera.position.z - t.z)
      this.rig.flyTo({ pos: [p.x + Math.sin(az) * 14, p.y + 9, p.z + Math.cos(az) * 14], target: [p.x, p.y + 1.2, p.z] }, 1200, performance.now())
    } else if (this.savedLimits) {
      this.rig.setDistanceLimits(...this.savedLimits)
      this.savedLimits = null
    }
    this.o.onExplore?.(on)
  }

  // 鍵盤 + 搖桿 → 世界座標的移動方向(相對於鏡頭看的方向:前 = 鏡頭往人物看去的水平方向)
  private moveDirection(): { x: number; z: number } {
    let mx = this.stick.x
    let my = this.stick.y
    const k = this.keys
    if (k.has('d') || k.has('arrowright')) mx += 1
    if (k.has('a') || k.has('arrowleft')) mx -= 1
    if (k.has('w') || k.has('arrowup')) my += 1
    if (k.has('s') || k.has('arrowdown')) my -= 1
    const len = Math.hypot(mx, my)
    if (len < 0.05) return { x: 0, z: 0 }
    if (len > 1) { mx /= len; my /= len }
    const fx = this.controls.target.x - this.camera.position.x
    const fz = this.controls.target.z - this.camera.position.z
    const fl = Math.hypot(fx, fz) || 1
    const f = [fx / fl, fz / fl]
    const r = [-f[1], f[0]] // 右 = 前方向轉 90°(前 (0,-1) 時右是 +x)
    return { x: f[0] * my + r[0] * mx, z: f[1] * my + r[1] * mx }
  }

  // 鏡頭跟隨:OrbitControls 的 target 與鏡頭一起往人物位移(使用者的旋轉、縮放偏移保留)
  private followPlayer(dt: number) {
    if (!this.explorer || this.rig.flying) return
    const p = this.explorer.position
    const want = new THREE.Vector3(p.x, p.y + 1.2, p.z)
    const d = want.sub(this.controls.target).multiplyScalar(Math.min(1, dt * 6))
    this.controls.target.add(d)
    this.camera.position.add(d)
  }
  capture(): Promise<Blob | null> {
    this.renderer.shadowMap.needsUpdate = true // 分享圖用當下的陰影
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

  // 效能調節器:持續太慢就降一級像素密度,持續有餘裕再升回來(logic/world/governor.ts)
  private adaptQuality(dt: number) {
    const next = stepGovernor(this.governor, dt, { ...DEFAULT_GOVERNOR, levels: this.pixelRatios.length })
    if (next.level !== this.governor.level) {
      this.renderer.setPixelRatio(this.pixelRatios[next.level])
      if (this.o.debug) console.info(`[island] 效能調節:像素密度 → ${this.pixelRatios[next.level]}`)
    }
    this.governor = next
  }

  // ===== 每幀 =====
  private frame = () => {
    const dt = Math.min(0.1, this.clock.getDelta())
    const t = this.clock.elapsedTime
    if (!this.scrubbing) {
      const prev = Math.floor(this.minutes)
      this.minutes = (this.minutes + dt * MINUTES_PER_SECOND) % MINUTES_PER_DAY
      if (Math.floor(this.minutes) !== prev) this.o.onTime?.(this.minutes) // 每過一分鐘才通知 HUD,不用每幀更新 DOM
    }

    const { layout } = this.o
    const light = sampleLight(layout.lighting, this.minutes)
    const sunStep = Math.floor(this.minutes / SUN_STEP_MINUTES)
    this.lights.update(light, new THREE.Vector3(0, 4, 0), sampleLight(layout.lighting, sunStep * SUN_STEP_MINUTES))
    if (sunStep !== this.sunStep || t - this.shadowAt >= SHADOW_REFRESH_S) {
      this.sunStep = sunStep
      this.shadowAt = t
      // 陰影範圍跟著鏡頭焦點:近看時範圍小、影子細;拉遠看全島時涵蓋整座島
      const view = this.camera.position.distanceTo(this.controls.target)
      this.lights.shadowAround(this.controls.target, quantizeHalf(shadowHalfSize(view, this.shadowCfg), this.shadowCfg))
      this.renderer.shadowMap.needsUpdate = true
    }
    this.cells.update(this.controls.target.x, this.controls.target.z)
    this.skyM.update(light, sunDirection(light.sunElevationDeg, light.sunAzimuthDeg))
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
    if (this.exploring && this.explorer) {
      this.explorer.update(dt, this.moveDirection(), t)
      this.followPlayer(dt)
    } else {
      this.travelers?.update(travelerArc(this.stamps, this.minutes), t)
    }
    this.particles.update(t, dt, dark)

    this.rig.update(performance.now())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
    this.adaptQuality(dt)

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
