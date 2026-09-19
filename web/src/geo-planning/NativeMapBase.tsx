import { useEffect, useRef, useState } from 'react'
import { importLibrary } from '@googlemaps/js-api-loader'
import type { ReactNode } from 'react'
import type { Theme } from '../theme'
import { ensureOptionsSet, themeToColorScheme } from './googleMapsBootstrap'
import styles from './ExploreMap.module.css'

// NativeMapBase——只做「建立一個 Google Map 實例」這件事的最小元件,不掛
// 任何搜尋框/類別標籤/景點 overlay/marker/panTarget 等行為。這是
// MapHandle 設計的落地起點(見先前討論:地圖建立邏輯各自獨立沒關係,是
// 附掛在地圖上的元件/行為要能拆出來,依需求組裝到不同地圖實體上)。
//
// 呼叫端透過 onReady(mapRef, mapReady) 拿到 MapHandle 形狀的兩個值,再自行
// 把 useAttractionOverlays/useSearchResultMarkers/useTripEntryMarkers 等
// 「掛載式」hook 組裝上去——這個元件本身完全不知道、也不需要知道呼叫端
// 會掛什麼上來。
//
// 刻意先只做展示頁(KiyomizuDemoPage.tsx)需要的最小原生配置子集
// (center/zoom/restrictBounds/showZoomControl/theme)——不是要在這裡
// 重建 ExploreMap.tsx 全部的建圖選項(mapId/gestureHandling 等目前先
// 對齊過去,其餘如 resize 保險措施、click 監聽器等屬於「行為」而非「原生
// 配置」的部分不搬過來,呼叫端需要時應該用掛載的方式另外加,而非塞回
// 這個元件)。themeToColorScheme/ensureOptionsSet 兩個純函式與
// ExploreMap.tsx 共用同一份實作(見 googleMapsBootstrap.ts 的完整說明),
// 不在這裡重複定義。

export interface MapHandle {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
}

export function NativeMapBase({
  center,
  zoom = 12,
  minZoom,
  restrictBounds,
  showZoomControl = true,
  theme,
  onHandleChange,
  onPoiClick,
  children,
}: {
  // center:undefined 代表呼叫端還在決定初始中心(對齊 ExploreMap.tsx
  // initialCenter 的既有慣例,見該 prop 的完整說明),建圖要等待。
  center: { lat: number; lng: number } | undefined
  zoom?: number
  // minZoom:縮放下限——strictBounds 刻意設 false(見下方說明),範圍限制
  // 不會連帶鎖住縮放,若呼叫端不想讓使用者縮小到看見 restrictBounds 範圍
  // 外一大片空白,可以自行算好「剛好框住該範圍的縮放層級」傳入這裡,兩者
  // 是獨立的兩個限制、各自可選。
  minZoom?: number
  restrictBounds?: google.maps.LatLngBoundsLiteral | null
  showZoomControl?: boolean
  theme?: Theme
  // onHandleChange:每次 mapRef/mapReady 有實質變化就呼叫一次,把
  // MapHandle 往上交給呼叫端——呼叫端拿到後自行組裝掛載式 hook(見檔案
  // 開頭說明)。用 callback 而非直接 return 值,是因為 mapRef 是 ref、
  // mapReady 才是驅動重渲染的 state,呼叫端要能在 mapReady 變 true 的
  // 那次重渲染中同步拿到最新的 mapRef.current。
  onHandleChange?: (handle: MapHandle) => void
  // onPoiClick:攔截使用者點擊底圖上 Google 原生繪製的 POI 圖標(如餐廳、
  // 景點——見 google.maps.IconMouseEvent 的說明,MapMouseEvent 的擴充,
  // 只有點到 POI 圖標時 event 才會多出 placeId 欄位)時觸發,並呼叫
  // event.stop() 阻止 Google 預設彈出的小資訊卡——這個元件本身不知道、
  // 也不需要知道呼叫端拿到 placeId 後想做什麼(查詳情、開自己的卡片、
  // 或單純不理會),只負責把這個原生事件攔下來、把 placeId 往上交出去。
  // 對齊 ExploreMap.tsx 的同名攔截邏輯(見該檔案 click 監聽器的完整
  // 說明)——差別是 ExploreMap 內部直接呼叫 fetchGeoPlaceDetails 查完整
  // 資料才觸發 callback,這裡刻意只做「攔截+交出 placeId」這一層最小
  // 動作,查詢與後續行為完全交給呼叫端決定,理由同這個元件檔案開頭
  // 「只做原生配置」的既有取捨:查詢屬於呼叫端的業務邏輯,不屬於地圖
  // 建立本身。optional——不傳時退回 Google 預設行為(彈出原生小資訊卡),
  // 不影響既有呼叫端。
  onPoiClick?: (placeId: string) => void
  // children:附掛在地圖容器內的額外 UI(搜尋框/類別標籤等)——呼叫端組裝,
  // 這個元件不關心內容。
  children?: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const buildingRef = useRef(false)
  const builtColorSchemeRef = useRef<string | null>(null)
  // onPoiClickRef:建圖 effect 依賴陣列不含 onPoiClick(避免呼叫端每次
  // 重渲染傳入新的內聯函式參照時觸發不必要的重建),click 監聽器內透過
  // .current 讀取最新版本——理由同 ExploreMap.tsx 對 onPoiSelectRef 等
  // 一系列 ref 包裝的完整說明。
  const onPoiClickRef = useRef(onPoiClick)
  onPoiClickRef.current = onPoiClick

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

  useEffect(() => {
    if (!apiKey) {
      setErr('未設定 VITE_GOOGLE_MAPS_API_KEY(見 web/.env.development.local)')
      return
    }
    if (!containerRef.current) return
    const colorScheme = themeToColorScheme(theme ?? null)
    if (mapRef.current && builtColorSchemeRef.current === colorScheme) return
    if (buildingRef.current) return
    if (center === undefined) return
    if (mapRef.current) {
      google.maps.event.clearInstanceListeners(mapRef.current)
      mapRef.current = null
    }
    setMapReady(false)
    buildingRef.current = true
    let cancelled = false

    ensureOptionsSet(apiKey)
    Promise.all([importLibrary('maps'), importLibrary('marker')])
      .then(([{ Map }]) => {
        if (cancelled || !containerRef.current) return
        mapRef.current = new Map(containerRef.current, {
          center,
          zoom,
          ...(minZoom != null ? { minZoom } : {}),
          mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string,
          colorScheme,
          disableDefaultUI: true,
          zoomControl: showZoomControl,
          gestureHandling: 'greedy',
          // strictBounds 刻意不傳(等同 false)——這裡要的是「鎖拖曳範圍、
          // 不鎖縮放」:strictBounds:true 會把範圍限制跟縮放下限綁在一起
          // (無法縮小到能看見範圍外的畫面),false/省略則是官方文件記載的
          // 「彈簧」效果,只限制拖曳能到的位置,不限制縮放層級。這個展示頁
          // 只是要防止使用者拖到空白區域,不需要連帶鎖死縮放。
          ...(restrictBounds ? { restriction: { latLngBounds: restrictBounds, strictBounds: false } } : {}),
        })
        builtColorSchemeRef.current = colorScheme
        // click 監聽器:攔截點擊底圖上 Google 原生繪製的 POI 圖標——理由
        // 同 onPoiClick prop 的完整說明。只有點到 POI 圖標時,event 才會
        // 多出 placeId 欄位(google.maps.IconMouseEvent),用它分辨這次
        // 點擊是不是點到 POI,不是的話直接放行(不呼叫 event.stop(),
        // 維持地圖空白處一般點擊的既有行為)。
        mapRef.current.addListener('click', (event: google.maps.IconMouseEvent) => {
          if (!event.placeId) return
          event.stop()
          onPoiClickRef.current?.(event.placeId)
        })
        setMapReady(true)
        onHandleChange?.({ mapRef, mapReady: true })
        requestAnimationFrame(() => {
          if (!mapRef.current) return
          google.maps.event.trigger(mapRef.current, 'resize')
          mapRef.current.setCenter(center)
        })
      })
      .catch((e) => {
        buildingRef.current = false
        setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, center, theme, zoom, minZoom])

  useEffect(() => {
    if (!mapReady) return
    onHandleChange?.({ mapRef, mapReady })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady])

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} />
      {children}
      {err && (
        <div className={styles.mapError}>
          <span>地圖載入失敗</span>
          <span className={styles.mapErrorDetail}>{err}</span>
        </div>
      )}
    </div>
  )
}
