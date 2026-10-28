// glbLoader.ts——載入外部建模的 GLB(three 渲染層)。
//
// GLTFLoader 用動態 import:這支模組本身不帶 three 的載入器,只有真的要載 GLB 時才下載它,
// 所以靜態 import 這支檔案不會把 three 拖進首屏。
//
// 發光強度換算:Blender 的自發光強度(窗 2.4、燈籠 3.0)是看渲染圖調的;島上是「基準 × (0.2 + 2.2 × 日夜強度)」
// (three/stops.ts),基準約 0.6。所以載入時把發光材質的強度除以 EMISSIVE_DIVISOR,日夜連動才不會過曝。
import type * as THREE from 'three'

export const EMISSIVE_DIVISOR = 4

// SHARED_RESOURCE——標在 GLB 的幾何與材質上:這些由 registry 的快取擁有(整個 session 重複使用),
// 場景卸載時 disposeObject 要跳過,不然每次進出島都得把 2MB、4 萬面重傳一次 GPU。
export const SHARED_RESOURCE = 'sharedResource'
const PREPARED = 'glbPrepared'

// prepareGlbScene——載入後處理:陰影、發光強度換算、標記共用資源。
// 假設與後續程式一致:每個網格只有「一個材質」(Blender 腳本按材質合併成物件;stops.ts 的日夜發光、bake.ts、colliders.ts 都這樣假設),
// 遇到多材質網格直接丟錯——比靜默讓窗光不隨日夜連動好找問題(registry 會接住,改用簡化版)。
// 冪等:同一個 scene 重複呼叫不會再除一次發光強度。
export function prepareGlbScene(scene: THREE.Object3D): THREE.Object3D {
  if (scene.userData[PREPARED]) return scene
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (Array.isArray(mesh.material)) {
      throw new Error(`GLB 網格「${mesh.name || '(無名稱)'}」有 ${mesh.material.length} 個材質;島的程式假設每個網格只有一個材質,請在建模時按材質拆開`)
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat.emissive && mat.emissive.getHex() !== 0 && !mat.userData[PREPARED]) {
      mat.emissiveIntensity /= EMISSIVE_DIVISOR
      mat.userData[PREPARED] = true // 多個網格共用同一個材質時,只換算一次
    }
    mat.userData[SHARED_RESOURCE] = true
    mesh.geometry.userData[SHARED_RESOURCE] = true
  })
  scene.userData[PREPARED] = true
  return scene
}

// loadGlbScene——自己 fetch 再交給 GLTFLoader.parseAsync,不用 loader.loadAsync:
//   - three 的 FileLoader 以網址為鍵記錄「進行中的請求」,請求建立時就同步丟例外(例如網址無效)會留下永遠不完成的記錄,
//     之後同一個網址的重試會一直卡住;自己 fetch 就沒有這種跨呼叫的殘留狀態,重試真的是重新嘗試;
//   - HTTP 錯誤(404、500)有明確訊息,不是等到解析 HTML 才失敗。
export async function loadGlbScene(url: string): Promise<THREE.Object3D> {
  const [{ GLTFLoader }, res] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), fetch(url)])
  if (!res.ok) throw new Error(`GLB 載入失敗(HTTP ${res.status}):${url}`)
  const buffer = await res.arrayBuffer()
  const gltf = await new GLTFLoader().parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1))
  return prepareGlbScene(gltf.scene)
}
