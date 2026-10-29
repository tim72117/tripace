import type { Model3D, Part } from '../three/model';

// 一串燈籠：兩根木柱之間拉一條繩，五盞紅燈籠微微下垂成弧線，各自以不同相位擺動。
// 設計意圖：跨在步道上方或沿屋前排列，夜晚形成一條紅色光帶，是九份街景的「線條」元素。
// 尺寸：寬 1（柱到柱）、高約 1.05。真實尺寸跨距約 5.6 m(跨過步道),rotY 讓燈串與步道垂直。
const LANTERN_XS = [-0.32, -0.16, 0, 0.16, 0.32];

const lanterns: Part[] = LANTERN_XS.map((x, i) => {
  // 繩子下垂的弧度：中間最低
  const sag = 0.07 * (1 - (x / 0.46) ** 2);
  return {
    name: `lantern${i}`,
    position: [x, 0.96 - sag, 0],
    motion: { kind: 'sway', axis: 'x', amplitude: 0.1, speed: 1.2, phase: i * 1.3 },
    children: [
      { shape: { type: 'sphere', radius: 0.055, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.08, 0], scale: [1, 1.25, 1] },
      { shape: { type: 'cone', radius: 0.018, height: 0.05, segments: 4 }, color: '$tassel', emissive: '$tassel', position: [0, -0.17, 0], rotation: [Math.PI, 0, 0] },
    ],
  };
});

const model: Model3D = {
  unit: 5.625, // 真實尺寸(1 格 = 1 m):燈籠串跨距約 5.7 m(橫過步道)
  palette: {
    wood: '#7a4b2e',
    rope: '#2e2422',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
    tassel: '#ffc15a',
  },
  parts: [
    { name: 'postL', shape: { type: 'cylinder', radiusTop: 0.02, radiusBottom: 0.026, height: 1.02, segments: 6 }, color: '$wood', position: [-0.48, 0.51, 0] },
    { name: 'postR', shape: { type: 'cylinder', radiusTop: 0.02, radiusBottom: 0.026, height: 1.02, segments: 6 }, color: '$wood', position: [0.48, 0.51, 0] },
    // 繩子：橫躺的細圓柱（沿 X）
    { name: 'rope', shape: { type: 'cylinder', radiusTop: 0.006, radiusBottom: 0.006, height: 0.96, segments: 4 }, color: '$rope', position: [0, 0.97, 0], rotation: [0, 0, Math.PI / 2] },
    ...lanterns,
  ],
};

export default model;
