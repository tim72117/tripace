import type { Model3D } from '../three/model';

// 茶壺：紫砂色的圓胖茶壺，壺嘴朝 +Z 斜上，壺把在後。呼應阿妹茶樓「點一壺茶」的段落。
// 設計意圖：小 scale 放在茶樓欄杆邊的茶桌上當擺設；大 scale 可當島上地標或終點彩蛋。
// 尺寸：寬約 0.8、高約 0.75。建議 scale 0.5~0.8（擺設）或 2.5~3.5（地標）。
const model: Model3D = {
  palette: {
    clay: '#7b3f2c',
    clayDark: '#5e2f21',
    clayLight: '#94523a',
  },
  parts: [
    { name: 'foot', shape: { type: 'cylinder', radiusTop: 0.2, radiusBottom: 0.18, height: 0.05, segments: 10 }, color: '$clayDark', position: [0, 0.025, 0] },
    { name: 'body', shape: { type: 'sphere', radius: 0.3, detail: 1 }, color: '$clay', position: [0, 0.3, 0], scale: [1, 0.85, 1] },
    { name: 'lid', shape: { type: 'cylinder', radiusTop: 0.12, radiusBottom: 0.15, height: 0.06, segments: 10 }, color: '$clayLight', position: [0, 0.56, 0] },
    { name: 'knob', shape: { type: 'sphere', radius: 0.045, detail: 0 }, color: '$clayDark', position: [0, 0.62, 0] },
    { name: 'spout', shape: { type: 'cone', radius: 0.07, height: 0.3, segments: 6 }, color: '$clay', position: [0, 0.38, 0.33], rotation: [0.9, 0, 0] },
    { name: 'handle', shape: { type: 'torus', radius: 0.13, tube: 0.03, arc: Math.PI * 1.3 }, color: '$clayDark', position: [0, 0.33, -0.3], rotation: [0, Math.PI / 2, -0.95] },
  ],
};

export default model;
