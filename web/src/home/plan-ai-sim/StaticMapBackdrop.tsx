import { useMemo, useState } from 'react'
import styles from './StaticMapBackdrop.module.css'

// StaticMapBackdrop — /ai-plan 展示頁的整頁地圖背景。
//
// 用 Maps Static API(回傳一張 PNG)而不是 Maps JavaScript API,理由是
// 計費模型:Dynamic Maps 每次 new google.maps.Map() 就是一次 map load,
// 而 Static Maps 是圖片請求、且同一組 URL 可以被瀏覽器/CDN 快取——這個
// 頁面是公開的高流量展示頁,地圖內容又完全固定(台南赤崁一帶),沒有
// 任何互動需求,快取命中後的訪客不會再產生 API 呼叫。
//
// 連帶省掉的還有 @googlemaps/js-api-loader 那包 JS 的下載與執行:這個
// 元件只是一個 <img>,不碰 SDK。
//
// 刻意不隨時間軸站點增加而重畫:每次改 URL 參數都是一次新的圖片請求
// (快取鍵不同),展示頁跑完整段腳本會變成七、八次呼叫。地圖在這裡的
// 作用是「讓畫面有地理脈絡」的氛圍底層,不是精確指出每一站的位置——
// 那是時間軸卡片本身在做的事。

// CENTER/ZOOM — 對準「赤崁・府城」這個主題點所在的老城區,範圍涵蓋
// 展示腳本(planSimScript.ts)全部 14 個站點,以及資料庫裡赤崁周邊的
// attraction(赤崁樓、孔廟、全美戲院、臺灣文學館、神農街、林百貨…)。
//
// 中心往西移到 120.1900(而非赤崁樓所在的 120.2024):zoom 拉遠之後,
// 把運河與鹽水溪那側一起帶進來,畫面才有「這是一座臨水的城市」的
// 地理脈絡,不只是一整片街廓。
//
// zoom 14:實際產圖比對過 15/16/17 三個級距後再往外一階。這個範圍除了
// 腳本的 14 個站點與赤崁周邊 attraction,還涵蓋運河、鹽水溪、魚塭,
// 地理脈絡最完整,而街廓紋理也還沒細到糊成灰色。
const CENTER = { lat: 22.9975, lng: 120.1900 }
const ZOOM = 14

// MAP_STYLE — 隱藏商家/交通類 POI,讓底圖維持安靜,不跟上層的時間軸
// 卡片搶視線。語意對齊 docs/map-style/*-no-food-lodging.json(城市介紹頁
// 那套 Cloud-based 樣式)——Static Maps 不吃 Cloud Map ID,只能用 URL
// 參數形式,故在這裡重寫一份等效的最小版本。
//
// 每一項是一組 style= 參數,組 URL 時會逐一串上去。
// 實測產出的圖確認過:只關 labels.icon 不夠,poi 的標籤文字仍會留著
// (赤崁樓、臺南公園、河樂廣場等),那些地名會跟上層時間軸卡片的站名
// 重複、互相干擾,故整個 poi 關掉。
const MAP_STYLE: string[] = [
  'feature:poi|visibility:off',
  'feature:transit|visibility:off',
  // 道路保留幾何但拿掉圖標與路名:街廓紋理是「這是一座城市」的視覺
  // 線索,要留;密密麻麻的路名則純粹是雜訊。
  'feature:road|element:labels|visibility:off',
  // administrative 的地名(北區/中西區)同理,背景不需要。
  'feature:administrative|element:labels|visibility:off',
  // landscape 的 labels 要單獨關:zoom 拉近後會冒出建物名稱
  // (實測在 zoom 17 看到「皇龍建設公寓大廈」),那同樣是雜訊。
  'feature:landscape|element:labels|visibility:off',
  // water 的 labels 同理:zoom 拉遠後水體名稱會冒出來(實測在 zoom 14
  // 看到「鹽水溪」「鯤鯓湖」)。
  'feature:water|element:labels|visibility:off',
  // 降低底圖彩度,讓它退到背景——上層卡片用的是 --paper 暖白紙感,
  // 底圖若太鮮豔會互相干擾。
  'feature:landscape|element:geometry|lightness:25',
  'feature:water|element:geometry|saturation:-40|lightness:15',
]

// SIZE/SCALE — Static Maps 的尺寸上限是 640x640(scale=2 時實際輸出
// 1280x1280,屬於 Retina 支援範圍內,不另外計費)。這張圖會被 CSS 拉伸
// 鋪滿整個視窗(object-fit: cover),所以取正方形而非配合視窗比例:
// 橫向/直向螢幕都能裁切出合理構圖,不需要依裝置尺寸產生多種 URL
// (那會讓快取鍵分散、命中率下降)。
const SIZE = '640x640'
const SCALE = 2

// PlotStop — 要畫在地圖上的站點。只收座標,樣式由這個元件決定(沿用
// /app 正式功能的小圓點視覺,見下方 .marker 樣式的說明)。
export interface PlotStop {
  id: string
  lat: number
  lng: number
}

// SIZE_PX — Static Map 的像素尺寸(SIZE 是 '640x640',scale 不影響座標
// 換算,只影響實際輸出解析度)。座標→像素的投影要用這個邏輯尺寸。
const SIZE_PX = 640

// project — Web Mercator 投影:把經緯度換算成「相對於地圖中心的像素
// 偏移」,再轉成百分比給 CSS 定位用。
//
// Static Map 的投影規則跟 Maps JS 一樣:世界在 zoom 0 時是 256x256 像素,
// 每升一級寬高各乘 2。所以 zoom z 的世界尺寸是 256 * 2^z 像素。
//
// 回傳的 left/top 是相對整張圖的百分比(0~100),超出 0~100 代表這個點
// 落在圖外、不該畫。
function project(lat: number, lng: number): { leftPct: number; topPct: number } {
  const worldSize = 256 * Math.pow(2, ZOOM)
  const toWorld = (la: number, ln: number) => {
    const x = ((ln + 180) / 360) * worldSize
    // 緯度要先轉成 Mercator 的 y:越靠近極區拉伸越大。clamp 在 ±85.05
    // 度(Mercator 的實際可表示範圍),避免極端值算出 Infinity。
    const sinLat = Math.sin((Math.min(Math.max(la, -85.05112878), 85.05112878) * Math.PI) / 180)
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
    return { x, y }
  }
  const center = toWorld(CENTER.lat, CENTER.lng)
  const point = toWorld(lat, lng)
  // 圖的中心在畫布正中央,故偏移量加上半個畫布。
  const px = point.x - center.x + SIZE_PX / 2
  const py = point.y - center.y + SIZE_PX / 2
  return { leftPct: (px / SIZE_PX) * 100, topPct: (py / SIZE_PX) * 100 }
}

export function StaticMapBackdrop({ stops = [] }: { stops?: PlotStop[] }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  // loaded/failed — 圖片載入前先維持純色底(見 .backdrop 的背景色),
  // 載入完成才淡入,避免一塊灰白區塊突然跳出來。載入失敗(網路、
  // 額度用盡、key 設定錯誤)時整個不顯示,頁面退回原本的純色背景——
  // 這是裝飾性底層,不該因為它失敗就讓展示頁看起來壞掉。
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const src = useMemo(() => {
    if (!apiKey) return null
    const params = new URLSearchParams({
      center: `${CENTER.lat},${CENTER.lng}`,
      zoom: String(ZOOM),
      size: SIZE,
      scale: String(SCALE),
      maptype: 'roadmap',
      language: 'zh-TW',
      region: 'TW',
      key: apiKey,
    })
    // style 是可重複的參數,URLSearchParams 的建構子只收單一值,故逐項
    // append。
    for (const s of MAP_STYLE) params.append('style', s)
    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
  }, [apiKey])

  // plotted — 換算成百分比座標,並濾掉落在圖外的點(投影結果超出
  // 0~100%)。濾在這裡而不是讓 CSS 去裁:超出範圍的元素即使看不見仍會
  // 參與版面與合成,沒必要渲染。
  const plotted = useMemo(
    () =>
      stops
        .map((s) => ({ id: s.id, ...project(s.lat, s.lng) }))
        .filter((p) => p.leftPct >= 0 && p.leftPct <= 100 && p.topPct >= 0 && p.topPct <= 100),
    [stops],
  )

  // 沒有 API key(本機未設定)或載入失敗時不渲染任何東西,讓 .page 自己
  // 的背景色接手。
  if (!src || failed) return null

  return (
    <div className={styles.backdrop} aria-hidden="true">
      <img
        src={src}
        alt=""
        className={`${styles.image} ${loaded ? styles.imageLoaded : ''}`}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        // decoding/loading——這是純裝飾的背景,不該阻塞上層時間軸的
        // 渲染與互動。
        decoding="async"
        loading="eager"
      />
      {/* 遮罩:底圖再怎麼降彩度,直接讓文字壓在地圖上仍然不好讀。這層
          半透明的 --paper 色把對比拉回來,同時保留地圖的輪廓感——
          使用者看得出「底下是一張地圖」,但讀卡片時不會被干擾。 */}
      <div className={styles.scrim} />
      {/* 站點圖標:用 HTML 絕對定位疊在地圖上,而不是 Static Map 的
          markers 參數——後者每多一個標記就是一組新的 URL、一次新的
          圖片請求,展示腳本跑完 14 站等於 14 次 API 呼叫且快取全數失效。
          疊 HTML 則讓底圖維持單一固定 URL(可被 CDN/瀏覽器快取),
          標記本身零成本,還能做進場動畫。
          視覺沿用 /app 正式功能的小圓點(見 geo-planning/mapMarkers.ts
          的 planStopMarkerContent base 態:13px、accent 色、2px 白邊),
          展示頁與正式功能用同一套語彙。 */}
      {plotted.map(({ id, leftPct, topPct }) => (
        <span
          key={id}
          className={styles.marker}
          style={{ left: `${leftPct}%`, top: `${topPct}%` }}
        />
      ))}
    </div>
  )
}
