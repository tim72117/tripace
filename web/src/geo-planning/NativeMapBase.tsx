import { useEffect, useRef, useState } from 'react'
import { importLibrary } from '@googlemaps/js-api-loader'
import type { ReactNode } from 'react'
import type { Theme } from '../theme'
import { ensureOptionsSet, themeToColorScheme } from './googleMapsBootstrap'
import cssStyles from './PlanMap.module.css'

// NativeMapBase——只做「建立一個 Google Map 實例」這件事的最小元件,不掛
// 任何搜尋框/類別標籤/景點 overlay/marker/panTarget 等行為。這是
// MapHandle 設計的落地起點(見先前討論:地圖建立邏輯各自獨立沒關係,是
// 附掛在地圖上的元件/行為要能拆出來,依需求組裝到不同地圖實體上)。
//
// 呼叫端透過 onReady(mapRef, mapReady) 拿到 MapHandle 形狀的兩個值,再自行
// 把 useSharedDrawLayer(統一繪製層:attractionGlow/searchResults/tripEntries 等功能層)
// 等「掛載式」hook 組裝上去——這個元件本身完全不知道、也不需要知道呼叫端
// 會掛什麼上來。
//
// 刻意先只做展示頁(InteractiveExploreMap.tsx)需要的最小原生配置子集
// (center/zoom/restrictBounds/showZoomControl/theme)——不是要在這裡
// 重建 PlanMap.tsx 全部的建圖選項(mapId/gestureHandling 等目前先
// 對齊過去)。現況補充:這個元件目前已內建 POI click 監聽器(onPoiClick,
// 攔截底圖 POI 圖標並交出 placeId)、rebuildOnThemeChange(theme 改變時是否
// 重建地圖)與 preserveViewOnResize(容器尺寸改變時保留視野的 resize 處理),
// 供 PlanMap 兩份實作沿用;其餘「行為」仍應由呼叫端用掛載的方式另外加。themeToColorScheme/ensureOptionsSet 兩個純函式與
// PlanMap.tsx 共用同一份實作(見 googleMapsBootstrap.ts 的完整說明),
// 不在這裡重複定義。

export interface MapHandle {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  // mapVersion:每次真的建立一個新的 google.maps.Map 實例就遞增——
  // 單靠 mapReady 這個布林值不足以讓呼叫端的掛載式 hook(如
  // attractionGlowLayer.ts)正確偵測到「地圖被整個重建了,要把 overlay
  // 重新掛到新實例上」:theme 改變觸發重建時,importLibrary('maps')
  // 通常已經被前一次呼叫快取住,幾乎瞬間 resolve,導致
  // setMapReady(false)(重建開始)跟緊接著的 setMapReady(true)(重建
  // 完成)被 React 18 自動批次處理(automatic batching)合併進同一次
  // commit,呼叫端的 mapReady 從頭到尾只看到最終值 true、沒有真的
  // 經歷 false→true 的邊緣,依賴 mapReady 的 useEffect 因此完全不會
  // 重新執行(2026-09 實測:日夜切換後主題點的自訂 overlay 全部消失,
  // 只剩 Google 原生 pin,追蹤到這裡才發現 mapReady 的邊緣觸發被
  // 批次處理吃掉)。mapVersion 用遞增計數器取代「觀察布林值變化」,
  // 每次重建保證是一個新的數字,呼叫端可以拿它當 useEffect 依賴,
  // 不會被批次處理合併成看不出變化的同一個值。
  mapVersion: number
  // error:建圖失敗的原因(沒有 API key、載入地圖模組失敗等);正常時為 null。
  // 2026-10 新增——NativeMapBase 自己會畫一個失敗畫面,但錯誤原本是內部 state,
  // 呼叫端看不到。PlanMap 這類自己有控制項(搜尋框、類別標籤)的呼叫端需要在地圖
  // 壞掉時隱藏它們,所以交出來。選填:既有呼叫端自己初始化 handle(例如
  // `{ mapRef, mapReady: false, mapVersion: 0 }`)不用跟著改。
  error?: string | null
}

export function NativeMapBase({
  center,
  zoom = 12,
  minZoom,
  restrictBounds,
  showZoomControl = true,
  theme,
  mapId,
  styles,
  onHandleChange,
  onPoiClick,
  rebuildOnThemeChange = true,
  preserveViewOnResize = false,
  strictRestriction = false,
  children,
}: {
  // center:undefined 代表呼叫端還在決定初始中心(對齊 PlanMap.tsx
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
  // mapId:不傳時退回 VITE_GOOGLE_MAPS_MAP_ID(見下方建圖 options 的既有
  // 行為,PlanMap.tsx/PlanPhoneView.tsx 等正式規劃功能呼叫端
  // 都不傳,沿用原樣式不受影響)。InteractiveExploreMap.tsx(landing page
  // 系列城市介紹頁的展示地圖)傳入另一個 Cloud Style Map ID(見該檔案
  // 呼叫處的說明,不顯示餐廳/旅宿 POI 的樣式,docs/map-style/*-no-food-
  // lodging.json 是對應的樣式快照)——這是唯一需要跟正式功能不同樣式的
  // 呼叫端,不影響共用元件本身的預設行為。
  mapId?: string
  // styles——inline JS 樣式規則(google.maps.MapTypeStyle[]),2026-10
  // 新增,使用者明確要求「用 map sdk 繪製手繪可愛風地圖」。跟 mapId(Cloud-
  // based styling)是官方文件明定互斥的兩套機制:地圖一旦帶 mapId,
  // Console 上設定的 Cloud Style 會覆蓋/忽略這裡傳入的 inline styles,
  // 若呼叫端傳了 styles,這個元件會完全不帶 mapId(連預設的
  // VITE_GOOGLE_MAPS_MAP_ID 也不退回),讓 inline styles 真正生效,見下方
  // 建圖 options 的判斷。沒有 Cloud Console 存取權限、或想直接在程式碼裡
  // 定義一次性視覺風格(不需要走 Console 手動設定流程)時用這個管道。
  styles?: google.maps.MapTypeStyle[]
  // onHandleChange:每次 mapRef/mapReady 有實質變化就呼叫一次,把
  // MapHandle 往上交給呼叫端——呼叫端拿到後自行組裝掛載式 hook(見檔案
  // 開頭說明)。用 callback 而非直接 return 值,是因為 mapRef 是 ref、
  // mapReady 才是驅動重渲染的 state,呼叫端要能在 mapReady 變 true 的
  // 那次重渲染中同步拿到最新的 mapRef.current。
  onHandleChange?: (handle: MapHandle) => void
  // rebuildOnThemeChange:theme 改變時要不要重建地圖,預設 true(既有行為)。
  // 2026-10 新增。雲端樣式(mapId)的 colorScheme「只能在建圖時設定」(見
  // @types/google.maps 的 MapOptions.colorScheme 說明),所以要讓地圖跟著明暗換色只能
  // 重建;但重建會讓視角回到初始 center/zoom,且呼叫端沒有支援 mapVersion 的圖層會留在
  // 舊地圖上。PlanMap 目前建圖後從不重建(見 PlanMap.mapEvents.test.tsx 記錄的
  // 現況),換成 NativeMapBase 組合時傳 false 維持原樣;第一次建圖不受影響。
  rebuildOnThemeChange?: boolean
  // preserveViewOnResize:容器尺寸改變時的 resize 處理方式,預設 false(既有行為)。
  // 2026-10 新增。
  //   - false(預設):只在容器「從隱藏變可見」時補一次 resize,並把中心設回初始 center。
  //   - true(給 PlanMap 用,對齊它原本自己的 ResizeObserver):每次「非零」尺寸回報都補
  //     resize(側欄收合、視窗調整等容器縮放,Maps SDK 不會自己重新量測,不補會停在舊尺寸
  //     或灰色圖磚),並把中心設回「目前」的中心——使用者可能已經拖曳/搜尋移動過地圖,拿
  //     初始座標會把畫面拉回原點。尺寸為 0(元素被隱藏或卸載)時不處理,此時 resize 只會
  //     讓 Maps 把畫布尺寸記成 0。
  preserveViewOnResize?: boolean
  // strictRestriction:restrictBounds 的 strictBounds 值,預設 false(既有行為:只鎖拖曳範圍,
  // 不鎖縮放下限,使用者仍能縮小到看見範圍外)。2026-10 新增:PlanMap 原本傳 true
  // (連縮放下限一起鎖),換成 NativeMapBase 組合時傳 true 維持原樣。沒有 restrictBounds
  // 時沒有作用。
  strictRestriction?: boolean
  // onPoiClick:攔截使用者點擊底圖上 Google 原生繪製的 POI 圖標(如餐廳、
  // 景點——見 google.maps.IconMouseEvent 的說明,MapMouseEvent 的擴充,
  // 只有點到 POI 圖標時 event 才會多出 placeId 欄位)時觸發,並呼叫
  // event.stop() 阻止 Google 預設彈出的小資訊卡——這個元件本身不知道、
  // 也不需要知道呼叫端拿到 placeId 後想做什麼(查詳情、開自己的卡片、
  // 或單純不理會),只負責把這個原生事件攔下來、把 placeId 往上交出去。
  // 對齊 PlanMap.tsx 的同名攔截邏輯(見該檔案 click 監聽器的完整
  // 說明)——差別是 PlanMap 內部直接呼叫 fetchGeoPlaceDetails 查完整
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
  // mapVersion:見 MapHandle.mapVersion 的完整說明——每次真的建立新的
  // google.maps.Map 實例就遞增。必須是 state(不是 ref):遞增動作本身
  // 要能驅動下方通知呼叫端的 useEffect 重新執行,單靠 mapReady 這個
  // 布林值在 theme 改變觸發重建的情境下會被 React 18 自動批次處理
  // 合併掉中間的 false 狀態(見該 useEffect 的完整說明),數字遞增則
  // 每次都是新值,不會被合併成看不出變化的同一個值。
  const [mapVersion, setMapVersion] = useState(0)
  // isVisible:容器目前是否有實際尺寸(寬高皆非 0)——呼叫端可能用 CSS
  // (display: none/hidden 屬性)讓這個元件所在的 DOM 子樹保持掛載但
  // 暫時不可見(例如 MobileMapReveal.tsx 縮圖/滿版切換,見該檔案
  // 「children 不會再 unmount」的完整說明),建圖 effect 依賴這個值、
  // 容器不可見時不執行——Google Maps SDK 在零尺寸容器建圖的行為未定義
  // (實測會直接失敗、地圖永遠不出現,即使之後容器變可見也不會自動補
  // 建),不能假設「反正之後會 resize 就沒差」。初始值固定 false(而非
  // 嘗試在這裡讀 containerRef.current.offsetWidth):useState 初始化
  // 函式在第一次 render 當下執行,這時 ref 必然還是 null(ref 賦值發生
  // 在 DOM 掛載後的 commit 階段,晚於 render),讀不到真實尺寸;false
  // 是安全的保守預設,實際可見性由下方 ResizeObserver effect 掛載後
  // 立即量測一次並修正。
  const [isVisible, setIsVisible] = useState(false)
  // onPoiClickRef:建圖 effect 依賴陣列不含 onPoiClick(避免呼叫端每次
  // 重渲染傳入新的內聯函式參照時觸發不必要的重建),click 監聽器內透過
  // .current 讀取最新版本——理由同 PlanMap.tsx 對 onPoiSelectRef 等
  // 一系列 ref 包裝的完整說明。
  const onPoiClickRef = useRef(onPoiClick)
  onPoiClickRef.current = onPoiClick
  const preserveViewOnResizeRef = useRef(preserveViewOnResize)
  preserveViewOnResizeRef.current = preserveViewOnResize

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

  useEffect(() => {
    if (!apiKey) {
      setErr('未設定 VITE_GOOGLE_MAPS_API_KEY(見 web/.env.development.local)')
      return
    }
    if (!containerRef.current) return
    // 容器不可見時不建圖(見上方 isVisible 的完整說明)——這裡只擋「還
    // 沒建過圖」的情況,已經建好的地圖實例(mapRef.current 有值)即使
    // 容器暫時不可見也不清除、不重建,下方 ResizeObserver effect 會在
    // 容器重新可見時補一次 resize,不需要整個重建。
    if (!isVisible && !mapRef.current) return
    if (mapRef.current && !rebuildOnThemeChange) return
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
        if (cancelled) return
        if (!containerRef.current) {
          buildingRef.current = false
          return
        }
        mapRef.current = new Map(containerRef.current, {
          center,
          zoom,
          ...(minZoom != null ? { minZoom } : {}),
          // styles 有值時完全不帶 mapId、也不帶 colorScheme(2026-10 修正
          // ——實測發現 styles 與 colorScheme 同時存在會讓地圖初始化失敗,
          // 畫面顯示 Google 原生的「這個網頁無法正確載入 Google 地圖」
          // 錯誤訊息:colorScheme/Dynamic Color Scheme 是 mapId 底下的
          // vector map 渲染管線專屬選項,legacy JSON styles 走的是不支援
          // colorScheme 的 raster map 渲染管線,兩者混用會被 SDK 拒絕,
          // 不是單純「其中一個被忽略」那麼溫和的失敗方式)。mapId 跟
          // colorScheme 互斥的理由同上一版註解——Cloud Style 會蓋掉這裡
          // 的 inline styles。
          ...(styles ? { styles } : { mapId: mapId ?? (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string), colorScheme }),
          disableDefaultUI: true,
          zoomControl: showZoomControl,
          gestureHandling: 'greedy',
          // strictBounds 刻意不傳(等同 false)——這裡要的是「鎖拖曳範圍、
          // 不鎖縮放」:strictBounds:true 會把範圍限制跟縮放下限綁在一起
          // (無法縮小到能看見範圍外的畫面),false/省略則是官方文件記載的
          // 「彈簧」效果,只限制拖曳能到的位置,不限制縮放層級。這個展示頁
          // 只是要防止使用者拖到空白區域,不需要連帶鎖死縮放。
          ...(restrictBounds ? { restriction: { latLngBounds: restrictBounds, strictBounds: strictRestriction } } : {}),
        })
        builtColorSchemeRef.current = colorScheme
        setMapVersion((v) => v + 1)
        // buildingRef 在這裡(建圖成功路徑)重設回 false——先前只在
        // .catch() 失敗路徑重設(理由是避免掩蓋 StrictMode 下
        // cancelled-early-return 那條成功路徑,見本檔案較早版本的完整
        // 說明),但沒考慮到「真的建圖成功之後」也必須重設,否則
        // buildingRef 會永遠卡在 true,導致之後任何需要重建地圖的情境
        // (例如 theme 改變、colorScheme 需要切換)在第 102 行的
        // `if (buildingRef.current) return` 被永久擋下,地圖再也無法
        // 重建(2026-09 實測:日夜切換後地圖底圖完全不會跟著換,追蹤
        // console.log 才發現建圖 effect 每次都在這個 guard 被攔下)。
        buildingRef.current = false
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
        requestAnimationFrame(() => {
          if (!mapRef.current) return
          google.maps.event.trigger(mapRef.current, 'resize')
          mapRef.current.setCenter(center)
        })
      })
      .catch((e) => {
        // 這一輪已被取消時,旗標由新一輪的 effect 持有,不能在這裡清掉
        if (!cancelled) buildingRef.current = false
        setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
      // 建圖進行中依賴就變了(例如手機版容器尺寸短暫為 0 使 isVisible 翻轉):舊的非同步結果回來時會因 cancelled 提早
      // return、不會重設旗標,新一輪又被 `if (buildingRef.current) return` 擋住,地圖就永遠不會建。所以取消時交還旗標。
      buildingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, center, theme, zoom, minZoom, mapId, styles, isVisible, rebuildOnThemeChange, strictRestriction])

  // 通知呼叫端的唯一進入點——依賴 mapVersion(state,見該欄位的完整
  // 說明)而非只依賴 mapReady:theme 改變觸發重建時,importLibrary('maps')
  // 通常已被前一次呼叫快取住、幾乎瞬間 resolve,若只依賴 mapReady 這個
  // 布林值,重建開始的 setMapReady(false) 跟緊接著重建完成的
  // setMapReady(true) 會被 React 18 自動批次處理(automatic batching)
  // 合併進同一次 commit,呼叫端只看得到最終值 true、沒有真的經歷
  // false→true 的邊緣,導致下游依賴 mapReady 的 useEffect(如
  // attractionGlowLayer.ts 那個重新掛載 overlay 到新地圖實例的
  // effect)完全不會重新執行(2026-09 實測:日夜切換後主題點的自訂
  // overlay 全部消失,只剩 Google 原生 pin,追蹤到這裡才發現問題出在
  // 批次處理把中間狀態吃掉)。mapVersion 每次重建保證遞增成新數字,
  // 加進這個 effect 的依賴陣列後,即使 mapReady 的中間值被合併掉,
  // mapVersion 的變化仍會讓這個 effect 重新執行、把最新的
  // mapReady/mapVersion 一併傳給呼叫端。
  useEffect(() => {
    onHandleChange?.({ mapRef, mapReady, mapVersion, error: err })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, err])

  // ResizeObserver:持續追蹤容器是否有實際尺寸,同步進 isVisible
  // state——呼叫端可能用 CSS(display: none/hidden 屬性)暫時隱藏這個
  // 元件所在的 DOM 子樹而不 unmount(例如 MobileMapReveal.tsx 縮圖/
  // 滿版切換,見該檔案「children 不會再 unmount」的完整說明)。兩種
  // 情況分別處理:
  // (1) 容器從一開始就不可見,地圖還沒建過(mapRef.current 為
  //     null)——isVisible 變 true 會讓上方建圖 effect 的依賴陣列
  //     觸發、真正第一次建圖(見該 effect 的完整說明)。
  // (2) 地圖已經建好,只是容器暫時被藏起來又重新出現——Google Maps
  //     SDK 本身沒有機制自動偵測「我又重新可見了」,不手動 trigger
  //     'resize' 會停留在建圖當下算出的舊尺寸/圖磚快取,顯示灰色
  //     空白或圖磚沒補齊,故仍額外手動 resize+setCenter 這一步,不能
  //     只靠 isVisible 變化觸發建圖 effect(該 effect 見到
  //     mapRef.current 已有值會直接 return,不會重新配置尺寸)。
  useEffect(() => {
    if (!containerRef.current) return
    let wasVisible = false
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const nowVisible = width > 0 && height > 0
      if (preserveViewOnResizeRef.current) {
        // 每次非零尺寸回報都補 resize,中心設回「目前」的中心(見 preserveViewOnResize)。
        const map = mapRef.current
        if (nowVisible && map) {
          const current = map.getCenter()
          google.maps.event.trigger(map, 'resize')
          if (current) map.setCenter(current)
        }
      } else if (!wasVisible && nowVisible && mapRef.current) {
        google.maps.event.trigger(mapRef.current, 'resize')
        if (center) mapRef.current.setCenter(center)
      }
      wasVisible = nowVisible
      setIsVisible(nowVisible)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={cssStyles.wrap}>
      <div ref={containerRef} className={cssStyles.map} />
      {children}
      {err && (
        <div className={cssStyles.mapError}>
          <span>地圖載入失敗</span>
          <span className={cssStyles.mapErrorDetail}>{err}</span>
        </div>
      )}
    </div>
  )
}
