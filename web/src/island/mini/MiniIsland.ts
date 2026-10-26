// MiniIsland.ts——首頁展示用的縮小版島:固定光照、背景透明、鏡頭固定、只自動旋轉(不能拖曳)。
//
// 跟完整版(IslandApp)的差別——刻意砍掉的東西:
//   - 沒有日夜變化:光照凍結在一個好看的時刻(亮色主題夕陽、暗色主題夜晚),燈籠一律全亮;
//   - 沒有天空球、海面、霧:背景透明,島直接浮在頁面背景上;
//   - 沒有陰影、PointLight、OrbitControls、旅人、導覽、標籤、資訊卡;
//   - 站點建築與裝飾一起烘焙成實例化幾何(動畫凍結),繪製呼叫數少。
// 保留:島體與階地、步道、建築與裝飾、燈籠與光暈、蒸氣/天燈/螢火蟲(數量減少)。
import * as THREE from 'three'
import type { IslandLayout } from '../data/layoutTypes'
import { sampleLight } from '../logic/lighting'
import { buildPathCurve } from '../logic/pathCurve'
import { cameraDistance, miniGlow, miniLightBoost, presetMinutes, rotationAt, shouldDrawFrame, type MiniTheme } from '../logic/mini'
import { resolveScatter } from '../logic/scatterResolve'
import { heightAt as heightAtLayout } from '../logic/terrain'
import { buildLanterns, type Lanterns } from '../three/lanterns'
import { buildLights } from '../three/lighting'
import { disposeObject, disposeRenderer } from '../three/dispose'
import type { Model3D } from '../three/model'
import { buildParticles } from '../three/particles'
import { buildPathMesh } from '../three/pathMesh'
import { buildScatter } from '../three/scatter'
import { buildTerrain } from '../three/terrain'
import { buildGroundPools, type GroundPools } from './groundPools'

export type MiniOptions = {
  container: HTMLElement
  layout: IslandLayout
  models: Record<string, Model3D>
  theme: MiniTheme
  reducedMotion: boolean
  controlY?: ReadonlyArray<number>
  secondsPerTurn?: number
  // 最高繪製幀率(預設 30):首頁常駐展示用,旋轉很慢,30fps 肉眼看不出差別、GPU 工作量減半。0 = 不節流。
  maxFps?: number
  onContextLost?: () => void
  onContextRestored?: () => void
}

const FOV = 28

export class MiniIsland {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private world = new THREE.Group() // 整座島放在這裡,旋轉的是它(鏡頭與燈光固定)
  private lights = buildLights(0)
  private lanterns: Lanterns
  private pools: GroundPools
  private particles: ReturnType<typeof buildParticles>
  private theme: MiniTheme
  private running = false
  private clock = new THREE.Clock()
  private radius: number
  private ro: ResizeObserver
  private spinSeconds = 0 // 累計「在跑」的秒數:暫停期間不累加,恢復時不會跳角度
  private sinceDraw = 0 // 距離上一次繪製累積的秒數(節流用)
  private cleanup: Array<() => void> = []

  constructor(private o: MiniOptions) {
    const { layout } = o
    this.theme = o.theme
    const w = Math.max(1, o.container.clientWidth)
    const h = Math.max(1, o.container.clientHeight)
    this.radius = Math.max(...layout.outline.map(([x, z]) => Math.hypot(x, z)))

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    // 不接收任何指標事件:不能拖曳,也不會擋住頁面捲動(手機上單指滑過它仍是捲頁面)
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
    this.renderer.domElement.setAttribute('aria-hidden', 'true') // 裝飾性;意義由外層連結/說明文字承載
    o.container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(FOV, w / h, 1, 1200)
    this.frameCamera(w / h)

    const heightAt = (x: number, z: number) => heightAtLayout(layout, x, z)
    const terrain = buildTerrain(layout, heightAt)
    this.world.add(terrain.group)

    const curve = buildPathCurve(layout.path.points)
    this.world.add(buildPathMesh(layout, curve, heightAt, o.controlY).mesh)

    // 散落物與站點建築一起烘焙實例化(站點建築當成一般的擺放,動畫凍結)
    const resolved = resolveScatter(layout.scatter, layout, {
      pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
      pathWidth: layout.path.width, stopClear: 4, edgeClear: 1, radiusOf: (p) => Math.min(1.2, 0.3 * (p.scale ?? 1)),
    })
    const stopPlacements = layout.stops
      .filter((s) => o.models[s.model])
      .map((s) => ({ model: s.model, x: s.x, z: s.z, rotY: s.rotY, scale: s.scale, seed: s.seed, y: s.y ?? heightAt(s.x, s.z) }))
    const scatter = buildScatter([...resolved.kept, ...stopPlacements], o.models, { shadows: false })
    this.world.add(scatter.group)

    // 燈籠:全亮(globalGlow=1)。光暈用較小的點;站點上方固定放 4 盞暖色 PointLight(數量固定、
    // 只改強度,亮色主題強度為 0)——真的照亮周圍的地面與建築,是暗色「自發光」的一部分。
    const stopLights = layout.stops.map((st) => ({ x: st.x, y: st.y ?? heightAt(st.x, st.z), z: st.z }))
    this.lanterns = buildLanterns(scatter.lampSources, () => 0, stopLights, { pointLights: 4, glowSize: 2.6 })
    this.world.add(this.lanterns.group)
    // 地面光斑:每盞燈與每棟建築底下貼地的暖色光暈(暗色才顯示)
    this.pools = buildGroundPools(scatter.lampSources)
    if (this.pools.mesh) this.world.add(this.pools.mesh)

    // 粒子:蒸氣加少量天燈與螢火蟲,數量縮到 0.3
    const steamModels = new Set(['deco-stall', 'deco-steam', 'deco-teapot'])
    const emitters = resolved.kept.filter((p) => steamModels.has(p.model)).slice(0, 8).map((p) => ({ x: p.x, y: p.y + 1.2, z: p.z }))
    this.particles = buildParticles(emitters, { x: 0, y: 7, z: 0 }, this.radius, 0.3)
    this.world.add(this.particles.group)

    this.scene.add(this.world, this.lights.hemi, this.lights.sun, this.lights.sun.target)
    this.applyTheme()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(o.container)

    const el = this.renderer.domElement
    const onLost = (e: Event) => { e.preventDefault(); this.running = false; o.onContextLost?.() }
    const onRestored = () => o.onContextRestored?.()
    el.addEventListener('webglcontextlost', onLost)
    el.addEventListener('webglcontextrestored', onRestored)
    this.cleanup.push(() => { el.removeEventListener('webglcontextlost', onLost); el.removeEventListener('webglcontextrestored', onRestored) })

    this.stillFrame()
  }

  get isRunning(): boolean { return this.running }

  setTheme(t: MiniTheme) {
    this.theme = t
    this.applyTheme()
    if (!this.running) this.stillFrame()
  }

  // setRunning——開始/停止迴圈。停止時完全不繪製(離開畫面省電);恢復時角度從停下的地方接續。
  setRunning(on: boolean) {
    // 「減少動態」:永遠不啟動迴圈,只畫靜止的一幀(角度 0 的封面角度,粒子也停住)——
    // 不能只把角度固定而讓迴圈照跑,那樣 GPU 每幀照畫、粒子還在動。
    if (on && this.o.reducedMotion) { this.stillFrame(); return }
    if (on === this.running) return
    this.running = on
    if (on) { this.clock.getDelta(); this.renderer.setAnimationLoop(this.frame) }
    else this.renderer.setAnimationLoop(null)
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.ro.disconnect()
    this.cleanup.forEach((f) => f())
    disposeObject(this.scene) // 幾何、材質、貼圖、實例化屬性(three 不會自動釋放)
    disposeRenderer(this.renderer) // 並主動讓出 WebGL context(監聽器已先移除,不會觸發 onContextLost)
    this.renderer.domElement.remove()
  }

  private applyTheme() {
    const light = sampleLight(this.o.layout.lighting, presetMinutes(this.theme))
    this.lights.update(light, new THREE.Vector3(0, 4, 0))
    // 縮小版沒有天空與陰影、要在頁面背景上展示模型,所以比完整版補亮(係數見 logic/mini.ts miniLightBoost)
    const boost = miniLightBoost(this.theme)
    this.lights.hemi.intensity = light.hemiIntensity * boost.hemi
    this.lights.sun.intensity = light.sunIntensity * boost.sun
    this.renderer.toneMappingExposure = boost.exposure
    // 自發光(只有暗色):燈籠與窗戶更亮、站點 PointLight 啟用、地面光斑顯示(係數見 logic/mini.ts miniGlow)
    const glow = miniGlow(this.theme)
    this.lanterns.update(1, this.theme === 'light' ? 0.8 : 0.35, { on: glow.lampOn, lightScale: glow.pointLight })
    this.pools.setOpacity(glow.groundPool)
  }

  private frameCamera(aspect: number) {
    const d = cameraDistance(this.radius * 1.08, FOV, aspect)
    const polar = 1.12 // 從約 64° 的仰角看下去(從天頂算起),山城層次最清楚
    this.camera.position.set(0, Math.cos(polar) * d + 1, Math.sin(polar) * d)
    this.camera.lookAt(0, 0, 0)
  }

  private resize() {
    const w = Math.max(1, this.o.container.clientWidth)
    const h = Math.max(1, this.o.container.clientHeight)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.frameCamera(w / h)
    if (!this.running) this.stillFrame()
  }

  // stillFrame——停止狀態下補畫一幀:粒子先更新到一個固定的時間點(否則粒子都在原點、看不見)。
  private stillFrame() {
    this.particles.update(3.2, 0, this.theme === 'dark' ? 1 : 0.7)
    this.renderOnce()
  }

  private renderOnce() {
    this.world.rotation.y = rotationAt(this.spinSeconds, this.o.secondsPerTurn ?? 48, !this.o.reducedMotion)
    this.renderer.render(this.scene, this.camera)
  }

  private frame = () => {
    const dt = Math.min(0.1, this.clock.getDelta())
    this.spinSeconds += dt // 角度以時間決定、與是否畫這一幀無關,節流不會讓旋轉變慢
    this.sinceDraw += dt
    const fps = this.o.maxFps ?? 30
    if (!shouldDrawFrame(this.sinceDraw, fps > 0 ? 1 / fps : 0)) return
    const t = this.clock.elapsedTime
    this.particles.update(t, this.sinceDraw, this.theme === 'dark' ? 1 : 0.7)
    this.sinceDraw = 0
    this.renderOnce()
  }
}

