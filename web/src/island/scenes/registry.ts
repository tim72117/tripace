// registry.ts——場景註冊表:有哪些場景、網址怎麼對、怎麼載入(含快取與預載)。
//
// createSceneRegistry 是純工廠(傳入場景清單與共用模型載入器,方便測試);預設實例 SCENES 等是正式註冊結果。
// 新增場景:建 scenes/<id>/(index.ts 輕量描述 + data.ts 重資料),在下面 ALL 加一行。
import type * as THREE from 'three'
import type { Model3D } from '../three/model'
import { loadGlbScene } from '../three/glbLoader'
import { loadModels, neededModelIds, type ModelLoaders } from './modelIds'
import { NIGHT_JIUFEN } from './night-jiufen'
import { SAMPLE_ISLET } from './sample-islet'
import { SHARED_MODEL_LOADERS } from './sharedModels'
import type { SceneData, SceneDef, SceneModule } from './types'

// GLB_TIMEOUT_MS——單一高細節 GLB 最久等多久;逾時視同載入失敗(沿用簡化版,且不快取這次結果,下次還會重試)。
export const GLB_TIMEOUT_MS = 30_000

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} 載入逾時(${ms}ms)`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export function createSceneRegistry(
  defs: ReadonlyArray<SceneDef>,
  defaultId: string,
  shared: ModelLoaders,
  loadGlb: (url: string) => Promise<THREE.Object3D> = loadGlbScene,
  glbTimeoutMs = GLB_TIMEOUT_MS,
) {
  const scenes = defs
  if (!scenes.some((s) => s.id === defaultId)) throw new Error(`預設場景 ${defaultId} 不在註冊清單裡`)
  const baseCache = new Map<string, Promise<SceneData>>() // 宣告式模型(輕量,首頁縮小版也用)
  const fullCache = new Map<string, Promise<SceneData>>() // 再加上高細節 GLB(完整版島用)
  const glbOf = new Map<string, NonNullable<SceneModule['glbModels']>>()

  const get = (id: string | undefined): SceneDef | undefined => scenes.find((s) => s.id === id)

  // 預設場景維持原本的 /island,其餘 /island/<id>(不讓同一個場景有兩個網址)
  const href = (id: string): string => (id === defaultId ? '/island' : `/island/${id}`)

  // loadBase——只載宣告式模型(同一場景只載入一次,進行中與已完成都共用同一個 promise);失敗不留快取,重試會重新載入。
  const loadBase = (id: string): Promise<SceneData> => {
    const hit = baseCache.get(id)
    if (hit) return hit
    const def = get(id)
    if (!def) return Promise.reject(new Error(`找不到場景 ${id}`))
    const p = def
      .load()
      .then(async (mod) => {
        const { modelLoaders, glbModels, ...rest } = mod
        if (glbModels) glbOf.set(id, glbModels)
        const models = await loadModels<Model3D>(neededModelIds(mod.layout), [shared, modelLoaders])
        return { ...rest, models }
      })
      .catch((e) => {
        baseCache.delete(id)
        throw e
      })
    baseCache.set(id, p)
    return p
  }

  // load——完整版:在基本版上把有 GLB 的模型換成高細節版。單一 GLB 載入失敗(網路、檔案壞、逾時)只記警告、
  // 沿用宣告式後備,場景照樣能進;所以這裡不會因為 GLB 而 reject。
  // 有任何 GLB 失敗時這次結果不留快取(fullCache 清掉),下次 load 會重新嘗試載入高細節版,不必整頁重整;
  // 全部成功才快取。(基本版的快取不受影響。)
  const load = (id: string): Promise<SceneData> => {
    const hit = fullCache.get(id)
    if (hit) return hit
    const p = loadBase(id)
      .then(async (base) => {
        const sources = Object.entries(glbOf.get(id) ?? {}).filter(([mid]) => base.models[mid])
        if (!sources.length) return base
        const models = { ...base.models }
        let anyFailed = false
        await Promise.all(
          sources.map(async ([mid, src]) => {
            try {
              models[mid] = { ...models[mid], glb: { scene: await withTimeout(loadGlb(src.url), glbTimeoutMs, `高細節模型 ${mid}`), unit: src.unit } }
            } catch (e) {
              anyFailed = true
              console.warn(`[island] 高細節模型 ${mid} 載入失敗,改用簡化版:`, e)
            }
          }),
        )
        if (anyFailed && fullCache.get(id) === p) fullCache.delete(id)
        return { ...base, models }
      })
      .catch((e) => {
        if (fullCache.get(id) === p) fullCache.delete(id)
        throw e
      })
    fullCache.set(id, p)
    return p
  }

  // preload——切換選單 hover/focus 時先載入;失敗靜默(真的切過去時會再試並顯示錯誤)。
  const preload = (id: string): void => {
    if (get(id)) void load(id).catch(() => undefined)
  }

  return { scenes, defaultId, get, href, load, loadBase, preload }
}

// ISLAND_SAMPLE_ENABLED——範例小島(實驗場景,sample-islet)的編譯時 feature flag,同 DesktopShared.tsx 那批 VITE_FEATURE_* 的機制:
// 未設為字串 "true" 時預設關閉——切換選單沒有連結、/island/sample-islet 也不存在(導回 /island)。
// 要用條件式直接組陣列(不是建完再 filter):正式建置時條件被靜態替換成 false,範例島的程式與資料 chunk 才會被打包器整個丟掉。
export const ISLAND_SAMPLE_ENABLED = import.meta.env.VITE_FEATURE_ISLAND_SAMPLE === 'true'
const ALL: SceneDef[] = [NIGHT_JIUFEN, ...(import.meta.env.VITE_FEATURE_ISLAND_SAMPLE === 'true' ? [SAMPLE_ISLET] : [])]

export const registry = createSceneRegistry(
  ALL,
  NIGHT_JIUFEN.id,
  SHARED_MODEL_LOADERS,
)
export const SCENES = registry.scenes
export const DEFAULT_SCENE_ID = registry.defaultId
export const getScene = registry.get
export const sceneHref = registry.href
export const loadScene = registry.load
export const loadSceneBase = registry.loadBase
export const preloadScene = registry.preload
