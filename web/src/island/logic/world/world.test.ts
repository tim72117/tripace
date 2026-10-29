import { describe, expect, it } from 'vitest'
import { cellBounds, cellKey, cellOf, cellRng, cellSeed, cellsInBounds, distanceToCell, layerSeed, parseCellKey } from './grid'
import { assembleScene, bakeCells, SCENE_FORMAT_VERSION, validateCells, type CellPlacement, type SceneFiles } from './sceneFormat'

const grid = { cellSize: 32 }

describe('grid', () => {
  it('cellOf:以原點對齊,負座標往下取整;cellKey/parseCellKey 互逆', () => {
    expect(cellOf(grid, 0, 0)).toEqual({ ix: 0, iz: 0 })
    expect(cellOf(grid, 31.99, -0.01)).toEqual({ ix: 0, iz: -1 })
    expect(cellOf(grid, -32, 64)).toEqual({ ix: -1, iz: 2 })
    expect(parseCellKey(cellKey({ ix: -2, iz: 1 }))).toEqual({ ix: -2, iz: 1 })
    expect(() => parseCellKey('a_b')).toThrow()
  })
  it('cellBounds 與 cellsInBounds 一致;distanceToCell 在格內為 0', () => {
    expect(cellBounds(grid, { ix: -1, iz: 0 })).toEqual({ minX: -32, minZ: 0, maxX: 0, maxZ: 32 })
    expect(cellsInBounds(grid, { minX: -1, minZ: -1, maxX: 33, maxZ: 1 }).map(cellKey)).toEqual(['-1_-1', '0_-1', '1_-1', '-1_0', '0_0', '1_0'])
    expect(distanceToCell(grid, { ix: 0, iz: 0 }, 10, 10)).toBe(0)
    expect(distanceToCell(grid, { ix: 0, iz: 0 }, 35, 36)).toBeCloseTo(5)
  })
  it('cellSeed:同輸入同輸出、不同格子/圖層不同;cellRng 可重現', () => {
    expect(cellSeed(7, { ix: 1, iz: 2 })).toBe(cellSeed(7, { ix: 1, iz: 2 }))
    expect(cellSeed(7, { ix: 1, iz: 2 })).not.toBe(cellSeed(7, { ix: 2, iz: 1 }))
    expect(cellSeed(7, { ix: 1, iz: 2 })).not.toBe(cellSeed(8, { ix: 1, iz: 2 }))
    const a = cellRng(7, { ix: 0, iz: 0 }), b = cellRng(7, { ix: 0, iz: 0 })
    expect([a(), a()]).toEqual([b(), b()])
    expect(layerSeed(1, 'pines')).not.toBe(layerSeed(1, 'houses'))
  })
})

const p = (x: number, z: number, source: CellPlacement['source'], model = 'm'): CellPlacement => ({ model, x, z, layer: 'trees', source })
const files = (cells: SceneFiles['cells']): SceneFiles => ({
  scene: { format: SCENE_FORMAT_VERSION, id: 't', grid, seed: 1, layers: { trees: {} }, topY: 0, thickness: 2, river: { points: [], width: 0 } },
  terrain: {
    outline: [[-50, -50], [50, -50], [50, 50], [-50, 50]],
    terrain: { ramp: { from: [0, 0], to: [10, 0], y0: 0, y1: 10 }, pads: [{ id: 'A', kind: 'row', outline: [[1, -1], [3, -1], [3, 1], [1, 1]], y: 'auto', blend: 1 }] },
    autoPadY: { sample: 0.5, step: 0.5 },
  },
  paths: { width: 2, points: [[0, 0, 1], [5, 0, 2]] },
  stops: { stops: [] },
  camera: { cover: { pos: [0, 10, 10], target: [0, 0, 0] }, stops: [] },
  lighting: { keys: [], palette: { grass: '#000', grassAlt: '#000', dirt: '#000', water: '#000', waterDeep: '#000', path: '#000' } },
  cells,
})

describe('sceneFormat', () => {
  it('assembleScene:平台 y auto 取範圍內原地形平均(ramp 斜面上 x 1~3 → 約 2)、步道拆成平面點與腳底高度', () => {
    const a = assembleScene(files([]))
    expect(a.pads[0].y).toBeCloseTo(2, 1)
    expect(a.layout.terrain!.pads![0].y).toBe(a.pads[0].y)
    expect(a.layout.path.points).toEqual([[0, 0], [5, 0]])
    expect(a.pathPointY).toEqual([1, 2])
  })
  it('validateCells:擺放不在自己的格子、圖層沒登記、重複的格子都會報錯', () => {
    const scene = files([]).scene
    expect(validateCells(scene, [{ format: 1, cell: '0_0', placements: [p(40, 1, 'rule')] }])[0]).toMatch(/不在這一格內/)
    expect(validateCells(scene, [{ format: 1, cell: '0_0', placements: [{ ...p(1, 1, 'rule'), layer: 'x' }] }])[0]).toMatch(/沒有在 scene.json 登記/)
    expect(validateCells(scene, [{ format: 1, cell: '0_0', placements: [] }, { format: 1, cell: '0_0', placements: [] }])[0]).toMatch(/重複/)
    expect(() => assembleScene(files([{ format: 1, cell: '0_0', placements: [p(40, 1, 'rule')] }]))).toThrow()
  })
  it('bakeCells:手擺的保留、規則的整批替換,依格子分檔、輸出穩定', () => {
    const existing = [{ format: 1, cell: '0_0', placements: [p(1, 1, 'hand', 'keep'), p(2, 2, 'rule', 'old')] }]
    const out = bakeCells(grid, existing, [p(-5, 3, 'rule', 'new'), p(5, 3, 'rule', 'new2')])
    expect(out.map((c) => c.cell)).toEqual(['-1_0', '0_0'])
    expect(out[1].placements.map((q) => q.model)).toEqual(['keep', 'new2'])
    expect(out.flatMap((c) => c.placements).some((q) => q.model === 'old')).toBe(false)
  })
})
