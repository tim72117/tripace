import type { Model3D, Part } from '../../../three/model';

// 風景地標「昇平戲院」與門前廣場的主建築（不是文章站點，只是九份的經典場景之一）。
// 以下外觀是憑印象做的風格化，不是考據：
//   - 早年的老戲院，近年整修後重新開放(憑印象)。這裡做成「洗石子/灰泥白牆的立面 + 後方長方形觀眾廳」的
//     典型老戲院樣式。
//   - 正面是一道比屋頂高的山牆(牌樓式立面)，頂部中央拱起，掛著橫向大招牌「昇平戲院」(這裡用一塊發光的
//     暖色招牌代表，不做文字)。立面兩側是突出的壁柱，壁柱頂有小柱頭。
//   - 一樓三樘門(中間大門透出大廳暖光)，門上一道雨庇；左右兩側是老電影看板(手繪海報，用暗色板 + 微弱的
//     彩色發光代表)；右側一個小售票口。
//   - 後方觀眾廳是雙坡灰瓦屋頂，屋脊前後向(垂直於立面)，從側面看得出「戲院是一個長盒子」。
//   - 立面兩側各懸一盞紅燈籠(sway)，與九份老街的燈籠一致，夜裡門面是廣場的光源。
// 設計意圖：在豎崎路底、輕便路口旁圍出一個開闊廣場，正面朝 +Z(廣場、海與封面鏡頭)。整體比阿妹茶樓矮、
//   比一般老屋高大且方正，夜裡靠「發光招牌 + 大門暖光 + 兩盞燈籠」被認出來，不和茶樓搶視覺頂點。
// 尺寸：寬約 1.0(X，含壁柱)、深約 0.82(Z，-0.40 ~ +0.42)、高約 0.80(山牆拱頂)。
// 真實尺寸(unit 10.94)約 11 m 寬、9 m 深、8.9 m 高。原點在腳底中心，正面朝 +Z。

const WALL_H = 0.42; // 觀眾廳牆高
const HALL_W = 0.8;
const HALL_D = 0.74;
const HALL_Z = -0.03; // 觀眾廳中心(往後退，讓立面突出在前)
const FRONT_Z = 0.36; // 立面板中心
const FRONT_T = 0.06; // 立面板厚
const FACE = FRONT_Z + FRONT_T / 2; // 立面外表面 z

// 雙坡屋頂：三角柱(cylinder 3 段)，軸向沿 Z、尖端朝上；scale 的第三軸壓扁三角形的高度
function gableRoof(width: number, depth: number, height: number, baseY: number, z: number): Part {
  const r = width / 2 / 0.866;
  const sz = height / (1.5 * r);
  return {
    name: 'hallRoof',
    shape: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: depth, segments: 3 },
    color: '$roof',
    rotation: [-Math.PI / 2, 0, 0],
    scale: [1, 1, sz],
    position: [0, baseY + 0.5 * r * sz, z],
  };
}

function lantern(name: string, x: number, phase: number): Part {
  return {
    name,
    position: [x, 0.43, FACE + 0.05],
    motion: { kind: 'sway', axis: 'x', amplitude: 0.1, speed: 1.2, phase },
    children: [
      { shape: { type: 'cylinder', radiusTop: 0.004, radiusBottom: 0.004, height: 0.04, segments: 4 }, color: '$dark', position: [0, -0.02, 0] },
      { shape: { type: 'sphere', radius: 0.042, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.075, 0], scale: [1, 1.3, 1] },
    ],
  };
}

const model: Model3D = {
  unit: 10.9375, // 真實尺寸(1 格 = 1 m):戲院約 11 m 寬、8.9 m 高
  palette: {
    stone: '#8a877f',
    plaster: '#d8ccb2', // 洗石子/灰泥立面
    plasterShade: '#bfb196',
    hallWall: '#a89a82',
    roof: '#4a4e57', // 灰瓦
    trim: '#7a3b2a', // 門框、壁柱線腳的深紅褐
    door: '#4a2e22',
    warm: '#ffc15a',
    sign: '#3a2a24',
    signGlow: '#ffd27a',
    posterA: '#7a4a6a',
    posterAGlow: '#c0607a',
    posterB: '#3f5a6e',
    posterBGlow: '#5f9ac0',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
    dark: '#2a2420',
  },
  parts: [
    // ---------- 台基與觀眾廳 ----------
    { name: 'podium', shape: { type: 'box', size: [1.0, 0.04, 0.84] }, color: '$stone', position: [0, 0.02, 0.01] },
    { name: 'step', shape: { type: 'box', size: [0.46, 0.025, 0.06] }, color: '$stone', position: [0, 0.0125, FACE + 0.04] },
    { name: 'hall', shape: { type: 'box', size: [HALL_W, WALL_H, HALL_D] }, color: '$hallWall', position: [0, 0.04 + WALL_H / 2, HALL_Z] },
    gableRoof(HALL_W + 0.08, HALL_D + 0.04, 0.2, 0.04 + WALL_H, HALL_Z - 0.01),
    // 觀眾廳側牆的高窗(兩側各兩扇，微亮)
    ...[-1, 1].flatMap((side) =>
      [-0.18, 0.08].map((z, i): Part => ({
        name: `sideWin${side < 0 ? 'L' : 'R'}${i}`,
        shape: { type: 'box', size: [0.01, 0.06, 0.1] },
        color: '$warm',
        emissive: '$warm',
        position: [side * (HALL_W / 2 + 0.003), 0.34, HALL_Z + z],
      })),
    ),

    // ---------- 正面山牆(牌樓式立面) ----------
    { name: 'facade', shape: { type: 'box', size: [0.9, 0.6, FRONT_T] }, color: '$plaster', position: [0, 0.04 + 0.3, FRONT_Z] },
    // 頂部中央拱起(半圓露在立面上緣，下半埋在立面板內)
    { name: 'pediment', shape: { type: 'cylinder', radiusTop: 0.17, radiusBottom: 0.17, height: FRONT_T, segments: 12 }, color: '$plaster', rotation: [Math.PI / 2, 0, 0], position: [0, 0.64, FRONT_Z] },
    { name: 'pedimentStepL', shape: { type: 'box', size: [0.16, 0.06, FRONT_T] }, color: '$plaster', position: [-0.25, 0.67, FRONT_Z] },
    { name: 'pedimentStepR', shape: { type: 'box', size: [0.16, 0.06, FRONT_T] }, color: '$plaster', position: [0.25, 0.67, FRONT_Z] },
    { name: 'cornice', shape: { type: 'box', size: [0.94, 0.025, FRONT_T + 0.03] }, color: '$plasterShade', position: [0, 0.6, FRONT_Z] },
    // 壁柱(左右突出)與柱頭
    ...[-1, 1].flatMap((side): Part[] => [
      { name: `pilaster${side < 0 ? 'L' : 'R'}`, shape: { type: 'box', size: [0.07, 0.68, FRONT_T + 0.04] }, color: '$plasterShade', position: [side * 0.465, 0.04 + 0.34, FRONT_Z + 0.01] },
      { name: `capital${side < 0 ? 'L' : 'R'}`, shape: { type: 'box', size: [0.09, 0.04, FRONT_T + 0.06] }, color: '$trim', position: [side * 0.465, 0.74, FRONT_Z + 0.01] },
    ]),
    // 橫向大招牌「昇平戲院」：暗底框 + 發光字帶
    { name: 'signFrame', shape: { type: 'box', size: [0.5, 0.11, 0.02] }, color: '$sign', position: [0, 0.52, FACE + 0.01] },
    { name: 'signText', shape: { type: 'box', size: [0.44, 0.065, 0.01] }, color: '$signGlow', emissive: '$signGlow', position: [0, 0.52, FACE + 0.022] },
    // 二樓高窗一排(立面中段)
    ...[-0.27, -0.09, 0.09, 0.27].map((x, i): Part => ({
      name: `upperWin${i}`,
      shape: { type: 'box', size: [0.08, 0.07, 0.01] },
      color: '$warm',
      emissive: '$warm',
      position: [x, 0.39, FACE + 0.003],
    })),

    // ---------- 一樓入口 ----------
    { name: 'canopy', shape: { type: 'box', size: [0.6, 0.02, 0.1] }, color: '$trim', position: [0, 0.3, FACE + 0.05] },
    { name: 'doorMain', shape: { type: 'box', size: [0.16, 0.2, 0.01] }, color: '$warm', emissive: '$warm', position: [0, 0.14, FACE + 0.003] },
    { name: 'doorFrame', shape: { type: 'box', size: [0.2, 0.025, 0.015] }, color: '$trim', position: [0, 0.252, FACE + 0.006] },
    { name: 'doorL', shape: { type: 'box', size: [0.1, 0.18, 0.01] }, color: '$door', position: [-0.17, 0.13, FACE + 0.003] },
    { name: 'doorR', shape: { type: 'box', size: [0.1, 0.18, 0.01] }, color: '$door', position: [0.17, 0.13, FACE + 0.003] },
    // 老電影看板(左右各一，微弱彩色光)
    { name: 'posterL', shape: { type: 'box', size: [0.12, 0.17, 0.012] }, color: '$posterA', emissive: '$posterAGlow', position: [-0.34, 0.17, FACE + 0.008] },
    { name: 'posterR', shape: { type: 'box', size: [0.12, 0.17, 0.012] }, color: '$posterB', emissive: '$posterBGlow', position: [0.34, 0.17, FACE + 0.008] },
    // 售票口(右側看板與門之間，小小一格暖光)
    { name: 'ticket', shape: { type: 'box', size: [0.05, 0.04, 0.01] }, color: '$warm', emissive: '$warm', position: [0.255, 0.15, FACE + 0.004] },

    // ---------- 立面兩側的紅燈籠 ----------
    lantern('lanternL', -0.39, 0),
    lantern('lanternR', 0.39, 1.4),
  ],
};

export default model;
