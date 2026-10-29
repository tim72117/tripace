import type { Model3D, Part } from '../../../three/model';

// 石階小片(5 階):Blender 腳本 tools/blender/stone_steps.py 的 steps-5(高細節版 GLB 載入後取代這個後備)。
// 單位:長(Z)= 1 = 1.8 m(5 階 × 0.36);寬 3 m = 1.667;每階高 0.18 m = 0.1;原點在入口邊中心、最低一階的地面高度,
// +Z 端是入口,往 -Z 上升(爬升 0.5);底下實心埋 0.3 m = 0.167,所以放在坡面上不會露出懸空的底。
const STEPS = 5;
const W = 3 / 1.8;
const RISE = 0.18 / 1.8;
const BASE = 0.3 / 1.8;

const steps: Part[] = Array.from({ length: STEPS }, (_, i): Part => {
  const top = (i + 1) * RISE;
  return {
    name: `step${i}`,
    shape: { type: 'box', size: [W, top + BASE, 1 / STEPS] },
    color: i % 2 ? '$stone' : '$stoneLight',
    position: [0, (top - BASE) / 2, -(i + 0.5) / STEPS],
  };
});

const model: Model3D = {
  unit: 1.8, // 真實尺寸(1 格 = 1 m):1 單位 = 1.8 m,對齊 GLB
  palette: { stone: '#8f8a80', stoneLight: '#a8a296' },
  parts: steps,
};

export default model;
