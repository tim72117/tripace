import type { FeatureLayer, LatLng } from '../types'
import { arcChordMeters, arcPath } from './routeArc'
import { routeArrowOffsets, routeCasingOptions, routeStrokeOptions } from './routeStyle'

// RouteLineSegment——要畫的一段連線:穩定的 id 加起訖座標。
// 段的來源是 planning/timeline/segments.ts 的 routeSegmentsFromTimeline(回傳的 RouteSegment 多帶 fromId/toId,
// 結構相容可直接傳入);功能層只需要 id 與座標。
export interface RouteLineSegment {
  id: string
  from: LatLng
  to: LatLng
}

// routeLineLayer——站點之間的連線功能層(2026-10-24 三個入口統一後唯一的連線層)。
//
// 以「段」為單位:每段畫成兩個 drawable——底層光暈(id `${id}:casing`,group 'routeCasing')與上層顏色線
// (id 就是段的 id,group 'routeLine')。路徑是 from→to 的弧線(routeArc.ts,與 hover 虛線同一組參數,
// 虛線會準確疊在對應的段上),樣式(細線、圓頭、白色開口箭頭——只在中段、起點不放、光暈)集中在 routeStyle.ts。
// 顏色一律用主題強調色(accentColor,由接線處用 useAccentColor 讀,功能層不碰地圖);dark 決定光暈顏色。
//
// 原本(2026-10-24 之前)這一層把所有站點連成一整條、受 enabled 開關控制,行程詳情頁另有依天換色的
// routePolylineLayer;現在切段規則(只畫有交通膠囊的那一段、不跨天、旅館不參與)收在 planning/timeline/segments.ts,
// 要不要畫由接線處決定(不傳段或傳空陣列就不畫,宿主會把已畫的線移除)。
export function routeLineLayer(input: { segments: RouteLineSegment[]; accentColor: string; dark?: boolean }): FeatureLayer {
  const { segments, accentColor, dark = false } = input
  return {
    id: 'routeLine',
    drawables: segments.flatMap((seg) => {
      const path = arcPath(seg.from, seg.to)
      // 箭頭數量依段長(公尺)分級,只放在中段、起訖兩端不放(見 routeStyle.ts 的 routeArrowOffsets)。
      const arrowOffsets = routeArrowOffsets(arcChordMeters(seg.from, seg.to))
      return [
        { id: `${seg.id}:casing`, group: 'routeCasing' as const, kind: 'polyline' as const, path, options: routeCasingOptions(dark) },
        { id: seg.id, group: 'routeLine' as const, kind: 'polyline' as const, path, options: routeStrokeOptions(accentColor, { arrowOffsets }) },
      ]
    }),
  }
}
