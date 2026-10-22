// leafShape.ts——楓葉的 canvas 向量輪廓(單位尺寸 1,以葉心為原點、葉尖朝上)。
// 形狀沿用使用者給的示意頁:五個裂片(中間最大、兩側逐漸變小)加一根葉柄,
// 每個裂片邊緣有鋸齒。呼叫端用 setTransform 縮放/旋轉後 fill。
//
// 放在獨立檔案、延遲建立:Path2D 只存在於瀏覽器(vitest 的 jsdom 沒有),
// 純邏輯(momijiFrontModel.ts)因此不能依賴這裡。

let cached: Path2D | null = null

export function getLeafPath(): Path2D {
  if (cached) return cached
  const p = new Path2D()
  const pt = (a: number, r: number): [number, number] => [r * Math.sin(a), -r * Math.cos(a)]
  const lobes: Array<[number, number]> = [[-1.95, 0.56], [-0.98, 0.86], [0, 1], [0.98, 0.86], [1.95, 0.56]]
  const valleys = [-2.55, -1.47, -0.49, 0.49, 1.47, 2.55]
  const vr = [0.24, 0.36, 0.4, 0.4, 0.36, 0.24]
  const teeth: Array<[number, number]> = [[-0.26, 0.64], [-0.14, 0.56], [0, 1], [0.14, 0.56], [0.26, 0.64]]
  const s = pt(Math.PI, 0.16)
  p.moveTo(s[0], s[1])
  for (let i = 0; i < lobes.length; i++) {
    const [a, len] = lobes[i]
    const v = pt(valleys[i], vr[i])
    p.lineTo(v[0], v[1])
    for (const [da, rr] of teeth) {
      const q = pt(a + da * (len < 0.7 ? 0.8 : 1), len * (da === 0 ? 1 : (rr / 0.64) * 0.66))
      p.lineTo(q[0], q[1])
    }
  }
  const last = pt(valleys[5], vr[5])
  p.lineTo(last[0], last[1])
  p.closePath()
  // 葉柄
  p.moveTo(-0.035, 0.1)
  p.lineTo(0.035, 0.1)
  p.lineTo(0.08, 0.66)
  p.lineTo(0.03, 0.66)
  p.closePath()
  cached = p
  return p
}
