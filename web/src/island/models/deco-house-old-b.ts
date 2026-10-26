import type { Model3D } from '../three/model';

// 九份老屋 B：紅磚單層長屋，微斜的黑色油毛氈平屋頂，屋頂上有九份常見的不鏽鋼水塔，門邊掛一盞紅燈籠。
// 設計意圖：和 A 款（米白兩層、人字頂）交錯擺，讓山城的屋頂輪廓有高低與材質變化；
// 屋頂水塔是遠看時最好辨識的九份剪影元素。窗、門燈、燈籠都是 emissive。
// 尺寸：寬 1、深 0.6、高約 0.75（含水塔）。建議 scale 3~4（約 3~4 格寬）。
const model: Model3D = {
  palette: {
    brick: '#a8553a',
    brickDark: '#7e3c28',
    roof: '#2e3440',
    tank: '#a9b8c4',
    tankLeg: '#5b6470',
    wood: '#7a4b2e',
    win: '#ffc15a',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
  },
  parts: [
    { name: 'body', shape: { type: 'box', size: [0.96, 0.42, 0.56] }, color: '$brick', position: [0, 0.21, 0] },
    { name: 'base', shape: { type: 'box', size: [1, 0.06, 0.6] }, color: '$brickDark', position: [0, 0.03, 0] },
    // 微斜的平屋頂：前低後高，往前出簷
    { name: 'roof', shape: { type: 'box', size: [1.04, 0.05, 0.68] }, color: '$roof', position: [0, 0.45, 0.03], rotation: [0.08, 0, 0] },
    // 屋頂水塔（圓桶 + 腳架 + 蓋子）
    { name: 'tankStand', shape: { type: 'box', size: [0.2, 0.06, 0.2] }, color: '$tankLeg', position: [0.26, 0.5, -0.1] },
    { name: 'tank', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.09, height: 0.18, segments: 8 }, color: '$tank', position: [0.26, 0.62, -0.1] },
    { name: 'tankLid', shape: { type: 'cone', radius: 0.095, height: 0.05, segments: 8 }, color: '$tank', position: [0.26, 0.735, -0.1] },
    // 正面：木門、兩扇窗
    { name: 'door', shape: { type: 'box', size: [0.15, 0.28, 0.02] }, color: '$wood', position: [-0.12, 0.17, 0.281] },
    { name: 'winL', shape: { type: 'box', size: [0.18, 0.12, 0.02] }, color: '$win', emissive: '$win', position: [-0.36, 0.25, 0.281] },
    { name: 'winR', shape: { type: 'box', size: [0.24, 0.12, 0.02] }, color: '$win', emissive: '$win', position: [0.24, 0.25, 0.281] },
    // 門邊紅燈籠（輕微擺動）
    {
      name: 'lanternHang',
      position: [0.02, 0.4, 0.33],
      motion: { kind: 'sway', axis: 'z', amplitude: 0.1, speed: 1.6, phase: 0.7 },
      children: [
        { shape: { type: 'sphere', radius: 0.05, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.08, 0], scale: [1, 1.25, 1] },
      ],
    },
  ],
};

export default model;
