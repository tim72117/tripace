// tour.ts——導覽鏡頭關鍵幀(純函式,不依賴 three)。
//
// 導覽 = 鏡頭依序停靠「封面視角 → 各站 → 封面視角」。每個關鍵幀是 {位置, 看向的目標}。
// 站點的鏡頭放在站點的東南上方(從山下往上看,九份的燈籠層層往上的畫面最好看)。
export type V3 = [number, number, number]
export type CameraKey = { pos: V3; target: V3 }

export function coverKey(islandRadius: number, centerY = 4, override?: CameraKey): CameraKey {
  if (override) return override
  const d = islandRadius * 2.9 // 剛進來要看得到整座島,不貼太近(OrbitControls 最遠 3.6 倍)
  const az = (-35 * Math.PI) / 180 // 從西南偏南看,版面較自然
  return { pos: [Math.sin(az) * d, islandRadius * 1.45, Math.cos(az) * d], target: [0, centerY, 0] }
}

// camera:版面手寫的鏡頭(layout.camera):cover 覆蓋封面、stops[i] 覆蓋第 i 站;沒填的用預設推算。
export function tourKeyframes(
  stops: ReadonlyArray<{ x: number; y: number; z: number }>,
  islandRadius: number,
  camera?: { cover?: CameraKey; stops?: ReadonlyArray<CameraKey | null | undefined> },
): CameraKey[] {
  const cover = coverKey(islandRadius, 4, camera?.cover)
  const mid: CameraKey[] = stops.map((s, i) => {
    const custom = camera?.stops?.[i]
    if (custom) return custom
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

// fitCoverToAspect——手寫的封面鏡頭是為橫向畫面設計的;畫面比較窄(手機直向)時,沿「目標 → 鏡頭」方向把距離拉遠,
// 讓整座島的寬度(halfWidth,一半)放得進畫面,最遠不超過 maxDistance。距離只會變遠、不會變近。
export function fitCoverToAspect(k: CameraKey, halfWidth: number, vfovDeg: number, aspect: number, maxDistance: number): CameraKey {
  const vx = k.pos[0] - k.target[0], vy = k.pos[1] - k.target[1], vz = k.pos[2] - k.target[2]
  const d0 = Math.hypot(vx, vy, vz)
  if (d0 === 0 || aspect <= 0) return k
  const need = (halfWidth * 1.1) / (Math.tan((vfovDeg * Math.PI) / 360) * aspect)
  const d = Math.min(Math.max(d0, need), Math.max(d0, maxDistance))
  const f = d / d0
  return { pos: [k.target[0] + vx * f, k.target[1] + vy * f, k.target[2] + vz * f], target: k.target }
}

const ease = (t: number) => t * t * (3 - 2 * t)
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t] // 寫成 a(1-t)+bt,t=1 時精確等於 b

// cameraAt——u ∈ [0,1] 沿關鍵幀走;兩個關鍵幀之間用 smoothstep 緩動,到站時速度為 0。
export function cameraAt(keys: ReadonlyArray<CameraKey>, u: number): CameraKey {
  if (keys.length === 1) return keys[0]
  const x = Math.max(0, Math.min(1, u)) * (keys.length - 1)
  const i = Math.min(Math.floor(x), keys.length - 2)
  const t = ease(x - i)
  return { pos: lerp3(keys[i].pos, keys[i + 1].pos, t), target: lerp3(keys[i].target, keys[i + 1].target, t) }
}
