import type { Model3D, Part } from '../../../three/model';

// 石階中段帶平台(steps-landing):5 階、1.2 m 平台、5 階。Blender 腳本 tools/blender/stone_steps.py 的 steps-landing
// (高細節版 GLB 載入後取代這個後備)。單位同 deco-stone-steps:1 單位 = 1.8 m;原點在入口邊中心、入口地面高度;
// +Z 端是入口,往 -Z 上升(共 10 階,爬升 1.0);底下實心埋 0.3 m。總長 4.8 m = 2.667。
const W = 3 / 1.8;
const RISE = 0.18 / 1.8;
const TREAD = 0.36 / 1.8;
const LANDING = 1.2 / 1.8;
const BASE = 0.3 / 1.8;

// [起點 z 往 -z 的距離, 深度, 頂面高]
const SLABS: Array<[number, number, number]> = [
  ...Array.from({ length: 5 }, (_, i): [number, number, number] => [i * TREAD, TREAD, (i + 1) * RISE]),
  [5 * TREAD, LANDING, 5 * RISE],
  ...Array.from({ length: 5 }, (_, i): [number, number, number] => [5 * TREAD + LANDING + i * TREAD, TREAD, (6 + i) * RISE]),
];

const parts: Part[] = SLABS.map(([d, depth, top], i): Part => ({
  name: `slab${i}`,
  shape: { type: 'box', size: [W, top + BASE, depth] },
  color: i % 2 ? '$stone' : '$stoneLight',
  position: [0, (top - BASE) / 2, -(d + depth / 2)],
}));

const model: Model3D = {
  unit: 1.8, // 真實尺寸(1 格 = 1 m):1 單位 = 1.8 m,對齊 GLB
  palette: { stone: '#8f8a80', stoneLight: '#a8a296' },
  parts,
};

export default model;
