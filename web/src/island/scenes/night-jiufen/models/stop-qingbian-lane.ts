import type { Model3D, Part, Vec3 } from '../../../three/model';

// 第三站「参 輕便路散步」：從豎崎路往阿妹茶樓方向的安靜緩坡小路。
// 設計意圖：
//   - 和前兩站相反——沒有攤販、沒有成串燈籠，只有三盞暖黃路燈（emissive）一盞盞亮著，
//     讓畫面「靜下來」。路面是 8 段很低的緩坡石板，沿 Z 軸往 -Z 爬升 RISE。
//   - +X 側：下半段矮石牆、上半段一角老屋（窗內暖光）、三盞路燈立在路與牆之間。
//   - -X 側（建議朝向鏡頭）：低矮的竹籬笆與一小叢竹子，不擋視線。
// 尺寸：長 1（Z）、寬約 0.6、路面爬升 0.15、老屋最高約 0.45。
// unit 15.625 → 真實尺寸約 15.6 m 長、爬升 2.3 m,剛好接上一層較高的階地；rotY 讓 -Z 朝上坡方向。

const SEGMENTS = 8;
const RISE = 0.15;
const PATH_W = 0.2;
const heightAt = (z: number) => (0.5 - z) * RISE;

const road: Part[] = Array.from({ length: SEGMENTS }, (_, i): Part => {
  const h = ((i + 1) / SEGMENTS) * RISE;
  return {
    name: `road${i}`,
    shape: { type: 'box', size: [PATH_W, h, 1 / SEGMENTS + 0.002] },
    color: i % 2 ? '$paving' : '$pavingLight',
    position: [0, h / 2, 0.5 - (i + 0.5) / SEGMENTS],
  };
});

// 路燈：底座踩在該處路面高度，燈臂伸向路中央（-X）
function lamp(z: number, i: number): Part[] {
  const base = heightAt(z);
  const x = 0.125;
  return [
    { name: `lampPole${i}`, shape: { type: 'cylinder', radiusTop: 0.006, radiusBottom: 0.009, height: 0.26, segments: 5 }, color: '$iron', position: [x, base + 0.13, z] },
    { name: `lampArm${i}`, shape: { type: 'box', size: [0.06, 0.008, 0.008] }, color: '$iron', position: [x - 0.03, base + 0.26, z] },
    { name: `lampBulb${i}`, shape: { type: 'sphere', radius: 0.016, detail: 1 }, color: '$bulb', emissive: '$bulb', position: [x - 0.055, base + 0.245, z] },
  ];
}

const fencePosts: Part[] = [0.44, 0.29, 0.14, -0.01, -0.16, -0.31, -0.46].map((z, i): Part => ({
  name: `post${i}`,
  shape: { type: 'cylinder', radiusTop: 0.007, radiusBottom: 0.008, height: 0.08, segments: 5 },
  color: '$bambooDry',
  position: [-0.125, heightAt(z) + 0.04, z],
}));

function rail(name: string, above: number): Part {
  return {
    name,
    shape: { type: 'box', size: [0.008, 0.008, Math.hypot(1, RISE)] },
    color: '$bambooDry',
    position: [-0.125, RISE / 2 + above, 0],
    rotation: [Math.atan(RISE), 0, 0],
  };
}

// 老屋一角的人字屋頂（屋脊沿 X）
function gable(depth: number, length: number, height: number, pos: Vec3): Part {
  const r = depth / 1.732;
  const sz = height / (1.5 * r);
  return {
    name: 'houseRoof',
    shape: { type: 'cylinder', radiusTop: r, radiusBottom: r, height: length, segments: 3 },
    color: '$roof',
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
    scale: [1, 1, sz],
    position: [pos[0], pos[1] + 0.5 * r * sz, pos[2]],
  };
}

const bamboo: Part[] = [0, 1, 2].map((i): Part => ({
  name: `bamboo${i}`,
  position: [-0.19 - i * 0.025, 0, 0.32 - i * 0.04],
  rotation: [0, 0, -0.08 * i],
  motion: { kind: 'sway', axis: 'z', amplitude: 0.05, speed: 1 + i * 0.2, phase: i * 1.1 },
  children: [
    { shape: { type: 'cylinder', radiusTop: 0.005, radiusBottom: 0.007, height: 0.32 - i * 0.04, segments: 5 }, color: '$bamboo', position: [0, (0.32 - i * 0.04) / 2, 0] },
    { shape: { type: 'cone', radius: 0.035, height: 0.09, segments: 5 }, color: '$leaf', position: [0, 0.3 - i * 0.04, 0], rotation: [Math.PI, 0, 0] },
  ],
}));

const model: Model3D = {
  unit: 15.625, // 真實尺寸(1 格 = 1 m):路段約 15.6 m 長
  palette: {
    paving: '#8d8a82',
    pavingLight: '#9d998f',
    wallStone: '#6f6b64',
    wall: '#efe2c8',
    roof: '#2e3440',
    warm: '#ffc15a',
    iron: '#33363d',
    bulb: '#ffc15a',
    bambooDry: '#b59a5e',
    bamboo: '#7d9a4a',
    leaf: '#4f8040',
  },
  parts: [
    ...road,
    // 下半段矮石牆（+X 側，順著坡度）
    { name: 'lowWall', shape: { type: 'box', size: [0.03, 0.09, 0.55] }, color: '$wallStone', position: [0.15, heightAt(0.22) + 0.01, 0.22], rotation: [Math.atan(RISE), 0, 0] },
    // 上半段老屋一角（+X 側），窗朝路面（-X）
    { name: 'house', shape: { type: 'box', size: [0.26, 0.34, 0.36] }, color: '$wall', position: [0.28, 0.17, -0.27] },
    gable(0.4, 0.3, 0.12, [0.28, 0.34, -0.27]),
    { name: 'houseWin', shape: { type: 'box', size: [0.006, 0.07, 0.12] }, color: '$warm', emissive: '$warm', position: [0.148, 0.27, -0.25] },
    ...lamp(0.36, 0),
    ...lamp(-0.02, 1),
    ...lamp(-0.42, 2),
    ...fencePosts,
    rail('railLow', 0.03),
    rail('railHigh', 0.065),
    ...bamboo,
  ],
};

export default model;
