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

/** 一般文字段落——最基本的 Block kind,任何文章都可以只用這一種。 */
export interface ParagraphBlock {
  id: string
  kind: 'paragraph'
  text: string
}

/** 單圖區塊——取代最初試做版本把出血/繞排擠在同一個 align 欄位的設計
 *  (見本檔開頭說明第 2 點)。 */
export interface ImageBlock {
  id: string
  kind: 'image'
  file: string
  alt: string
  caption?: string
  width: ImageWidth
  /** 只在 width='column' 時有意義,其餘情況由渲染端忽略此欄位。 */
  float: ImageFloat
  focal?: FocalPoint
}

/** 多圖群組區塊——顯式群組,取代「靠張數隱式判斷版面」的舊邏輯(見本檔
 *  開頭說明第 2 點)。items 上限建議 2~4 張,對齊 Medium/Ghost 刻意訂
 *  低張數上限、避免排版失控的慣例。 */
export interface GalleryBlock {
  id: string
  kind: 'gallery'
  items: Array<{ file: string; alt: string; caption?: string; focal?: FocalPoint }>
  layout: 'grid' | 'row'
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
 * 主題介紹頁的內容區塊——扁平聯集陣列,順序即渲染順序。新增 kind 時,
 * 既有內容若含渲染端不認識的 kind,應該靜默忽略該區塊(graceful
 * fallback),不中斷整頁渲染(見本檔開頭說明第 6 點)。
 */
export type ThemePageBlock = ParagraphBlock | ImageBlock | GalleryBlock | StopBlock

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
  /** 風格基調,可省略(見本檔開頭說明第 7 點與 ThemePagePalette)。 */
  palette?: ThemePagePalette
  /** 內容區塊陣列,順序即渲染順序——見本檔開頭說明第 1 點。 */
  blocks: ThemePageBlock[]
  /** 發布狀態——草稿可以不完整,只有 published 才會被公開頁面讀取顯示。 */
  status: 'draft' | 'published'
}
