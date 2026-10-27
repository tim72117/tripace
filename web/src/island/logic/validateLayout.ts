// validateLayout.ts——版面資料驗證(純函式)。
//
// 版面是美術(Fable)用程式碼產出的,型別能擋欄位缺漏,擋不住「幾何上不合理」:輪廓自交、
// 階地超出島、站點與文章對不上、燈光沒涵蓋傍晚、引用不存在的模型。dev 時有 error 就在畫面
// 左上角用紅框列出,不讓錯誤悄悄變成怪畫面。
import type { IslandLayout, Pt } from '../data/layoutTypes'
import type { Issue } from './articleToIsland'
import { pointInPolygon } from './geometry'
import { parseTime } from './lighting'

const HEX = /^#[0-9a-fA-F]{6}$/

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

// 多邊形自交:任兩條不相鄰的邊相交。
export function selfIntersects(poly: ReadonlyArray<Pt>): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) === 1 || (i === 0 && j === n - 1)) continue
      if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true
    }
  }
  return false
}

export function polygonArea(poly: ReadonlyArray<Pt>): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}

// 凸形:所有相鄰邊的轉向(叉積正負)一致;共線的點忽略
function isConvex(poly: ReadonlyArray<Pt>): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], [cx, cz] = poly[(i + 2) % poly.length]
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx)
    if (Math.abs(cross) < 1e-9) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

export function validateLayout(layout: IslandLayout, modelNames: ReadonlySet<string>, articleStopIds: ReadonlyArray<string>): Issue[] {
  const out: Issue[] = []
  const err = (path: string, msg: string) => out.push({ level: 'error', path, msg })
  const warn = (path: string, msg: string) => out.push({ level: 'warn', path, msg })

  if (layout.outline.length < 3) err('outline', '輪廓至少需要 3 個點')
  else if (selfIntersects(layout.outline)) err('outline', '輪廓自交,島體會產生破面')
  if (layout.thickness <= 0) err('thickness', '厚度必須 > 0')

  layout.terraces?.forEach((t, i) => {
    if (t.y <= layout.topY) err(`terraces[${i}].y`, '階地高度必須高於 topY')
    if (t.outline.length < 3) err(`terraces[${i}].outline`, '階地輪廓至少 3 個點')
    else {
      if (selfIntersects(t.outline)) err(`terraces[${i}].outline`, '階地輪廓自交')
      if (t.outline.some(([x, z]) => !pointInPolygon(x, z, layout.outline))) warn(`terraces[${i}].outline`, '階地有頂點超出島的輪廓(會懸空)')
    }
  })

  layout.slopes?.forEach((sl, i) => {
    if (sl.y0 < layout.topY) err(`slopes[${i}].y0`, '斜坡低端高度不得低於 topY')
    if (sl.y1 < layout.topY) err(`slopes[${i}].y1`, '斜坡高端高度不得低於 topY')
    if (sl.from[0] === sl.to[0] && sl.from[1] === sl.to[1]) err(`slopes[${i}].from`, '斜坡方向線的起點與終點重合')
    if (sl.outline.length < 3) err(`slopes[${i}].outline`, '斜坡輪廓至少 3 個點')
    else {
      if (selfIntersects(sl.outline)) err(`slopes[${i}].outline`, '斜坡輪廓自交')
      if (sl.outline.some(([x, z]) => !pointInPolygon(x, z, layout.outline))) warn(`slopes[${i}].outline`, '斜坡有頂點超出島的輪廓(會懸空)')
      if (sl.crag && !isConvex(sl.outline)) warn(`slopes[${i}].outline`, '峭壁的輪廓是凹形:Delaunay 剖分不保證密閉(凹處可能留洞),建議拆成多塊凸形斜坡')
    }
    if (sl.crag) {
      // detail 決定格點間隔 10/2^detail:太大會產生數百萬格點、Delaunay(O(n²))直接卡死
      if (!Number.isInteger(sl.crag.detail) || sl.crag.detail < 0 || sl.crag.detail > 5) err(`slopes[${i}].crag.detail`, '峭壁 detail 必須是 0~5 的整數')
      if (!Number.isFinite(sl.crag.amp) || sl.crag.amp < 0) err(`slopes[${i}].crag.amp`, '峭壁 amp 必須是不小於 0 的有限數字')
    }
  })

  if (layout.path.points.length < 2) err('path.points', '步道至少 2 個點')
  layout.path.points.forEach(([x, z], i) => {
    if (!pointInPolygon(x, z, layout.outline)) warn(`path.points[${i}]`, '步道點在島外')
  })

  const check = (path: string, model: string) => { if (!modelNames.has(model)) err(path, `找不到模型 ${model}`) }
  layout.stops.forEach((s, i) => check(`stops[${i}].model`, s.model))
  layout.scatter.forEach((p, i) => check(`scatter[${i}].model`, p.model))
  layout.scatter.forEach((p, i) => {
    if (p.tilt && !p.tilt.every(Number.isFinite)) err(`scatter[${i}].tilt`, 'tilt 必須是兩個有限數字(弧度)')
  })

  // 站點與文章
  if (layout.stops.length !== articleStopIds.length) warn('stops', `版面 ${layout.stops.length} 站,文章 ${articleStopIds.length} 站`)
  const ids = layout.stops.map((s) => s.stopId)
  if (ids.some((id, i) => articleStopIds[i] !== undefined && id !== articleStopIds[i])) err('stops', '站點順序或 id 與文章不一致')
  let prev = -1
  layout.stops.forEach((s, i) => {
    try {
      const m = parseTime(s.time)
      if (m <= prev) err(`stops[${i}].time`, '示意時間必須遞增')
      prev = m
    } catch { err(`stops[${i}].time`, `時間格式錯誤: ${s.time}`) }
  })

  // 光照:至少涵蓋 16:00~22:00 的關鍵時刻,lanternGlow 在 [0,1]
  const mins = layout.lighting.flatMap((k) => { try { return [parseTime(k.time)] } catch { err('lighting', `時間格式錯誤: ${k.time}`); return [] } })
  if (!mins.some((m) => m <= 16 * 60 + 30) || !mins.some((m) => m >= 21 * 60 + 30)) warn('lighting', '光照關鍵時刻沒有涵蓋 16:30 ~ 21:30')
  layout.lighting.forEach((k, i) => {
    if (k.lanternGlow < 0 || k.lanternGlow > 1) err(`lighting[${i}].lanternGlow`, '必須在 0~1')
    if (k.sunIntensity < 0) err(`lighting[${i}].sunIntensity`, '不可為負')
    for (const c of [k.skyTop, k.skyBottom, k.fog, k.sun, k.hemiSky, k.hemiGround]) if (!HEX.test(c)) err(`lighting[${i}]`, `顏色格式錯誤: ${c}`)
  })

  for (const [k, c] of Object.entries(layout.palette)) if (!HEX.test(c)) err(`palette.${k}`, `顏色格式錯誤: ${c}`)
  return out
}
