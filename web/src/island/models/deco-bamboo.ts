import type { Model3D, Part } from '../three/model';

// 竹叢：六根細高的竹竿從同一處冒出，每根以不同相位 sway，頂端一簇竹葉。
// 設計意圖：輕便路旁與階地邊的綠意，搖曳的動態讓安靜的巷子「有風」。
// 尺寸：寬約 0.6、高約 1.5。建議 scale 2.5~3.5。
const STALKS: Array<[number, number, number, number]> = [
  // [x, z, 高度, 傾斜]
  [0, 0, 1.45, 0],
  [0.12, 0.06, 1.3, 0.08],
  [-0.1, 0.08, 1.2, -0.1],
  [0.05, -0.12, 1.35, 0.05],
  [-0.14, -0.06, 1.05, -0.14],
  [0.18, -0.08, 1.0, 0.16],
];

const stalks: Part[] = STALKS.map(([x, z, h, tilt], i) => ({
  name: `stalk${i}`,
  position: [x, 0, z],
  rotation: [tilt * 0.5, 0, tilt],
  motion: { kind: 'sway', axis: 'z', amplitude: 0.05, speed: 1 + i * 0.13, phase: i * 0.9 },
  children: [
    { shape: { type: 'cylinder', radiusTop: 0.016, radiusBottom: 0.022, height: h, segments: 5 }, color: i % 2 ? '$stalk' : '$stalkAlt', position: [0, h / 2, 0] },
    { shape: { type: 'cone', radius: 0.1, height: 0.3, segments: 5 }, color: i % 2 ? '$leaf' : '$leafAlt', position: [0, h - 0.05, 0], rotation: [Math.PI, 0, 0] },
  ],
}));

const model: Model3D = {
  palette: {
    stalk: '#7d9a4a',
    stalkAlt: '#93a858',
    leaf: '#4f8040',
    leafAlt: '#64944c',
  },
  parts: stalks,
};

export default model;
