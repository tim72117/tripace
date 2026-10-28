// data.ts——範例小島的重資料(開發用,見 ./index.ts)。
import type { IslandLayout, Placement, Pt, StopAnchor, TerrainSpec } from '../../data/layoutTypes'
import type { ArticleSource } from '../../logic/articleToIsland'
import type { SceneModule } from '../types'

const OUTLINE: Pt[] = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2
  const r = 24 + Math.sin(i * 2.3) * 2.5 // 略不規則
  return [Math.round(Math.cos(a) * r * 10) / 10, Math.round(Math.sin(a) * r * 10) / 10]
})

const PATH_POINTS: Pt[] = [[-16, 10], [-10, 12], [-3, 9], [3, 4], [9, 2], [14, -4], [12, -11]]

const STOPS: StopAnchor[] = [
  { stopId: 'stop_a', label: '壱 港口小屋', time: '09:30', model: 'deco-house-old-a', x: -10, z: 15, rotY: 0, scale: 5 },
  { stopId: 'stop_b', label: '弐 市集', time: '11:30', model: 'deco-stall', x: 3, z: 8, rotY: -0.4, scale: 2.4 },
  { stopId: 'stop_c', label: '参 山邊老屋', time: '14:00', model: 'deco-house-old-b', x: 14, z: -8, rotY: 0.3, scale: 4 },
]

// 連續地形:南邊低(海岸)往北升高,一條東西向的山脊,三塊削平的平台(放三站)——也是引擎高度場原語的測試台
const rect = (cx: number, cz: number, w: number, d: number): Pt[] => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]]
const TERRAIN: TerrainSpec = {
  ramp: { from: [0, 24], to: [0, -24], y0: 0, y1: 6 },
  features: [
    { kind: 'bump', x: -8, z: -8, rx: 13, rz: 10, rot: 0.4, height: 4 },
    { kind: 'ridge', points: [[-22, -10, 2], [0, -15, 4], [20, -8, 2.5]], halfWidth: 8 },
  ],
  noise: { amp: 0.5, scale: 7, seed: 5 },
  pads: [
    { outline: rect(-10, 15, 9, 7), y: 0.8, blend: 3, color: '#c9bfa0' },
    { outline: rect(3, 8, 7, 6), y: 1.6, blend: 3, color: '#c9bfa0' },
    { outline: rect(14, -8, 9, 8), y: 4.2, blend: 3.5, color: '#c9bfa0' },
  ],
  colors: { beachY: 0.7, beach: '#d9c9a0' },
}

const TREES: Array<[number, number, string]> = [
  [-18, -4, 'deco-tree-pine'], [-14, -10, 'deco-tree-pine'], [-6, -14, 'deco-tree-banyan'], [2, -16, 'deco-tree-pine'],
  [8, -15, 'deco-bush'], [18, 4, 'deco-tree-pine'], [16, 10, 'deco-bush'], [-2, 18, 'deco-bush'], [8, 17, 'deco-rock'],
  [-20, 6, 'deco-rock'], [-8, 2, 'deco-bush'], [6, -6, 'deco-rock'],
]
const SCATTER: Placement[] = TREES.map(([x, z, model], i) => ({ model, x, z, rotY: i * 0.7, scale: model.startsWith('deco-tree') ? 3.5 : 1.6, seed: 100 + i }))

// 白天為主:08:00 ~ 18:00,沒有燈籠光(lanternGlow 全 0)
const day = (time: string, skyTop: string, skyBottom: string, sunIntensity: number, sunElevationDeg: number) => ({
  time, skyTop, skyBottom, fog: skyBottom, sun: '#fff1d0', sunIntensity, sunElevationDeg, sunAzimuthDeg: 200,
  hemiSky: '#bcd7f2', hemiGround: '#6b7a55', hemiIntensity: 0.7, lanternGlow: 0,
})

const layout: IslandLayout = {
  outline: OUTLINE,
  topY: 0,
  sea: { y: -2.5, color: '#3b78a8' },
  thickness: 6,
  river: { points: [], width: 2 },
  terrain: TERRAIN,
  path: { points: PATH_POINTS, width: 2 },
  stops: STOPS,
  scatter: SCATTER,
  lighting: [
    day('08:00', '#8ec5f0', '#dcecf7', 0.8, 25),
    day('12:00', '#5ba9e8', '#cfe6f5', 1.1, 70),
    day('16:00', '#7db4e6', '#f1e3c8', 0.95, 35),
    day('18:00', '#e7a46e', '#f6d4a8', 0.7, 12),
  ],
  palette: { grass: '#7fae5c', grassAlt: '#93bf68', dirt: '#8a6a49', water: '#4a86b0', waterDeep: '#2c5878', path: '#b3a78f' },
}

const article: ArticleSource = {
  slug: 'sample-islet',
  content: {
    title: '範例小島',
    lede: '開發用的範例場景。',
    blocks: [
      { id: 'stop_a', kind: 'stop', index: '壱', name: '港口小屋', desc: '早上抵達小島,先到港口邊的小屋。' },
      { id: 'stop_b', kind: 'stop', index: '弐', name: '市集', desc: '中午在市集逛逛、吃點東西。' },
      { id: 'stop_c', kind: 'stop', index: '参', name: '山邊老屋', desc: '下午走到山邊的老屋,看整座島。' },
    ],
  },
}

const scene: SceneModule = {
  layout,
  article,
  byline: { name: 'tripace' },
  pathPointY: [],
  modelLoaders: {},
}

export default scene
