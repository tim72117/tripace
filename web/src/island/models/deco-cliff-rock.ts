import type { Model3D } from '../three/model';

// 峭壁岩塊：有稜有角的灰褐色岩，貼在陡坡面上用（Placement.tilt 讓它對齊坡面）。
// 由旋轉過的方塊、四稜柱與四角錐疊成，平面著色後大平面之間的交線就是稜線。
// 尺寸：寬約 1.6、高約 1.3（原點在底面中心，底部略大、擺放時要埋進坡裡約 1/4）。版面 scale 預設 1,只做小幅變化(真實尺寸見 unit)。
const model: Model3D = {
  unit: 3.4375, // 真實尺寸(1 格 = 1 m):峭壁岩塊約 6.5 m 寬
  palette: {
    rock: '#8f8372',
    rockDark: '#6f6559',
    rockLight: '#a89c88',
  },
  parts: [
    { name: 'base', shape: { type: 'box', size: [1.6, 0.9, 1.3] }, color: '$rock', position: [0, 0.35, 0], rotation: [0.08, 0.5, 0.05] },
    { name: 'slab', shape: { type: 'box', size: [0.9, 0.7, 0.8] }, color: '$rockDark', position: [-0.3, 0.85, 0.05], rotation: [0.25, 0.9, 0.18] },
    { name: 'prism', shape: { type: 'cylinder', radiusTop: 0.08, radiusBottom: 0.42, height: 1.15, segments: 4 }, color: '$rockLight', position: [0.35, 0.8, -0.1], rotation: [0.15, 0.4, -0.2] },
    { name: 'shard', shape: { type: 'cone', radius: 0.35, height: 0.8, segments: 4 }, color: '$rock', position: [-0.1, 1.2, 0.3], rotation: [-0.2, 0.7, 0.3] },
  ],
};

export default model;
