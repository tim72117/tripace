import type { Model3D } from '../three/model';

// 路燈：輕便路那種老式單臂路燈，深色鐵桿、彎出的燈臂、垂下的暖黃燈泡（emissive）。
// 設計意圖：輕便路「只剩路燈一盞盞亮著」的安靜氛圍靠它撐起；比紅燈籠冷靜、偏暖黃。
// 尺寸：高約 1.6、燈臂向 +Z 伸出約 0.3。真實尺寸約 4.4 m 高,版面 scale 預設 1,只做小幅變化(真實尺寸見 unit)。
const model: Model3D = {
  unit: 2.8125, // 真實尺寸(1 格 = 1 m):路燈約 4.4 m 高
  palette: {
    iron: '#33363d',
    ironLight: '#4b505a',
    bulb: '#ffc15a',
  },
  parts: [
    { name: 'base', shape: { type: 'cylinder', radiusTop: 0.06, radiusBottom: 0.09, height: 0.12, segments: 6 }, color: '$ironLight', position: [0, 0.06, 0] },
    { name: 'pole', shape: { type: 'cylinder', radiusTop: 0.025, radiusBottom: 0.035, height: 1.5, segments: 6 }, color: '$iron', position: [0, 0.82, 0] },
    { name: 'arm', shape: { type: 'box', size: [0.03, 0.03, 0.32] }, color: '$iron', position: [0, 1.55, 0.14] },
    { name: 'shade', shape: { type: 'cone', radius: 0.1, height: 0.08, segments: 6 }, color: '$ironLight', position: [0, 1.52, 0.28] },
    { name: 'bulb', shape: { type: 'sphere', radius: 0.055, detail: 1 }, color: '$bulb', emissive: '$bulb', position: [0, 1.46, 0.28] },
  ],
};

export default model;
