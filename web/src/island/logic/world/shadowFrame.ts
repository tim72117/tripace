// shadowFrame.ts——太陽陰影範圍跟著鏡頭(純函式)。
//
// 大場景不可能讓一張陰影圖蓋住整個世界:陰影的正交相機以鏡頭焦點為中心,半徑隨鏡頭距離縮放
// (近看時範圍小、影子細;拉遠看全景時範圍大),上下限夾在 [minHalf, maxHalf]。
// 中心對齊到陰影貼圖的一個像素寬(texel snapping),鏡頭平移時影子邊緣才不會閃爍(業界標準做法)。
// 這裡的座標是「垂直於太陽方向的平面」上的兩軸(u, v),由呼叫端投影;回傳對齊後的中心與半寬。
export type ShadowFrameCfg = { mapSize: number; minHalf: number; maxHalf: number; distanceFactor: number }

export function shadowHalfSize(viewDistance: number, cfg: ShadowFrameCfg): number {
  return Math.max(cfg.minHalf, Math.min(cfg.maxHalf, viewDistance * cfg.distanceFactor))
}

// 半寬先量化(每次至少變 1/8),避免鏡頭每一點縮放都重算陰影解析度
export function quantizeHalf(half: number, cfg: ShadowFrameCfg): number {
  const step = Math.max(1, cfg.minHalf / 8)
  return Math.min(cfg.maxHalf, Math.ceil(half / step) * step)
}

export function snapToTexel(u: number, v: number, half: number, mapSize: number): [number, number] {
  const texel = (half * 2) / mapSize
  return [Math.round(u / texel) * texel, Math.round(v / texel) * texel]
}
