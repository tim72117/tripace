import type { Model3D } from '../three/model';

// 榕樹：粗短樹幹、垂下的氣根、寬闊扁平的深綠樹冠。台灣老街口、廟埕常見的「大樹下」意象。
// 設計意圖：放在島的前緣與基山街口，用寬樹冠框住畫面；樹冠整團以 sway 微微晃動。
// 尺寸：寬約 1.1、高約 1。版面 scale 預設 1,只做小幅變化(真實尺寸見 unit)。
const model: Model3D = {
  unit: 7.65625, // 真實尺寸(1 格 = 1 m):榕樹約 8.5 m 高、8.7 m 寬
  palette: {
    trunk: '#6b4a32',
    root: '#5a3e2a',
    leaf: '#3f6b3a',
    leafDark: '#2f5530',
    leafLight: '#5a8a48',
  },
  parts: [
    { name: 'trunk', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.15, height: 0.55, segments: 7 }, color: '$trunk', position: [0, 0.275, 0] },
    { name: 'rootA', shape: { type: 'cylinder', radiusTop: 0.015, radiusBottom: 0.02, height: 0.42, segments: 4 }, color: '$root', position: [0.3, 0.4, 0.1] },
    { name: 'rootB', shape: { type: 'cylinder', radiusTop: 0.015, radiusBottom: 0.02, height: 0.36, segments: 4 }, color: '$root', position: [-0.28, 0.44, -0.08] },
    { name: 'rootC', shape: { type: 'cylinder', radiusTop: 0.015, radiusBottom: 0.02, height: 0.3, segments: 4 }, color: '$root', position: [0.06, 0.48, 0.3] },
    {
      name: 'canopy',
      position: [0, 0.62, 0],
      motion: { kind: 'sway', axis: 'z', amplitude: 0.03, speed: 0.8 },
      children: [
        { shape: { type: 'dodecahedron', radius: 0.36 }, color: '$leaf', position: [0, 0.12, 0], scale: [1.3, 0.75, 1.2] },
        { shape: { type: 'dodecahedron', radius: 0.26 }, color: '$leafDark', position: [-0.32, 0.04, 0.06], scale: [1.1, 0.8, 1] },
        { shape: { type: 'dodecahedron', radius: 0.24 }, color: '$leafLight', position: [0.3, 0.1, -0.08], scale: [1.1, 0.8, 1] },
        { shape: { type: 'dodecahedron', radius: 0.2 }, color: '$leaf', position: [0.05, 0.3, 0.12] },
      ],
    },
  ],
};

export default model;
