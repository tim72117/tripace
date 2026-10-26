import type { Model3D } from '../three/model';

// 旅人（小孩）：珊瑚紅上衣、黃色漁夫帽，右手拿著一串剛買的魚丸（基山街的小吃）。
// 頭身比刻意誇張（頭大），步伐小、彈跳明顯，跟在大人身邊顯得蹦蹦跳跳。
// 尺寸：高約 0.68、寬約 0.32。建議 scale 與 traveler-parent 相同（1.6~1.8）。
const model: Model3D = {
  palette: {
    shirt: '#e86a4f',
    shorts: '#3f7d8c',
    skin: '#f5d0ab',
    hat: '#ffd166',
    hatBand: '#d63a2f',
    shoe: '#efe2c8',
    eye: '#1e1a18',
    stick: '#c9a46a',
    ball: '#f3ead7',
  },
  stride: 0.42,
  parts: [
    {
      name: 'legL',
      position: [-0.055, 0.22, 0],
      motion: { kind: 'swing', axis: 'x', amplitude: 0.6, phase: 0 },
      children: [
        { shape: { type: 'capsule', radius: 0.04, length: 0.11 }, color: '$skin', position: [0, -0.1, 0] },
        { shape: { type: 'box', size: [0.07, 0.045, 0.11] }, color: '$shoe', position: [0, -0.2, 0.02] },
      ],
    },
    {
      name: 'legR',
      position: [0.055, 0.22, 0],
      motion: { kind: 'swing', axis: 'x', amplitude: 0.6, phase: Math.PI },
      children: [
        { shape: { type: 'capsule', radius: 0.04, length: 0.11 }, color: '$skin', position: [0, -0.1, 0] },
        { shape: { type: 'box', size: [0.07, 0.045, 0.11] }, color: '$shoe', position: [0, -0.2, 0.02] },
      ],
    },
    {
      name: 'body',
      motion: { kind: 'bob', amplitude: 0.04 },
      children: [
        { name: 'shorts', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.1, height: 0.07, segments: 8 }, color: '$shorts', position: [0, 0.24, 0] },
        { name: 'torso', shape: { type: 'capsule', radius: 0.095, length: 0.08 }, color: '$shirt', position: [0, 0.34, 0] },
        { name: 'head', shape: { type: 'sphere', radius: 0.12, detail: 1 }, color: '$skin', position: [0, 0.53, 0.01] },
        { name: 'eyeL', shape: { type: 'box', size: [0.024, 0.03, 0.02] }, color: '$eye', position: [-0.045, 0.53, 0.125] },
        { name: 'eyeR', shape: { type: 'box', size: [0.024, 0.03, 0.02] }, color: '$eye', position: [0.045, 0.53, 0.125] },
        // 漁夫帽：帽簷 + 帽身 + 紅帽帶
        { name: 'hatBrim', shape: { type: 'cylinder', radiusTop: 0.16, radiusBottom: 0.17, height: 0.02, segments: 10 }, color: '$hat', position: [0, 0.6, 0] },
        { name: 'hatTop', shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.115, height: 0.08, segments: 10 }, color: '$hat', position: [0, 0.65, 0] },
        { name: 'hatBand', shape: { type: 'cylinder', radiusTop: 0.117, radiusBottom: 0.117, height: 0.02, segments: 10 }, color: '$hatBand', position: [0, 0.62, 0] },
        {
          name: 'armL',
          position: [-0.12, 0.4, 0],
          motion: { kind: 'swing', axis: 'x', amplitude: 0.7, phase: Math.PI },
          children: [
            { shape: { type: 'capsule', radius: 0.032, length: 0.1 }, color: '$shirt', position: [0, -0.08, 0] },
            { shape: { type: 'sphere', radius: 0.035, detail: 0 }, color: '$skin', position: [0, -0.16, 0] },
          ],
        },
        // 右手舉著魚丸串（手臂微微往前抬，擺幅小，避免小吃甩出去）
        {
          name: 'armR',
          position: [0.12, 0.4, 0],
          rotation: [-0.7, 0, 0],
          motion: { kind: 'swing', axis: 'x', amplitude: 0.2, phase: 0 },
          children: [
            { shape: { type: 'capsule', radius: 0.032, length: 0.1 }, color: '$shirt', position: [0, -0.08, 0] },
            { shape: { type: 'sphere', radius: 0.035, detail: 0 }, color: '$skin', position: [0, -0.16, 0] },
            { name: 'skewer', shape: { type: 'cylinder', radiusTop: 0.006, radiusBottom: 0.006, height: 0.2, segments: 4 }, color: '$stick', position: [0, -0.12, 0.06], rotation: [1.3, 0, 0] },
            { name: 'ball1', shape: { type: 'sphere', radius: 0.026, detail: 0 }, color: '$ball', position: [0, -0.13, 0.1] },
            { name: 'ball2', shape: { type: 'sphere', radius: 0.026, detail: 0 }, color: '$ball', position: [0, -0.115, 0.15] },
          ],
        },
      ],
    },
  ],
};

export default model;
