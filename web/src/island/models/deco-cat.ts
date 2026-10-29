import type { Model3D } from '../three/model';

// 九份的貓：坐姿的三花貓（白底、橘與黑斑），尾巴貼地左右甩動，頭偶爾轉一下。
// 設計意圖：山城彩蛋，讓人想湊近點看；放在石階邊、茶樓門口、輕便路牆頭。正面朝 +Z。
// 尺寸：寬約 0.45、高約 0.65。真實尺寸約 0.3 m 高(約成人小腿高),版面 scale 預設 1,只做小幅變化(真實尺寸見 unit)。
const model: Model3D = {
  unit: 0.45, // 真實尺寸(1 格 = 1 m):貓坐姿約 0.3 m 高(真實尺寸)
  palette: {
    white: '#f4efe6',
    orange: '#e08a3c',
    black: '#2a2624',
    pink: '#e89a9a',
    eye: '#3a5a2a',
  },
  parts: [
    { name: 'body', shape: { type: 'sphere', radius: 0.2, detail: 1 }, color: '$white', position: [0, 0.2, -0.03], scale: [0.95, 1.1, 1.05] },
    { name: 'patchOrange', shape: { type: 'sphere', radius: 0.13, detail: 0 }, color: '$orange', position: [-0.09, 0.27, -0.1], scale: [1, 0.9, 1] },
    { name: 'patchBlack', shape: { type: 'sphere', radius: 0.1, detail: 0 }, color: '$black', position: [0.1, 0.2, -0.14] },
    { name: 'pawL', shape: { type: 'sphere', radius: 0.05, detail: 0 }, color: '$white', position: [-0.07, 0.04, 0.14] },
    { name: 'pawR', shape: { type: 'sphere', radius: 0.05, detail: 0 }, color: '$white', position: [0.07, 0.04, 0.14] },
    {
      name: 'head',
      position: [0, 0.46, 0.04],
      motion: { kind: 'sway', axis: 'y', amplitude: 0.35, speed: 0.6 },
      children: [
        { name: 'skull', shape: { type: 'sphere', radius: 0.14, detail: 1 }, color: '$white', scale: [1.1, 0.95, 1] },
        { name: 'capOrange', shape: { type: 'sphere', radius: 0.1, detail: 0 }, color: '$orange', position: [-0.05, 0.07, -0.02], scale: [1, 0.6, 1] },
        { name: 'earL', shape: { type: 'cone', radius: 0.05, height: 0.09, segments: 4 }, color: '$orange', position: [-0.08, 0.13, 0], rotation: [0, 0, 0.3] },
        { name: 'earR', shape: { type: 'cone', radius: 0.05, height: 0.09, segments: 4 }, color: '$black', position: [0.08, 0.13, 0], rotation: [0, 0, -0.3] },
        { name: 'eyeL', shape: { type: 'box', size: [0.035, 0.03, 0.02] }, color: '$eye', position: [-0.05, 0.02, 0.13] },
        { name: 'eyeR', shape: { type: 'box', size: [0.035, 0.03, 0.02] }, color: '$eye', position: [0.05, 0.02, 0.13] },
        { name: 'nose', shape: { type: 'box', size: [0.025, 0.02, 0.02] }, color: '$pink', position: [0, -0.03, 0.145] },
      ],
    },
    // 尾巴：樞紐在臀部，尾巴橫躺在地上，繞 Y 軸左右甩
    {
      name: 'tail',
      position: [0, 0.04, -0.18],
      motion: { kind: 'sway', axis: 'y', amplitude: 0.5, speed: 2.2 },
      children: [
        { shape: { type: 'capsule', radius: 0.03, length: 0.24 }, color: '$orange', position: [0.12, 0, -0.04], rotation: [0, 0.3, Math.PI / 2] },
      ],
    },
  ],
};

export default model;
