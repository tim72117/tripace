// terrainShade.ts——地表著色的判斷(純函式,不依賴 three)。
//
// 用高度場本身(heightAt)算每個位置的「坡度」與「曲率」,而不是看網格三角形的法線:著色因此與網格疏密無關
// (網格比較疏的地方一樣讀得出溝壑),也不會因為雜訊產生的小稜面零星變色。
// 規則參考 WoC 的 terrain_chunk_build.ts(坡度 + 凹凸 + 雜訊抖動邊界),數值是為低多邊形島重新調的:
//   - 岩石:坡度超過門檻;門檻隨雜訊彎曲(邊界不沿等高線),漸層過渡而不是一刀切。
//   - 溝壑裸岩:凹陷且偏陡的地方即使沒到門檻也露出岩石(像被水沖過)。
//   - 坡腳積土:凹陷且平緩的地方偏泥土色。
//   - 乾草稜線:凸起且平緩的地方偏乾黃(吹風、排水好)。
//   - 環境光遮蔽(ao):凹處暗、凸處微亮,直接乘進頂點色,執行時零成本。
export type HeightFn = (x: number, z: number) => number

// sampledHeight——把 h 先取樣成規則格網(step 格一個),之後用雙線性內插讀取。
// 著色每個三角形要讀 9 次高度;heightAt 本身不便宜(平台、山脊都要逐一計算),直接呼叫會讓地形建構慢 3 倍。
// 格網只用於著色(坡度、曲率),不影響網格頂點的高度(那邊仍直接用 heightAt)。
// MAX_SHADE_GRID_CELLS——著色高度格網的格數上限(約 2M 格 = 8MB 的 Float32Array)。
export const MAX_SHADE_GRID_CELLS = 2_000_000

export function sampledHeight(h: HeightFn, minX: number, maxX: number, minZ: number, maxZ: number, step: number, margin = 0): HeightFn {
  if (![minX, maxX, minZ, maxZ, step, margin].every(Number.isFinite) || step <= 0) {
    throw new Error(`sampledHeight 參數無效:範圍 [${minX},${maxX}]×[${minZ},${maxZ}]、step=${step}、margin=${margin}`)
  }
  const x0 = minX - margin, z0 = minZ - margin
  // 格網大小上限:大輪廓配小 step 時格數是 (範圍/step)²,不設上限會吃光記憶體與建構時間。超過就放寬 step(只影響著色用的
  // 取樣密度,雙線性內插仍然連續)。
  const spanX = maxX + margin - x0, spanZ = maxZ + margin - z0
  const cells = (spanX / step + 1) * (spanZ / step + 1)
  if (cells > MAX_SHADE_GRID_CELLS) step *= Math.sqrt(cells / MAX_SHADE_GRID_CELLS)
  const nx = Math.max(2, Math.ceil(spanX / step) + 1)
  const nz = Math.max(2, Math.ceil(spanZ / step) + 1)
  const grid = new Float32Array(nx * nz)
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) grid[i * nz + j] = h(x0 + i * step, z0 + j * step)
  return (x, z) => {
    const fx = Math.max(0, Math.min(nx - 1.000001, (x - x0) / step))
    const fz = Math.max(0, Math.min(nz - 1.000001, (z - z0) / step))
    const i = Math.floor(fx), j = Math.floor(fz)
    const tx = fx - i, tz = fz - j
    const a = grid[i * nz + j], b = grid[(i + 1) * nz + j], c = grid[i * nz + j + 1], d = grid[(i + 1) * nz + j + 1]
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
  }
}

export type SurfaceMetrics = {
  grade: number // 坡度 = 上升/水平距離(0 平地、1 ≈ 45°)
  concavity: number // 曲率:> 0 凹(谷、坡腳)、< 0 凸(稜線、坡肩),單位 1/格
}

// eps:差分步長(格);曲率用 2 倍步長取四鄰,抹掉比格距更細的雜訊
export function surfaceMetrics(h: HeightFn, x: number, z: number, eps: number): SurfaceMetrics {
  const gx = (h(x + eps, z) - h(x - eps, z)) / (2 * eps)
  const gz = (h(x, z + eps) - h(x, z - eps)) / (2 * eps)
  const k = eps * 2
  const lap = (h(x + k, z) + h(x - k, z) + h(x, z + k) + h(x, z - k) - 4 * h(x, z)) / (k * k)
  return { grade: Math.hypot(gx, gz), concavity: lap }
}

export type ShadeWeights = {
  rock: number // 0~1:往岩色混合的比例
  dirt: number // 0~1:往泥土色
  dry: number // 0~1:往乾草色
  ao: number // 亮度乘數(約 0.78~1.06)
}

export const ROCK_GRADE = 0.9 // 約 42°;雜訊 ±ROCK_JITTER 彎曲這條邊界
export const ROCK_JITTER = 0.25
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// edgeNoise:[-1, 1] 的雜訊,讓岩石邊界彎曲
export function surfaceWeights(m: SurfaceMetrics, edgeNoise: number): ShadeWeights {
  const { grade, concavity } = m
  const rockBlend = clamp01((grade - (ROCK_GRADE + edgeNoise * ROCK_JITTER)) * 2.6)
  const gully = clamp01(concavity * 2.2 - 0.1) * clamp01((grade - 0.5) * 2.2)
  const rock = Math.min(1, Math.max(rockBlend, gully * 0.6))
  const dirt = clamp01(concavity * 2.2 - 0.12) * clamp01((0.95 - grade) * 2) * (1 - rock)
  const dry = clamp01(-concavity * 1.4 - 0.1) * clamp01((0.6 - grade) * 2) * (1 - rock)
  const ao = 1 - 0.22 * clamp01(concavity * 1.5) + 0.06 * clamp01(-concavity * 1.5)
  return { rock, dirt, dry, ao }
}
