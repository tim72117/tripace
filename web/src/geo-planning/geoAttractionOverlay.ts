import type { GeoAttraction } from '../api'

// AttractionOverlay:單一景點區域的複合 DOM 疊層(光暈 + 圓形地標圖 + 白話標籤),
// 用 google.maps.OverlayView 子類別實作,讓它跟著地圖投影自動換算像素位置。
// 從 GeoOutlineMap.tsx 抽成獨立模組——這裡是純 DOM/Google Maps SDK 操作,
// 不涉及任何 React state,搬移風險最低,但下面這段關於 CSS class 命名的
// 限制務必完整保留(見 onAdd() 內的說明):**這批 class 名稱與
// GeoOutlineMap.module.css 的 :global(.geo-attraction-*) 選擇器是一一
// 對應的固定字串契約,兩邊修改必須同步,不能只改其中一邊**——搬到這個
// 獨立檔案後,兩者在檔案樹上的物理距離變遠,更容易被之後的維護者忽略
// 同步,故此處鄭重重申一次(該限制的完整技術理由見 onAdd() 內的行內
// 註解與 GeoOutlineMap.module.css 開頭的對應說明)。
//
// 這個 class 不能在模組頂層直接 `extends google.maps.OverlayView`——
// extends 子句在 class 宣告當下就會被求值,而 google.maps SDK 是透過
// importLibrary('maps')異步載入的(見 GeoOutlineMap.tsx 建圖的
// useEffect),模組載入的當下 google 這個全域變數還不存在,會直接拋出
// ReferenceError: google is not defined。改用 getAttractionOverlayClass()
// 延後到 SDK 確定載入完成後才定義並快取這個 class(單例,只建一次)。
export type AttractionOverlayInstance = google.maps.OverlayView & {
  setSelected: (selected: boolean) => void
  setCandidate: (candidate: boolean) => void
}

let AttractionOverlayClass:
  | (new (
      attraction: GeoAttraction,
      position: google.maps.LatLng,
      selected: boolean,
      candidate: boolean,
      onClick: (attraction: GeoAttraction) => void,
    ) => AttractionOverlayInstance)
  | null = null

export function getAttractionOverlayClass() {
  if (AttractionOverlayClass) return AttractionOverlayClass

  class AttractionOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null
    private position: google.maps.LatLng
    private selected: boolean
    // candidate:這個景點區域目前是否已經在候選籃裡(見
    // GeoOutlineMap.tsx 的 candidateKeys prop 說明)——跟 selected 是
    // 兩個獨立、可以同時成立的狀態:selected 是「側欄目前點開哪一項的
    // 介紹」,candidate 是「使用者已經把這個景點丟進候選籃」,一個是
    // 暫時的瀏覽焦點、一個是持續累積的規劃結果,不能合併成同一個布林值。
    private candidate: boolean

    constructor(
      private attraction: GeoAttraction,
      position: google.maps.LatLng,
      selected: boolean,
      candidate: boolean,
      private onClick: (attraction: GeoAttraction) => void,
    ) {
      super()
      this.position = position
      this.selected = selected
      this.candidate = candidate
    }

    onAdd() {
      const div = document.createElement('div')
      // 這裡刻意用固定字串(而非 styles.xxx)當 class 名稱:這些 class 是
      // 透過 innerHTML 字串動態組裝出來的 DOM,不是 JSX 裡直接寫
      // className={styles.xxx} 的元素,CSS Modules 只會把「有被 JS 實際
      // 引用到的 local class」雜湊改名並匯出成 styles 物件屬性——但
      // :global()包裹的規則本來就不會被匯出(這正是 :global 的用途:定義
      // 不受雜湊影響的固定 class 名),若誤用 styles.xxx 取值會拿到
      // undefined,等於完全沒套用到任何 class、CSS 規則(尤其是關鍵的
      // position: absolute)整個失效。故這裡與 GeoOutlineMap.module.css
      // 的 :global(.xxx) 選擇器一致,直接寫死字串。
      div.className = [
        'geo-attraction-overlay',
        this.selected && 'geo-attraction-overlay-selected',
        this.candidate && 'geo-attraction-overlay-candidate',
      ].filter(Boolean).join(' ')
      div.innerHTML = `
        <div class="geo-attraction-glow"></div>
        ${
          this.attraction.landmarkPhotoUrl
            ? `<img class="geo-attraction-landmark-photo" src="${this.attraction.landmarkPhotoUrl}" alt="${escapeHtml(this.attraction.landmarkName ?? this.attraction.name)}" loading="lazy" />`
            : `<div class="geo-attraction-landmark-placeholder"></div>`
        }
        <span class="geo-attraction-label">${escapeHtml(this.attraction.name)}</span>
      `
      this.div = div
      const panes = this.getPanes()
      panes?.overlayMouseTarget.appendChild(div)

      // 只在圓形地標圖/佔位圓本身綁點擊(見 module.css 的
      // pointer-events: auto 覆寫),不是整個 overlay 容器——光暈與標籤
      // 文字仍不可點擊,維持「只召喚不強加」,只有具體可辨識的地標本身
      // 才是可互動元素。點下去回報這個景點區域資料,由外層決定怎麼放大
      // (見 GeoOutlineMap.tsx 的 handleAttractionClick)。
      const clickTarget = div.querySelector('.geo-attraction-landmark-photo, .geo-attraction-landmark-placeholder')
      if (clickTarget) {
        clickTarget.addEventListener('click', () => this.onClick(this.attraction))
        // preventMapHitsAndGesturesFrom:讓地圖的拖曳/縮放手勢判斷邏輯
        // 知道「這個元素上的事件是給它自己的,不是給地圖拖曳用的」——
        // overlayMouseTarget pane 本身雖然會把原生 DOM 事件傳給子元素,
        // 但沒有這行的話,Maps 內部的拖曳偵測仍可能在滑鼠按下/放開之間
        // 判斷成一次(即使是原地不動的)拖曳手勢而吃掉 click,導致單純
        // 用 addEventListener('click', ...) 註冊的監聽器不會被觸發。
        // 這是 Google 官方文件建議讓自訂 OverlayView 內元素能可靠接收
        // 點擊的做法,addEventListener 本身要保留(不是被取代)。
        google.maps.OverlayView.preventMapHitsAndGesturesFrom(clickTarget as HTMLElement)
      }
    }

    draw() {
      if (!this.div) return
      const projection = this.getProjection()
      if (!projection) return
      const point = projection.fromLatLngToDivPixel(this.position)
      if (!point) return
      this.div.style.left = `${point.x}px`
      this.div.style.top = `${point.y}px`
    }

    onRemove() {
      this.div?.remove()
      this.div = null
    }

    // setSelected:選取狀態變動時只切換 class,不整個重建 overlay(避免
    // DOM 節點重新掛載造成光暈/照片的 fadeIn 動畫重播、閃爍)。
    setSelected(selected: boolean) {
      this.selected = selected
      if (!this.div) return
      this.div.classList.toggle('geo-attraction-overlay-selected', selected)
    }

    // setCandidate:候選籃狀態變動時只切換 class,理由同 setSelected——
    // 加入/移出候選籃是使用者在側欄操作觸發的,不該讓地圖上其他沒被
    // 動到的景點區域跟著重畫閃爍。
    setCandidate(candidate: boolean) {
      this.candidate = candidate
      if (!this.div) return
      this.div.classList.toggle('geo-attraction-overlay-candidate', candidate)
    }
  }

  AttractionOverlayClass = AttractionOverlay
  return AttractionOverlayClass
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

// maxLevelForZoom:Google Maps zoom 值(數字越大越接近地面)累加式對應到
// 知名度分級(model.Attraction.Level,1=國際~5=在地,見後端型別說明)的
// 顯示上限——縮得越小只顯示越知名的地標,拉近才逐步冒出更細粒度的
// 在地資訊,不會一次全部消失/出現。level 未設定的地標(即時查 Google
// Places、非人工建檔的結果)不受這個篩選影響,見呼叫端的判斷。
export function maxLevelForZoom(zoom: number): number {
  if (zoom <= 10) return 1
  if (zoom <= 11) return 2
  if (zoom <= 13) return 3
  if (zoom <= 14) return 4
  return 5
}

// minZoomForLevel:maxLevelForZoom 的反函式——給定一個知名度分級,回傳
// 「至少要縮放到多少 zoom 才看得到它」的最小 zoom 值。供側欄點擊地點
// 時使用:點一個 5 級(在地級,如「永康商圈」)的地點,若目前 zoom 只有
// 12(對應 maxLevel=3),該點根本不會被畫出來(見 GeoOutlineMap.tsx 的
// filteredAttractions 篩選),必須先把 zoom 拉到 15 以上才看得到,單純
// panTo 平移過去只會移到一個空地圖。數字取自 maxLevelForZoom 每個門檻的
// 下一格,兩者需要保持同步——調整 maxLevelForZoom 的門檻時記得一併更新
// 這裡。這份門檻表在 geoAttractionClick.ts 有一份不依賴 Google Maps
// SDK 的重新匯出版本(供該模組單元測試使用),三處調整時需同步。
export function minZoomForLevel(level: number): number {
  if (level <= 1) return 0
  if (level === 2) return 11
  if (level === 3) return 12
  if (level === 4) return 14
  return 15
}
