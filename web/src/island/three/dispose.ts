// dispose.ts——釋放一棵 three 物件樹佔用的 GPU 資源(幾何、材質、貼圖、實例化屬性)。
//
// three 不會自動釋放這些:renderer.dispose() 只釋放 renderer 自己的東西。島是單頁應用裡會反覆掛載/卸載
// 的元件(首頁 ↔ /island、context 還原後重建),不釋放就會累積 GPU 記憶體。
// 注意:model.ts 的材質是「全域共用快取」,這裡釋放它們是安全的——three 的 dispose 只是釋放 GPU 端資源,
// 材質物件之後再被使用會自動重新上傳/編譯,不會壞,只是下一次建島要多編譯一次。
import * as THREE from 'three'

const isTexture = (v: unknown): v is THREE.Texture => !!v && (v as THREE.Texture).isTexture === true

export function disposeMaterial(m: THREE.Material): void {
  // 材質上的貼圖屬性(map、emissiveMap、alphaMap…):掃描所有自有屬性,避免漏掉某一種貼圖
  for (const v of Object.values(m)) if (isTexture(v)) v.dispose()
  // ShaderMaterial 的貼圖放在 uniforms 裡
  const uniforms = (m as THREE.ShaderMaterial).uniforms
  if (uniforms) for (const u of Object.values(uniforms)) if (isTexture(u?.value)) u.value.dispose()
  m.dispose()
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const o = obj as THREE.Mesh
    o.geometry?.dispose()
    const mat = o.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(disposeMaterial)
    else if (mat) disposeMaterial(mat)
    if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose() // 釋放 instanceMatrix / instanceColor
  })
}

// disposeRenderer——釋放 renderer 並主動讓出 WebGL context。
// 只呼叫 renderer.dispose() 不會立刻讓出 context,要等垃圾回收;瀏覽器對同時存在的 context 有上限(約 16 個),
// 反覆進出頁面會觸發「Too many active WebGL contexts」並讓最舊的失效,所以這裡主動 forceContextLoss。
export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose()
  renderer.forceContextLoss()
}
