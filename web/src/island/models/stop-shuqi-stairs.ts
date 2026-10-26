import type { Model3D, Part } from '../three/model';

// 第二站「弐 豎崎路石階」：九份最經典的畫面——長長的石階往上，兩旁紅燈籠一盞接一盞。
// 設計意圖：
//   - 石階沿 Z 軸：+Z 端（Z=0.5）是最低一階、貼地；往 -Z 爬升，-Z 端（Z=-0.5）頂面高 RISE。
//     模型「正面朝 +Z」= 從山下往上看的視角，鏡頭在坡下就能看到整段階梯往上延伸。
//   - 12 階實心石塊，深淺兩種石色交錯，讓每一階的高低一眼可辨。
//   - 兩側斜牆 + 外側四棟店屋立面（往上越高），立面朝內的窗是 emissive 暖光。
//   - 兩側各 4 盞紅燈籠沿坡度排列、各自 sway；它們是「一盞接一盞亮起」最該被看見的燈。
// 尺寸：長 1（Z）、全寬約 0.47（含兩側立面）、最高約 0.88（頂端立面）、階梯頂面高 0.43。
// 建議 scale 14 → 約 14 格長、階梯爬升 6 格、寬 6.6 格；rotY 讓 -Z 朝上坡方向。
// 縮小 scale（例如 4.7 → 爬升 2 格）也可當階地之間的連接小階梯。

const STEPS = 12;
const RISE = 0.43;
const STEP_W = 0.22;
const SLOPE = Math.atan(RISE); // 斜牆傾角
const heightAt = (z: number) => (0.5 - z) * RISE; // 該 Z 處的階梯頂面高度

const steps: Part[] = Array.from({ length: STEPS }, (_, i): Part => {
  const h = ((i + 1) / STEPS) * RISE;
  const z = 0.5 - (i + 0.5) / STEPS;
  return {
    name: `step${i}`,
    shape: { type: 'box', size: [STEP_W, h, 1 / STEPS + 0.002] },
    color: i % 2 ? '$stone' : '$stoneLight',
    position: [0, h / 2, z],
  };
});

const walls: Part[] = [-1, 1].map((side): Part => ({
  name: side < 0 ? 'wallL' : 'wallR',
  shape: { type: 'box', size: [0.04, 0.1, Math.hypot(1, RISE)] },
  color: '$wallStone',
  position: [side * 0.13, RISE / 2 + 0.05, 0],
  rotation: [SLOPE, 0, 0],
}));

// 兩側燈籠：沿坡度排列，樞紐在燈籠上方，往下垂掛
const LANTERN_ZS = [0.36, 0.1, -0.16, -0.42];
const lanterns: Part[] = [-1, 1].flatMap((side) =>
  LANTERN_ZS.map((z, i): Part => ({
    name: `lantern${side < 0 ? 'L' : 'R'}${i}`,
    position: [side * 0.13, heightAt(z) + 0.2, z],
    motion: { kind: 'sway', axis: 'x', amplitude: 0.1, speed: 1.2 + i * 0.1, phase: i * 1.4 + (side > 0 ? 0.8 : 0) },
    children: [
      { shape: { type: 'sphere', radius: 0.026, detail: 1 }, color: '$lantern', emissive: '$glow', position: [0, -0.04, 0], scale: [1, 1.3, 1] },
    ],
  })),
);

// 外側店屋立面：[側, z 中心, 長度, 頂高, 牆色]
const FACADES: Array<[number, number, number, number, string]> = [
  [-1, 0.22, 0.5, 0.36, '$wall'],
  [-1, -0.27, 0.46, 0.66, '$brick'],
  [1, 0.26, 0.42, 0.32, '$brick'],
  [1, -0.22, 0.54, 0.62, '$wall'],
];

const facades: Part[] = FACADES.flatMap(([side, z, len, top, color], i): Part[] => [
  { name: `facade${i}`, shape: { type: 'box', size: [0.08, top, len] }, color, position: [side * 0.195, top / 2, z] },
  { name: `facadeRoof${i}`, shape: { type: 'box', size: [0.1, 0.025, len + 0.02] }, color: '$roof', position: [side * 0.195, top + 0.012, z] },
  // 朝階梯內側的窗（暖光），放在該段階梯頂面上方
  { name: `facadeWin${i}`, shape: { type: 'box', size: [0.006, 0.05, len * 0.5] }, color: '$warm', emissive: '$warm', position: [side * 0.152, Math.min(heightAt(z) + 0.14, top - 0.06), z] },
]);

const model: Model3D = {
  palette: {
    stone: '#8d8a82',
    stoneLight: '#a39f95',
    wallStone: '#6f6b64',
    wall: '#efe2c8',
    brick: '#a8553a',
    roof: '#2e3440',
    warm: '#ffc15a',
    lantern: '#d63a2f',
    glow: '#ff5a2e',
  },
  parts: [...steps, ...walls, ...facades, ...lanterns],
};

export default model;
