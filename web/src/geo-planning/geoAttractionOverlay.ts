import type { GeoAttraction } from '../api'
import { curatedCategoryOf, CURATED_CATEGORY_MAP_CLASS } from './geoCuratedCategoryStub'

// AttractionOverlay:單一景點區域的複合 DOM 疊層(光暈 + 圓形地標圖 + 白話標籤),
// 用 google.maps.OverlayView 子類別實作,讓它跟著地圖投影自動換算像素位置。
// 從 ExploreMap.tsx 抽成獨立模組——這裡是純 DOM/Google Maps SDK 操作,
// 不涉及任何 React state,搬移風險最低,但下面這段關於 CSS class 命名的
// 限制務必完整保留(見 onAdd() 內的說明):**這批 class 名稱與
// ExploreMap.module.css 的 :global(.geo-attraction-*) 選擇器是一一
// 對應的固定字串契約,兩邊修改必須同步,不能只改其中一邊**——搬到這個
// 獨立檔案後,兩者在檔案樹上的物理距離變遠,更容易被之後的維護者忽略
// 同步,故此處鄭重重申一次(該限制的完整技術理由見 onAdd() 內的行內
// 註解與 ExploreMap.module.css 開頭的對應說明)。
//
// 這個 class 不能在模組頂層直接 `extends google.maps.OverlayView`——
// extends 子句在 class 宣告當下就會被求值,而 google.maps SDK 是透過
// importLibrary('maps')異步載入的(見 ExploreMap.tsx 建圖的
// useEffect),模組載入的當下 google 這個全域變數還不存在,會直接拋出
// ReferenceError: google is not defined。改用 getAttractionOverlayClass()
// 延後到 SDK 確定載入完成後才定義並快取這個 class(單例,只建一次)。
export type AttractionOverlayInstance = google.maps.OverlayView & {
  setSelected: (selected: boolean) => void
  setCandidate: (candidate: boolean) => void
  setHovered: (hovered: boolean) => void
  setPhotoUrls: (photoUrls: string[] | undefined) => void
  setHidden: (hidden: boolean) => void
  // setLabelHidden/getLabelEl/getLabelPriority:標籤避讓機制(見
  // useAttractionOverlays.ts 的 resolveLabelCollisions 完整說明)專用——
  // 跟 setHidden 不同,這裡只隱藏標籤文字本身,圓點/縮圖維持可見可點擊,
  // 使用者仍看得到「這裡有一個點」,只是暫時看不到名稱(密集區域縮放
  // 放大後,或拖曳移開重疊的鄰居後,標籤會自動重新顯示)。
  setLabelHidden: (hidden: boolean) => void
  getLabelEl: () => HTMLElement | null
  getVisualEl: () => HTMLElement | null
  getLabelPriority: () => number
  // isHidden:標籤避讓機制(resolveLabelCollisions)排除用——setHidden(true)
  // 只是把 style.visibility 設成 hidden(見該方法完整說明,刻意不用
  // display:none,因為 draw() 仍要持續更新 left/top),但 visibility:hidden
  // 的元素 getBoundingClientRect() 仍會回傳實際尺寸、仍會占掉版面空間,
  // 不像 display:none 那樣直接讓寬高歸零。碰撞偵測若不額外排除,手機版
  // bottom sheet 開啟、主題點被 setHidden(true)收起期間,這個已經看不見
  // 的主題點仍會被當成障礙物,擠掉周邊精選點原本該正常顯示的標籤。
  isHidden: () => boolean
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
    // ExploreMap.tsx 的 candidateKeys prop 說明)——跟 selected 是
    // 兩個獨立、可以同時成立的狀態:selected 是「側欄目前點開哪一項的
    // 介紹」,candidate 是「使用者已經把這個景點丟進候選籃」,一個是
    // 暫時的瀏覽焦點、一個是持續累積的規劃結果,不能合併成同一個布林值。
    private candidate: boolean
    // hovered:僅精選點(見下方 isTheme)使用——使用者滑鼠移到
    // AttractionInfoPanel「附近景點」清單裡對應的項目時暫時為 true,見
    // useAttractionOverlays.ts 同步這個狀態的 effect。主題點永遠忽略這個
    // 欄位(建構時就已經是完整照片呈現,沒有「展開」的必要)。
    private hovered: boolean = false
    // photoUrls:這個景點區域實際要顯示的照片清單,由呼叫端(見
    // useAttractionOverlays.ts)查完 GET /internal(或 /public)/geo/
    // place-details 後透過 setPhotoUrls 寫入(GeoPlaceDetails.googlePhotoUrls,
    // 即時查詢結果,見該欄位的完整說明)——2026-09 使用者明確要求
    // 「不再使用 landmarkPhotoUrl,如果有 place id 則使用 photo_assets
    // 第一張圖」:這個欄位取代原本直接讀 attraction.landmarkPhotoUrl
    // (後端資料庫欄位,建檔當下的舊快照,不受 photo_assets 過期/更新
    // 機制影響)的做法,跟 AttractionInfoPanel.tsx 點開詳情卡後看到的
    // 圖片改用同一套查詢流程與資料來源,不再各自為政。
    //
    // 2026-10 修正:原本這裡存的是單一 photoUrl 字串(GeoPlaceDetails.photoUrl,
    // 即 googlePhotoUrls 的第一張,純粹是向後相容欄位),判斷「有沒有圖」
    // 用這個字串的真假值——改成直接存完整的 googlePhotoUrls 清單,「有沒有
    // 圖」改用清單長度判斷(見下方 renderContent 的 showPhoto/this.photoUrls?.[0]),
    // 不再依賴那個相容欄位,跟 PhotoCarousel.tsx(介紹卡的多圖輪播,同樣
    // 以 googlePhotoUrls 清單長度判斷 0/1/多張的三種呈現)用同一套判斷
    // 依據,地圖縮圖目前仍只顯示清單第一張,但判斷邏輯跟資料來源與介紹卡
    // 完全一致,不再各自維護一個「有沒有圖」的真假值欄位。建構當下沒有
    // placeId 的地點(舊資料,尚未補上 place_id)或還沒查完時維持
    // undefined,顯示 placeholder,不落回任何舊表資料墊底。
    private photoUrls: string[] | undefined = undefined
    // isTheme:主題點/精選點的分級,建構後不會再變動——見下方 onAdd() 對
    // 這個分級如何影響 markup 的完整說明。直接讀 GeoAttraction.isTheme
    // (後端 model.Attraction.IsTheme,見該欄位完整說明),不再用
    // level===1 推斷——level 數字分級已改為只服務 zoom 顯示門檻用途,跟
    // 「是否為主題」是兩個獨立語意,不應該再共用同一個數字欄位判斷。
    private readonly isTheme: boolean
    // hidden:手機版 bottom sheet 開啟期間暫時隱藏這個 overlay(見
    // setHidden 的完整說明)——跟 selected/candidate 一樣必須先存成欄位、
    // 不能只在 div 已存在時才生效:onAdd() 是 Google Maps SDK 非同步才
    // 呼叫(setMap() 之後下一個 frame 才真正建立 div),若呼叫端在
    // setMap() 剛呼叫完、div 還沒建好的這段空窗期呼叫 setHidden(true),
    // 當時 this.div 是 null,若不記住這個意圖,div 建好後只會依預設顯示
    // 出來,呼叫端其實看不出這次呼叫「被吃掉了」(2026-10 實測踩過:
    // 手機版點擊主題點時 overlay 剛好正在這段重建空窗期,setHidden 完全
    // 無效,地圖上主題點沒有消失)。
    private hidden: boolean = false

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
      this.isTheme = attraction.isTheme
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
      // position: absolute)整個失效。故這裡與 ExploreMap.module.css
      // 的 :global(.xxx) 選擇器一致,直接寫死字串。
      div.className = [
        'geo-attraction-overlay',
        // geo-attraction-overlay-theme:2026-10 新增——主題點永遠顯示
        // 完整照片(見下方 renderContent() 的 showPhoto 判斷),跟「被
        // hover 暫時展開的精選點」共用完全相同的 markup
        // (.geo-attraction-landmark-photo),CSS 原本無法單純用 class
        // 區分兩者,主題點縮圖的 z-index 因此跟一般未展開精選點圓點
        // 同層級(都是 2),只能看 DOM 順序決定誰蓋過誰——使用者實測
        // 回報「主題點縮圖還是被小點覆蓋」,根因就是主題點身份完全沒有
        // 反映在 CSS 層級裡。這個 class 建構時就固定(不像 selected/
        // candidate/hovered 會隨使用者互動變動),讓 ExploreMap.module.css
        // 能明確針對「主題點」給一個固定的、比一般精選點更高的 z-index
        // (見該檔案 .geo-attraction-overlay-theme 的完整說明),不依賴
        // hover/selected 等需要互動才會觸發的狀態。
        this.isTheme && 'geo-attraction-overlay-theme',
        this.selected && 'geo-attraction-overlay-selected',
        this.candidate && 'geo-attraction-overlay-candidate',
      ].filter(Boolean).join(' ')
      div.style.visibility = this.hidden ? 'hidden' : ''
      this.div = div
      this.updateContainerZIndex()
      this.renderContent()
      const panes = this.getPanes()
      panes?.overlayMouseTarget.appendChild(div)
    }

    // renderContent:依 isTheme/hovered 組出 innerHTML 並重新綁定點擊——
    // 主題點(isTheme===true)一律畫完整的光暈+圓形地標圖(或無照片時的
    // 佔位圓)+白話標籤。精選點(isTheme===false,見 useAttractionOverlays.ts
    // 對這個分級的完整說明)預設只畫散策羅盤那種輕量的圓點
    // (geo-attraction-curated-dot),不帶照片,理由是精選點數量可能一次
    // 揭露一整批(見 revealedAttractionNames),若每個都用跟主題點同等
    // 份量的照片縮圖呈現,會搶過主題點本身的視覺焦點,失去「主題點才是
    // 主角、精選點是環繞的衛星」這個散策羅盤的核心視覺隱喻——只有使用者
    // 滑鼠移到「附近景點」清單對應項目時(hovered),才臨時升級成跟主題點
    // 同樣的完整照片呈現(不含光暈,理由同 setHovered 的說明),滑開後
    // 立刻收回圓點,讓地圖上的視覺重點永遠是「使用者當下感興趣的那一個」
    // 而非一次攤開一整批照片。
    //
    // 每次呼叫都重新設定 innerHTML(而非像 setSelected/setCandidate 只切
    // class),是因為圓點/照片兩種狀態的 DOM 結構本身不同(圓點沒有 img
    // 元素),不是單純的樣式差異——但只有 setHovered 真的觸發狀態改變時
    // 才會呼叫,實際觸發頻率很低(同一時間通常只有一個精選點被滑到),
    // 不會像「所有 overlay 依賴陣列變動」那樣大量重繪。
    private renderContent() {
      if (!this.div) return
      const showPhoto = this.isTheme || this.hovered
      // 圓點分類配色:見 geoCuratedCategoryStub.ts 的完整說明——優先讀
      // 後端 category 欄位,查無對應分類時圓點退回基底 class
      // (ExploreMap.module.css 的 --ios-sand 預設色),不額外附加
      // modifier class。
      const category = curatedCategoryOf(this.attraction.category)
      const dotClass = [
        'geo-attraction-curated-dot',
        category && CURATED_CATEGORY_MAP_CLASS[category],
      ].filter(Boolean).join(' ')
      this.div.innerHTML = showPhoto
        ? `
        ${this.isTheme ? '<div class="geo-attraction-glow"></div>' : ''}
        ${
          this.photoUrls && this.photoUrls.length > 0
            ? `<img class="geo-attraction-landmark-photo" src="${this.photoUrls[0]}" alt="${escapeHtml(this.attraction.landmarkName ?? this.attraction.name)}" loading="lazy" />`
            : `<div class="geo-attraction-landmark-placeholder"></div>`
        }
        <span class="geo-attraction-label">${escapeHtml(this.attraction.name)}</span>
      `
        : `
        <div class="${dotClass}"></div>
        <span class="geo-attraction-label">${escapeHtml(this.attraction.name)}</span>
      `

      // 在圓形地標圖/佔位圓/精選點圓點與文字標籤本身綁點擊(見 module.css
      // 的 pointer-events: auto 覆寫),不是整個 overlay 容器——光暈仍
      // 不可點擊(純裝飾,沒有對應的可辨識地標語意)。2026-10 使用者明確
      // 要求文字標籤也要能點開(原本只有圖示/圓點可點,理由是「只召喚
      // 不強加」,但使用者點擊習慣上會直接點文字,排除掉反而像沒反應),
      // 故把 .geo-attraction-label 併入點擊目標,主題點/精選點皆適用。
      // 點下去回報這個景點區域資料,由外層決定怎麼放大(見 ExploreMap.tsx
      // 的 handleAttractionClick)。innerHTML 每次重設都會拿掉舊的監聽器,
      // 故每次 renderContent() 都要重新綁定;querySelectorAll 回傳
      // NodeList,要對每個 target 各自綁一次,不是單一 Element。
      const clickTargets = this.div.querySelectorAll(
        '.geo-attraction-landmark-photo, .geo-attraction-landmark-placeholder, .geo-attraction-curated-dot, .geo-attraction-label',
      )
      clickTargets.forEach((clickTarget) => {
        clickTarget.addEventListener('click', () => this.onClick(this.attraction))
        // 2026-08:原本這裡呼叫 google.maps.OverlayView.preventMapHitsAndGesturesFrom
        // (Google 官方文件建議讓自訂 OverlayView 內元素能可靠接收點擊的
        // 做法)——但官方文件同時記載這個 API 連 wheel(滑鼠滾輪)事件都會
        // 一併攔截,不只是點擊/拖曳,導致使用者滑鼠停在地標圖示/圓點正
        // 上方時完全無法縮放地圖(使用者實測回報)。曾經試過兩種補救方式
        // 都失敗:(1)自己算縮放後該把地圖中心挪到哪重現「對齊游標」效果,
        // 位置算錯;(2)把 wheel 事件原封不動 dispatchEvent 轉發給
        // map.getDiv(),疑似因為是合成事件(isTrusted: false)或轉發目標
        // 不是 Maps 內部真正掛監聽器的那層,導致完全接收不到、縮放整個
        // 失效。
        //
        // 改用更保守的做法:不整批攔截,只針對「拖曳手勢誤判吃掉 click」
        // 這個原始問題本身動手——真正會被 Maps 內部拖曳偵測誤判的是
        // mousedown/touchstart(滑鼠按下/觸控開始,拖曳判定從這裡起算),
        // 不是 wheel,也不是 click 本身(click 監聽器掛在同一個元素上,
        // 不受這裡的 stopPropagation 影響,一定會觸發)。只擋這兩個事件
        // 冒泡到地圖,讓 wheel 完全不被觸碰、維持 100% 原生瀏覽器事件
        // (真正的 isTrusted: true 事件,不依賴合成事件是否被 Maps 內部
        // 邏輯接受),縮放位置自然正確,不需要自己重新推導投影數學或猜測
        // Maps 內部監聽器掛在哪一層。
        clickTarget.addEventListener('mousedown', (e) => e.stopPropagation())
        clickTarget.addEventListener('touchstart', (e) => e.stopPropagation())
      })

      // renderContent() 每次都會整個重設 innerHTML,標籤是全新的 DOM
      // 節點,若這個景點當下正因為標籤避讓機制而隱藏標籤(見 labelHidden
      // 欄位),必須在這裡重新套用,否則重繪瞬間(例如 setHovered 切換
      // 圓點→照片)會讓已隱藏的標籤意外重新冒出來一瞬間。
      if (this.labelHidden) {
        const label = this.getLabelEl()
        if (label) label.style.visibility = 'hidden'
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

    // getLabelEl:標籤避讓機制(見 useAttractionOverlays.ts 的
    // resolveLabelCollisions)量測碰撞範圍用——每次 renderContent()
    // 重設 innerHTML 都會產生全新的標籤節點,不能在建構時快取一次就
    // 固定下來,故改成即時查詢,呼叫端自己決定多久查一次。
    getLabelEl(): HTMLElement | null {
      return this.div?.querySelector('.geo-attraction-label') ?? null
    }

    // getVisualEl:標籤避讓機制量測碰撞範圍用——2026-10 修正:原本碰撞
    // 偵測只比對「標籤跟標籤」,沒有涵蓋「圓點/縮圖本身跟其他景點標籤」
    // 的重疊(使用者實測回報「縮圖還是被文字標籤覆蓋」「也都還是被小點
    // 蓋住」:某個精選點被 hover 展開成 56px 照片時,物理範圍變大,常常
    // 跟旁邊未展開精選點的小圓點(或其標籤)重疊,但舊版判斷完全沒把這種
    // 跨類型(縮圖↔標籤、縮圖↔縮圖)重疊納入考慮)。這裡回傳「整個可辨識
    // 地標視覺」(圓形地標圖/佔位圓/精選點圓點,不含光暈——光暈本來就是
    // 故意會跟鄰居重疊的裝飾效果,見該處完整說明,不需要也不該參與避讓),
    // 呼叫端拿這個範圍跟其他景點的 getVisualEl()/getLabelEl() 一起比對,
    // 只要有任何重疊就可能需要避讓,不分是撞到點還是撞到字。
    getVisualEl(): HTMLElement | null {
      return this.div?.querySelector(
        '.geo-attraction-landmark-photo, .geo-attraction-landmark-placeholder, .geo-attraction-curated-dot',
      ) ?? null
    }

    // setLabelHidden:標籤避讓機制偵測到跟其他景點標籤重疊、且這個景點
    // 優先序較低時呼叫——只切 style.visibility,不影響圓點/縮圖本身的
    // 顯示與可點擊性(理由同 setHidden 的說明:暫時收起、之後要能原樣
    // 恢復,不走 onRemove 那條路徑)。每次 renderContent() 重建 innerHTML
    // 後標籤節點是新的,必須重新套用這個狀態,故這裡也記成欄位,在
    // renderContent() 結尾一併套用(見該方法結尾的呼叫)。
    private labelHidden = false
    setLabelHidden(hidden: boolean) {
      this.labelHidden = hidden
      const label = this.getLabelEl()
      if (label) label.style.visibility = hidden ? 'hidden' : ''
    }

    // getLabelPriority:標籤避讓機制排序用——數字越大代表重疊時越優先
    // 保留。主題點(isTheme)固定最高(100,散策羅盤的主角,不應該因為
    // 精選點標籤密集而被犧牲);hovered/selected/candidate 次之(60,
    // 使用者當下明確感興趣或已加入候選的,比單純路過的精選點重要);其餘
    // 精選點最低(0),彼此之間重疊時目前不細分先後(見呼叫端排序的完整
    // 說明,相同優先序時改用穩定的既有規則,例如陣列順序)。
    // 2026-10 修正:優先序順序對調過一次——原本主題點(100)固定贏過
    // hovered/selected/candidate(60),但這跟 ExploreMap.module.css 的
    // z-index 語意(.geo-attraction-overlay-theme 固定 2.5,hovered 等
    // 互動狀態固定 3,互動狀態贏過主題點)矛盾,兩套機制各自判斷出不同
    // 的「誰該蓋過誰」會造成「JS 覺得這個標籤該顯示,但 CSS 層級卻讓
    // 另一個縮圖疊在它上面」這種視覺與避讓結果對不上的情況。改成跟
    // CSS 一致:使用者當下正在互動的精選點(hovered/selected/candidate)
    // 優先序最高,主題點次之,其餘一般精選點最低——理由見
    // ExploreMap.module.css .geo-attraction-overlay-theme 規則的完整
    // 說明:主題點永遠是散策羅盤的主角,預設該蓋過一般精選點,但使用者
    // 明確點開/hover 某個精選點時,那個精選點的即時回饋該優先顯示。
    getLabelPriority(): number {
      if (this.selected || this.hovered || this.candidate) return 100
      if (this.isTheme) return 60
      return 0
    }

    // updateContainerZIndex:2026-10 新增,修正一個比子層 z-index class
    // 更根本的問題——.geo-attraction-overlay(每個景點 overlay 的根容器)
    // 用 transform: translate(...)做置中定位(見 ExploreMap.module.css
    // 該 class 的說明),而 transform 只要不是 none,就會強制讓這個元素
    // 建立新的 stacking context,不管有沒有設定 z-index。這代表每個
    // overlay 容器都是各自獨立的 stacking context,子層(縮圖/圓點/
    // 標籤)原本設計的 10/20/30/40/50 分層,只在「同一個 overlay 容器
    // 內部」(縮圖 vs 自己的標籤)有意義,完全無法跨到「另一個 attraction
    // 的 overlay 容器」去比較——決定兩個不同景點誰的整組疊層蓋過誰的,
    // 其實是它們各自的 overlay 容器(這一層)在共同父層 stacking context
    // 裡的順序,而容器本身原本完全沒有設定 z-index(維持 auto),退回
    // DOM 順序決勝負,跟子層精心設計的分層完全無關(使用者實測回報
    // 「文學館的縮圖 z-index 50 卻被消防史料館的圓點 z-index 20 蓋住」,
    // 根因就是這兩個 50/20 從未真正被拿來互相比較過)。
    //
    // 修法:容器本身也要有明確的 z-index,決定哪個景點的整組疊層該蓋過
    // 哪個——優先序計算沿用 getLabelPriority() 同一套邏輯(hover/
    // selected/candidate > 主題點 > 一般精選點),乘以 10 對齊子層
    // 數值系統(子層最高用到 50),之後在容器內部才由子層的 10/20/30/
    // 40/50 決定縮圖/圓點/標籤的相對順序——兩層 z-index 分工:這裡決定
    // 「哪個景點」優先,子層決定「同一個景點內部」縮圖/圓點/標籤誰蓋過
    // 誰,兩者互不衝突。
    private updateContainerZIndex() {
      if (!this.div) return
      this.div.style.zIndex = String(this.getLabelPriority())
    }

    // setSelected:選取狀態變動時只切換 class,不整個重建 overlay(避免
    // DOM 節點重新掛載造成光暈/照片的 fadeIn 動畫重播、閃爍)。
    setSelected(selected: boolean) {
      this.selected = selected
      if (!this.div) return
      this.div.classList.toggle('geo-attraction-overlay-selected', selected)
      this.updateContainerZIndex()
    }

    // setCandidate:候選籃狀態變動時只切換 class,理由同 setSelected——
    // 加入/移出候選籃是使用者在側欄操作觸發的,不該讓地圖上其他沒被
    // 動到的景點區域跟著重畫閃爍。
    setCandidate(candidate: boolean) {
      this.candidate = candidate
      if (!this.div) return
      this.div.classList.toggle('geo-attraction-overlay-candidate', candidate)
      this.updateContainerZIndex()
    }

    // setHovered:主題點永遠 no-op(見 isTheme 的說明,建構後已經是完整
    // 照片呈現,沒有「展開」的必要)。精選點才需要重繪 innerHTML(圓點↔
    // 照片兩種 DOM 結構不同,不是切 class 能表達的差異,見 renderContent
    // 的完整說明)——值沒有真的改變時提早跳出,避免使用者滑鼠在同一個
    // 圓點上小幅移動時重複觸發不必要的 DOM 重建。額外切換
    // geo-attraction-overlay-hovered class(見 module.css 的完整說明)
    // 把整組地標拉到最上層——這個觸發來源(附近景點清單 hover)游標實際
    // 不在地圖上,無法靠 CSS :hover 判斷,必須用 JS 主動切 class。
    setHovered(hovered: boolean) {
      if (this.isTheme || this.hovered === hovered) return
      this.hovered = hovered
      this.div?.classList.toggle('geo-attraction-overlay-hovered', hovered)
      this.updateContainerZIndex()
      this.renderContent()
    }

    // setPhotoUrls:查詢完成(或查無/失敗回傳 undefined)後由呼叫端寫入
    // 實際要顯示的照片清單(見上方 photoUrls 欄位的完整說明)——值真的
    // 改變時才重繪,理由同 setHovered:overlay 建構當下、查詢還沒回來
    // 之前會先呼叫一次 setPhotoUrls(undefined)(見
    // useAttractionOverlays.ts 的查詢 effect),此時 this.photoUrls 本來
    // 就是 undefined,不該觸發一次沒有意義的重繪。只有在 showPhoto 為
    // true(主題點,或精選點目前正被 hover)時,photoUrls 的變化才會真的
    // 反映在畫面上,但這裡不做這層判斷——精選點未 hover 時呼叫這個方法
    // 只是單純更新內部欄位、不重繪,之後真的被 hover 時 renderContent
    // 自然會讀到最新值,不需要在這裡分成兩種情境處理。用參照比較(而非
    // 深比陣列內容)判斷是否跳過重繪即可——呼叫端(useAttractionOverlays.ts)
    // 每次查詢只會產生一個新的 googlePhotoUrls 陣列參照,不會原地重複呼叫
    // 同一個參照兩次。
    setPhotoUrls(photoUrls: string[] | undefined) {
      if (this.photoUrls === photoUrls) return
      this.photoUrls = photoUrls
      this.renderContent()
    }

    // setHidden:手機版點開主題點的 bottom sheet 期間,暫時隱藏地圖上這個
    // overlay 本身(見 useAttractionOverlays.ts 呼叫端說明)——只切
    // style.visibility,不走 onRemove()/div=null 那條路徑,理由是這裡是
    // 「暫時收起、之後要能原樣恢復」的情境,onRemove 是生命週期結束時的
    // 一次性清理,重新呼叫 onAdd 會重建 DOM 並重播 fadeIn 動畫、閃爍。
    // 用 visibility 而非 display:none,是因為 draw() 仍會持續被 Maps
    // SDK 呼叫、持續更新 style.left/top,display:none 不影響這個計算但
    // visibility:hidden 語意更準確表達「仍在版面上,只是不可見」,且兩者
    // 都會一併移除點擊互動,不需要額外處理 pointer-events。
    // 比照 setSelected/setCandidate:先存成 this.hidden 欄位,再檢查
    // div 是否已存在——onAdd() 是 Google Maps SDK 非同步才呼叫,呼叫端
    // 可能在 setMap() 剛執行完、div 還沒建好的空窗期就呼叫這個方法(見
    // 上方 hidden 欄位的完整說明),若不記住這個意圖,div 建好時(onAdd
    // 內已補上套用,見該處)就會遺漏這次呼叫。
    setHidden(hidden: boolean) {
      this.hidden = hidden
      if (!this.div) return
      this.div.style.visibility = hidden ? 'hidden' : ''
    }

    isHidden(): boolean {
      return this.hidden
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
// 12(對應 maxLevel=3),該點根本不會被畫出來(見 ExploreMap.tsx 的
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
