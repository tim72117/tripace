// ThemePageContent:主題介紹頁規格化內容的型別定義——試做範本是
// TainanChikanPage.tsx 的 STOPS 資料(見該檔案第 86-245 行),但
// TainanChikanPage 只是「逐站介紹」這一種呈現形式,不是所有主題頁都會
// 用這種結構(例如純文章式長文、或沒有站點概念的單主題介紹頁)。
//
// 設計依據見 docs/refactor-theme-page-content-cms-plan-2026-10.md 第四、
// 五節,以及針對圖片排版意圖做的業界調研(Notion/Medium/Sanity Portable
// Text/Contentful/Ghost/Webflow)結論。核心決定:
//
// 1. 頂層內容是扁平的 Block 聯集陣列(paragraph/image/gallery/stop),
//    不是「站點(Stop)為頂層單位、站內才能放圖片」的固定模板——這是
//    修正過的設計決定:最初版本把 ThemePageStop 焊死成唯一的頂層形狀
//    (必填 name/desc/info/media/layout),等於用 TainanChikanPage 這
//    一個範例鎖死了所有主題頁的樣子,換一篇不是「逐站兩日遊」形式的
//    文章(純文字長文、沒有資訊框的單景點介紹)就會被迫塞進站點模板。
//    改成扁平 Block 陣列後,'stop' 只是其中一種 kind,一篇文章可以
//    全部由 paragraph/image 組成(無站點概念),也可以摻雜 stop 卡片
//    (逐站介紹),由內容本身決定要用哪些 kind、要用幾個,不是由 schema
//    預先規定。
//
// 2. 圖片排版的三個 kind(image/gallery,以及 stop 內部複用的同一組
//    型別)套用業界調研的建議,放棄最初試做版本單一 `align` 欄位(把
//    「要不要出血」跟「要不要繞排」擠在一起),改成 Ghost/Sanity
//    路線——「扁平陣列 + 顯式群組 block」:
//    - 單圖:width(欄寬/外擴/全寬出血)與 float(繞排方向,只在
//      width='column' 時有效)兩個正交列舉,對應 Ghost 的 cardWidth
//      與既有 align 概念的拆分。
//    - 多圖成組:獨立的 'gallery' kind,顯式帶 items 陣列與
//      layout('grid' | 'row'),不是靠「相鄰元素張數」隱式推算版面
//      (Medium 的隱式分組模式被調研報告指出是「拖拉重排容易壞」的
//      設計缺陷,見規劃文件圖片排版段落)。
//    - 兩種圖片 kind 都預留 focal(裁切焦點)欄位,對齊 Sanity hotspot
//      的設計——現在可以不填,但若等真的需要縮圖裁切才回頭補,就要
//      回填所有既有內容,不如現在就留位置。
//    - 容器型/任意比例跨欄(Notion column_list 式)明確不做,見規劃
//      文件的決定(CLI 手寫 JSON 場景下巢狀樹是維護負擔,目前沒有
//      拖拉編輯器也用不到這種表達力)。
//
// 3. 'stop' kind 把 TainanChikanPage 這種逐站卡片的欄位(index/day/
//    kind 分類標籤/blurb/info 資訊框/layout 大版面)完整保留,因為
//    這一組欄位本身是有意義的「站點卡片」概念,不是要拆散——只是
//    改成「這是眾多 Block kind 之一,文章可以選擇用或不用」,不再是
//    唯一的頂層形狀。stop 內部的 media 欄位複用跟頂層同一組
//    ImageBlock/GalleryBlock 型別,不另外定義一套。
//
// 4. info 維持 label-value 配對陣列(對齊既有 STOPS.info 的
//    `[string, string][]` 形狀)——比起另外設計固定欄位(location/
//    duration/note),配對陣列讓不同站點可以有不同的資訊項目組合,
//    不需要在 schema 裡預先窮舉所有可能欄位名稱。
//
// 5. 頂層 content 帶 version 欄位(目前固定 1)——為日後 schema 演進
//    預留 lazy migration 的判斷依據,讀取端看到舊版本號就知道要跑
//    對應的轉換邏輯,不需要靠一次性批次改寫資料庫裡的 JSON。
//
// 6. Block 用 kind 聯集而非固定欄位,刻意採用「未知 kind 不中斷渲染」
//    的防禦設計(見渲染端建議)——日後新增 kind(例如影片、地圖嵌入、
//    地點卡)不會讓既有內容的渲染邏輯直接拋錯,只是該區塊被忽略顯示。
//
// 7. 樣式彈性(不同文章想要不同風格基調)用「具名主題」而非「資料裡存
//    具體 CSS 值」——頂層 theme 欄位只選預先定義好的主題名稱
//    (ThemePagePalette),實際色票/字體數值仍由 CSS 端的
//    [data-palette] 規則決定(見 ThemePageDemo.css)。這是刻意的取捨:
//    - 若改成資料裡直接存色碼/px 數值(例如 ImageBlock.style.color),
//      會讓「語意」跟「視覺」混在一起——這正是最初試做版本的
//      photoGradient/gradient 被指出的同一種問題(見本檔先前版本說明
//      與規劃文件的調研結論),等於繞過前面 width/float 正交拆分、
//      focal 焦點這些設計想避免的技術債。
//    - CLI 編輯者只需要選一個主題名稱,不需要自己調色/抓對比度,
//      不會做出不可讀或不一致的頁面;日後要整體換風格,只改 CSS,
//      不需要回頭改任何已存的內容資料。
//    - 代價是彈性受限於預先定義好的主題清單——如果之後需求是「同一
//      篇文章裡逐塊精細調整顏色」,這套設計撐不住,那種需求通常代表
//      已經需要一個真正的視覺化樣式編輯器,不是 CLI 編輯 JSON 的
//      場景該解決的問題,見規劃文件開放問題。

/** 圖片裁切焦點(0~1 相對座標)——對齊 Sanity hotspot 的設計意圖,縮圖/
 *  裁切時以此為準,避免主體被裁掉。可省略,省略時以置中裁切處理。 */
export interface FocalPoint {
  x: number
  y: number
}

/** 單圖的出血/欄寬檔位——對應 Ghost cardWidth 的三段式設計。 */
export type ImageWidth = 'column' | 'wide' | 'full'

/** 單圖繞排方向——只在 width='column' 時生效,width 為 wide/full 時
 *  渲染端應忽略這個欄位(全寬圖沒有繞排的意義)。 */
export type ImageFloat = 'none' | 'left' | 'right'

/** 圖片顯示方向——2026-10 新增:BlogArticle.css 原本全部 gallery/單圖
 *  規則固定套用橫式 aspect-ratio(1.4~1.6:1,見該檔案的完整說明),不論
 *  原圖本身是橫是直,一律被 object-fit: cover 裁切成橫式比例。混合
 *  直式原圖(手機直拍的人像/巷弄構圖)的 gallery 因此失真明顯——直式
 *  照片的主體(通常是縱向的構圖重心)被硬裁成橫的,即使搭配 focal 調整
 *  裁切位置,畫面整體形狀仍跟原始構圖意圖不符。
 *
 *  'landscape'(省略時的預設值)維持既有橫式比例,向後相容現有內容;
 *  'portrait' 讓渲染端改套用直式比例(見 BlogArticle.css
 *  [data-orientation="portrait"] 規則)。寫文章時依照這張圖實際的原始
 *  長寬比(可從 CLI `blog-photo list` 回應的 variants[].width/height
 *  判斷,height > width 即為直式)手動標注,不是系統自動判斷——同一個
 *  gallery 裡常常混合橫直式照片(例如同一條巷弄裡有橫拍的建築遠景、
 *  也有直拍的行人/巷弄縱深構圖),需要逐張指定,不能用整個區塊共用
 *  一個值。 */
export type ImageOrientation = 'landscape' | 'portrait'

/** 段落樣式變體——具名樣式,不是資料裡存具體字級/字重數值(對齊本檔
 *  開頭說明第 7 點「具名主題」的既有設計哲學:CLI 編輯者只選語意化的
 *  變體名稱,實際視覺數值(字級/字重/顏色/間距)交給 CSS 端的
 *  [data-variant] 規則決定,之後要整體調整某種變體的呈現方式,只改
 *  CSS,不需要回頭改任何已存的內容資料)。
 *
 *  - 'heading':小標題感,用在想把一段文字當成區段標題/轉折點的場合
 *    (不是真正的 <h2>,仍是同一篇文章扁平敘事裡的一段,只是視覺上更
 *    醒目,對齊赤崁·府城那篇手寫版(TainanChikanPage.tsx)的
 *    tainan-chikan-stop-head/h2 視覺慣例)。
 *  - 'emphasis':重點強調,字級/字重略為放大,用在想讓讀者多停留一下
 *    的關鍵句子,對齊赤崁·府城那篇的 tainan-chikan-stop-blurb 視覺
 *    慣例(但那裡字重是減弱的斜體語氣,這裡刻意是加強,語意不同,
 *    不要混淆)。
 *  - 'quote':引言樣式,用在摘錄的話、店家招牌文字、或想特別標出的
 *    一句話。
 *  - 'caption':小字說明,用在補充性質、不是正文重點的文字(例如
 *    價位資訊、營業時間這類輔助細節)。
 *  - 省略(undefined):一般內文,對應改動前的既有外觀,維持向後相容。
 */
export type ParagraphVariant = 'heading' | 'emphasis' | 'quote' | 'caption'

/** 一般文字段落——最基本的 Block kind,任何文章都可以只用這一種。 */
export interface ParagraphBlock {
  id: string
  kind: 'paragraph'
  text: string
  /** 選填的樣式變體,見 ParagraphVariant 的完整說明。省略時是一般內文。 */
  variant?: ParagraphVariant
}

/** 單圖區塊——取代最初試做版本把出血/繞排擠在同一個 align 欄位的設計
 *  (見本檔開頭說明第 2 點)。
 *
 *  2026-10 修正:photoId 取代原本的 file(圖檔路徑字串)——file 當初是
 *  直接拼接固定路徑前綴+檔名(見 BlogArticlePage.tsx 舊版 photoUrl()
 *  的寫法),圖片一旦被使用者重新上傳替換,舊路徑就直接失效,文章內容
 *  跟實際檔案位置脫鉤,業界常見做法(WordPress attachment ID、Sanity
 *  Portable Text asset reference)都是在內容裡存不會變動的穩定識別碼,
 *  渲染時才解析成當下有效的實際網址。photoId 對應後端
 *  uploaded_photos.id(見 server/internal/store/entity.go
 *  uploadedPhotoRow 的完整說明),前端渲染文章時透過
 *  fetchPublicBlogPhotosByIDs(api.ts)批次展開成實際網址,不在內容
 *  JSON 裡直接存任何路徑/網址字串。 */
export interface ImageBlock {
  id: string
  kind: 'image'
  photoId: string
  alt: string
  caption?: string
  width: ImageWidth
  /** 只在 width='column' 時有意義,其餘情況由渲染端忽略此欄位。 */
  float: ImageFloat
  focal?: FocalPoint
  /** 選填,見 ImageOrientation 的完整說明。省略時等同 'landscape'
   *  (既有橫式比例),向後相容既有內容。 */
  orientation?: ImageOrientation
  /** 疊在圖片上的文字(2026-10 新增)——跟 caption(圖片下方的小字圖說)
   *  是不同用途、刻意分開的欄位,不是同一件事的兩種寫法:caption 是
   *  「補充說明這張圖是什麼」,這裡是「這段文字本身就是內容,只是用
   *  圖片當視覺背景呈現」,對應 BlogArticle.css 的疊字卡片樣式(深色
   *  漸層遮罩+白色文字,呼應 Hero 背景圖的既有做法,見 .theme-page-
   *  demo-hero[data-hero-photo] 規則的完整說明)。
   *
   *  挑選依據(2026-10 使用者實機回報「文繞排配短段落效果很差,撐不滿
   *  圖片高度、底下一片空白」後,新增這個欄位當替代方案):文繞排
   *  (width:'column' + float)需要緊接其後的文字段落夠長,才能讓文字
   *  持續繞在圖片旁(至少繞滿圖片的視覺高度,抓一個概略門檻:至少
   *  100~150 字,實際門檻依圖片比例/欄寬調整,沒有精確公式)。文字量
   *  不夠長時(例如本身只是一句話、一段短收尾感想),不要用 float,
   *  改用這個欄位讓圖文本來就疊在一起顯示,不依賴「文字夠長到撐滿
   *  圖片」這個前提。
   *  省略時維持原本的版面(不疊字),圖片下方若有 caption 則顯示 caption
   *  ,两者可以共存但目前還沒有同時使用的實例,渲染端的呈現細節(是否
   *  互相遮擋)屆時再處理。 */
  overlayText?: string
}

/** 多圖群組區塊——顯式群組,取代「靠張數隱式判斷版面」的舊邏輯(見本檔
 *  開頭說明第 2 點)。items 上限建議 2~4 張,對齊 Medium/Ghost 刻意訂
 *  低張數上限、避免排版失控的慣例。items[].photoId 同 ImageBlock.photoId
 *  的完整說明,2026-10 同一輪修正從 file 改名。 */
export interface GalleryBlock {
  id: string
  kind: 'gallery'
  items: Array<{
    photoId: string
    alt: string
    caption?: string
    focal?: FocalPoint
    /** 選填,見 ImageOrientation 的完整說明——逐張指定,同一個 gallery
     *  裡常混合橫直式照片。省略時等同 'landscape'。 */
    orientation?: ImageOrientation
  }>
  /** 'grid'(預設):第一張大圖+其餘固定 2 欄小圖。'row':取消大小分層,
   *  統一縮小、密集多欄排列(見 BlogArticle.css [data-layout="row"]
   *  規則的完整說明,適合 ≥5 張的站點)。
   *  'split'(2026-10 新增):固定 3 張的非對稱拼貼——左側一張直式大圖,
   *  右側兩張橫式圖上下堆疊(雜誌常見的拼貼版面)。items 依陣列順序
   *  對應固定位置:items[0] 是左側直式大圖,items[1]/items[2] 是右側
   *  由上到下的兩張橫式圖,不是隨排版自動決定——寫入內容時需按這個
   *  順序排列,渲染端(BlogArticle.css [data-layout="split"])依
   *  nth-child 選到固定位置,不是依 orientation 欄位自動判斷哪張該放
   *  左邊。items 長度不是 3 張時,渲染端會退回 'grid' 版面並印
   *  console.warn(2026-10 code review 修正,見 renderGalleryBlock 的
   *  完整說明)——寫入前仍應自行確保張數正確,這個防呆只是避免版面
   *  悄悄跑掉、方便事後排查,不是鼓勵依賴它。 */
  layout: 'grid' | 'row' | 'split'
  /** 整組圖片共用的說明文字,跟單張 caption 分開(對齊 Ghost gallery
   *  card 在「整組」層級才有 caption 的設計)。 */
  caption?: string
}

/** 單一資訊項目——[標籤, 內容],例如 ['建議停留', '約 45 分鐘']。 */
export type StopInfoItem = [label: string, value: string]

/**
 * 站點卡片區塊——對應 TainanChikanPage.tsx 現有 STOPS 陣列的一筆元素,
 * 但現在只是眾多 Block kind 之一(見本檔開頭說明第 1、3 點),文章可以
 * 完全不用它(純段落/圖片文章),也可以整篇幾乎都是它(逐站介紹,
 * 像 TainanChikanPage 這樣)。
 */
export interface StopBlock {
  id: string
  kind: 'stop'
  /** 站序標號,例如中文數字「壱/弐/参」——純展示用,不影響排序(排序看陣列順序)。 */
  index: string
  /** 第幾天(用於渲染 Day 分隔線),可省略——沒有「多日行程」概念的文章不需要這個欄位。 */
  day?: number
  /** 敘事分類標籤,例如「前世今生」「住宿」——純文字顯示,不影響排序/篩選邏輯,可省略。 */
  category?: string
  /** 站點名稱(卡片標題)。 */
  name: string
  /** 主要介紹段落。 */
  desc: string
  /** 部落客語氣補充短句,可省略——跟 desc 分開渲染,語氣/用途不同不互相取代。 */
  blurb?: string
  /** 這一站的媒體區塊,依陣列順序渲染,複用頂層同一組 ImageBlock/GalleryBlock 型別。 */
  media: Array<ImageBlock | GalleryBlock>
  /** 資訊框內容(label-value 配對),可省略或為空陣列。 */
  info?: StopInfoItem[]
  /**
   * 整站交替版面標記('stacked' | 'side'),可省略——對齊既有
   * STOPS.layout 欄位,用於整張卡片(非逐張圖片)的大版面切換,跟
   * media 裡個別圖片的 width/float 是兩個獨立的排版維度。
   */
  layout?: 'stacked' | 'side'
}

/**
 * 捲動時間軸——起始標記。2026-10 新增:使用者明確要求「將時間軸工具
 * 當作一個小工具,讓他可以選擇性的放到頁面中」,且要讓不懂程式碼的人
 * 也能插入——在此之前,home/ScrollTimeline.tsx 只能由工程師手寫 JSX
 * (<ScrollTimeline><ScrollTimeline.Anchor>...</ScrollTimeline.Anchor>
 * </ScrollTimeline>)才能套用到某個城市頁。
 *
 * 設計決定:這三個 scroll-timeline-* kind(start/anchor/end)不帶任何
 * 巢狀 Block 陣列——刻意不做成「ScrollTimelineBlock.anchors[].content:
 * ThemePageBlock[]」這種遞迴巢狀型別(更早版本的草案),理由:
 *   - 本檔開頭說明第 2 點已經明確決定「容器型/任意比例跨欄(Notion
 *     column_list 式)明確不做……巢狀樹是維護負擔」,巢狀的 anchors[].
 *     content 等於違反這個已經訂下的原則,讓 CLI 編輯者要維護樹狀
 *     結構而非扁平清單。
 *   - 業界成熟的作法(Sanity Portable Text 的 custom block、Ghost 的
 *     bookmark/embed card)對於「文案裡嵌入複雜互動 widget」,慣例是把
 *     widget 本身的設定值(這裡是 city/accentColor/各錨點的 thumb/
 *     theme)跟文案內容分開,不把文案塞進 widget 的資料結構裡。
 *
 * 改用「扁平標記點」模式:blocks 陣列裡插入一個 'scroll-timeline-start'
 * (帶 ScrollTimeline 本身的設定值)、若干個 'scroll-timeline-anchor'
 * (帶該錨點的中繼資料),以及一個 'scroll-timeline-end'(純邊界標記,
 * 無欄位)。這三種標記之間、之後的一般 block(paragraph/image/gallery/
 * stop)維持完全扁平,不改變既有的陣列結構——渲染端(見
 * BlogArticlePage.tsx groupScrollTimelineBlocks 的完整說明)在渲染前
 * 做一次線性分組,把 start...anchor...anchor...end 這段動態組裝成
 * <ScrollTimeline><ScrollTimeline.Anchor>...的 JSX 樹,型別本身不需要
 * 任何遞迴引用,CLI 編輯 JSON 時全程只面對一份扁平陣列。
 *
 * 寫法示意(blocks 陣列,省略無關欄位):
 *   paragraph(引言)
 *   scroll-timeline-start(city=台南, accentColor=...)
 *   scroll-timeline-anchor(thumb=..., theme=赤崁樓)
 *   stop(赤崁樓介紹卡)
 *   scroll-timeline-anchor(thumb=..., theme=武廟愛玉)
 *   stop(武廟愛玉介紹卡)
 *   scroll-timeline-end
 *   paragraph(結語)
 */
export interface ScrollTimelineStartBlock {
  id: string
  kind: 'scroll-timeline-start'
  /** 直接轉傳給 ScrollTimeline 的 city prop——嵌入式小地圖要查詢的城市,
   *  對應後端 publicAttractionsCityAllowlist 白名單裡的其中一個值。 */
  city: string
  /** 直接轉傳給 ScrollTimeline 的 accentColor prop(必填)——見
   *  AccentColorProp 的完整說明,通常是 "var(--xxx)" 這類 CSS 變數
   *  參照字串,也可以是色碼字串。 */
  accentColor: string
  /** 直接轉傳給 ScrollTimeline 的 defaultOpenTheme prop(選填)——沒有
   *  在個別 anchor 指定 theme/center 時的共用退回值。 */
  defaultOpenTheme?: string
  /** 直接轉傳給 ScrollTimeline 的 mapRestrictRadiusKm prop(選填)。 */
  mapRestrictRadiusKm?: number
}

/**
 * 捲動時間軸——單一錨點標記,對應 home/ScrollTimeline.tsx 的
 * <ScrollTimeline.Anchor> 一筆。只帶這個錨點的中繼資料,不帶文案
 * 內容——這個標記「之後、到下一個 scroll-timeline-anchor 或
 * scroll-timeline-end 之前」的所有一般 block,都屬於這個錨點的文案
 * (由渲染端分組邏輯決定,見 ScrollTimelineStartBlock 的完整說明)。
 * 必須出現在某一組 scroll-timeline-start ~ scroll-timeline-end 之間,
 * 否則渲染端會忽略它(落單的 anchor 標記沒有外層 ScrollTimeline 可以
 * 歸屬)。
 */
export interface ScrollTimelineAnchorBlock {
  id: string
  kind: 'scroll-timeline-anchor'
  /** 時間軸圓形縮圖網址。 */
  thumb: string
  /** 對應地圖上的主題點名稱(選填)——見 ScrollTimeline.tsx AnchorMeta
   *  的完整說明:theme/center 擇一,同時填時 theme 優先。 */
  theme?: string
  /** 直接指定地圖中心座標(選填)——theme 比對不到時(一般精選點/完全
   *  不在資料庫裡的地點)用這個欄位移動地圖視角,不開主題點介紹卡。 */
  center?: { lat: number; lng: number }
  /** 地圖開關按鈕 aria-label 用的簡短可讀文字(選填,未填退回 id)。 */
  label?: string
}

/**
 * 捲動時間軸——結束標記,純邊界,無欄位。渲染端看到它就結束目前正在
 * 收集的 ScrollTimeline 分組(見 ScrollTimelineStartBlock 的完整說明)。
 */
export interface ScrollTimelineEndBlock {
  id: string
  kind: 'scroll-timeline-end'
}

/**
 * 主題介紹頁的內容區塊——扁平聯集陣列,順序即渲染順序。新增 kind 時,
 * 既有內容若含渲染端不認識的 kind,應該靜默忽略該區塊(graceful
 * fallback),不中斷整頁渲染(見本檔開頭說明第 6 點)。
 */
export type ThemePageBlock =
  | ParagraphBlock
  | ImageBlock
  | GalleryBlock
  | StopBlock
  | ScrollTimelineStartBlock
  | ScrollTimelineAnchorBlock
  | ScrollTimelineEndBlock

/**
 * 具名風格基調——每個值對應 ThemePageDemo.css 裡一組 [data-palette]
 * 色票/字體規則(見本檔開頭說明第 7 點)。新增主題時,CSS 端補一組
 * 對應規則、這裡補一個列舉值,兩處要同步——跟 store.go/schema_check.go
 * 兩處同步維護 AutoMigrate 清單是同一種「刻意不共用、需要手動對齊」
 * 的取捨,好處是每個主題的色票定義集中在 CSS 裡單一位置,不會分散。
 * 省略時套用預設主題(見 ThemePageDemo.css 的 :root 層級預設值)。
 */
export type ThemePagePalette = 'paper-warm' | 'ocean-cool' | 'night-market'

/** 整篇主題介紹頁的內容——對應一個 slug(路由路徑)。 */
export interface ThemePageContent {
  /** schema 版本號——見本檔開頭說明第 5 點,第一版固定為 1。 */
  version: 1
  /** 對應路由 slug,例如 "tainan-chikan"。 */
  slug: string
  /** 頁面主標,對應既有 Hero <h1> 內容。 */
  title: string
  /** Hero 副標籤(eyebrow),可省略——沒有副標籤需求的文章不用填。 */
  eyebrow?: string
  /** Hero 介紹段落(對應既有 <header> 裡的 <p>),可省略。 */
  lede?: string
  /** Hero 全寬背景圖(2026-10 新增)——可省略,省略時 Hero 維持原本的
   *  純文字排版(無背景圖)。跟 ImageBlock.photoId 同一套引用方式
   *  (穩定識別碼,見該欄位的完整說明),不直接存網址。挑選依據見
   *  model.UploadedPhoto.Rating 的完整說明:評 3 分(最高)的照片
   *  適合選來當這裡的 Hero 大圖,但這個欄位本身不限制一定要用高分
   *  照片,純粹是挑選時的參考依據,不是強制規則。這張圖固定以
   *  object-fit: cover 滿版鋪底,不支援自訂裁切焦點(不像
   *  ImageBlock/GalleryBlock 的 focal)——Hero 區塊的文案版面本身
   *  已經要求置中對齊,裁切偏移需求相對低,目前先用最簡單的實作,
   *  真的有裁切不理想的情況再回頭加 focal。 */
  heroPhotoId?: string
  /** Hero 下方獨立定場大圖(2026-10 新增,跟 heroPhotoId 是兩種不同的
   *  呈現方式並存試做——見 BlogArticlePage.tsx 對應 JSX 的完整說明)。
   *  可省略,省略時不顯示這個區塊。跟 heroPhotoId 一樣是穩定識別碼,
   *  可以跟 heroPhotoId 用同一張或不同張照片,兩者互不影響。 */
  heroStandalonePhotoId?: string
  /** 建議的日夜間模式(2026-10 新增)——可省略,省略時維持既有行為
   *  (跟隨讀者系統偏好或之前手動切換過的選擇)。這只是「預設值」,
   *  不是強制鎖定:讀者進入這篇文章時,若自己還沒手動切換過(見
   *  useThemeToggle 的 theme state,null 代表尚未手動切換),套用這裡
   *  指定的模式;讀者按下既有的 SiteNavThemeToggle 仍可自由切換,
   *  這個欄位只影響「初次進入時」的預設顯示,不影響之後的互動。用途
   *  例如夜景主題的文章(像九份夜遊)用深色配色展示效果更好,但不該
   *  強迫所有讀者都看深色,只是替大多數人設一個更合適的起點。 */
  preferredTheme?: 'dark' | 'light'
  /** 風格基調,可省略(見本檔開頭說明第 7 點與 ThemePagePalette)。 */
  palette?: ThemePagePalette
  /** 內容區塊陣列,順序即渲染順序——見本檔開頭說明第 1 點。 */
  blocks: ThemePageBlock[]
  /** 發布狀態——草稿可以不完整,只有 published 才會被公開頁面讀取顯示。 */
  status: 'draft' | 'published'
}
