import type { Model3D } from '../three/model';

// 蒸氣團：從小吃攤、茶樓飄起的白色水氣，三顆由大到小的低多邊形球疊成一縷，兩層 sway 交錯擺動。
// 設計意圖：讓街景「有溫度」；契約沒有透明度，所以用偏暖的米白，夜晚在燈籠光下會染成淡橘。
// 原點在蒸氣底部（請把 y 設在攤位/茶壺上緣）。尺寸：寬約 0.5、高約 1。建議 scale 1~1.6。
const model: Model3D = {
  palette: {
    steam: '#f6f1e8',
    steamSoft: '#e9e2d6',
  },
  parts: [
    {
      name: 'plume',
      motion: { kind: 'sway', axis: 'z', amplitude: 0.15, speed: 0.7 },
      children: [
        { shape: { type: 'sphere', radius: 0.2, detail: 0 }, color: '$steam', position: [0, 0.2, 0] },
        {
          name: 'upper',
          position: [0, 0.38, 0],
          motion: { kind: 'sway', axis: 'x', amplitude: 0.2, speed: 1.1, phase: 1.2 },
          children: [
            { shape: { type: 'sphere', radius: 0.15, detail: 0 }, color: '$steamSoft', position: [0.06, 0.16, 0] },
            { shape: { type: 'sphere', radius: 0.1, detail: 0 }, color: '$steam', position: [-0.04, 0.4, 0.02] },
            { shape: { type: 'sphere', radius: 0.06, detail: 0 }, color: '$steamSoft', position: [0.02, 0.56, 0] },
          ],
        },
      ],
    },
  ],
};

export default model;
