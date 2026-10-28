// registry.ts——場景註冊表:有哪些場景、網址怎麼對、怎麼載入(含快取與預載)。
//
// createSceneRegistry 是純工廠(傳入場景清單與共用模型載入器,方便測試);預設實例 SCENES 等是正式註冊結果。
// 新增場景:建 scenes/<id>/(index.ts 輕量描述 + data.ts 重資料),在下面 ALL 加一行。
import type { Model3D } from '../three/model'
import { loadModels, neededModelIds, type ModelLoaders } from './modelIds'
import { NIGHT_JIUFEN } from './night-jiufen'
import { SAMPLE_ISLET } from './sample-islet'
import { SHARED_MODEL_LOADERS } from './sharedModels'
import type { SceneData, SceneDef } from './types'

export function createSceneRegistry(defs: ReadonlyArray<SceneDef>, defaultId: string, shared: ModelLoaders) {
  const scenes = defs
  if (!scenes.some((s) => s.id === defaultId)) throw new Error(`預設場景 ${defaultId} 不在註冊清單裡`)
  const cache = new Map<string, Promise<SceneData>>()

  const get = (id: string | undefined): SceneDef | undefined => scenes.find((s) => s.id === id)

  // 預設場景維持原本的 /island,其餘 /island/<id>(不讓同一個場景有兩個網址)
  const href = (id: string): string => (id === defaultId ? '/island' : `/island/${id}`)

  // load——同一場景只載入一次(進行中與已完成都共用同一個 promise);失敗不留快取,重試會重新載入。
  const load = (id: string): Promise<SceneData> => {
    const hit = cache.get(id)
    if (hit) return hit
    const def = get(id)
    if (!def) return Promise.reject(new Error(`找不到場景 ${id}`))
    const p = def
      .load()
      .then(async (mod) => {
        const { modelLoaders, ...rest } = mod
        const models = await loadModels<Model3D>(neededModelIds(mod.layout), [shared, modelLoaders])
        return { ...rest, models }
      })
      .catch((e) => {
        cache.delete(id)
        throw e
      })
    cache.set(id, p)
    return p
  }

  // preload——切換選單 hover/focus 時先載入;失敗靜默(真的切過去時會再試並顯示錯誤)。
  const preload = (id: string): void => {
    if (get(id)) void load(id).catch(() => undefined)
  }

  return { scenes, defaultId, get, href, load, preload }
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
export const preloadScene = registry.preload
