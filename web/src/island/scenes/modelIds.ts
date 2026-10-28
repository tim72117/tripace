// modelIds.ts——一份版面實際用到哪些模型(純函式),場景載入時只載入這些,不是整個 models/ 目錄。
import type { IslandLayout } from '../data/layoutTypes'

// 旅人不寫在版面裡,由引擎固定引用(IslandApp 有這兩個模型才會放旅人)。
export const TRAVELER_MODEL_IDS = ['traveler-parent', 'traveler-child'] as const

export function neededModelIds(layout: Pick<IslandLayout, 'stops' | 'scatter'>): string[] {
  const ids = new Set<string>(TRAVELER_MODEL_IDS)
  for (const s of layout.stops) ids.add(s.model)
  for (const p of layout.scatter) ids.add(p.model)
  return [...ids].sort()
}

// 'x/y/deco-rock.ts' → 'deco-rock'
export function modelIdOfPath(path: string): string {
  return path.replace(/^.*\/(.+)\.ts$/, '$1')
}

export type ModelLoaders = Record<string, () => Promise<unknown>>

// loadModels——依 id 清單載入。sources 靠後的優先(場景專屬模型可蓋掉共用的同名模型);
// 找不到載入器的 id 直接略過,由 validateLayout 回報「找不到模型」,不在這裡丟錯。
export async function loadModels<M>(ids: ReadonlyArray<string>, sources: ReadonlyArray<ModelLoaders>): Promise<Record<string, M>> {
  const byId = new Map<string, () => Promise<unknown>>()
  for (const src of sources) for (const [path, load] of Object.entries(src)) byId.set(modelIdOfPath(path), load)
  const entries = await Promise.all(
    ids.flatMap((id) => {
      const load = byId.get(id)
      return load ? [load().then((m) => [id, m as M] as const)] : []
    }),
  )
  return Object.fromEntries(entries)
}
