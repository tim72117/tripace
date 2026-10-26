import type { Model3D } from '../three/model';

// 單顆紅燈籠（附木掛架）：九份最具代表性的小物件，散落在步道兩側與屋簷旁。
// 設計意圖：細木柱 + 橫桿，燈籠從橫桿垂掛並以 sway 輕輕搖晃；燈籠本體與穗子是 emissive，
// 夜晚由渲染層依 lanternGlow 點亮，是整座島「一盞一盞亮起」節奏的主要光點。
// 尺寸：總高約 1.15、寬約 0.6（以木柱到燈籠的跨距計）。建議 scale 1.2~1.6（約 1.5~1.8 格高）。
const model: Model3D = {
  palette: {
    wood: '#7a4b2e',
    woodDark: '#4f2f1c',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
    cap: '#2e2422',
    tassel: '#ffc15a',
  },
  parts: [
    // 木柱與底座
    { name: 'foot', shape: { type: 'box', size: [0.2, 0.06, 0.2] }, color: '$woodDark', position: [-0.3, 0.03, 0] },
    { name: 'post', shape: { type: 'cylinder', radiusTop: 0.035, radiusBottom: 0.045, height: 1.15, segments: 6 }, color: '$wood', position: [-0.3, 0.6, 0] },
    // 橫桿
    { name: 'arm', shape: { type: 'box', size: [0.42, 0.04, 0.05] }, color: '$wood', position: [-0.1, 1.14, 0] },
    // 燈籠樞紐：從橫桿末端垂掛，隨風擺盪
    {
      name: 'hang',
      position: [0.06, 1.12, 0],
      motion: { kind: 'sway', axis: 'z', amplitude: 0.12, speed: 1.4 },
      children: [
        { name: 'cord', shape: { type: 'cylinder', radiusTop: 0.008, radiusBottom: 0.008, height: 0.12, segments: 4 }, color: '$cap', position: [0, -0.06, 0] },
        { name: 'capTop', shape: { type: 'cylinder', radiusTop: 0.07, radiusBottom: 0.09, height: 0.04, segments: 8 }, color: '$cap', position: [0, -0.14, 0] },
        { name: 'body', shape: { type: 'sphere', radius: 0.17, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.32, 0], scale: [1, 1.2, 1] },
        { name: 'band', shape: { type: 'cylinder', radiusTop: 0.175, radiusBottom: 0.175, height: 0.03, segments: 8 }, color: '$cap', position: [0, -0.32, 0] },
        { name: 'capBottom', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.07, height: 0.04, segments: 8 }, color: '$cap', position: [0, -0.52, 0] },
        { name: 'tassel', shape: { type: 'cone', radius: 0.05, height: 0.14, segments: 5 }, color: '$tassel', emissive: '$tassel', position: [0, -0.6, 0], rotation: [Math.PI, 0, 0] },
      ],
    },
  ],
};

export default model;
