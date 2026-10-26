// tour.ts——導覽鏡頭關鍵幀(純函式,不依賴 three)。
//
// 導覽 = 鏡頭依序停靠「封面視角 → 各站 → 封面視角」。每個關鍵幀是 {位置, 看向的目標}。
// 站點的鏡頭放在站點的東南上方(從山下往上看,九份的燈籠層層往上的畫面最好看)。
export type V3 = [number, number, number]
export type CameraKey = { pos: V3; target: V3 }

export function coverKey(islandRadius: number, centerY = 4): CameraKey {
  const d = islandRadius * 2.1
  const az = (-35 * Math.PI) / 180 // 從西南偏南看,版面較自然
  return { pos: [Math.sin(az) * d, islandRadius * 1.05, Math.cos(az) * d], target: [0, centerY, 0] }
}

export function tourKeyframes(stops: ReadonlyArray<{ x: number; y: number; z: number }>, islandRadius: number): CameraKey[] {
  const cover = coverKey(islandRadius)
  const mid: CameraKey[] = stops.map((s) => {
    const d = islandRadius * 0.55
    const elev = 0.62 // 仰角約 35°
    const az = (35 * Math.PI) / 180
    return {
      pos: [s.x + Math.sin(az) * d, s.y + d * elev + 2, s.z + Math.cos(az) * d],
      target: [s.x, s.y + 2.5, s.z],
    }
  })
  return [cover, ...mid, cover]
}

const ease = (t: number) => t * t * (3 - 2 * t)
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// cameraAt——u ∈ [0,1] 沿關鍵幀走;兩個關鍵幀之間用 smoothstep 緩動,到站時速度為 0。
export function cameraAt(keys: ReadonlyArray<CameraKey>, u: number): CameraKey {
  if (keys.length === 1) return keys[0]
  const x = Math.max(0, Math.min(1, u)) * (keys.length - 1)
  const i = Math.min(Math.floor(x), keys.length - 2)
  const t = ease(x - i)
  return { pos: lerp3(keys[i].pos, keys[i + 1].pos, t), target: lerp3(keys[i].target, keys[i + 1].target, t) }
}

// timeAt——導覽時,鏡頭走到 u 時時鐘該指向幾點:關鍵幀 i 對應 times[i],之間線性內插。
// times 長度要等於關鍵幀數(封面 + 各站 + 封面)。
export function timeAt(times: ReadonlyArray<number>, u: number): number {
  if (times.length === 0) return 0
  if (times.length === 1) return times[0]
  const x = Math.max(0, Math.min(1, u)) * (times.length - 1)
  const i = Math.min(Math.floor(x), times.length - 2)
  return times[i] + (times[i + 1] - times[i]) * (x - i)
}
