// viewer.js——模型預覽頁:載入 GLB、旋轉檢視,檔案更新時自動重新載入(保留目前視角)。
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const $ = (id) => document.getElementById(id)
const stage = $('stage')

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
stage.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// ---- 燈光預設 ----
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1)
const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
scene.add(hemi, sun, sun.target)
const LIGHTS = {
  day: { bg: '#8fa6bd', sky: 0xdfeaf5, ground: 0x5a5648, hemiI: 1.0, sunC: 0xfff3dc, sunI: 2.6, dir: [-0.6, 1, 0.7], exp: 1.0 },
  dusk: { bg: '#3a3550', sky: 0x8a86b8, ground: 0x3a2f2a, hemiI: 0.75, sunC: 0xffa860, sunI: 2.2, dir: [-1, 0.45, 0.5], exp: 1.0 },
  night: { bg: '#0c0f1e', sky: 0x2a3560, ground: 0x15131a, hemiI: 0.35, sunC: 0x8fa0ff, sunI: 0.5, dir: [-0.5, 1, 0.4], exp: 1.2 },
}
function setLight(name) {
  const l = LIGHTS[name]
  scene.background = new THREE.Color(l.bg)
  hemi.color.setHex(l.sky); hemi.groundColor.setHex(l.ground); hemi.intensity = l.hemiI
  sun.color.setHex(l.sunC); sun.intensity = l.sunI
  sun.position.set(...l.dir.map((v) => v * 12))
  renderer.toneMappingExposure = l.exp
  for (const b of document.querySelectorAll('#lights button')) b.classList.toggle('on', b.dataset.light === name)
}

// ---- 地面與輔助 ----
const grid = new THREE.GridHelper(40, 40, 0x666a78, 0x30343f)
const shadowGround = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }))
shadowGround.receiveShadow = true
scene.add(grid, shadowGround)

// 比例人:1.7 單位高(假設模型單位是公尺)
const human = new THREE.Group()
{
  const m = new THREE.MeshStandardMaterial({ color: 0xd9b48a, roughness: 0.9 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 10), m); body.position.y = 0.72
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), m); head.position.y = 1.57
  body.castShadow = head.castShadow = true
  human.add(body, head)
}
human.visible = false
scene.add(human)

// ---- 模型 ----
let current = null // { name, root, box }
let boxHelper = null
let wire = false
const loader = new GLTFLoader()

function stats(root) {
  let tris = 0, verts = 0
  const mats = new Set()
  root.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3
    verts += g.attributes.position.count
    ;(Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m))
  })
  return { tris, verts, mats: mats.size }
}

function applyWire() {
  if (!current) return
  current.root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.wireframe = wire }) })
}

function frame(box, view) {
  const c = box.getCenter(new THREE.Vector3())
  const s = box.getSize(new THREE.Vector3())
  const r = Math.max(s.x, s.y, s.z, 0.01)
  const dist = r * 2.1
  const t = new THREE.Vector3(c.x, c.y, c.z)
  const dirs = { front: [0, 0.12, 1], side: [1, 0.12, 0], iso: [0.75, 0.55, 0.75], low: [0.5, -0.02, 1], top: [0, 1, 0.001] }
  const d = new THREE.Vector3(...(dirs[view] ?? dirs.iso)).normalize()
  camera.position.copy(t).addScaledVector(d, dist)
  if (view === 'low') camera.position.y = Math.max(0.05, box.min.y + 0.12 * r)
  controls.target.copy(t)
  controls.update()
  sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 1.6
  sun.shadow.camera.right = sun.shadow.camera.top = r * 1.6
  sun.shadow.camera.far = r * 10
  sun.shadow.camera.updateProjectionMatrix()
  sun.target.position.copy(t)
  grid.position.y = shadowGround.position.y = box.min.y
  grid.scale.setScalar(Math.max(0.05, r / 8))
  human.position.set(box.max.x + 0.8, box.min.y, c.z)
}

function showMsg(text, err = false) { const m = $('msg'); m.textContent = text; m.className = text ? `show${err ? ' err' : ''}` : '' }

async function load(name, { keepView }) {
  try {
    const gltf = await loader.loadAsync(`/models/${encodeURIComponent(name)}?t=${Date.now()}`)
    if (current) { scene.remove(current.root); current.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()) } }) }
    const root = gltf.scene
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    scene.add(root)
    const box = new THREE.Box3().setFromObject(root)
    current = { name, root, box }
    if (boxHelper) scene.remove(boxHelper)
    boxHelper = new THREE.Box3Helper(box, 0xffc15a); boxHelper.visible = $('bbox').classList.contains('on'); scene.add(boxHelper)
    applyWire()
    if (!keepView) frame(box, 'iso')
    const s = box.getSize(new THREE.Vector3()), st = stats(root)
    $('info').textContent = `${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)}(寬×高×深)· ${Math.round(st.tris).toLocaleString()} 面 · ${st.mats} 材質`
    showMsg('')
    setStatus(`已載入 ${new Date().toLocaleTimeString()}`, 'flash')
  } catch (e) {
    showMsg(`載入失敗:${e.message ?? e}`, true)
  }
}

// ---- 檔案清單與即時更新 ----
let selected = ''
async function refreshList(pick) {
  const list = await (await fetch('/api/models')).json()
  const sel = $('file')
  sel.innerHTML = list.map((m) => `<option value="${m.name}">${m.name}(${(m.size / 1024).toFixed(0)} KB)</option>`).join('')
  if (!list.length) { showMsg('還沒有模型:把 .glb 放進監看資料夾,這裡會自動出現'); return }
  const want = pick ?? selected
  selected = list.some((m) => m.name === want) ? want : list[0].name
  sel.value = selected
}

let dotTimer = 0
function setStatus(text, kind) {
  $('statusText').textContent = text
  const dot = $('dot')
  dot.className = kind === 'off' ? '' : 'live'
  if (kind === 'flash') { dot.className = 'flash'; clearTimeout(dotTimer); dotTimer = setTimeout(() => { dot.className = 'live' }, 700) }
}

function connect() {
  const es = new EventSource('/events')
  es.onopen = () => setStatus('即時更新中', 'live')
  es.onerror = () => setStatus('連線中斷,重試中…', 'off')
  es.onmessage = async (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'ping' || m.type === 'image') return
    if (m.type === 'remove') { await refreshList(); if (m.name === selected && selected) load(selected, { keepView: true }); return }
    // 有新檔案(或目前沒有選中)時切過去;選中的檔案更新時保留視角重載
    const isNew = !$('file').querySelector(`option[value="${CSS.escape(m.name)}"]`)
    await refreshList(isNew ? m.name : selected)
    if (m.name === selected) load(selected, { keepView: !isNew })
  }
}

// ---- 介面 ----
$('file').addEventListener('change', (e) => { selected = e.target.value; load(selected, { keepView: false }) })
$('views').addEventListener('click', (e) => { const v = e.target.dataset?.view; if (v && current) frame(current.box, v) })
$('lights').addEventListener('click', (e) => { const l = e.target.dataset?.light; if (l) setLight(l) })
$('wire').addEventListener('click', (e) => { wire = !wire; e.currentTarget.classList.toggle('on', wire); applyWire() })
$('bbox').addEventListener('click', (e) => { const on = e.currentTarget.classList.toggle('on'); if (boxHelper) boxHelper.visible = on })
$('human').addEventListener('click', (e) => { human.visible = e.currentTarget.classList.toggle('on') })

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix() }
addEventListener('resize', resize)
resize()
setLight('day')
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })

await refreshList()
if (selected) await load(selected, { keepView: false })
connect()
