import type { Model3D } from '../three/model';

// 小吃攤：基山街上賣魚丸、芋圓、臭豆腐的推車攤。木櫃台 + 紅色遮陽棚 + 冒著蒸氣的湯鍋 + 一盞吊燈。
// 設計意圖：「熱鬧」的來源——蒸氣用 sway 緩慢搖動，攤燈與櫃台玻璃櫃是 emissive，傍晚就先亮。
// 正面（客人站的那一側）朝 +Z。尺寸：寬 1、深 0.55、高約 1.05。真實尺寸約 2.2 m 寬、2.3 m 高,版面 scale 預設 1,只做小幅變化(真實尺寸見 unit)。
const model: Model3D = {
  unit: 2.15, // 真實尺寸(1 格 = 1 m):小吃攤約 2.2 m 寬、2.4 m 高(真實尺寸)
  palette: {
    wood: '#7a4b2e',
    woodDark: '#4f2f1c',
    awning: '#d63a2f',
    awningAlt: '#efe2c8',
    pot: '#b8bcc2',
    wheel: '#2e3440',
    glow: '#ffc15a',
    steam: '#f6f1e8',
    food: '#f3ead7',
  },
  parts: [
    // 推車櫃台與輪子
    { name: 'cart', shape: { type: 'box', size: [0.9, 0.4, 0.46] }, color: '$wood', position: [0, 0.28, 0] },
    { name: 'counterTop', shape: { type: 'box', size: [0.96, 0.04, 0.52] }, color: '$woodDark', position: [0, 0.5, 0] },
    { name: 'wheelL', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.09, height: 0.04, segments: 8 }, color: '$wheel', position: [-0.47, 0.09, 0], rotation: [0, 0, Math.PI / 2] },
    { name: 'wheelR', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.09, height: 0.04, segments: 8 }, color: '$wheel', position: [0.47, 0.09, 0], rotation: [0, 0, Math.PI / 2] },
    // 玻璃櫃（小吃展示，emissive 暖光）
    { name: 'showcase', shape: { type: 'box', size: [0.36, 0.14, 0.2] }, color: '$food', emissive: '$glow', position: [0.2, 0.59, 0.1] },
    // 湯鍋與蒸氣
    { name: 'pot', shape: { type: 'cylinder', radiusTop: 0.13, radiusBottom: 0.11, height: 0.14, segments: 8 }, color: '$pot', position: [-0.22, 0.59, 0] },
    {
      name: 'steam',
      position: [-0.22, 0.66, 0],
      motion: { kind: 'sway', axis: 'z', amplitude: 0.18, speed: 0.9 },
      children: [
        { shape: { type: 'sphere', radius: 0.08, detail: 0 }, color: '$steam', position: [0, 0.08, 0] },
        { shape: { type: 'sphere', radius: 0.065, detail: 0 }, color: '$steam', position: [0.03, 0.2, 0] },
        { shape: { type: 'sphere', radius: 0.045, detail: 0 }, color: '$steam', position: [-0.02, 0.3, 0] },
      ],
    },
    // 遮陽棚：後側兩根柱子撐起、往前下斜，紅白兩片
    { name: 'poleL', shape: { type: 'cylinder', radiusTop: 0.018, radiusBottom: 0.018, height: 0.5, segments: 5 }, color: '$woodDark', position: [-0.44, 0.77, -0.2] },
    { name: 'poleR', shape: { type: 'cylinder', radiusTop: 0.018, radiusBottom: 0.018, height: 0.5, segments: 5 }, color: '$woodDark', position: [0.44, 0.77, -0.2] },
    { name: 'awningA', shape: { type: 'box', size: [0.5, 0.025, 0.62] }, color: '$awning', position: [-0.25, 1.0, 0.05], rotation: [0.28, 0, 0] },
    { name: 'awningB', shape: { type: 'box', size: [0.5, 0.025, 0.62] }, color: '$awningAlt', position: [0.25, 1.0, 0.05], rotation: [0.28, 0, 0] },
    // 吊燈
    { name: 'lamp', shape: { type: 'sphere', radius: 0.045, detail: 1 }, color: '$glow', emissive: '$glow', position: [0.1, 0.88, 0.12] },
  ],
};

export default model;
