import { useEffect, useState } from 'react'
import { solveSafeAreaCenter, type SafeAreaCenterSolution } from '../map/solveSafeAreaCenter'
import { debugDotStyle, debugLabelStyle } from '../shared/debugOverlayParts'

// SafeAreaDebugOverlay——開發工具:把 useMapSafeArea 的中心點計算視覺化,
// 讓「安全區塊的幾何」與「計算結果」都能肉眼核對。
//
// 存在的理由(2026-10 的實際經驗):計算邏輯本身一直是對的,錯的是餵
// 給它的幾何——安全區塊 .mapSafeArea 原本用 flex: 1 推導範圍,在三種
// 情況下都會靜默失效(手機版跟 .timelinePanel 對半分、時間軸沒內容時
// 吃滿全高、桌面版側欄是 absolute 不佔 flex 空間),而且不會有任何地方
// 報錯。這種「版面推導出錯的幾何」自動化測試很難涵蓋——jsdom 的
// getBoundingClientRect() 全部回傳 0,不計算 CSS;就算用 E2E,斷言
// 「綠框下緣貼齊卡片上方」也只能把估算值複製進測試,擋不住什麼。
// 純函式那層的數學改用單元測試守住(solveSafeAreaCenter.test.ts),
// 幾何這層就靠這個疊圖肉眼看。
//
// 刻意不透過 useMapSafeArea 拿中間結果(使用者構想「當成開發工具可以
// 分拆乾淨,需要時才組合嗎」):這個元件自己讀 map 與 safeAreaEl、自己
// 呼叫 solveSafeAreaCenter,所以 useMapSafeArea 的公開介面完全不需要
// 知道除錯工具存在,不用為它多開一個 debug 專用的回傳值。組合點只有
// safeAreaElRef 與 mapRef 兩個本來就公開的東西。
//
// 跟 hook 重複的只剩「讀 rect、取 projection」那幾行取值程式碼——那是
// 副作用,抽共用等於又把兩者綁回去,重複是刻意的。
//
// 疊在 .mapBackdrop 裡面:那個容器的範圍跟地圖 div 完全一致,而
// solveSafeAreaCenter 回傳的像素座標都是相對地圖容器左上角,基準相同
// 才對得準。

export function SafeAreaDebugOverlay({
  target,
  safeAreaElRef,
  mapRef,
  mapReady,
  onPan,
  resetView,
}: {
  // target——要驗證的那個地理座標。
  target: { lat: number; lng: number }
  // safeAreaElRef——useMapSafeArea 回傳的同一個 ref,組合點之一。
  safeAreaElRef: React.RefObject<HTMLDivElement | null>
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  // onPan——useMapSafeArea 回傳的 panToWithinSafeArea(正式路徑那一個)。
  // 按鈕按下時呼叫,讓使用者比對預測與實際:移動完成後紅點應該剛好
  // 停在綠點原本的位置上。
  onPan: (t: { lat: number; lng: number }) => void
  // resetView——頁面初始的中心與縮放,「重設視野」按鈕用它還原,方便
  // 反覆測試(手動拖回來的位置不精確,比對基準會跑掉)。
  resetView: { center: { lat: number; lng: number }; zoom: number }
}) {
  const [solution, setSolution] = useState<SafeAreaCenterSolution | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return

    // observedElRef——目前 ResizeObserver 正在盯的節點(見下方
    // ensureObserving 的完整說明),用來判斷 safeAreaElRef.current 換了
    // 新節點時要不要重新 observe,不是每次 recalc 都重建 observer。
    let observedEl: Element | null = null
    const resizeObserver = new ResizeObserver(recalc)
    // retryTimer——見 ensureObserving 的完整說明。
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retries = 0
    const MAX_RETRIES = 20

    function recalc() {
      const safeAreaEl = safeAreaElRef.current
      const projection = map!.getProjection()
      const currentZoom = map!.getZoom()
      const center = map!.getCenter()
      if (!safeAreaEl || !projection || currentZoom == null || !center) {
        setSolution(null)
        // 2026-10 修正(使用者回報「播放態框線完全沒有繪製」查出的真實
        // bug,比先前以為的「交接時節點換掉沒重算」更根本):這個 effect
        // 只在 mapReady 翻 true 的那一刻跑一次,若當下 safeAreaEl 還是
        // null(容器尚未完成掛載/排版,常發生在地圖比版面骨架更早準備好
        // 的時候),原本直接放棄、之後只能靠使用者手動拖曳/縮放地圖觸發
        // bounds_changed/idle 才會「意外」補算一次,框線因此一直不出現。
        // 改成短延時重試:容器還沒掛上就排一次 ensureObserving 稍後
        // 再試,直到量到為止或達到重試上限(見 ensureObserving;量到之後
        // 由 ResizeObserver 接手,不再需要這個重試)。
        ensureObserving()
        return
      }
      setZoom(currentZoom)
      setSolution(
        solveSafeAreaCenter({
          target,
          currentCenter: { lat: center.lat(), lng: center.lng() },
          zoom: currentZoom,
          mapRect: map!.getDiv().getBoundingClientRect(),
          safeRect: safeAreaEl.getBoundingClientRect(),
          projectToPoint: (latLng) => projection.fromLatLngToPoint(new google.maps.LatLng(latLng.lat, latLng.lng)),
          projectToLatLng: (point) => {
            const latLng = projection.fromPointToLatLng(new google.maps.Point(point.x, point.y))
            return latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null
          },
        }),
      )
      ensureObserving()
    }

    // ensureObserving——見上方 recalc 內「容器尚未掛載」情況的完整說明,
    // 同時也是「節點換掉後要換 observe 對象」的既有修正(safeAreaElRef
    // 是 ref object,identity 全程不變,.current 指向的 DOM 節點換掉
    // 例如 /ai-plan 從播放態交接到推論態,PlanLayout 兩側是各自獨立
    // 寫出的 JSX 子樹,安全區容器整個被卸載重新掛載成新節點,完全不會
    // 觸發這個 effect 重跑)。兩種情況合併成同一個函式:
    //   - safeAreaEl 還不存在 → 排一次 100ms 後重試 recalc,直到存在
    //     為止(地圖/劇本首次掛載,安全區容器通常一兩個 tick 內就緒)。
    //   - safeAreaEl 存在但換了新節點(或還沒 observe 過)→ 換 observer
    //     盯新節點,節點尺寸一變就重算,不用等下一次地圖事件。
    //
    // 重試有上限(MAX_RETRIES × 100ms = 2 秒):768–1023px 的桌面疊加版面
    // 沒有安全區節點(見 desktop/PlanOverlayLayout.tsx),ref 永遠是 null,
    // 不設上限會在開著 ?debugSafeArea 期間每 100ms 空轉一次。超過上限就
    // 停止輪詢,之後地圖事件(bounds_changed/idle/resize)呼叫 recalc 時
    // 若節點已出現,仍會量到並重置計數,不會因此永久失效。
    function ensureObserving() {
      const el = safeAreaElRef.current
      if (!el) {
        if (retryTimer == null && retries < MAX_RETRIES) {
          retries += 1
          retryTimer = setTimeout(() => { retryTimer = null; recalc() }, 100)
        }
        return
      }
      retries = 0
      if (el !== observedEl) {
        if (observedEl) resizeObserver.unobserve(observedEl)
        resizeObserver.observe(el)
        observedEl = el
      }
    }

    recalc()
    // bounds_changed 在拖曳/縮放過程中持續觸發,idle 是停下來之後——
    // 兩個都訂閱,拖曳中標記就會跟著動,不是放手才跳一次。
    const l1 = map.addListener('bounds_changed', recalc)
    const l2 = map.addListener('idle', recalc)
    // 視窗尺寸變化會改變安全區塊的排版結果,也要重算。
    window.addEventListener('resize', recalc)
    return () => {
      l1.remove()
      l2.remove()
      window.removeEventListener('resize', recalc)
      resizeObserver.disconnect()
      if (retryTimer != null) clearTimeout(retryTimer)
    }
  }, [mapReady, mapRef, safeAreaElRef, target])

  // 圓點與標籤的樣式與登入後的除錯疊圖共用(planning/shared/debugOverlayParts.tsx)。
  const dot = (p: { x: number; y: number }, color: string): React.CSSProperties => debugDotStyle(p, color)

  const label = (p: { x: number; y: number }, color: string): React.CSSProperties => ({
    position: 'absolute',
    left: p.x + 12,
    top: p.y - 8,
    ...debugLabelStyle(color),
  })

  return (
    // pointerEvents: none——純視覺標記不攔截地圖互動,使用者仍可自由
    // 拖曳/縮放觀察標記是否正確跟著更新。按鈕各自把它開回來。
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {solution && (
        <>
          {/* 綠色虛線框——安全區塊的實際範圍。這次的 bug 就是在這裡
              看出來的:框線一路延伸到視窗底部,代表時間軸完全沒被排除。 */}
          <div
            style={{
              position: 'absolute',
              left: solution.safeRectInMap.left,
              top: solution.safeRectInMap.top,
              width: solution.safeRectInMap.width,
              height: solution.safeRectInMap.height,
              border: '2px dashed #22c55e',
              background: 'rgba(34,197,94,.07)',
            }}
          />
          {/* 橘色箭頭——從 target 指向 safeCenter,長度與方向就是 delta。 */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <defs>
              <marker id="dbgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#f97316" />
              </marker>
            </defs>
            <line
              x1={solution.targetPixel.x}
              y1={solution.targetPixel.y}
              x2={solution.safeCenterPixel.x}
              y2={solution.safeCenterPixel.y}
              stroke="#f97316"
              strokeWidth="2"
              strokeDasharray="5 4"
              markerEnd="url(#dbgArrow)"
            />
          </svg>
          {/* 紅點:target 目前的螢幕位置。綠點:安全區中心,target 應該
              被移到的位置。藍點:容器中心,直接 panTo(target) 會移到的
              位置——藍綠兩點的距離就是這套計算存在的理由。 */}
          <div style={dot(solution.targetPixel, '#ef4444')} />
          <div style={label(solution.targetPixel, '#ef4444')}>
            target {solution.targetPixel.x.toFixed(0)},{solution.targetPixel.y.toFixed(0)}
          </div>
          <div style={dot(solution.safeCenterPixel, '#16a34a')} />
          <div style={label(solution.safeCenterPixel, '#16a34a')}>
            safeCenter {solution.safeCenterPixel.x.toFixed(0)},{solution.safeCenterPixel.y.toFixed(0)}
          </div>
          <div style={dot(solution.mapCenterPixel, '#3b82f6')} />
          <div style={label(solution.mapCenterPixel, '#3b82f6')}>
            mapCenter {solution.mapCenterPixel.x.toFixed(0)},{solution.mapCenterPixel.y.toFixed(0)}
          </div>
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(17,24,39,.88)',
              color: '#f9fafb',
              font: '500 11px/1.7 ui-monospace, monospace',
              whiteSpace: 'pre',
            }}
          >
            {[
              `zoom         ${zoom?.toFixed(3) ?? '—'}`,
              `delta        ${solution.delta.x.toFixed(1)}, ${solution.delta.y.toFixed(1)} px`,
              `safeRect     ${solution.safeRectInMap.width.toFixed(0)}×${solution.safeRectInMap.height.toFixed(0)} @ ${solution.safeRectInMap.left.toFixed(0)},${solution.safeRectInMap.top.toFixed(0)}`,
              `target       ${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`,
              `center next  ${solution.newCenter.lat.toFixed(5)}, ${solution.newCenter.lng.toFixed(5)}`,
            ].join('\n')}
          </div>
        </>
      )}
      {/* 重設視野——直接 setCenter/setZoom 不用 panTo:這裡要的是瞬間
          歸零,不是平滑移動。 */}
      <button
        type="button"
        onClick={() => {
          const map = mapRef.current
          if (!map) return
          map.setZoom(resetView.zoom)
          map.setCenter(resetView.center)
        }}
        style={{
          position: 'absolute',
          right: 12,
          bottom: 56,
          pointerEvents: 'auto',
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,.25)',
          background: 'rgba(17,24,39,.88)',
          color: '#f9fafb',
          font: '600 12px/1.4 ui-monospace, monospace',
          cursor: 'pointer',
        }}
      >
        重設視野
      </button>
      <button
        type="button"
        onClick={() => onPan(target)}
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          pointerEvents: 'auto',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid rgba(249,115,22,.5)',
          background: '#f97316',
          color: '#fff',
          font: '600 12px/1.4 ui-monospace, monospace',
          cursor: 'pointer',
        }}
      >
        移動到安全區中心
      </button>
    </div>
  )
}
