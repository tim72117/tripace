import type { Model3D, Part, Vec3 } from '../three/model';

// 第一站「壱 基山街」：九份最熱鬧的老街一段。
// 設計意圖：街道沿 X 軸延伸（模型 X 範圍 -0.5~0.5 = 街長），街面在 Z=0，旅人沿街面中線走。
//   - 後側（-Z）一排四間二層店屋，高低錯落，正面朝街（+Z），一樓店面與二樓窗都是 emissive 暖光，
//     每間有一塊直立紅招牌（emissive）。
//   - 前側（+Z，靠鏡頭）刻意只放矮的小吃攤（魚丸、芋圓、臭豆腐），不擋住看向店屋與燈籠的視線。
//   - 街道正上方懸一排紅燈籠（細繩在這個尺度看不見，省略），各燈籠不同相位 sway；一處湯鍋冒蒸氣。
// 傍晚 lanternGlow 還低時，店面暖光先亮、燈籠後亮，正好是文章「人潮散去、燈籠漸亮」的時刻。
// 尺寸：長 1（X）、深約 0.36（Z）、高約 0.24。建議 scale 16（約 16 格長、3.8 格高），rotY 讓街沿步道方向。

function gable(depth: number, length: number, height: number, pos: Vec3): Part {
  const r = depth / 1.732;
  const sz = height / (1.5 * r);
  return {
    shape: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: length, segments: 3 },
    color: '$roof',
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
    scale: [1, 1, sz],
    position: [pos[0], pos[1] + 0.5 * r * sz, pos[2]],
  };
}

// 後排店屋：[x 中心, 牆高, 牆色]
const SHOPS: Array<[number, number, string]> = [
  [-0.375, 0.17, '$wall'],
  [-0.125, 0.14, '$brick'],
  [0.125, 0.18, '$wood'],
  [0.375, 0.15, '$wall'],
];

const shopParts: Part[] = SHOPS.flatMap(([x, h, wall], i): Part[] => [
  { name: `shop${i}`, shape: { type: 'box', size: [0.235, h, 0.1] }, color: wall, position: [x, h / 2, -0.12] },
  // 一樓店面（暖光）
  { name: `shopFront${i}`, shape: { type: 'box', size: [0.16, 0.065, 0.008] }, color: '$warm', emissive: '$warm', position: [x, 0.04, -0.068] },
  // 二樓窗（暖光）
  { name: `shopWin${i}`, shape: { type: 'box', size: [0.12, 0.03, 0.008] }, color: '$warm', emissive: '$warm', position: [x, h - 0.045, -0.068] },
  // 直立紅招牌
  { name: `sign${i}`, shape: { type: 'box', size: [0.026, 0.07, 0.012] }, color: '$sign', emissive: '$signGlow', position: [x + 0.095, h * 0.6, -0.058] },
  gable(0.13, 0.25, 0.055, [x, h, -0.12]),
]);

// 前排小吃攤：[x 中心, 遮棚色]
const STALLS: Array<[number, string]> = [
  [-0.3, '$lantern'],
  [0.02, '$teal'],
  [0.3, '$lantern'],
];

const stallParts: Part[] = STALLS.flatMap(([x, awning], i): Part[] => [
  { name: `stall${i}`, shape: { type: 'box', size: [0.1, 0.035, 0.04] }, color: '$wood', position: [x, 0.0175, 0.11] },
  { name: `stallFood${i}`, shape: { type: 'box', size: [0.06, 0.012, 0.025] }, color: '$warm', emissive: '$warm', position: [x, 0.041, 0.11] },
  { name: `awning${i}`, shape: { type: 'box', size: [0.12, 0.006, 0.065] }, color: awning, position: [x, 0.075, 0.105], rotation: [-0.25, 0, 0] },
]);

// 街道上方的燈籠串
const LANTERN_XS = [-0.4, -0.24, -0.08, 0.08, 0.24, 0.4];
const lanterns: Part[] = LANTERN_XS.map((x, i) => ({
  name: `lantern${i}`,
  position: [x, 0.2, 0.0],
  motion: { kind: 'sway', axis: 'x', amplitude: 0.12, speed: 1.3, phase: i * 1.1 },
  children: [
    { shape: { type: 'sphere', radius: 0.016, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.02, 0], scale: [1, 1.3, 1] },
  ],
}));

const model: Model3D = {
  palette: {
    paving: '#8d8a82',
    wall: '#efe2c8',
    brick: '#a8553a',
    wood: '#7a4b2e',
    roof: '#2e3440',
    warm: '#ffc15a',
    sign: '#b8322a',
    signGlow: '#ff6a3d',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
    teal: '#3f7d74',
    steam: '#f6f1e8',
  },
  parts: [
    // 石板街面
    { name: 'paving', shape: { type: 'box', size: [1, 0.006, 0.3] }, color: '$paving', position: [0, 0.003, 0] },
    ...shopParts,
    ...stallParts,
    ...lanterns,
    // 湯鍋蒸氣（更多蒸氣由 layout 的 deco-steam 補）
    {
      name: 'steamA',
      position: [-0.3, 0.05, 0.12],
      motion: { kind: 'sway', axis: 'z', amplitude: 0.2, speed: 0.9 },
      children: [
        { shape: { type: 'sphere', radius: 0.014, detail: 0 }, color: '$steam', position: [0, 0.015, 0] },
        { shape: { type: 'sphere', radius: 0.01, detail: 0 }, color: '$steam', position: [0.004, 0.035, 0] },
      ],
    },
  ],
};

export default model;
