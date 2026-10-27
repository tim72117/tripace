import type { FeatureLayer, LatLng } from '../types'
import { arcChordMeters, arcPath } from './routeArc'
import { FOOTPRINT_REFERENCE_ZOOM } from './footprintIcon'
import { metersToPixels, routeArrowOffsets, routeCasingOptions, routeFootprintOptions, routeStrokeOptions } from './routeStyle'

// RouteLineSegment——要畫的一段連線:穩定的 id 加起訖座標。
// 段的來源是 planning/timeline/segments.ts 的 routeSegmentsFromTimeline(回傳的 RouteSegment 多帶 fromId/toId,
// 結構相容可直接傳入);功能層只需要 id 與座標。
export interface RouteLineSegment {
  id: string
  from: LatLng
  to: LatLng
  // walking——步行段:畫沿線的腳印(routeFootprintOptions),不畫光暈與實線;沒有或 false 走原本的實線。
  walking?: boolean
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
//
// 步行段(walking)改畫腳印:只有一個 drawable(id 就是段的 id,group 'routeLine'),沒有光暈也沒有線。腳印的間距與大小隨縮放,
// 所以多收一個 zoom(接線處傳取整後的縮放等級,不傳就用基準等級);非步行段完全不看 zoom。
export function routeLineLayer(input: {
  segments: RouteLineSegment[]
  accentColor: string
  dark?: boolean
  zoom?: number
}): FeatureLayer {
  const { segments, accentColor, dark = false, zoom = FOOTPRINT_REFERENCE_ZOOM } = input
  return {
    id: 'routeLine',
    drawables: segments.flatMap((seg) => {
      const path = arcPath(seg.from, seg.to)
      if (seg.walking) {
        // pathPx:路徑在螢幕上的長度,短到放不下一步時腳印改放百分比位置(沒有底線,見 routeFootprintOptions)。
        const pathPx = metersToPixels(arcChordMeters(seg.from, seg.to), seg.from.lat, zoom)
        return [{ id: seg.id, group: 'routeLine' as const, kind: 'polyline' as const, path, options: routeFootprintOptions(accentColor, { dark, zoom, pathPx }) }]
      }
      // 箭頭數量依段長(公尺)分級,只放在中段、起訖兩端不放(見 routeStyle.ts 的 routeArrowOffsets)。
      const arrowOffsets = routeArrowOffsets(arcChordMeters(seg.from, seg.to))
      return [
        { id: `${seg.id}:casing`, group: 'routeCasing' as const, kind: 'polyline' as const, path, options: routeCasingOptions(dark) },
        { id: seg.id, group: 'routeLine' as const, kind: 'polyline' as const, path, options: routeStrokeOptions(accentColor, { arrowOffsets }) },
      ]
    }),
  }
}
