// mapMarkers.ts——從 GeoOutlineMap.tsx 抽出來的 marker 內容產生邏輯,全部
// 是不吃 React state 的純函式,原本卡在 GeoOutlineMap.tsx 的 module scope
// 裡跟主元件擠在同一個 1300+ 行的檔案。搬過來的理由單純是「這批函式彼此
// 互相呼叫(svgStringToElement 被其餘四個 xxxMarkerContent 共用、
// candidateBadgeSvg 被 hotel/place 兩者共用),邏輯上是同一個小主題」,
// 跟主元件的地圖生命週期/查詢邏輯沒有交集,搬動本身不改變任何行為。

// candidateBadgeSvg:「已加入候選籃」的小勾選徽章 fragment,綠底 + 白色
// 勾勾,疊在 marker 右上角——跟 GeoOutlineMap.module.css 的
// .geo-attraction-overlay-candidate 是同一套視覺語言。cx/cy 是徽章圓心
// 座標,由呼叫端依自己的 viewBox 尺寸決定要疊在哪個角落——兩邊呼叫端
// (飯店/推薦地點)的圖示尺寸不同,由呼叫端決定位置比在這裡寫死一組
// 座標更不容易疊錯。
export function candidateBadgeSvg(cx: number, cy: number): string {
  const r = 4.5
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#5A8A6A" stroke="#FDFCFA" stroke-width="1"/>` +
    `<path d="M${cx - 2} ${cy}l1.3 1.3L${cx + 2} ${cy - 2.3}" fill="none" stroke="#FDFCFA" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`
  )
}

// svgStringToElement:把一段 <svg>...</svg> 字串解析成真正的 DOM 元素,供
// AdvancedMarkerElement.content 使用——這個元件改用 AdvancedMarkerElement
// 之前(google.maps.Marker 年代),同一段字串是包成 data:image/svg+xml
// 塞進 icon.url(圖片),而不是活的 DOM;AdvancedMarkerElement.content
// 要求真正的 Node,故這裡用 DOMParser 解析成 <svg> Element 後回傳,讓下面
// 四個 xxxMarkerContent 函式能沿用原本已經寫好、視覺調校過的 SVG 字串,
// 不必為了換 API 重寫一次繪圖邏輯。
export function svgStringToElement(svg: string): SVGElement {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  return doc.documentElement as unknown as SVGElement
}

// hotelMarkerContent:飯店 marker 的內容 DOM,依選取/候選籃狀態回傳不同
// 樣式——拆成模組層級的純函式(而非寫在 render 裡的閉包),讓建立飯店
// marker(全量重畫)與切換選取樣式(改用 setContent() 的 effect)兩個
// effect 共用同一份定義,不重複維護兩份圖示邏輯。candidate 為 true 時,
// 不論是否選中都疊加右上角勾選徽章(見 candidateBadgeSvg 的說明)——
// 候選籃狀態跟選取狀態是兩件獨立的事,可以同時成立。
//
// 選中態畫「同色實心圓 + 白色間隙環 + 同色外環」三層同心圓;未選中且非
// 候選籃時只畫單層描邊圓點——不再像 google.maps.Marker 年代需要為了
// 「內建 Symbol 只能單色」的限制而特意在 selected||candidate 才切換成
// SVG 字串分支,AdvancedMarkerElement 的 content 本來就是自由 DOM,兩種
// 狀態統一都走 SVG,寫法更單純。
export function hotelMarkerContent(selected: boolean, candidate: boolean): SVGElement {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
    (selected
      ? '<circle cx="10" cy="10" r="9" fill="#5A8A6A"/>' +
        '<circle cx="10" cy="10" r="6.5" fill="#FDFCFA"/>' +
        '<circle cx="10" cy="10" r="4" fill="#5A8A6A"/>'
      : '<circle cx="10" cy="10" r="5" fill="#5A8A6A" stroke="#FDFCFA" stroke-width="1.5"/>') +
    (candidate ? candidateBadgeSvg(16.5, 3.5) : '') +
    '</svg>'
  return svgStringToElement(svg)
}

// PLACE_CATEGORY_GLYPHS:附近推薦地點(見 handleCategoryClick 觸發的
// fetchGeoPlacesNearby)依 GeoPlace.primaryType
// 分類要畫的圖案內容(白色線條,座標為 lucide-react 對應圖示的原生 24x24
// path 資料,直接取自 hotel/map-pin/utensils-crossed 三顆 icon)——讓地圖
// 上方類別標籤(飯店/景點/餐廳,見 CATEGORY_TAGS)查出來的三種地點,各自
// 用跟標籤一致的圖示語意,而非全部套同一顆相機圖示。
const CAMERA_GLYPH =
  '<path d="M8.5 8.2h1.1l.7-1.1a.8.8 0 01.7-.4h2a.8.8 0 01.7.4l.7 1.1h1.1a1.6 1.6 0 011.6 1.6v5.4a1.6 1.6 0 01-1.6 1.6H8.5a1.6 1.6 0 01-1.6-1.6V9.8a1.6 1.6 0 011.6-1.6z" fill="none" stroke="#FDFCFA" stroke-width="1.3" stroke-linejoin="round"/>' +
  '<circle cx="12" cy="12.6" r="2.1" fill="none" stroke="#FDFCFA" stroke-width="1.3"/>'
// 每顆 lucide 圖示原生是 24x24 stroke 繪製、幾乎頂到邊框,直接套用會蓋過
// 圓形底色的邊緣——用同一個 <g transform> 把座標系縮到 60%、以 (12,12)
// 為中心再置中,壓進圓形底色內側,視覺份量對齊原本相機圖示的手繪尺寸。
const PLACE_CATEGORY_GLYPHS: Record<string, string> = {
  lodging:
    '<g transform="translate(12 12) scale(0.6) translate(-12 -12)" fill="none" stroke="#FDFCFA" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10 22v-6.57"/><path d="M12 11h.01"/><path d="M12 7h.01"/><path d="M14 15.43V22"/>' +
    '<path d="M15 16a5 5 0 0 0-6 0"/><path d="M16 11h.01"/><path d="M16 7h.01"/><path d="M8 11h.01"/><path d="M8 7h.01"/>' +
    '<rect x="4" y="2" width="16" height="20" rx="2"/></g>',
  tourist_attraction:
    '<g transform="translate(12 12) scale(0.6) translate(-12 -12)" fill="none" stroke="#FDFCFA" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>' +
    '<circle cx="12" cy="10" r="3"/></g>',
  restaurant:
    '<g transform="translate(12 12) scale(0.6) translate(-12 -12)" fill="none" stroke="#FDFCFA" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/>' +
    '<path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/>' +
    '<path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/></g>',
}

// placeMarkerContent:附近推薦地點的 marker 內容 DOM——用一顆小小的類別
// 圖示(而非 hotelMarkerContent 那種純色圓點),讓使用者一眼認出這是
// 「推薦景點」語意,跟景點區域光暈、飯店圓點的抽象色塊區隔開來。底色
// 維持靛藍(區分於景點區域的暖沙棕、飯店的森綠),圖案本身用白色線條,
// 尺寸刻意壓小(未選中 22px、選中 28px)——這是輔助辨識用的小圖標,
// 不搶過分區光暈與地標照片的視覺份量。選中態只放大 + 加一圈白色描邊
// 光暈(而非飯店那種三層同心圓靶心)——圖案本身已經有清楚的形狀語意,
// 不需要再疊靶心結構,加大加亮已足夠表達「這是選中的那個」。candidate
// 為 true 時疊加右上角勾選徽章,理由同 hotelMarkerContent。
export function placeMarkerContent(selected: boolean, candidate: boolean, category?: string): SVGElement {
  const size = selected ? 28 : 22
  const glyph = (category && PLACE_CATEGORY_GLYPHS[category]) || CAMERA_GLYPH
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
    (selected
      ? '<circle cx="12" cy="12" r="11.5" fill="#5A7A9E" stroke="#FDFCFA" stroke-width="2"/>'
      : '<circle cx="12" cy="12" r="11.5" fill="#5A7A9E"/>') +
    glyph +
    (candidate ? candidateBadgeSvg(19.5, 4.5) : '') +
    '</svg>'
  return svgStringToElement(svg)
}

// tripEntryMarkerContent:行程本身已有座標的 entry(見 tripEntries prop)
// 的 marker 內容 DOM——用全案主色 accent(暖橘,對齊 --color-accent)
// 搭配一枚小旗子造型,語意是「這裡已經排進行程」,跟分區光暈的暖沙棕、
// 飯店的森綠、推薦地點的靛藍相機都不同,一眼就能認出「這是我已經
// 決定要去的點」而非還在探索/推薦階段的候選。尺寸比其餘三種圖層
// 稍大一階(未選中 24px、選中 30px),因為這是這批圖層裡「已確定」
// 的內容,理當比還在探索的候選更顯眼一些。
export function tripEntryMarkerContent(selected: boolean): SVGElement {
  const size = selected ? 30 : 24
  const flagSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
    (selected
      ? '<circle cx="12" cy="12" r="11.5" fill="#C4956A" stroke="#FDFCFA" stroke-width="2"/>'
      : '<circle cx="12" cy="12" r="11.5" fill="#C4956A"/>') +
    // 小旗子造型:一根直立旗桿 + 三角形旗面,線條走白色,座標配合
    // 24x24 viewBox,足夠在 24-30px 的小尺寸下清楚辨識。
    '<path d="M9 7v11" stroke="#FDFCFA" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M9 7.3l6.5 2.2-6.5 2.2z" fill="#FDFCFA"/>' +
    '</svg>'
  return svgStringToElement(flagSvg)
}

// geocodeCandidateMarkerContent:搜尋候選 marker 的內容 DOM——用跟其餘
// 圖層(飯店森綠、推薦地點靛藍、行程 entry 暖橘)都不同的紫色系,並疊上
// 候選編號(1-based),讓使用者在地圖上能一眼分辨「這是搜尋查到的第幾筆
// 候選」,不需要另外對照清單。圖案本身用放大鏡造型(呼應「搜尋結果」
// 語意),而非既有的相機/旗子/純色點,故獨立一個函式而非重用
// placeMarkerContent 加個新的 category。selected 為 true 時放大並加一圈
// 白色描邊光暈(理由同 placeMarkerContent 的選中態),讓使用者選定後仍
// 能一眼認出「這是我剛選的那個」,即使其餘候選還留在地圖上也不會混淆。
export function geocodeCandidateMarkerContent(index: number, selected: boolean): SVGElement {
  const size = selected ? 34 : 28
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
    (selected
      ? '<circle cx="12" cy="12" r="11.5" fill="#7A5C99" stroke="#FDFCFA" stroke-width="2.5"/>'
      : '<circle cx="12" cy="12" r="11.5" fill="#7A5C99" stroke="#FDFCFA" stroke-width="2"/>') +
    '<g transform="translate(12 12) scale(0.55) translate(-12 -12)" fill="none" stroke="#FDFCFA" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>' +
    '</g>' +
    '<circle cx="20" cy="4" r="4.5" fill="#FDFCFA"/>' +
    '<text x="20" y="4" text-anchor="middle" dominant-baseline="central" font-size="6.5" font-weight="700" font-family="-apple-system, sans-serif" fill="#7A5C99">' + index + '</text>' +
    '</svg>'
  return svgStringToElement(svg)
}
