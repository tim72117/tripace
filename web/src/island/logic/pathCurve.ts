// pathCurve.ts——步道折線平滑成曲線,並以「弧長」參數化(純函式)。
//
// 旅人要以固定速度沿步道走,所以不能直接用曲線的 t 參數(各段長度不同會忽快忽慢),
// 這裡先把 Catmull-Rom 曲線取樣成密集折線,建立「累積弧長表」,之後用弧長 s 反查位置與朝向。
import type { Pt } from '../data/layoutTypes'

export type CurveSample = { x: number; z: number; s: number } // s = 從起點累積的弧長

export type PathCurve = {
  samples: CurveSample[]
  length: number
  // at——弧長 s(自動夾在 0..length)處的位置與前進方向(單位向量)。
  at(s: number): { x: number; z: number; dirX: number; dirZ: number }
  // nearestArc——離 (x, z) 最近的取樣點的弧長(用來把「站」對應到步道上的位置)。
  nearestArc(x: number, z: number): number
}

// 均勻 Catmull-Rom;端點用複製的虛擬控制點,曲線會通過所有控制點。
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

export function buildPathCurve(points: ReadonlyArray<Pt>, perSegment = 24): PathCurve {
  if (points.length < 2) throw new Error('步道至少需要兩個點')
  const n = points.length
  const at = (i: number) => points[Math.max(0, Math.min(n - 1, i))]
  const raw: Array<[number, number]> = []
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment
      raw.push([
        catmull(at(i - 1)[0], at(i)[0], at(i + 1)[0], at(i + 2)[0], t),
        catmull(at(i - 1)[1], at(i)[1], at(i + 1)[1], at(i + 2)[1], t),
      ])
    }
  }
  raw.push([points[n - 1][0], points[n - 1][1]])
  const samples: CurveSample[] = []
  let s = 0
  raw.forEach(([x, z], i) => {
    if (i > 0) s += Math.hypot(x - raw[i - 1][0], z - raw[i - 1][1])
    samples.push({ x, z, s })
  })
  const length = s

  function locate(sq: number): number {
    // 二分搜尋:最後一個 samples[i].s <= sq 的 i
    let lo = 0
    let hi = samples.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (samples[mid].s <= sq) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  return {
    samples,
    length,
    at(sq) {
      const q = Math.max(0, Math.min(length, sq))
      const i = Math.min(locate(q), samples.length - 2)
      const a = samples[i]
      const b = samples[i + 1]
      const seg = b.s - a.s
      const f = seg === 0 ? 0 : (q - a.s) / seg
      const dx = b.x - a.x
      const dz = b.z - a.z
      const dl = Math.hypot(dx, dz) || 1
      return { x: a.x + dx * f, z: a.z + dz * f, dirX: dx / dl, dirZ: dz / dl }
    },
    nearestArc(x, z) {
      let best = 0
      let bd = Infinity
      for (const p of samples) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2
        if (d < bd) { bd = d; best = p.s }
      }
      return best
    },
  }
}
