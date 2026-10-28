import type { Model3D, Part } from '../../../three/model';

// 第四站「肆 阿妹茶樓」：九份最有名的樓閣式茶樓，也是整趟夜遊的終點與島的視覺頂點。
// 設計意圖：
//   - 三層深色木造樓閣，層層外挑的黑瓦屋簷（四角錐台），每層屋簷下掛一排紅燈籠——
//     夜裡整棟像一座發光的燈塔，從島的任何角度都能一眼找到。
//   - 二樓前方是欄杆平台（文章「靠欄杆的位置」），放一張茶桌與小茶壺；平台朝 +Z，
//     島的版面讓 +Z 朝向坡下的山城與遠方海面。
//   - 窗帶全是 emissive 暖黃，紅布招牌 emissive，右側立柱再懸一盞大燈籠（sway）。
// 尺寸：寬約 1、深約 0.72、高約 1.0。建議 scale 7（約 7 格寬、7 格高），放在最高層階地。

// 四角錐台屋簷：cylinder 4 段轉 45 度成正方形，外層群組再壓扁 Z 成長方形
function eave(name: string, y: number, z: number, rBottom: number, rTop: number, h: number, depthScale: number): Part {
  return {
    name,
    position: [0, y, z],
    scale: [1, 1, depthScale],
    children: [
      { shape: { type: 'cylinder', radiusTop: rTop, radiusBottom: rBottom, height: h, segments: 4 }, color: '$roof', rotation: [0, Math.PI / 4, 0] },
    ],
  };
}

function lanternRow(prefix: string, xs: number[], y: number, z: number, r: number): Part[] {
  return xs.map((x, i): Part => ({
    name: `${prefix}${i}`,
    shape: { type: 'sphere', radius: r, detail: 1 },
    color: '$lantern',
    emissive: '$glow',
    position: [x, y, z],
    scale: [1, 1.25, 1],
  }));
}

const model: Model3D = {
  palette: {
    stone: '#8d8a82',
    wood: '#6e3523',
    woodLight: '#7a4b2e',
    rail: '#a8382c',
    roof: '#2e3440',
    warm: '#ffc15a',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
    banner: '#b8322a',
    bannerGlow: '#ff6a3d',
    gold: '#e0b04a',
    clay: '#7b3f2c',
  },
  parts: [
    { name: 'podium', shape: { type: 'box', size: [0.92, 0.08, 0.72] }, color: '$stone', position: [0, 0.04, 0] },

    // ---------- 一樓 ----------
    { name: 'floor1', shape: { type: 'box', size: [0.72, 0.24, 0.52] }, color: '$wood', position: [0, 0.2, 0] },
    { name: 'win1', shape: { type: 'box', size: [0.56, 0.1, 0.01] }, color: '$warm', emissive: '$warm', position: [0, 0.22, 0.262] },
    { name: 'banner', shape: { type: 'box', size: [0.07, 0.2, 0.012] }, color: '$banner', emissive: '$bannerGlow', position: [0.3, 0.2, 0.27] },
    eave('eave1', 0.35, 0, 0.62, 0.45, 0.06, 0.78),
    ...lanternRow('lanternA', [-0.32, -0.16, 0, 0.16, 0.32], 0.29, 0.31, 0.03),

    // ---------- 二樓與欄杆平台 ----------
    { name: 'balcony', shape: { type: 'box', size: [0.8, 0.025, 0.62] }, color: '$woodLight', position: [0, 0.39, 0.02] },
    { name: 'railFront', shape: { type: 'box', size: [0.8, 0.05, 0.014] }, color: '$rail', position: [0, 0.43, 0.33] },
    { name: 'railL', shape: { type: 'box', size: [0.014, 0.05, 0.3] }, color: '$rail', position: [-0.4, 0.43, 0.18] },
    { name: 'railR', shape: { type: 'box', size: [0.014, 0.05, 0.3] }, color: '$rail', position: [0.4, 0.43, 0.18] },
    { name: 'teaTable', shape: { type: 'box', size: [0.13, 0.04, 0.08] }, color: '$woodLight', position: [0.18, 0.425, 0.25] },
    { name: 'teaPot', shape: { type: 'sphere', radius: 0.02, detail: 0 }, color: '$clay', position: [0.18, 0.46, 0.25] },
    { name: 'floor2', shape: { type: 'box', size: [0.56, 0.2, 0.4] }, color: '$wood', position: [0, 0.5, -0.04] },
    { name: 'win2', shape: { type: 'box', size: [0.46, 0.09, 0.01] }, color: '$warm', emissive: '$warm', position: [0, 0.52, 0.162] },
    eave('eave2', 0.63, -0.04, 0.48, 0.33, 0.05, 0.8),
    ...lanternRow('lanternB', [-0.24, -0.08, 0.08, 0.24], 0.58, 0.19, 0.026),

    // ---------- 三樓與頂 ----------
    { name: 'floor3', shape: { type: 'box', size: [0.4, 0.15, 0.3] }, color: '$wood', position: [0, 0.73, -0.04] },
    { name: 'win3', shape: { type: 'box', size: [0.3, 0.07, 0.01] }, color: '$warm', emissive: '$warm', position: [0, 0.74, 0.112] },
    {
      name: 'roofTop',
      position: [0, 0.9, -0.04],
      scale: [1, 1, 0.8],
      children: [
        { shape: { type: 'cone', radius: 0.38, height: 0.2, segments: 4 }, color: '$roof', rotation: [0, Math.PI / 4, 0] },
      ],
    },
    { name: 'finial', shape: { type: 'sphere', radius: 0.025, detail: 0 }, color: '$gold', position: [0, 1.01, -0.04] },
    ...lanternRow('lanternC', [-0.13, 0.13], 0.77, 0.16, 0.022),

    // ---------- 右側立柱懸掛的大燈籠 ----------
    { name: 'sidePost', shape: { type: 'cylinder', radiusTop: 0.012, radiusBottom: 0.016, height: 0.62, segments: 6 }, color: '$woodLight', position: [0.48, 0.39, 0.3] },
    { name: 'sideArm', shape: { type: 'box', size: [0.1, 0.014, 0.014] }, color: '$woodLight', position: [0.44, 0.69, 0.3] },
    {
      name: 'sideLantern',
      position: [0.41, 0.68, 0.3],
      motion: { kind: 'sway', axis: 'z', amplitude: 0.12, speed: 1.1 },
      children: [
        { shape: { type: 'sphere', radius: 0.05, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.08, 0], scale: [1, 1.3, 1] },
      ],
    },
  ],
};

export default model;
