import type { LatLng } from '../types'

// routeArc——站點之間的「弧線」幾何(2026-10,連線樣式柔化)。
//
// 之前站點之間都是一條直線,折點在站上、看起來像尺規畫的。這裡把每一段換成一條輕微彎曲的二次貝茲弧線,
// 取樣成多個點交給 Polyline 畫(Polyline 本身只會畫直線段,點夠密就看不出折角)。兩個連線功能層
// (routeLineLayer、transitHoverLineLayer)都用同一組參數取樣,所以 hover 虛線會準確疊在連線的同一段上。
//
// 為什麼在 Web Mercator 的「世界座標」裡算,而不是直接在經緯度裡算:Google 地圖的非測地線 Polyline 是在
// 投影後的平面上連直線,而經緯度在高緯度會被拉伸(1 度緯度與 1 度經度的螢幕長度不同),直接在經緯度裡
// 算垂直方向會讓弧線歪斜、在不同城市長得不一樣。世界座標(0..1 的平面,與縮放無關)裡算出來的弧線,
// 在任何縮放等級都是同一個形狀,只是整體放大縮小。這裡的投影是純算術,不需要 google.maps(功能層不碰它)。
//
// 弧度與方向:
//   - 最大偏離量 = 弦長 × ARC_SAG_RATIO,弧度與距離成比例,長段與短段看起來一樣「彎」。
//   - 一律往行進方向的左側鼓起(固定規則):相鄰段不會互相打架;A→B 再 B→A 的來回兩段會分別鼓向兩側,
//     像兩條車道一樣不重疊。
//   - 太短的段(弦長不到 ARC_MIN_METERS 公尺)直接回兩點直線:弧線的偏離量只有幾公尺,畫出來和直線一樣,
//     省掉取樣點。

// 弧的最大偏離量佔弦長的比例。0.12 是在截圖上比對過的值:看得出是弧線、但還不會像誇張的拋物線。
export const ARC_SAG_RATIO = 0.12
// 每條弧取樣的線段數(點數 = 這個值 + 1)。二次貝茲很平滑,16 段在 1000px 長的弧上每個頂點的轉角
// 不到 2 度,肉眼看不出折角;再多只是增加 Polyline 的點數。
export const ARC_SEGMENTS = 16
// 弦長低於這個公尺數就不彎(退回直線)。
export const ARC_MIN_METERS = 40

const EARTH_CIRCUMFERENCE_METERS = 40075016.686
const MAX_LAT = 85.05112878

type WorldPoint = { x: number; y: number }

// projectMercator——經緯度轉 Web Mercator 世界座標(x、y 都在 0..1,y 向下)。
export function projectMercator(p: LatLng): WorldPoint {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat))
  const sinLat = Math.sin((lat * Math.PI) / 180)
  return {
    x: (p.lng + 180) / 360,
    y: 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI),
  }
}

// unprojectMercator——世界座標轉回經緯度(projectMercator 的反函式)。
export function unprojectMercator(w: WorldPoint): LatLng {
  const lng = w.x * 360 - 180
  const n = Math.PI - 2 * Math.PI * w.y
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

// arcChordMeters——兩點弦長的公尺近似值:世界座標距離 × 地球周長 × cos(中點緯度)。
// 只用來判斷「要不要彎」,幾個百分比的誤差無所謂。
export function arcChordMeters(from: LatLng, to: LatLng): number {
  const a = projectMercator(from)
  const b = projectMercator(to)
  const midLat = ((from.lat + to.lat) / 2) * (Math.PI / 180)
  return Math.hypot(b.x - a.x, b.y - a.y) * EARTH_CIRCUMFERENCE_METERS * Math.cos(midLat)
}

// arcPath——from 到 to 的弧線取樣點(含兩端點,兩端點原樣回傳不經投影往返,避免浮點誤差讓線頭離開站點)。
export function arcPath(from: LatLng, to: LatLng): LatLng[] {
  if (arcChordMeters(from, to) < ARC_MIN_METERS) return [from, to]
  const a = projectMercator(from)
  const b = projectMercator(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  // 行進方向的左側法向量(螢幕座標 y 向下:往東走時左側是北、也就是 y 變小)。
  const nx = dy / len
  const ny = -dx / len
  // 二次貝茲在 t=0.5 的偏離量是控制點偏離量的一半,所以控制點要推 2 倍。
  const push = 2 * ARC_SAG_RATIO * len
  const cx = (a.x + b.x) / 2 + nx * push
  const cy = (a.y + b.y) / 2 + ny * push
  const out: LatLng[] = [from]
  for (let i = 1; i < ARC_SEGMENTS; i++) {
    const t = i / ARC_SEGMENTS
    const u = 1 - t
    out.push(
      unprojectMercator({
        x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
        y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
      }),
    )
  }
  out.push(to)
  return out
}

// arcPolylinePath——多個站點依序串成一條線:相鄰兩站各畫一段弧,接點(站點)只放一次。
// 不足兩點回原樣(呼叫端自己決定要不要畫)。
export function arcPolylinePath(points: LatLng[]): LatLng[] {
  if (points.length < 2) return [...points]
  const out: LatLng[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    out.push(...arcPath(points[i - 1], points[i]).slice(1))
  }
  return out
}
