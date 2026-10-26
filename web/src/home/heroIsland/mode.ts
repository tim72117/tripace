// mode.ts——首頁縮小島要用哪種模式(純函式,方便測試)。
//   'off'  :不載入、整個島收起(省流量、版位太小、沒有 WebGL)
//   'still':載入但只畫靜止的一幀(使用者設定「減少動態」)
//   'live' :載入並自動旋轉
export type HeroIslandMode = 'off' | 'still' | 'live'

export type ModeInput = {
  saveData: boolean // navigator.connection?.saveData
  webgl: boolean
  sizePx: number // 島容器實際邊長;容器被 CSS 隱藏時是 0
  reducedMotion: boolean
}

// 邊長低於這個值,島小到看不出細節,CSS 也已把它隱藏(見 HomePage.css 的 @container 規則)。
export const MIN_ISLAND_PX = 200

export function heroIslandMode(i: ModeInput): HeroIslandMode {
  if (i.saveData || !i.webgl || i.sizePx < MIN_ISLAND_PX) return 'off'
  return i.reducedMotion ? 'still' : 'live'
}

// 省流量模式(navigator.connection.saveData,不是所有瀏覽器都有)。
export function readSaveData(nav: Navigator = navigator): boolean {
  return (nav as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
}

// 探測 WebGL 是否可用:建一個一次性 canvas 試取 context。結果快取起來(第一次 render 與載入時都會問,
// 每次探測都會建立一個 context,不要重複建)。傳入別的 document(測試用)時不快取。
let probed: boolean | null = null
export function probeWebgl(doc: Document = document): boolean {
  if (doc === document && probed !== null) return probed
  let ok = false
  try {
    const c = doc.createElement('canvas')
    ok = !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    ok = false
  }
  if (doc === document) probed = ok
  return ok
}
