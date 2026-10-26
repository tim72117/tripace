import type { Model3D } from '../three/model';

// 灌木叢：四團大小不一的低多邊形綠球加兩朵藍紫小花，填補階地邊緣與屋角的空隙。
// 尺寸：寬約 0.9、高約 0.5。建議 scale 1.2~2.2。
const model: Model3D = {
  palette: {
    leaf: '#4f7a40',
    leafDark: '#3b6234',
    leafLight: '#6b9450',
    flower: '#8f9be0',
  },
  parts: [
    { shape: { type: 'dodecahedron', radius: 0.26 }, color: '$leaf', position: [0, 0.22, 0], scale: [1.1, 0.85, 1] },
    { shape: { type: 'dodecahedron', radius: 0.2 }, color: '$leafDark', position: [-0.27, 0.15, 0.05] },
    { shape: { type: 'dodecahedron', radius: 0.17 }, color: '$leafLight', position: [0.26, 0.14, -0.04] },
    { shape: { type: 'dodecahedron', radius: 0.13 }, color: '$leafLight', position: [-0.06, 0.1, 0.24] },
    // 幾朵小花點綴（九份牆角常見的繡球花色）
    { shape: { type: 'sphere', radius: 0.045, detail: 0 }, color: '$flower', position: [0.1, 0.4, 0.12] },
    { shape: { type: 'sphere', radius: 0.04, detail: 0 }, color: '$flower', position: [-0.24, 0.3, 0.12] },
  ],
};

export default model;
