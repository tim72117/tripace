import type { Model3D } from '../three/model';

// 旅人（大人）：親子小旅行中的家長。青綠色外套、芥末黃小背包、深色短髮。
// 動畫：身體群組 bob 上下彈跳；手腳樞紐在肩、髖關節，以 swing 對角擺動（左手配右腳）。
// 尺寸：高約 1.05、寬約 0.42。unit 1.7 → 真實身高約 1.73 m(和 traveler-child 用同一個 unit,身高比例才對)。
const model: Model3D = {
  unit: 1.7, // 真實尺寸(1 格 = 1 m):成人約 1.73 m 高
  palette: {
    jacket: '#3f7d8c',
    jacketDark: '#2f6270',
    pants: '#3a3f55',
    skin: '#f2c9a0',
    hair: '#2a2320',
    bag: '#d9a441',
    bagStrap: '#9c6e24',
    shoe: '#5a3a2a',
    eye: '#1e1a18',
  },
  stride: 0.7,
  parts: [
    // ---------- 雙腿（不跟著 bob，腳才會踩在地上） ----------
    {
      name: 'legL',
      position: [-0.075, 0.42, 0],
      motion: { kind: 'swing', axis: 'x', amplitude: 0.55, phase: 0 },
      children: [
        { shape: { type: 'capsule', radius: 0.055, length: 0.24 }, color: '$pants', position: [0, -0.19, 0] },
        { shape: { type: 'box', size: [0.1, 0.06, 0.16] }, color: '$shoe', position: [0, -0.39, 0.03] },
      ],
    },
    {
      name: 'legR',
      position: [0.075, 0.42, 0],
      motion: { kind: 'swing', axis: 'x', amplitude: 0.55, phase: Math.PI },
      children: [
        { shape: { type: 'capsule', radius: 0.055, length: 0.24 }, color: '$pants', position: [0, -0.19, 0] },
        { shape: { type: 'box', size: [0.1, 0.06, 0.16] }, color: '$shoe', position: [0, -0.39, 0.03] },
      ],
    },
    // ---------- 身體群組（含頭、手、背包）隨步伐彈跳 ----------
    {
      name: 'body',
      motion: { kind: 'bob', amplitude: 0.025 },
      children: [
        { name: 'torso', shape: { type: 'capsule', radius: 0.13, length: 0.2 }, color: '$jacket', position: [0, 0.6, 0] },
        { name: 'hem', shape: { type: 'cylinder', radiusTop: 0.13, radiusBottom: 0.14, height: 0.05, segments: 8 }, color: '$jacketDark', position: [0, 0.45, 0] },
        { name: 'head', shape: { type: 'sphere', radius: 0.12, detail: 1 }, color: '$skin', position: [0, 0.89, 0.01] },
        { name: 'hair', shape: { type: 'sphere', radius: 0.125, detail: 1 }, color: '$hair', position: [0, 0.93, -0.02], scale: [1.02, 0.72, 1] },
        { name: 'eyeL', shape: { type: 'box', size: [0.025, 0.03, 0.02] }, color: '$eye', position: [-0.045, 0.89, 0.12] },
        { name: 'eyeR', shape: { type: 'box', size: [0.025, 0.03, 0.02] }, color: '$eye', position: [0.045, 0.89, 0.12] },
        // 背包與肩帶
        { name: 'bag', shape: { type: 'box', size: [0.2, 0.22, 0.1] }, color: '$bag', position: [0, 0.63, -0.16] },
        { name: 'bagFlap', shape: { type: 'box', size: [0.2, 0.06, 0.11] }, color: '$bagStrap', position: [0, 0.72, -0.16] },
        { name: 'strapL', shape: { type: 'box', size: [0.03, 0.26, 0.02] }, color: '$bagStrap', position: [-0.08, 0.64, 0.125] },
        { name: 'strapR', shape: { type: 'box', size: [0.03, 0.26, 0.02] }, color: '$bagStrap', position: [0.08, 0.64, 0.125] },
        {
          name: 'armL',
          position: [-0.17, 0.75, 0],
          motion: { kind: 'swing', axis: 'x', amplitude: 0.6, phase: Math.PI },
          children: [
            { shape: { type: 'capsule', radius: 0.045, length: 0.2 }, color: '$jacket', position: [0, -0.14, 0] },
            { shape: { type: 'sphere', radius: 0.045, detail: 0 }, color: '$skin', position: [0, -0.29, 0] },
          ],
        },
        {
          name: 'armR',
          position: [0.17, 0.75, 0],
          motion: { kind: 'swing', axis: 'x', amplitude: 0.6, phase: 0 },
          children: [
            { shape: { type: 'capsule', radius: 0.045, length: 0.2 }, color: '$jacket', position: [0, -0.14, 0] },
            { shape: { type: 'sphere', radius: 0.045, detail: 0 }, color: '$skin', position: [0, -0.29, 0] },
          ],
        },
      ],
    },
  ],
};

export default model;
