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
  // setFocused:2026-10 新增,ScrollTimeline.tsx 嵌入式小地圖專用(見
  // 下方 focused 欄位的完整說明)——跟 setSelected 是完全獨立的兩個狀態,
  // 不共用、不覆寫。
  setFocused: (focused: boolean) => void
  // setThemePhotoCollapsed:2026-10 新增,同樣是 ScrollTimeline.tsx 嵌入式
  // 小地圖專用(見下方 themePhotoCollapsed 欄位的完整說明)——主題點
  // 「目前不是時間軸聚焦的那個主題」時退化成素色小圓點。精選點永遠
  // no-op;既有呼叫端從不呼叫,預設 false 時渲染邏輯一字不變。
  setThemePhotoCollapsed: (collapsed: boolean) => void
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

// THEME_PHOTO_FADE_OUT_MS:主題點照片收起時幽靈複本的淡出時長(見
// setThemePhotoCollapsed/mountThemePhotoGhosts)——只拿來當 animationend
// 沒觸發時的 setTimeout 保底基準,實際動畫時長定義在 ExploreMap.module.css
// 的 .geo-attraction-landmark-ghost/.geo-attraction-glow-fading,兩邊要
// 一起改(這裡只要 >= CSS 的值即可,略大無妨)。
const THEME_PHOTO_FADE_OUT_MS = 240

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
    // focused:2026-10 新增,僅精選點(isTheme===false)使用——「這個精選點
    // 目前是 ScrollTimeline.tsx 捲動時間軸聚焦的那個錨點」(錨點的 center
    // 座標剛好跟這個精選點座標相同,見 InteractiveExploreMap.tsx 的
    // focusedAttractionId 推導)。true 時整個標記改用「深紅色淚滴形圖釘」
    // 造型(見 renderContent() 的 renderFocusedPin 分支),取代預設的
    // 分類色圓點/hover 展開照片。(2026-10 第二版:原本是素色小圓點+
    // 靶心三態,使用者附截圖明確要求改成經典地圖大頭針——上圓下尖、
    // 圓心挖一個白色小孔——的樣式。)
    //
    // 刻意是一個跟 selected 完全獨立的新欄位,不重用 selected:selected
    // 是全站共用的「側欄目前選中哪個候選景點」語意(DesktopLayout.tsx
    // 正式行程規劃功能在用),若把 selected && !isTheme 的視覺直接改成
    // 這套圖釘,正式功能的候選景點選取視覺會跟著變,是不能接受的副作用。
    // focused 只是「要不要切換成圖釘造型」的開關;切換之後圖釘本身的
    // base/hover/selected 三態,仍沿用既有的 hovered/selected 兩個布林值
    // 決定(見 renderFocusedPin()),不另外發明一套狀態。預設 false,除了
    // ScrollTimeline 這條路徑以外的所有呼叫端(九份/京都/台南正式城市頁、
    // DesktopLayout.tsx)從不呼叫 setFocused,渲染邏輯完全維持原樣。
    private focused: boolean = false
    // focusedPinEntrancePending:下一次 renderFocusedPin() 要不要播「圖釘
    // 落下」進場動畫——只在 setFocused(true) 時立起(含 onAdd 之前的空窗
    // 期:div 建好時 onAdd → renderContent 會消耗掉它),第一次畫出圖釘
    // 時消耗歸零。理由:renderContent() 每次都整個重設 innerHTML,動畫
    // 會從頭播,若不記住「已經進場過」,hover/selected 切換、setPhotoUrls
    // 等其他原因觸發的重繪都會讓圖釘再掉一次;進場動畫的語意是「這一站
    // 剛被時間軸點到」,只該在聚焦切換到這顆點的那一刻播一次。
    private focusedPinEntrancePending: boolean = false
    // themePhotoCollapsed:2026-10 新增,僅主題點(isTheme===true)使用——
    // 「這個主題點目前不是 ScrollTimeline.tsx 時間軸聚焦的那個主題」
    // (見 useAttractionOverlays.ts 的 themePhotoOnlyWhenFocused/
    // focusedThemeId 完整說明)。true 時主題點不再恆顯示圓形照片光暈,
    // 退化成跟一般未 hover 精選點完全相同的素色小圓點
    // (.geo-attraction-curated-dot,含分類配色),只有被 hover 時才臨時
    // 升級成照片(對齊精選點「hover 臨時升級成照片」的既有慣例,見
    // renderContent() 的 showPhoto 判斷)。
    //
    // 這是純 opt-in 的新行為:預設 false,只有 InteractiveExploreMap.tsx
    // 開了 themePhotoOnlyWhenFocused prop(目前僅 ScrollTimeline.tsx 開)
    // 才會透過 setThemePhotoCollapsed 寫成 true。九份/京都/台南/首頁/
    // DesktopLayout.tsx 等所有既有呼叫端從不呼叫,主題點繼續維持
    // 「恆顯示圓形照片」的既有行為,一個字都不變。
    private themePhotoCollapsed: boolean = false
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
        // geo-attraction-overlay-focused:見 focused 欄位說明——跟 hidden
        // 一樣要先存欄位、div 建好時再補套用(setFocused 可能在 onAdd
        // 之前的空窗期就被呼叫)。
        this.focused && !this.isTheme && 'geo-attraction-overlay-focused',
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
      // focused 且為精選點:整個標記換成淚滴圖釘造型(見 focused 欄位
      // 與 renderFocusedPin 的完整說明)。放在最前面提早分流,下方既有的
      // 圓點/照片渲染邏輯對 focused===false(所有既有呼叫端)完全不變。
      if (this.focused && !this.isTheme) {
        this.renderFocusedPin()
        this.bindClickTargets()
        this.reapplyLabelHidden()
        return
      }
      // showPhoto:主題點恆顯示照片、精選點只在 hover 時顯示——這是所有
      // 既有呼叫端依賴的規則。2026-10 補上 themePhotoCollapsed(見該欄位
      // 說明,純 opt-in,預設 false):被收起的主題點改成跟精選點同一套
      // 「只有 hover 才顯示照片」規則。themePhotoCollapsed 為 false 時
      // 整條判斷式等價於原本的 this.isTheme || this.hovered。
      // showGlow:光暈只給「完整狀態的主題點」——被收起的主題點 hover
      // 時臨時升級成照片,比照精選點 hover(不含光暈,理由見 setHovered
      // 說明),它此刻的角色就是「暫時被看一眼的衛星」而非主角。
      const showPhoto = (this.isTheme && !this.themePhotoCollapsed) || this.hovered
      const showGlow = this.isTheme && !this.themePhotoCollapsed
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
        ${showGlow ? '<div class="geo-attraction-glow"></div>' : ''}
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

      this.bindClickTargets()
      this.reapplyLabelHidden()
    }

    // renderFocusedPin:2026-10 新增(第二版,取代原本的素色小圓點+靶心
    // 三態)——ScrollTimeline.tsx 嵌入式小地圖「聚焦錨點剛好對應到地圖上
    // 既有精選點」時,那個精選點改畫的深紅色淚滴形圖釘:上半部實心圓、
    // 下半部收尖指向地面,圓心挖一個卡片白小孔(經典地圖大頭針,使用者
    // 附截圖明確指定這個樣式)。造型本身跟圓點/照片圓完全不同族,存在感
    // 已經足夠表達「這一顆是時間軸正在講的那一站」,三態只做輕量層次、
    // 不再疊光暈/漣漪那套:
    //   - base:圖釘本體 + 中心孔。
    //   - hover:同一支圖釘,CSS 以尖端為軸微放大(見 module.css 的
    //     .geo-attraction-focused-pin-hover),表達「滑過」。
    //   - selected:圖釘尖端下方多一圈扁橢圓「落地環」(accent 描邊),
    //     表達「釘住了」;中心孔不變。跟 hover 用不同維度(放大 vs 落地環)
    //     而非色相區分——地圖上「換色 = 換類別」是既有語言(分類圓點配色)。
    //     selected 優先於 hover:已經錨定的東西不該因滑鼠經過而變。
    //
    // 畫布固定 24x32(viewBox 同),落地環畫在畫布外(overflow visible):
    // 三種狀態 layout box 完全相同,.geo-attraction-overlay 用
    // translate(-50%,-100%) 以整組視覺置中/底部錨定座標,若畫布尺寸隨
    // 狀態變化,尖端會跟著跳位。圖釘尖端落在畫布底邊正中(12,31),即
    // 原本 14px 圓點底邊的位置——跟鄰居圓點/照片圓用同一套「視覺底邊貼
    // 座標、標籤掛在下方」的版面規則,不另外為圖釘重算錨點。
    //
    // 取色:不寫死色碼,直接用 inline style 讀 CSS 變數——--color-accent
    // (圖釘本體;base-ui.css 定義為硃紅 #8B3A2F、對齊城市頁的
    // --vermilion,深淺色模式各自有值,正是截圖那種深紅/磚紅色調,不需要
    // 另立 token)、--ios-card(中心孔/描邊,對齊既有圓點的 border 色,在
    // 深色底圖上才有對比)。SVG presentation attribute(fill="...")不接受
    // var(),必須寫在 style 屬性裡才會解析 CSS 變數;透明度另外用
    // stroke-opacity attribute 表達(token 值不能進 rgba())。
    //
    // 進場動畫(.geo-attraction-focused-pin-enter,@keyframes 與
    // prefers-reduced-motion 退化定義在 ExploreMap.module.css 的 :global
    // 區塊)只在 setFocused(true) 後的第一次渲染掛上(見
    // focusedPinEntrancePending 欄位說明)——圖釘從上方落下、落定,是
    // 「時間軸剛點到這一站」的一次性回饋;hover/selected 切換或其他原因
    // 的重繪不重播。
    private renderFocusedPin() {
      if (!this.div) return
      const state: 'base' | 'hover' | 'selected' = this.selected ? 'selected' : this.hovered ? 'hover' : 'base'
      const entering = this.focusedPinEntrancePending
      this.focusedPinEntrancePending = false
      const accent = 'var(--color-accent)'
      const card = 'var(--ios-card)'
      const svgClass = [
        'geo-attraction-focused-pin',
        state === 'hover' && 'geo-attraction-focused-pin-hover',
        state === 'selected' && 'geo-attraction-focused-pin-selected',
        entering && 'geo-attraction-focused-pin-enter',
      ].filter(Boolean).join(' ')
      // 落地環:只在 selected 畫,放在圖釘本體之前(DOM 順序在下層),
      // 尖端壓在環的正中央。環的視覺是「圖釘釘進地面的那一圈」,扁橢圓
      // 模擬透視。
      const groundRing = state === 'selected'
        ? `<ellipse cx="12" cy="31" rx="7" ry="2.6" fill="none" stroke-width="1.5" stroke-opacity="0.55" style="stroke:${accent}"/>`
        : ''
      // 圖釘本體路徑:圓心 (12,11) 半徑 10,兩側以貝茲曲線收到尖端 (12,31)。
      const pinPath =
        'M12 31 C12 31 2 18.5 2 11 A10 10 0 1 1 22 11 C22 18.5 12 31 12 31 Z'
      this.div.innerHTML = `
        <svg class="${svgClass}" xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32" overflow="visible" style="overflow:visible">
          ${groundRing}
          <path d="${pinPath}" stroke-width="1.5" stroke-linejoin="round" style="fill:${accent};stroke:${card}"/>
          <circle cx="12" cy="11" r="4" style="fill:${card}"/>
        </svg>
        <span class="geo-attraction-label">${escapeHtml(this.attraction.name)}</span>
      `
    }

    // bindClickTargets:在圓形地標圖/佔位圓/精選點圓點/focused 圖釘與
    // 文字標籤本身綁點擊(見 module.css 的 pointer-events: auto 覆寫),
    // 不是整個 overlay 容器——光暈仍不可點擊(純裝飾,沒有對應的可辨識
    // 地標語意)。2026-10 使用者明確要求文字標籤也要能點開(原本只有
    // 圖示/圓點可點,理由是「只召喚不強加」,但使用者點擊習慣上會直接點
    // 文字,排除掉反而像沒反應),故把 .geo-attraction-label 併入點擊目標,
    // 主題點/精選點皆適用。點下去回報這個景點區域資料,由外層決定怎麼
    // 放大(見 ExploreMap.tsx 的 handleAttractionClick)。innerHTML 每次
    // 重設都會拿掉舊的監聽器,故每次 renderContent() 都要重新綁定;
    // querySelectorAll 回傳 NodeList,要對每個 target 各自綁一次,不是
    // 單一 Element。
    private bindClickTargets() {
      if (!this.div) return
      const clickTargets = this.div.querySelectorAll(
        '.geo-attraction-landmark-photo, .geo-attraction-landmark-placeholder, .geo-attraction-curated-dot, .geo-attraction-focused-pin, .geo-attraction-label',
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
    }

    // reapplyLabelHidden:renderContent() 每次都會整個重設 innerHTML,
    // 標籤是全新的 DOM 節點,若這個景點當下正因為標籤避讓機制而隱藏標籤
    // (見 labelHidden 欄位),必須重新套用,否則重繪瞬間(例如 setHovered
    // 切換圓點→照片)會讓已隱藏的標籤意外重新冒出來一瞬間。
    private reapplyLabelHidden() {
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
        '.geo-attraction-landmark-photo, .geo-attraction-landmark-placeholder, .geo-attraction-curated-dot, .geo-attraction-focused-pin',
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
    // 2026-10:focused(ScrollTimeline 聚焦的精選點,見 focused 欄位說明)
    // 併入最高優先序——它是「時間軸正在講的那一站」,標籤不該被鄰居擠掉;
    // 既有呼叫端 focused 恆為 false,這條判斷對它們不產生任何影響。
    getLabelPriority(): number {
      if (this.selected || this.hovered || this.candidate || (this.focused && !this.isTheme)) return 100
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
    //
    // 2026-10 補充:themePhotoCollapsed(見該欄位說明,純 opt-in)為 true
    // 的主題點此刻長得跟精選點一樣是小圓點,hover 要能像精選點一樣臨時
    // 升級成照片,故 no-op 條件從「isTheme」收窄成「isTheme 且尚未被
    // 收起」。既有呼叫端 themePhotoCollapsed 恆為 false,對它們而言這條
    // 判斷跟原本的 isTheme no-op 完全等價(欄位、class、z-index、重繪
    // 一樣都不碰)。
    setHovered(hovered: boolean) {
      if ((this.isTheme && !this.themePhotoCollapsed) || this.hovered === hovered) return
      this.hovered = hovered
      this.div?.classList.toggle('geo-attraction-overlay-hovered', hovered)
      this.updateContainerZIndex()
      this.renderContent()
    }

    // setFocused:2026-10 新增(見 focused 欄位的完整說明)——主題點永遠
    // no-op(主題點恆顯示照片光暈,沒有「換成小圓點」這回事),值沒有真的
    // 改變時提早跳出。切換 geo-attraction-overlay-focused class 讓
    // ExploreMap.module.css 能針對這個狀態調整層級,並重繪 innerHTML
    // (小圓點 SVG 跟既有圓點/照片是不同 DOM 結構,不是切 class 能表達的
    // 差異,理由同 setHovered)。比照 setHidden,先存欄位再檢查 div 是否
    // 存在——呼叫端可能在 onAdd() 之前的空窗期就呼叫,div 建好時 onAdd
    // 會自行補套用 class 並 renderContent()。
    setFocused(focused: boolean) {
      if (this.isTheme || this.focused === focused) return
      this.focused = focused
      // 進入聚焦時立起進場旗標,由接下來第一次 renderFocusedPin() 消耗
      // (div 尚未建好時由 onAdd → renderContent 消耗),見該欄位說明。
      this.focusedPinEntrancePending = focused
      if (!this.div) return
      this.div.classList.toggle('geo-attraction-overlay-focused', focused)
      this.updateContainerZIndex()
      this.renderContent()
    }

    // setThemePhotoCollapsed:2026-10 新增(見 themePhotoCollapsed 欄位的
    // 完整說明)——精選點永遠 no-op(它本來就是小圓點,沒有「收起照片」
    // 這回事),值沒有真的改變時提早跳出(既有呼叫端從不呼叫;即使被
    // 呼叫 false 也會在這裡跳出,不觸發任何重繪)。收起/展開是圓點↔照片
    // 兩種 DOM 結構的切換,必須重繪 innerHTML(理由同 setHovered)。比照
    // setHidden/setFocused,先存欄位再檢查 div 是否存在——呼叫端可能在
    // onAdd() 之前的空窗期就呼叫,div 建好時 onAdd 會自行 renderContent()。
    //
    // 收起時若這個主題點正處於 hovered(被收起前不可能,因為完整主題點
    // 的 setHovered 是 no-op;但展開→收起→hover→展開→收起這種序列下,
    // hovered 欄位可能殘留 true),展開期間 setHovered(false) 會因為
    // 「完整主題點 no-op」而被擋掉,hovered 殘留到下次收起就會誤顯示照片
    // ——故展開(collapsed=false)時一併把 hovered 歸零並拿掉 hovered
    // class,確保完整主題點的狀態跟從未被 hover 過完全一致。
    //
    // 收起(collapsed=true)時的淡出:使用者要求「主題點消失時用淡出」——
    // 但 renderContent() 是整個重設 innerHTML,照片節點會瞬間消失。這裡
    // 不改成延遲重繪(那會讓 renderContent 變非同步,破壞所有「呼叫後
    // DOM 立即更新完畢」的既有假設,例如 getVisualEl/getLabelEl 的標籤
    // 避讓量測、bindClickTargets 的綁定時機),而是 crossfade:先在重繪
    // 「之前」把目前畫面上的照片/光暈做成純裝飾的幽靈複本(見
    // captureThemePhotoGhosts),照常同步重繪成小圓點,再把幽靈塞回
    // 容器讓 CSS 在原位淡出、動畫結束後自行移除(見 mountThemePhotoGhosts)。
    // 圓點、標籤、點擊綁定在 renderContent 回傳的當下就已經是最終狀態。
    // 這條分支只有 isTheme && collapsed=true 才會走到,既有呼叫端
    // (themePhotoCollapsed 恆 false)永遠不會產生幽靈節點。
    setThemePhotoCollapsed(collapsed: boolean) {
      if (!this.isTheme || this.themePhotoCollapsed === collapsed) return
      const ghosts = collapsed ? this.captureThemePhotoGhosts() : []
      this.themePhotoCollapsed = collapsed
      if (!collapsed && this.hovered) {
        this.hovered = false
        this.div?.classList.remove('geo-attraction-overlay-hovered')
      }
      if (!this.div) return
      this.updateContainerZIndex()
      this.renderContent()
      this.mountThemePhotoGhosts(ghosts)
    }

    // captureThemePhotoGhosts:主題點照片收起前,依目前 DOM 上的光暈/
    // 照片/佔位圓各做一份「幽靈」複本,供 renderContent 重繪之後塞回去
    // 原位淡出。必須在 themePhotoCollapsed 改值、innerHTML 重寫之前呼叫
    // (之後 DOM 上就只剩小圓點了)。
    //
    // 幽靈刻意不沿用 .geo-attraction-landmark-photo/-placeholder 這兩個
    // class,改用獨立的 .geo-attraction-landmark-ghost:那兩個 class 是
    // getVisualEl()/bindClickTargets() 的查詢契約(見各該方法),若幽靈
    // 也掛同樣的 class,標籤避讓會把一個正在消失的 56px 圓當成實際障礙物
    // 量測、候選徽章 ::after 與 photoFadeIn 進場動畫也會誤套到幽靈身上。
    // 光暈沒有這層契約(JS 從不查詢它、本來就 pointer-events:none),直接
    // 沿用 .geo-attraction-glow 的外觀,只疊一個 -fading modifier 把進場
    // 動畫換成淡出。所有幽靈都是純裝飾:pointer-events:none(CSS),不綁
    // 任何事件。
    //
    // prefers-reduced-motion:直接不產生幽靈,照片瞬間消失(比照
    // focused 圖釘進場動畫在該模式下退化成靜態的做法);CSS 端另有
    // display:none 的保底,涵蓋動畫播到一半系統設定才切換的情況。
    private captureThemePhotoGhosts(): HTMLElement[] {
      if (!this.div) return []
      if (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return []
      }
      const ghosts: HTMLElement[] = []
      const glow = this.div.querySelector('.geo-attraction-glow')
      if (glow) {
        const ghost = document.createElement('div')
        ghost.className = 'geo-attraction-glow geo-attraction-glow-fading'
        ghosts.push(ghost)
      }
      const photo = this.div.querySelector<HTMLImageElement>('.geo-attraction-landmark-photo')
      if (photo) {
        const ghost = document.createElement('img')
        ghost.className = 'geo-attraction-landmark-ghost'
        ghost.src = photo.src
        ghost.alt = ''
        ghosts.push(ghost)
      } else if (this.div.querySelector('.geo-attraction-landmark-placeholder')) {
        const ghost = document.createElement('div')
        ghost.className = 'geo-attraction-landmark-ghost geo-attraction-landmark-ghost-placeholder'
        ghosts.push(ghost)
      }
      return ghosts
    }

    // mountThemePhotoGhosts:把 captureThemePhotoGhosts 做好的幽靈塞回
    // 容器最前面(DOM 順序在圓點/標籤之前;幽靈全是絕對定位,不占
    // flex 版面,圓點/標籤的位置跟沒有幽靈時完全相同),淡出動畫
    // (ExploreMap.module.css 的 landmarkGhostFadeOut/glowFadeOut)結束
    // 後自行移除。animationend 之外另用固定時長的 setTimeout 保底——
    // 動畫被中途打斷(例如分頁切到背景、或 CSS 被覆寫成 none)時事件
    // 不會觸發,幽靈不能因此永遠留在 DOM 上。期間若有其他原因觸發
    // renderContent()(hover 升級、setPhotoUrls),innerHTML 重寫會直接
    // 把幽靈一併清掉,淡出提前結束;之後 remove() 對已脫離 DOM 的節點
    // 是 no-op,不需要額外追蹤計時器。
    private mountThemePhotoGhosts(ghosts: HTMLElement[]) {
      if (!this.div || ghosts.length === 0) return
      this.div.prepend(...ghosts)
      for (const ghost of ghosts) {
        const dispose = () => ghost.remove()
        ghost.addEventListener('animationend', dispose, { once: true })
        window.setTimeout(dispose, THEME_PHOTO_FADE_OUT_MS + 100)
      }
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
