// cellRuntime.ts——執行時的格子管理器:每幀依鏡頭焦點更新每格的串流與 LOD 狀態(logic/world/streaming.ts),
// 套到該格的物件上。做法同 World Partition 的串流與 WoC 的區域串流、far_lod_latch。
//
// 目前的最小框架:
//   - 串流:格子「載入」= 顯示,「卸載」= 隱藏(物件仍在記憶體)。真正的建立/釋放與背景佇列是待辦。
//   - LOD:每格算出等級,變化時呼叫 onLod(預設不做事)。模型的低細節版本(_LOD1.glb)與地形疏網格是待辦。
//   - HLOD:超過 hlodDistance 的格子本體隱藏,onHlod 通知(整格合併替身是待辦)。
// 只在狀態改變時動到物件(BatchedMesh.setVisibleAt、Object3D.visible),平常每幀只做幾十次距離計算。
import type * as THREE from 'three'
import { parseCellKey, type WorldGrid } from '../../logic/world/grid'
import { DEFAULT_STREAMING, nextCellState, type CellState, type StreamingConfig } from '../../logic/world/streaming'

export type CellContent = { objects: THREE.Object3D[]; instances: Array<{ mesh: THREE.BatchedMesh; id: number }> }

export type CellRuntimeHooks = {
  onLod?: (cell: string, lod: number) => void
  onHlod?: (cell: string, on: boolean) => void
}

export type CellRuntime = {
  add(cell: string, content: Partial<CellContent>): void
  update(x: number, z: number): void
  state(cell: string): CellState | undefined
  readonly cells: ReadonlyArray<string>
}

export function createCellRuntime(grid: WorldGrid, cfg: StreamingConfig = DEFAULT_STREAMING, hooks: CellRuntimeHooks = {}): CellRuntime {
  const content = new Map<string, CellContent>()
  const states = new Map<string, CellState>()
  const apply = (c: CellContent, visible: boolean) => {
    for (const o of c.objects) o.visible = visible
    for (const { mesh, id } of c.instances) mesh.setVisibleAt(id, visible)
  }
  return {
    get cells() { return [...content.keys()] },
    add(cell, part) {
      const c = content.get(cell) ?? { objects: [], instances: [] }
      c.objects.push(...(part.objects ?? []))
      c.instances.push(...(part.instances ?? []))
      content.set(cell, c)
      states.delete(cell) // 下一次 update 重新判斷並套用
    },
    update(x, z) {
      for (const [cell, c] of content) {
        const prev = states.get(cell)
        const next = nextCellState(grid, parseCellKey(cell), x, z, prev, cfg)
        const visible = next.loaded && !next.hlod
        if (!prev || visible !== (prev.loaded && !prev.hlod)) apply(c, visible)
        if (prev && next.lod !== prev.lod) hooks.onLod?.(cell, next.lod)
        if (prev && next.hlod !== prev.hlod) hooks.onHlod?.(cell, next.hlod)
        states.set(cell, next)
      }
    },
    state: (cell) => states.get(cell),
  }
}
