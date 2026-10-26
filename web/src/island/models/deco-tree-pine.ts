import type { Model3D } from '../three/model';

// 山邊松樹：三層錐形深綠樹冠，細高。放在島後方高處與邊緣，撐起「山」的剪影（呼應基隆山的山稜）。
// 設計意圖：顏色比榕樹更冷更深，夜晚幾乎融入藍紫天色，讓燈火更突出。
// 尺寸：寬約 0.6、高約 1.3。建議 scale 3~5。
const model: Model3D = {
  palette: {
    trunk: '#5a3e2a',
    needle: '#2f5a3e',
    needleDark: '#244a34',
    needleLight: '#3d6d48',
  },
  parts: [
    { name: 'trunk', shape: { type: 'cylinder', radiusTop: 0.04, radiusBottom: 0.07, height: 0.35, segments: 6 }, color: '$trunk', position: [0, 0.175, 0] },
    {
      name: 'crown',
      position: [0, 0.3, 0],
      motion: { kind: 'sway', axis: 'x', amplitude: 0.025, speed: 0.9 },
      children: [
        { shape: { type: 'cone', radius: 0.3, height: 0.45, segments: 7 }, color: '$needleDark', position: [0, 0.2, 0] },
        { shape: { type: 'cone', radius: 0.23, height: 0.4, segments: 7 }, color: '$needle', position: [0, 0.45, 0] },
        { shape: { type: 'cone', radius: 0.15, height: 0.35, segments: 7 }, color: '$needleLight', position: [0, 0.7, 0] },
      ],
    },
  ],
};

export default model;
