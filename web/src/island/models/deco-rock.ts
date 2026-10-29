import type { Model3D } from '../three/model';

// 岩石：九份山壁常見的灰色砂岩塊，一大一小、兩顆碎石加一點青苔。放在階地崖腳、島的邊緣。
// 尺寸：寬約 0.9、高約 0.5。版面 scale 預設 1,只做小幅變化(真實尺寸見 unit)。
const model: Model3D = {
  unit: 2.65625, // 真實尺寸(1 格 = 1 m):石塊約 2.5 m 寬
  palette: {
    stone: '#8d8a82',
    stoneDark: '#6e6b64',
    moss: '#5f7f45',
  },
  parts: [
    { name: 'big', shape: { type: 'dodecahedron', radius: 0.3 }, color: '$stone', position: [0, 0.2, 0], scale: [1.2, 0.75, 1] },
    { name: 'small', shape: { type: 'dodecahedron', radius: 0.17 }, color: '$stoneDark', position: [0.33, 0.1, 0.12], rotation: [0.4, 0.6, 0] },
    { name: 'pebbleA', shape: { type: 'dodecahedron', radius: 0.07 }, color: '$stone', position: [-0.32, 0.04, 0.16] },
    { name: 'pebbleB', shape: { type: 'dodecahedron', radius: 0.05 }, color: '$stoneDark', position: [0.12, 0.03, 0.3] },
    { name: 'moss', shape: { type: 'dodecahedron', radius: 0.14 }, color: '$moss', position: [-0.08, 0.38, -0.04], scale: [1.4, 0.4, 1.2] },
  ],
};

export default model;
