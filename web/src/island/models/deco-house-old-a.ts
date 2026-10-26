import type { Model3D, Part, Vec3 } from '../three/model';

// 九份老屋 A：依山而建的兩層米白牆小屋，黑瓦（黑色油毛氈）人字屋頂，右側加蓋一間水泥平頂小間。
// 設計意圖：山城的「基本單位」，沿階地等高線成排擺放；上下兩扇小窗是 emissive 暖黃，
// 夜晚一扇扇亮起，讓整面山坡變成點點燈火。屋脊沿 X，正面朝 +Z（請讓正面朝向坡下/鏡頭）。
// 尺寸：寬約 1.2（含加蓋）、深 0.72、高約 0.9。建議 scale 3~4.2（約 3.5~5 格寬）。

// 三角柱屋頂：cylinder 3 段，旋轉 [-π/2, 0, π/2] 後屋脊沿 X、尖端朝上。
// depth = 屋頂前後跨距，height = 屋簷到屋脊的高度，baseY = 屋簷高度。
function gable(name: string, depth: number, length: number, height: number, pos: Vec3, color: string): Part {
  const r = depth / 1.732;
  const sz = height / (1.5 * r);
  return {
    name,
    shape: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: length, segments: 3 },
    color,
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
    scale: [1, 1, sz],
    position: [pos[0], pos[1] + 0.5 * r * sz, pos[2]],
  };
}

const model: Model3D = {
  palette: {
    wall: '#efe2c8',
    plinth: '#8d8a82',
    roof: '#2e3440',
    annex: '#c9c2b0',
    wood: '#7a4b2e',
    win: '#ffc15a',
    winFrame: '#5a4636',
    plant: '#5f8a4a',
    pot: '#a8553a',
  },
  parts: [
    { name: 'plinth', shape: { type: 'box', size: [0.9, 0.08, 0.64] }, color: '$plinth', position: [-0.1, 0.04, 0] },
    { name: 'body', shape: { type: 'box', size: [0.84, 0.6, 0.6] }, color: '$wall', position: [-0.1, 0.38, 0] },
    // 上層兩扇窗（emissive）
    { name: 'winUpL', shape: { type: 'box', size: [0.16, 0.13, 0.02] }, color: '$win', emissive: '$win', position: [-0.32, 0.5, 0.301] },
    { name: 'winUpR', shape: { type: 'box', size: [0.16, 0.13, 0.02] }, color: '$win', emissive: '$win', position: [0.1, 0.5, 0.301] },
    { name: 'sill', shape: { type: 'box', size: [0.66, 0.025, 0.05] }, color: '$winFrame', position: [-0.11, 0.425, 0.31] },
    // 一樓木門與窗
    { name: 'door', shape: { type: 'box', size: [0.16, 0.27, 0.02] }, color: '$wood', position: [-0.32, 0.215, 0.301] },
    { name: 'winLow', shape: { type: 'box', size: [0.2, 0.12, 0.02] }, color: '$win', emissive: '$win', position: [0.08, 0.24, 0.301] },
    // 黑瓦人字屋頂
    gable('roof', 0.74, 0.96, 0.26, [-0.1, 0.68, 0], '$roof'),
    // 右側水泥加蓋 + 平頂
    { name: 'annex', shape: { type: 'box', size: [0.3, 0.38, 0.44] }, color: '$annex', position: [0.46, 0.19, 0.06] },
    { name: 'annexRoof', shape: { type: 'box', size: [0.34, 0.04, 0.48] }, color: '$roof', position: [0.46, 0.4, 0.06] },
    { name: 'annexWin', shape: { type: 'box', size: [0.12, 0.1, 0.02] }, color: '$win', emissive: '$win', position: [0.46, 0.24, 0.281] },
    // 門口盆栽
    { name: 'pot', shape: { type: 'cylinder', radiusTop: 0.05, radiusBottom: 0.04, height: 0.07, segments: 6 }, color: '$pot', position: [-0.52, 0.035, 0.38] },
    { name: 'plant', shape: { type: 'dodecahedron', radius: 0.07 }, color: '$plant', position: [-0.52, 0.12, 0.38] },
  ],
};

export default model;
