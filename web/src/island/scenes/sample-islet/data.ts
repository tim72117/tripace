// data.ts——範例小島的重資料(開發用,見 ./index.ts)。
import type { IslandLayout, Placement, Pt, StopAnchor, TerrainSpec } from '../../data/layoutTypes'
import type { ArticleSource } from '../../logic/articleToIsland'
import type { SceneModule } from '../types'

const OUTLINE: Pt[] = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2
  const r = 37.5 + Math.sin(i * 2.3) * 3.91 // 略不規則(1 格 = 1 m)
  return [Math.round(Math.cos(a) * r * 10) / 10, Math.round(Math.sin(a) * r * 10) / 10]
})

const PATH_POINTS: Pt[] = [[-25, 15.63], [-15.63, 18.75], [-4.69, 14.06], [4.69, 6.25], [14.06, 3.13], [21.88, -6.25], [18.75, -17.19]]

const STOPS: StopAnchor[] = [
  { stopId: 'stop_a', label: '壱 港口小屋', time: '09:30', model: 'deco-house-old-a', x: -15.63, z: 23.44, rotY: 0, scale: 1.41 },
  { stopId: 'stop_b', label: '弐 市集', time: '11:30', model: 'deco-stall', x: 4.69, z: 12.5, rotY: -0.4, scale: 1.12 },
  { stopId: 'stop_c', label: '参 山邊老屋', time: '14:00', model: 'deco-house-old-b', x: 21.88, z: -12.5, rotY: 0.3, scale: 1.13 },
]

// 連續地形:南邊低(海岸)往北升高,一條東西向的山脊,三塊削平的平台(放三站)——也是引擎高度場原語的測試台
const rect = (cx: number, cz: number, w: number, d: number): Pt[] => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]]
const TERRAIN: TerrainSpec = {
  ramp: { from: [0, 37.5], to: [0, -37.5], y0: 0, y1: 9.38 },
  features: [
    { kind: 'bump', x: -12.5, z: -12.5, rx: 20.31, rz: 15.63, rot: 0.4, height: 6.25 },
    { kind: 'ridge', points: [[-34.38, -15.63, 3.13], [0, -23.44, 6.25], [31.25, -12.5, 3.91]], halfWidth: 12.5 },
  ],
  noise: { amp: 0.78, scale: 10.94, seed: 5 },
  pads: [
    { outline: rect(-15.63, 23.44, 14.06, 10.94), y: 1.25, blend: 4.69, color: '#c9bfa0' },
    { outline: rect(4.69, 12.5, 10.94, 9.38), y: 2.5, blend: 4.69, color: '#c9bfa0' },
    { outline: rect(21.88, -12.5, 14.06, 12.5), y: 6.56, blend: 5.47, color: '#c9bfa0' },
  ],
  colors: { beachY: 1.09, beach: '#d9c9a0' },
}

const TREES: Array<[number, number, string]> = [
  [-28.13, -6.25, 'deco-tree-pine'], [-21.88, -15.63, 'deco-tree-pine'], [-9.38, -21.88, 'deco-tree-banyan'], [3.13, -25, 'deco-tree-pine'],
  [12.5, -23.44, 'deco-bush'], [28.13, 6.25, 'deco-tree-pine'], [25, 15.63, 'deco-bush'], [-3.13, 28.13, 'deco-bush'], [12.5, 26.56, 'deco-rock'],
  [-31.25, 9.38, 'deco-rock'], [-12.5, 3.13, 'deco-bush'], [9.38, -9.38, 'deco-rock'],
]
const SCATTER: Placement[] = TREES.map(([x, z, model], i) => ({ model, x, z, rotY: i * 0.7, seed: 100 + i })) // 大小由模型的 unit 決定(1 格 = 1 m)

// 白天為主:08:00 ~ 18:00,沒有燈籠光(lanternGlow 全 0)
const day = (time: string, skyTop: string, skyBottom: string, sunIntensity: number, sunElevationDeg: number) => ({
  time, skyTop, skyBottom, fog: skyBottom, sun: '#fff1d0', sunIntensity, sunElevationDeg, sunAzimuthDeg: 200,
  hemiSky: '#bcd7f2', hemiGround: '#6b7a55', hemiIntensity: 0.7, lanternGlow: 0,
})

const layout: IslandLayout = {
  outline: OUTLINE,
  topY: 0,
  sea: { y: -3.91, color: '#3b78a8' },
  thickness: 9.38,
  river: { points: [], width: 3.13 },
  terrain: TERRAIN,
  path: { points: PATH_POINTS, width: 3.13 },
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
