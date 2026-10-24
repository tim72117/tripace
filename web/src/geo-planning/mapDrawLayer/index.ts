import { useEffect, useMemo, useRef } from 'react'
import { composeLayers } from './compose'
import { diffDrawables, signatureOf, type Entry } from './diff'
import type { CircleDrawable, Drawable, FeatureLayer, MarkerDrawable, OverlayInstance, PolylineDrawable } from './types'
import { GROUP_Z } from './zOrder'

export type { Drawable, FeatureLayer, DrawGroup, MarkerDrawable, CircleDrawable, PolylineDrawable, OverlayDrawable, OverlayInstance } from './types'
export { GROUP_Z } from './zOrder'
export { useAccentColor, DEFAULT_ACCENT_COLOR } from './useAccentColor'

// 沒有任何功能層時使用的穩定空陣列(避免每次渲染都產生新陣列)。
export const NO_LAYERS: FeatureLayer[] = []

// useMapDrawLayer——統一繪製層的宿主(見 types.ts 檔頭的三層分工)。
//
// 吃一組功能層,組合後依 id 比對:新的就畫、資料變了就原地更新、不見了就移除。地圖還沒好、或
// mapVersion 改變(地圖被重建成新實例)時,把舊的全部清掉,重新畫到新地圖上——所有功能層一次
// 處理好,不再需要每個 hook 各自記得加 mapVersion 依賴。卸載時全部清掉。
//
// 比對只看資料(見 diff.ts),所以呼叫端每次渲染傳新的陣列或新的函式都沒關係。
type Instance = Entry & {
  contentKey?: string
  object: google.maps.marker.AdvancedMarkerElement | google.maps.Circle | google.maps.Polyline | OverlayInstance
  // overlay 專用:移除時要通知功能層
  onDispose?: (instance: OverlayInstance) => void
}

export function useMapDrawLayer({
  mapRef,
  mapReady,
  mapVersion = 0,
  layers,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion?: number
  layers: FeatureLayer[]
}) {
  const drawables = useMemo(() => composeLayers(layers), [layers])
  // 點擊回呼永遠查最新的清單,不被建立當下的閉包卡住。
  const latestById = useRef(new Map<string, Drawable>())
  latestById.current = new Map(drawables.map((d) => [d.id, d]))

  const instances = useRef(new Map<string, Instance>())

  // 依簽章產生比對用的 key:只有「資料」變了才需要重新比對。
  const key = drawables
    .map((d) => {
      const s = signatureOf(d)
      return `${d.id}#${s.structure}#${s.data}`
    })
    .join('\n')

  // 地圖生命週期:地圖變成不可用、被重建、或卸載時,把畫過的全部清掉。
  useEffect(() => {
    return () => {
      instances.current.forEach((inst) => dispose(inst))
      instances.current.clear()
    }
  }, [mapReady, mapVersion])

  // 比對並套用。宣告順序在上面的 effect 之後,地圖重建時先清舊的、再把全部畫到新地圖上。
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    const prev = new Map<string, Entry>()
    instances.current.forEach((inst, id) => prev.set(id, inst))
    const diff = diffDrawables(prev, drawables)

    for (const id of diff.remove) {
      const inst = instances.current.get(id)
      if (inst) dispose(inst)
      instances.current.delete(id)
    }
    for (const d of diff.update) {
      const inst = instances.current.get(d.id)
      if (inst) instances.current.set(d.id, update(inst, d))
    }
    for (const d of diff.add) {
      instances.current.set(d.id, create(map, d, (id) => latestById.current.get(id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, key])
}

function create(map: google.maps.Map, d: Drawable, lookup: (id: string) => Drawable | undefined): Instance {
  const sig = signatureOf(d)
  const z = GROUP_Z[d.group]
  switch (d.kind) {
    case 'marker': {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: d.position,
        map,
        title: d.title,
        content: applyMarkerAnchor(d.createContent(), d.anchor),
        zIndex: z,
        // gmpClickable 必須明確開啟,AdvancedMarkerElement 預設不接受點擊事件;只能在建立時決定。
        gmpClickable: !!d.clickable,
      })
      if (d.clickable) {
        marker.addListener('gmp-click', () => {
          const latest = lookup(d.id)
          if (latest?.kind === 'marker') latest.onClick?.(d.id)
        })
      }
      return { kind: 'marker', ...sig, contentKey: d.contentKey, object: marker }
    }
    case 'circle':
      return {
        kind: 'circle',
        ...sig,
        object: new google.maps.Circle({ ...d.options, map, center: d.center, radius: d.radiusMeters, zIndex: z, clickable: false }),
      }
    case 'polyline':
      return {
        kind: 'polyline',
        ...sig,
        object: new google.maps.Polyline({ ...d.options, map, path: d.path, zIndex: z, clickable: false }),
      }
    case 'overlay': {
      const instance = d.create()
      instance.setMap(map)
      d.onCreate?.(instance)
      return { kind: 'overlay', ...sig, object: instance, onDispose: d.onDispose }
    }
  }
}

function update(inst: Instance, d: Drawable): Instance {
  const sig = signatureOf(d)
  const z = GROUP_Z[d.group]
  if (d.kind === 'marker' && inst.kind === 'marker') {
    const marker = inst.object as google.maps.marker.AdvancedMarkerElement
    marker.position = d.position
    marker.title = d.title ?? ''
    marker.zIndex = z
    let contentKey = inst.contentKey
    if (inst.contentKey !== d.contentKey) {
      marker.content = applyMarkerAnchor((d as MarkerDrawable).createContent({ previousContentKey: inst.contentKey }), d.anchor)
      contentKey = d.contentKey
    } else if (marker.content instanceof Element) {
      // 內容沒換、但 anchor 可能變了(anchor 在簽章 data 裡,改變才會進到 update):對既有內容重新套用位移。
      applyMarkerAnchor(marker.content, d.anchor)
    }
    return { ...inst, ...sig, contentKey }
  }
  if (d.kind === 'circle' && inst.kind === 'circle') {
    const c = d as CircleDrawable
    ;(inst.object as google.maps.Circle).setOptions({ ...c.options, center: c.center, radius: c.radiusMeters, zIndex: z })
    return { ...inst, ...sig }
  }
  if (d.kind === 'polyline' && inst.kind === 'polyline') {
    const p = d as PolylineDrawable
    ;(inst.object as google.maps.Polyline).setOptions({ ...p.options, path: p.path, zIndex: z })
    return { ...inst, ...sig }
  }
  if (d.kind === 'overlay' && inst.kind === 'overlay') {
    d.update?.(inst.object)
    return { ...inst, ...sig, onDispose: d.onDispose }
  }
  return inst
}

// applyMarkerAnchor——依 MarkerDrawable.anchor 調整 content 的位移(見 types.ts 的 anchor 說明)。
// AdvancedMarkerElement 把 content 的底部中央放在座標上;'center' 時對 content 套 translateY(50%),整個內容往下移
// 自己高度的一半,圓心就落在座標上。用 transform 而不是改 layout:layout box 不變,Google 的定位與 hit target
// (點擊事件以 content 本身為目標往上冒泡到 marker,gmp-click 照常觸發)都不受影響;content 內部的光暈/漣漪動畫
// (.ps-halo/.ps-ripple)作用在 SVG 內的 circle,與根元素的 transform 互不干擾。'bottom'(或沒傳)清掉位移。
function applyMarkerAnchor<T extends Element>(content: T, anchor: MarkerDrawable['anchor']): T {
  const style = (content as unknown as { style?: CSSStyleDeclaration }).style
  if (style) style.transform = anchor === 'center' ? 'translateY(50%)' : ''
  return content
}

function dispose(inst: Instance) {
  if (inst.kind === 'marker') {
    const marker = inst.object as google.maps.marker.AdvancedMarkerElement
    google.maps.event.clearInstanceListeners(marker)
    marker.map = null
  } else {
    ;(inst.object as google.maps.Circle | google.maps.Polyline | OverlayInstance).setMap(null)
    if (inst.kind === 'overlay') inst.onDispose?.(inst.object as OverlayInstance)
  }
}
