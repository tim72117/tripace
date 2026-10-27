import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Pause, Play, Snowflake } from 'lucide-react'
import { NativeMapBase, type MapHandle } from '../planning/map/NativeMapBase'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import { HAND_DRAWN_MAP_STYLE, HAND_DRAWN_MAP_STYLE_DARK } from '../itineraries/handDrawnMapStyle'
import {
  TOTAL_DAYS, advanceClock, createJapanField, dateOfDay, dayState, formatMonthDay, windEnvelope, type Clock,
} from './momijiFrontModel'
import { createMomijiRenderer } from './momijiRenderer'
import { createMomijiCanvasOverlay, type MomijiCanvasOverlay } from './MomijiCanvasOverlay'
import { CITY_FORECASTS, FORECAST_SOURCE } from './momijiForecast'
import { MOMIJI_SPOTS, type MomijiSpot } from './momijiSpots'
import { SPOT_LABEL_FONT, nearestWithin } from './spotHit'
import { itineraryPath, loadSpotItinerary } from './spotItinerary'
import { SpotListPanel } from './SpotListPanel'
import { spotListEntries } from './spotList'
import { trackEvent } from '../analytics'
import type { SampleItinerary } from '../itineraries/types'
import { dayCountOf, stopCountOf } from '../itineraries/catalog'
import { SITE_SEO_BASE_URL } from '../AppCommon'
import { SEO_DESCRIPTION, SEO_TITLE } from './momijiSeo'
import styles from './MomijiFrontPage.module.css'

// MomijiFrontPage——「紅葉前線」獨立頁面(2026-10 新增,使用者提供示意頁
// 「紅葉前線模擬」,要求「做一個獨立頁面,地圖用現在 itineraries 的滿版
// 地圖」):日本列島上的楓葉依日本氣象 2026-10-01 發表的各都市紅葉預測日,
// 由北往南、由綠轉黃、橙、紅;每天有一陣風由北往南掃過(視覺效果),播放/
// 拖曳日期/三段倍速可控,地圖上另標出 14 個預測都市與知名賞楓景點。
//
// 版面沿用 itineraries 詳情頁的滿版地圖做法(AiItineraryDetailPageMapView):
// NativeMapBase 鋪滿整頁、手繪暖色樣式(日夜兩份)、固定在頂端的站台導覽
// (品牌/主題切換/登入)。
//
// 2026-10(第三次修正,見 MomijiCanvasOverlay.ts 的完整說明)楓葉畫在
// MomijiCanvasOverlay(google.maps.OverlayView 子類)擁有的 canvas 上,
// 這個 canvas 由 Maps 自己掛進它的疊加層面板(不是獨立疊在地圖容器
// 外面的 React <canvas> 元素)——Maps 在自己投影/縮放/平移狀態改變的
// 每一刻都會呼叫 OverlayView.draw(),用這個時機點換算出的螢幕座標
// 保證跟地圖當下的視覺渲染同步,不會有「地圖已經開始縮放、楓葉座標還
// 沒跟上」的時間差。rAF 迴圈仍然自己跑(葉子熟度漸變、搖擺、飛葉物理
// 這些跟地圖狀態無關的連續動畫需要持續推進),只是每個 frame 換算座標
// 改用 overlay.getProjection() 而非自己存一份 map.getProjection()。
//
// 這頁不接任何後端資料,資料都在程式端的資料檔(momijiForecast.ts 預測日、
// momijiSpots.ts 景點)。各地變色時程是依 14 個都市的預測日內插出來的示意
// (見 momijiFrontModel.ts forecastPeakDay),不是逐地點的預測;風的掃過順序
// 與「18 天由綠轉紅」的長度是視覺假設,不是來源資料。

// 地圖初始縮放:依視窗高度挑整數 zoom(inline styles 的地圖是 legacy raster,
// 不支援小數縮放)。日本在 zoom 5 約 445px 高、zoom 6 約 890px 高。
function initialZoom(): number {
  return typeof window !== 'undefined' && window.innerHeight >= 1000 ? 6 : 5
}
const MAP_CENTER = { lat: 38.2, lng: 137.4 }
// 窄螢幕(手機)不顯示 Google 的縮放鈕:它固定在右下角,會被底部的播放控制列
// 壓住;手機本來就用雙指縮放。
function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= 440
}

const SPEEDS = [1, 2, 4] as const

// 可點的景點(有精選行程的)與點擊命中半徑:手指點擊比滑鼠不準,半徑取 18px。
const LINKED_SPOTS = MOMIJI_SPOTS.filter((s): s is MomijiSpot & { itineraryId: string } => !!s.itineraryId)
const SPOT_HIT_RADIUS_PX = 18
// 從清單點景點時地圖移過去的縮放等級:夠近能看清楚該景點與附近的標示,又不會一下子放太大。
const SPOT_FOCUS_ZOOM = 8
// 清單內容只依資料檔,不隨狀態變,模組載入時整理一次。
const SPOT_LIST_ENTRIES = spotListEntries(MOMIJI_SPOTS)

// SEO_TITLE/SEO_DESCRIPTION/SEO_URL:這個頁面專屬的文案。<title> 與 JSON-LD 由前端宣告;description、canonical、
// og:*、twitter:* 由 server/cmd/server/seo_meta.go 的 seoMetaByPath 在 server 端統一輸出(唯一事實來源,見 main.tsx 對
// HelmetProvider 的說明——前端再宣告一份會讓 <head> 同時存在兩份互相矛盾的標籤)。SEO_TITLE 與 SEO_DESCRIPTION 必須跟
// seo_meta.go 裡 "/momiji-front" 那一筆保持一致,改其中一邊記得檢查另一邊。
// 文案本身在 momijiSeo.ts(含為什麼要保留「其餘地區為內插示意」那句,以及與 seo_meta.go 的對照測試)。
const SEO_URL = `${SITE_SEO_BASE_URL}/momiji-front`

export function MomijiFrontPage() {
  const { theme, dark, toggleTheme } = useThemeToggle()
  const field = useMemo(() => createJapanField(), [])
  const renderer = useMemo(() => createMomijiRenderer(field), [field])

  // ===== 播放狀態 =====
  // 時間/播放/倍速/拖動都存在 ref 裡:requestAnimationFrame 迴圈每個 frame
  // 都要讀,放 React state 會讓迴圈拿到過期的值或需要每次重建迴圈。畫面上
  // 需要重繪的部分(日期、百分比、播放鍵圖示、倍速)另外用 state 鏡射。
  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const clockRef = useRef<Clock>({ time: 0, hold: 0 })
  const playingRef = useRef(!prefersReducedMotion)
  const speedRef = useRef<number>(1)
  const scrubbingRef = useRef(false)
  // 初值 true:第 0 天是今天,各地不一定還是綠色,第一個真正畫出的 frame
  // 要直接顯示今天的熟度,不能從綠色花一秒漸變上去(renderer.draw 回傳非
  // null 時會自動清掉這個旗標,地圖還沒準備好前會一直保持)。
  const snapRef = useRef(true)
  const darkRef = useRef(dark)
  darkRef.current = dark
  const [playing, setPlayingState] = useState(!prefersReducedMotion)
  const [speed, setSpeedState] = useState<number>(1)
  const [hud, setHud] = useState({ day: 0, pct: 0 })
  // 北海道降雪/積雪開關(2026-10 北海道初雪後加,畫在楓葉 canvas 裡、剪裁在北海道
  // 輪廓內,見 momijiRenderer.drawSnow);減少動態偏好時預設關閉,不持久化。
  // 跟 dark 一樣用 ref 鏡射給 rAF 迴圈讀。
  const [snowing, setSnowing] = useState(!prefersReducedMotion)
  const snowingRef = useRef(snowing)
  snowingRef.current = snowing

  const mapHandleRef = useRef<MapHandle | null>(null)
  // overlayRef/overlayMapRef——MomijiCanvasOverlay 實例與它目前掛載的
  // map,見 handleMapHandleChange 的完整說明。overlayMapRef 記錄「目前
  // overlay.setMap() 的是哪個 map 實例」,避免地圖重建(mapVersion 變化,
  // 見 NativeMapBase.tsx 的完整說明)時重複建立/掛載。
  const overlayRef = useRef<MomijiCanvasOverlay | null>(null)
  const overlayMapRef = useRef<google.maps.Map | null>(null)
  // overlayVersion——state(不是 ref):overlay.setMap() 是非同步的,呼叫
  // 後 onAdd()(canvas 真正掛進 Maps 疊加層面板、getProjection() 才會
  // 回傳非 null)要再等一個 tick。遞增這個計數器驅動下方動畫迴圈的
  // useEffect 重新檢查 overlay 是否已掛載好,單純放 overlayRef 在依賴
  // 陣列不會觸發重跑(ref 本身不是 React 追蹤的狀態)。
  const [overlayVersion, setOverlayVersion] = useState(0)
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    mapHandleRef.current = handle
    const map = handle.mapRef.current
    if (!map || overlayMapRef.current === map) return
    overlayMapRef.current = map
    // overlay 只建立一次、重複使用:地圖重建(例如切換日夜模式)時換掛
    // 到新的 map 實例,不需要每次都重新 new 一個 OverlayView——canvas
    // 本身與繪製狀態(disp/kick 等葉子動畫 state,見 momijiRenderer.ts)
    // 不該因為地圖重建就重置。
    if (!overlayRef.current) overlayRef.current = createMomijiCanvasOverlay(styles.leafCanvas)
    overlayRef.current.setMap(map)
    setOverlayVersion((v) => v + 1)
  }, [])

  // ===== 景點點擊:顯示精選行程摘要卡片 =====
  // 楓葉層是 pointer-events:none 的 canvas,徽章本身收不到點擊;改監聽地圖的
  // click/mousemove,用 overlay 的 projection 把點擊位置與每個可點景點都換成
  // 容器像素,找半徑內最近的(見 spotHit.ts)。監聽器掛在 overlayVersion 變動的
  // effect 裡(地圖重建時換掛新地圖),cleanup 會移除舊的——StrictMode 下
  // mount/unmount/mount 也能重新掛回。
  const [activeSpot, setActiveSpot] = useState<(MomijiSpot & { itineraryId: string }) | null>(null)
  const [activeItinerary, setActiveItinerary] = useState<SampleItinerary | null>(null)
  const [itineraryLoading, setItineraryLoading] = useState(false)

  useEffect(() => {
    const map = mapHandleRef.current?.mapRef.current
    if (!map || overlayVersion === 0) return
    // 名稱文字的寬度:用跟繪製(momijiRenderer.drawSpots)同一個字型量,文字
    // 區域也算可點(見 spotHit.ts)。每個名稱只量一次。拿不到 2D context 時
    // 退回只有徽章圓形可點。
    const measureCtx = document.createElement('canvas').getContext('2d')
    if (measureCtx) measureCtx.font = SPOT_LABEL_FONT
    const labelWidths = new Map<string, number>()
    const labelWidth = (name: string) => {
      if (!measureCtx) return undefined
      let w = labelWidths.get(name)
      if (w === undefined) {
        w = measureCtx.measureText(name).width
        labelWidths.set(name, w)
      }
      return w
    }
    const hitSpot = (latLng: google.maps.LatLng | null | undefined) => {
      const proj = overlayRef.current?.getProjection()
      if (!proj || !latLng) return null
      const click = proj.fromLatLngToContainerPixel(latLng)
      if (!click) return null
      const pts = LINKED_SPOTS.flatMap((sp) => {
        const p = proj.fromLatLngToContainerPixel(new google.maps.LatLng(sp.lat, sp.lng))
        return p ? [{ id: sp.id, x: p.x, y: p.y, labelWidth: labelWidth(sp.name) }] : []
      })
      const id = nearestWithin(pts, click.x, click.y, SPOT_HIT_RADIUS_PX)
      return id ? LINKED_SPOTS.find((sp) => sp.id === id) ?? null : null
    }
    let hovering = false
    const onClick = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      const sp = hitSpot(e.latLng)
      setActiveSpot(sp)
      if (sp) trackEvent('momiji_spot_click', { spot: sp.name, itinerary: sp.itineraryId })
    })
    const onMove = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
      const over = hitSpot(e.latLng) !== null
      if (over !== hovering) {
        hovering = over
        map.setOptions({ draggableCursor: over ? 'pointer' : null })
      }
    })
    return () => {
      onClick.remove()
      onMove.remove()
      map.setOptions({ draggableCursor: null })
    }
  }, [overlayVersion])

  // 從右側清單選景點:地圖移到該景點(放大到至少 SPOT_FOCUS_ZOOM);有精選行程的
  // 同時開啟摘要卡片(跟點地圖上的徽章一樣),沒有行程的只移動地圖並關掉舊卡片。
  const selectSpotFromList = useCallback((id: string) => {
    const spot = MOMIJI_SPOTS.find((sp) => sp.id === id)
    if (!spot) return
    const map = mapHandleRef.current?.mapRef.current
    if (map) {
      map.panTo({ lat: spot.lat, lng: spot.lng })
      if ((map.getZoom() ?? 0) < SPOT_FOCUS_ZOOM) map.setZoom(SPOT_FOCUS_ZOOM)
    }
    const linked = LINKED_SPOTS.find((sp) => sp.id === id) ?? null
    setActiveSpot(linked)
    trackEvent('momiji_spot_list_click', { spot: spot.name, linked: linked !== null })
  }, [])
  const openItineraryFromList = useCallback((id: string) => {
    const sp = LINKED_SPOTS.find((s) => s.id === id)
    if (sp) trackEvent('momiji_spot_itinerary_open', { spot: sp.name, itinerary: sp.itineraryId, from: 'list' })
  }, [])

  // 點開景點後載入行程摘要(沒點之前完全不載入,見 spotItinerary.ts)
  useEffect(() => {
    setActiveItinerary(null)
    if (!activeSpot) {
      setItineraryLoading(false)
      return
    }
    let cancelled = false
    setItineraryLoading(true)
    loadSpotItinerary(activeSpot.itineraryId)
      .then((it) => { if (!cancelled) setActiveItinerary(it) })
      .catch((err) => console.warn('[MomijiFrontPage] 載入景點行程失敗:', err))
      .finally(() => { if (!cancelled) setItineraryLoading(false) })
    return () => { cancelled = true }
  }, [activeSpot])

  // Esc 關閉卡片
  useEffect(() => {
    if (!activeSpot) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveSpot(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSpot])

  const sliderRef = useRef<HTMLInputElement>(null)

  const setPlaying = useCallback((p: boolean) => {
    playingRef.current = p
    setPlayingState(p)
  }, [])

  const togglePlay = useCallback(() => {
    // 已經播完時按播放 = 從頭再看一次
    if (!playingRef.current && clockRef.current.time >= TOTAL_DAYS) {
      clockRef.current = { time: 0, hold: 0 }
      snapRef.current = true
    }
    setPlaying(!playingRef.current)
  }, [setPlaying])

  // 空白鍵切換播放(焦點在 body 時,避免搶走按鈕/滑桿自己的空白鍵行為)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  // ===== 動畫迴圈 =====
  // 2026-10(第三次修正,見 MomijiCanvasOverlay.ts 的完整說明)canvas
  // 不再是 React <canvas ref> 元素,而是 MomijiCanvasOverlay 實例自己
  // 擁有、掛進 Maps 疊加層面板的 DOM 節點——這個 effect 本身不直接依賴
  // overlayRef(那是 ref,依賴陣列放它不會在它變化時重跑),改成依賴
  // overlayVersion(見該 state 的完整說明)驅動重新檢查。
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const canvas = overlay.canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let last = performance.now()
    let lastDay = -1
    let lastPct = -1

    const render = (ts: number) => {
      const dt = Math.max(0, Math.min(0.05, (ts - last) / 1000))
      last = ts

      // layout():可視範圍離開 canvas 或縮放改變時才會重新定位/改尺寸
      // (見 MomijiCanvasOverlay),平常是 no-op。
      const laidOut = overlay.isMounted() && overlay.layout()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = overlay.cssWidth
      const h = overlay.cssHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }

      const map = mapHandleRef.current?.mapRef.current ?? null
      const projection = laidOut ? overlay.getProjection() ?? null : null
      const zoom = map?.getZoom() ?? null
      const mapReady = !!projection && zoom != null
      // 地圖還沒準備好時不推進時間,避免楓葉動畫在看不到地圖時就跑掉一段
      let restarted = false
      if (mapReady && playingRef.current) {
        const step = advanceClock(clockRef.current, dt, speedRef.current)
        clockRef.current = step.clock
        restarted = step.restarted
      }
      if (restarted) snapRef.current = true

      const time = clockRef.current.time
      const { day, frac, windU } = dayState(time)
      const windOn = playingRef.current && time < TOTAL_DAYS
      const env = windEnvelope(frac, { active: windOn, scrubbing: scrubbingRef.current })
      const pct = renderer.draw(ctx, w, h, dpr, { projection, zoom, originX: overlay.originX, originY: overlay.originY }, {
        dt, now: ts / 1000, time, day, frac, windU, env, windOn, playing: playingRef.current,
        snap: snapRef.current, dark: darkRef.current, snowing: snowingRef.current,
      })
      if (pct != null) snapRef.current = false

      if (day !== lastDay || (pct != null && pct !== lastPct)) {
        lastDay = day
        if (pct != null) lastPct = pct
        setHud((cur) => (cur.day === day && (pct == null || cur.pct === pct) ? cur : { day, pct: pct ?? cur.pct }))
      }
      const slider = sliderRef.current
      if (slider) {
        if (!scrubbingRef.current) slider.value = String(time)
        slider.style.setProperty('--p', `${(time / TOTAL_DAYS) * 100}%`)
      }
    }
    // render 只負責畫一幀;排程另外處理。Maps 的 draw() 也會同步呼叫 render
    // 補畫,若 render 自己排下一個 rAF,每次 draw() 都會多開一條永久迴圈。
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      // Maps 的 draw() 可能已在這一幀用較晚的 performance.now() 同步畫過(onDraw);這個 rAF 的 ts 不比它晚,
      // 再畫一次只會讓整幀(含雪)畫兩次、dt 重複計算。
      if (ts > last) render(ts)
    }
    raf = requestAnimationFrame(loop)
    // onDraw——見 MomijiCanvasOverlay.onDraw 的完整說明:Maps 的投影/
    // 縮放/平移狀態一改變就會呼叫,這裡額外補一次立即重繪(不等下一個
    // rAF tick),確保縮放過渡動畫的每一幀都有對應畫面更新,不會因為
    // rAF 排程時機跟 Maps 內部過渡動畫的 tick 沒對齊而看起來慢半拍。
    const unsubscribe = overlay.onDraw(() => render(performance.now()))
    return () => {
      cancelAnimationFrame(raf)
      unsubscribe()
    }
  }, [renderer, overlayVersion])

  const startLabel = formatMonthDay(dateOfDay(0), '/')
  const endLabel = formatMonthDay(dateOfDay(TOTAL_DAYS), '/')

  return (
    <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined} data-momiji-dark={dark ? 'true' : 'false'}>
      <Helmet>
        {/* <title> 留在前端:SPA 內部換頁時需要它更新分頁標題(react-helmet-async 對 title 是直接覆寫 document.title,
            不會與 index.html 的靜態 title 重複)。description/canonical/og 不在這裡宣告,見 SEO_TITLE 上方說明。 */}
        <title>{SEO_TITLE}</title>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: SEO_TITLE,
            description: SEO_DESCRIPTION,
            url: SEO_URL,
            inLanguage: 'zh-Hant',
            isPartOf: { '@type': 'WebSite', name: 'Tripace', url: `${SITE_SEO_BASE_URL}/` },
            about: { '@type': 'Thing', name: '日本紅葉前線' },
            citation: FORECAST_SOURCE.url,
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: `${SITE_SEO_BASE_URL}/` },
              { '@type': 'ListItem', position: 2, name: '紅葉前線', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      {/* 頁面主體是畫在 canvas 上的地圖動畫,本身沒有可被爬蟲或螢幕閱讀器讀取的文字。這一段是同一份資料的文字版
          (標題、說明、14 個都市的預測見頃日、資料來源),視覺上隱藏、但保留在 DOM 供搜尋引擎與輔助科技使用;
          內容全部來自 CITY_FORECASTS 與 FORECAST_SOURCE,與畫面顯示的資料同源,不另外寫死。 */}
      <section className={styles.srOnly} aria-label="紅葉前線文字摘要">
        <h1>2026 日本紅葉預測攻略</h1>
        <p>{SEO_DESCRIPTION}</p>
        <ul>
          {CITY_FORECASTS.map((c) => (
            <li key={c.id}>
              {c.nameZh}:紅葉預測見頃 {c.momiji.peak.replace('-', '/')}(平年 {c.momiji.normal.replace('-', '/')})、銀杏黃葉預測見頃 {c.ginkgo.peak.replace('-', '/')}
            </li>
          ))}
        </ul>
        <ul>
          {LINKED_SPOTS.map((sp) => (
            <li key={sp.id}>
              <a href={itineraryPath(sp.itineraryId)} tabIndex={-1}>{sp.name}({sp.area})的精選行程</a>
            </li>
          ))}
        </ul>
        <p>
          資料來源:{FORECAST_SOURCE.publisher}「{FORECAST_SOURCE.title}」,{FORECAST_SOURCE.announcedOn} 發表。各地中間日期為內插的視覺示意,非官方逐日預報。
        </p>
      </section>
      <SiteNavBrand pageLabel="紅葉前線" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">登入</SiteNavCta>

      <div className={styles.mapBackdrop}>
        <NativeMapBase
          center={MAP_CENTER}
          zoom={initialZoom()}
          showZoomControl={!isNarrowScreen()}
          theme={dark ? 'dark' : 'light'}
          styles={dark ? HAND_DRAWN_MAP_STYLE_DARK : HAND_DRAWN_MAP_STYLE}
          onHandleChange={handleMapHandleChange}
        />
      </div>
      {/* 楓葉層——2026-10(第三次修正)不再是這裡的 JSX <canvas> 元素,
          改由 MomijiCanvasOverlay 在 onAdd() 時自己建立、掛進 Maps 的
          疊加層面板(見該檔案的完整說明),CSS class 透過 overlay 建構子
          直接設定在它擁有的 canvas DOM 節點上(見該處的完整說明)。 */}

      {/* 景點行程摘要卡片:點到有精選行程的景點徽章(目前是定山溪)時出現。標題、
          地區、天數、站數與簡介來自 itineraries/example/<id>.ts(見 spotItinerary.ts),
          「查看完整行程」連到 /itineraries/<id>。資料還在載入或載不到時仍顯示景點名稱與連結。 */}
      <SpotListPanel
        entries={SPOT_LIST_ENTRIES}
        activeId={activeSpot?.id ?? null}
        onSelect={selectSpotFromList}
        onOpenItinerary={openItineraryFromList}
      />

      {activeSpot && (
        <aside className={styles.spotCard} role="region" aria-label={`${activeSpot.name}的精選行程`}>
          <button type="button" className={styles.spotCardClose} onClick={() => setActiveSpot(null)} aria-label="關閉">×</button>
          <div className={styles.spotCardEyebrow}>{activeSpot.area} · {activeSpot.kind}</div>
          <div className={styles.spotCardTitle}>{activeItinerary?.title ?? activeSpot.name}</div>
          {activeItinerary && (
            <div className={styles.spotCardMeta}>
              {activeItinerary.region} · {dayCountOf(activeItinerary)} 天 · {stopCountOf(activeItinerary)} 站
            </div>
          )}
          {itineraryLoading && <div className={styles.spotCardMeta}>載入行程中…</div>}
          {activeItinerary?.summary && <p className={styles.spotCardSummary}>{activeItinerary.summary}</p>}
          <a
            className={styles.spotCardLink}
            href={itineraryPath(activeSpot.itineraryId)}
            onClick={() => trackEvent('momiji_spot_itinerary_open', { spot: activeSpot.name, itinerary: activeSpot.itineraryId })}
          >
            查看完整行程
          </a>
        </aside>
      )}

      <div className={styles.hud} aria-live="off">
        <div className={styles.date}>{formatMonthDay(dateOfDay(hud.day), '月')}日</div>
        <div className={styles.day}>
          第 {hud.day + 1} 天 · 已轉紅 <span className={styles.pct}>{hud.pct}%</span>
        </div>
        <div className={styles.legend} aria-hidden="true">
          <div className={styles.legendBar} />
          <div className={styles.legendTicks}><span>綠</span><span>黃</span><span>橙</span><span>紅</span></div>
        </div>
        {/* 資料出處——各地變色時程是依日本氣象 14 個都市的預測見頃日內插出來的
            示意(見 momijiForecast.ts/forecastPeakDay),不是逐地點的預測,
            要讓使用者知道。 */}
        <div className={styles.source}>
          依 {FORECAST_SOURCE.publisher} {FORECAST_SOURCE.announcedOn.replace(/-/g, '/')} 發表的紅葉預測日內插,示意用
        </div>
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.playBtn} onClick={togglePlay} aria-label={playing ? '暫停' : '播放'}>
          {playing ? <Pause size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} />}
        </button>
        <div className={styles.sliderWrap}>
          <input
            ref={sliderRef}
            type="range"
            className={styles.slider}
            min={0}
            max={TOTAL_DAYS}
            step={0.01}
            defaultValue={0}
            aria-label="模擬日期"
            onInput={(e) => {
              clockRef.current = { time: parseFloat((e.target as HTMLInputElement).value), hold: 0 }
              scrubbingRef.current = true
              if (playingRef.current) setPlaying(false)
            }}
            onPointerUp={() => { scrubbingRef.current = false }}
            onKeyUp={() => { scrubbingRef.current = false }}
            onBlur={() => { scrubbingRef.current = false }}
          />
          <div className={styles.sliderLabels}><span>{startLabel}</span><span>{endLabel}</span></div>
        </div>
        <div className={styles.speed} role="group" aria-label="播放速度">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.speedBtn}
              aria-pressed={speed === s}
              onClick={() => {
                speedRef.current = s
                setSpeedState(s)
              }}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.snowBtn}
          aria-pressed={snowing}
          aria-label={snowing ? '關閉北海道降雪' : '開啟北海道降雪'}
          title="北海道降雪"
          onClick={() => setSnowing((s) => !s)}
        >
          <Snowflake size={16} />
        </button>
      </div>
    </div>
  )
}
