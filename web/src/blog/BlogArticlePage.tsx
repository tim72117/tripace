import { useEffect, useRef, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { fetchPublicBlogArticle, fetchPublicBlogPhotosByIDs, type ClientConfig, type PublicUploadedPhoto } from '../api'
import { NotFoundPage } from '../home/NotFoundPage'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { useScrollProgress } from '../hooks/useScrollProgress'
import { ScrollTimeline } from '../home/ScrollTimeline'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import { trackEvent } from '../analytics'
import { CityPageFooter } from '../home/CityPageFooter'
import { groupScrollTimelineBlocks, type ScrollTimelineGroup } from './scrollTimelineGrouping'
import type { GalleryBlock, ImageBlock, StopBlock, ThemePageBlock, ThemePageContent } from './types'
import './BlogArticle.css'

// GUEST_CFG:這個頁面跟 InteractiveExploreMap.tsx 的既有理由一樣——
// 讀取已發布內容是公開頁面的訪客動作,不需要使用者自己的 JWT,token
// 傳 null(走訪客)。baseURL 沿用 AppCommon.tsx 的 BASE_URL(建置時
// VITE_API_BASE,或退回目前頁面 origin)。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// photoMap:photoId → PublicUploadedPhoto 的對照表,供
// renderImageBlock/renderGalleryBlock 把 ImageBlock.photoId/
// GalleryBlock.items[].photoId(見 types.ts 的完整說明:2026-10 從直接
// 存路徑字串改成存這個穩定識別碼)解析成實際可顯示的圖片網址。
//
// 當參數一路往下傳(renderBlock/StopCard/renderImageBlock/
// renderGalleryBlock/renderScrollTimelineGroup),不是用 React Context
// ——原本考慮過用 Context 省去逐層改簽章的麻煩,但 renderImageBlock/
// renderGalleryBlock 是小寫開頭的一般函式(直接被呼叫
// renderImageBlock(x),不是當成 JSX 元件掛載),在這種函式裡呼叫
// useContext 違反 React Hooks 規則(Hook 只能在真正的 function
// component 或自訂 hook 內呼叫),故改成讓最上層的 BlogArticlePage 查
// 好 photoMap 後,一路當參數往下傳,每一層都是單純的參數傳遞,不是在
// 非 hook 情境下違規使用 Hook。

// collectPhotoIds:掃描整份 content.blocks(含巢狀在 StopBlock.media 裡
// 的 image/gallery),收集所有出現過的 photoId,供掛載時一次性批次查詢
// (fetchPublicBlogPhotosByIDs)用。只掃描會真正出現在 ImageBlock/
// GalleryBlock 裡的這兩種 kind,其餘 kind(paragraph/stop 本身/
// scroll-timeline-*)不含 photoId,略過。
// heroPhotoId/heroStandalonePhotoId(選填)——2026-10 新增兩種 Hero
// 圖呈現後,這兩個 photoId 也要一併批次查詢,不然 resolvePhotoURL 對它們
// 永遠查不到 photoMap 裡的資料(見 ThemePageContent.heroPhotoId/
// heroStandalonePhotoId 的完整說明)。
function collectPhotoIds(blocks: ThemePageBlock[], heroPhotoId?: string, heroStandalonePhotoId?: string): string[] {
  const ids = new Set<string>()
  if (heroPhotoId) ids.add(heroPhotoId)
  if (heroStandalonePhotoId) ids.add(heroStandalonePhotoId)
  function visit(list: Array<ImageBlock | GalleryBlock>) {
    for (const b of list) {
      if (b.kind === 'image') ids.add(b.photoId)
      else for (const item of b.items) ids.add(item.photoId)
    }
  }
  const imagesAndGalleries = blocks.filter((b): b is ImageBlock | GalleryBlock => b.kind === 'image' || b.kind === 'gallery')
  visit(imagesAndGalleries)
  for (const b of blocks) {
    if (b.kind === 'stop') visit(b.media)
  }
  return Array.from(ids)
}

// resolvePhotoURL:依 photoId 從 PhotoMapContext 查出實際可顯示的圖片
// 網址——優先用 "large" 衍生版本(文章內文大圖),查無 large 時退回原圖
// (見 uploadedPhotoRow.OriginalURL 的完整說明:衍生版本是背景非同步
// 產生的,剛上傳完成、還沒處理完的圖片只有原圖可用,這是合理的降級,
// 不是錯誤狀態)。
//
// photoId 在對照表裡查不到時,退回舊式的 photoUrl(file) 固定路徑拼接
// ——2026-10 移除 sampleTainanChikan.ts 這份展示用假資料(fallback)後,
// 正常情況下不該再出現 photoId 查無結果的情況,保留這個降級路徑只是
// 避免極端情況(例如 photoMap 還沒載入完成、或照片剛好被刪除)下直接
// 顯示破圖連結,不是為了相容任何已知的假資料格式。
function resolvePhotoURL(photoMap: Map<string, PublicUploadedPhoto>, photoId: string): string {
  const photo = photoMap.get(photoId)
  if (!photo) return photoUrl(photoId)
  const large = photo.variants?.find((v) => v.kind === 'large')
  return large?.url ?? photo.originalUrl
}

// resolvePhotoFocal:依 photoId 查出裁切焦點——優先用
// ImageBlock/GalleryBlock 自己當時在 CLI/編輯器裡指定的 focal(見
// types.ts FocalPoint 的完整說明),查無則退回這張圖在 uploaded_photos
// 表上設定的全域焦點(PhotoFocalEditor.tsx 讓使用者拖曳設定的那組值)。
// 兩者都沒有時回傳 undefined,沿用 objectPositionFor 既有的「置中裁切」
// 預設行為。
function resolvePhotoFocal(
  photoMap: Map<string, PublicUploadedPhoto>,
  photoId: string,
  blockFocal: { x: number; y: number } | undefined,
): { x: number; y: number } | undefined {
  if (blockFocal) return blockFocal
  const photo = photoMap.get(photoId)
  if (photo?.focalX != null && photo?.focalY != null) return { x: photo.focalX, y: photo.focalY }
  return undefined
}

// BlogArticlePage:部落客發文正式頁面——資料來源是依 props 傳入的
// handle/slug,呼叫 fetchPublicBlogArticle(見 api.ts)向後端查詢對應
// 作者、對應文章的已發布內容(見下方 FetchState 的完整說明)。
//
// 2026-10 移除假資料 fallback(使用者明確要求「部落格頁不要做
// fallback」,根因:API 失敗時原本會顯示 sampleTainanChikan 這份
// 寫死的赤崁．府城展示內容,讀者會誤以為查到了一篇真實存在但內容
// 錯誤的文章,而不是意識到載入失敗——這在這個頁面還是「驗證排版能否
// 從扁平 blocks 陣列還原」的試做版本時是合理的設計(那時沒有「查無
// 特定文章」這個情境,只需要確保有東西可以展示排版效果),但轉正成
// 讀取任意作者/文章的正式產品頁面後,這個設計本身就是錯的——任何失敗
// (404、網路錯誤、API 回應形狀不對)現在都統一顯示 NotFoundPage,
// 不再嘗試用假內容撐住頁面)。
//
// 樣式沿用 TainanChikanPage.css 整份複製改名(BlogArticle.css,
// class 前綴 tainan-chikan- → theme-page-demo-,保留原試做階段的 class
// 命名,刻意不改動任何視覺數值)。
//
// 照片網址:TainanChikanPage.tsx 的 PHOTO_TAGGING_PREVIEW_BASE 常數值,
// 直接沿用(同一批 GCS 物件,公開可讀)。
const PHOTO_BASE = 'https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan'

function photoUrl(file: string) {
  return `${PHOTO_BASE}/${file}`
}

// FAKE_AUTHOR——2026-10 暫時假資料:後端 theme_pages 表目前沒有
// owner/userId/作者頭像等欄位(見 docs/brainstorm/2026-10-product-
// direction-brainstorm.md 構想五的完整說明,這批功能排在後端 userId
// 欄位與查詢改造之後才會真的接上真實資料),之後要接真實作者資料時,
// 整個换成從 content(或後端回應)讀取真正欄位即可,renderAuthorBelowLede
// 本身不需要大改,只是資料來源從這個假常數換成真實欄位。
const FAKE_AUTHOR = {
  name: 'tim72117',
  avatarUrl: 'https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan/IMG_9812.webp',
  publishedAt: '2026-10-12',
}

// renderAuthorBelowLede:標題+導言(lede)下方,頭像+作者名+發布日期
// 一行,讓讀者先專注標題與導言,再看到作者身份。試做階段曾比較過另外
// 兩種位置(eyebrow 上方、文章結尾的獨立卡片),已移除,見 git 歷史。
function renderAuthorBelowLede() {
  return (
    <div className="theme-page-demo-author theme-page-demo-author--below-lede">
      <img className="theme-page-demo-author-avatar" src={FAKE_AUTHOR.avatarUrl} alt={FAKE_AUTHOR.name} />
      <span className="theme-page-demo-author-name">{FAKE_AUTHOR.name}</span>
      <span className="theme-page-demo-author-sep">·</span>
      <time className="theme-page-demo-author-date">{FAKE_AUTHOR.publishedAt}</time>
    </div>
  )
}

// objectPositionFor:把 FocalPoint(0~1 相對座標,見 types.ts 該型別的
// 完整說明)轉成 CSS object-position 的百分比語法——兩者語意完全對應
// (0,0 是左上角、1,1 是右下角),不需要額外換算公式。
//
// 2026-10 新增(使用者實機回報「照片沒有完全顯示」,根因排查:這批
// 台南赤崁照片混合直式(0.75:1)與橫式(1.333:1)比例,gallery 格子
// 本身是固定比例容器(aspect-ratio,見 ThemePageDemo.css 該規則的完整
// 說明)+ object-fit:cover,裁切時預設只會裁掉置中(50%,50%)以外的
// 部分——直式照片被裁進橫式格子時,裁掉的範圍可能剛好蓋到照片真正的
// 主體(例如人物/招牌/建築頂端),讓人感覺「照片不完整」)。
// types.ts 的 FocalPoint 設計本來就是為了解決這個問題而預留的欄位
// (「縮圖/裁切時以此為準,避免主體被裁掉」),這裡接上渲染邏輯,把
// CLI 編輯者對每張照片指定的焦點,轉換成瀏覽器真正拿去裁切定位的
// object-position。沒有填 focal 時回傳 undefined,讓瀏覽器使用
// object-position 的 CSS 預設值(50% 50%,置中裁切),維持跟改動前
// 完全一致的行為,不強制所有既有內容都要補填這個選填欄位。
function objectPositionFor(focal?: { x: number; y: number }): string | undefined {
  if (!focal) return undefined
  return `${focal.x * 100}% ${focal.y * 100}%`
}

// renderImageBlock/renderGalleryBlock:image/gallery 這兩種 kind 同時
// 出現在頂層 blocks 與 StopBlock.media 裡(見 types.ts,media 複用同一組
// 型別),抽成獨立函式讓兩處呼叫同一份渲染邏輯,不需要各自重寫一次。
//
// photoMap 當參數傳入,不是透過 useContext 讀取——這兩個函式是小寫
// 開頭的一般函式(直接被呼叫 renderImageBlock(x),不是當成
// <RenderImageBlock /> JSX 元件掛載),在這種函式裡呼叫 Hook 違反
// React Hooks 規則(Hook 只能在真正的 function component 或自訂 hook
// 內呼叫)。改成讓最上層(BlogArticlePage 本身)用 useContext 讀一次,
// 一路當參數往下傳,雖然多了幾個函式簽章要改,但每一層都仍是單純的
// 參數傳遞,不是在非 hook 情境下違規使用 Hook。
// width/float(2026-10 接線——types.ts 定義這兩個欄位已久,但渲染端
// 從未真正讀取套用,是死欄位。這裡補上 data-width/data-float 屬性,
// 讓 BlogArticle.css 能依這兩個值套用對應排版:
//   - width="wide"/"full":全寬出血呈現,float 強制視為 none(見
//     ImageFloat 型別註解:全寬圖沒有繞排意義),CSS 端用
//     [data-width="wide"]/[data-width="full"] 覆寫跳出 .stop-gallery
//     的容器寬度限制。
//   - width="column"(預設)+ float="left"/"right":文繞排——圖靠一側,
//     後續文字段落繞到另一側的空白處。只在這個組合下才輸出
//     data-float,避免 wide/full 搭配非 none 的 float 值時(語意上
//     float 已失效)仍渲染出一個其實不生效的 data-float 屬性,造成
//     CSS 選擇器意外命中。
// overlayText(2026-10 新增,見 types.ts ImageBlock.overlayText 的完整
// 說明)——有設定時,整個區塊改走疊字版面(data-overlay="true"),不走
// 原本的 figure+figcaption 結構:圖片當滿版背景,文字疊在上面,不是
// 「圖片配下方圖說」。有 overlayText 時忽略 width/float(疊字版面本身
// 就是一種獨立的出血大圖呈現,跟繞排/欄寬檔位是互斥的選擇,不疊加
// 套用)。
function renderImageBlock(block: ImageBlock, photoMap: Map<string, PublicUploadedPhoto>) {
  if (block.overlayText) {
    return (
      <div key={block.id} className="theme-page-demo-image-overlay">
        <img
          src={resolvePhotoURL(photoMap, block.photoId)}
          alt={block.alt}
          loading="lazy"
          style={{ objectPosition: objectPositionFor(resolvePhotoFocal(photoMap, block.photoId, block.focal)) }}
        />
        <p className="theme-page-demo-image-overlay-text">{block.overlayText}</p>
      </div>
    )
  }
  const dataFloat = block.width === 'column' && block.float !== 'none' ? block.float : undefined
  return (
    <div
      key={block.id}
      className="theme-page-demo-stop-gallery theme-page-demo-stop-gallery--single"
      data-width={block.width !== 'column' ? block.width : undefined}
      data-float={dataFloat}
    >
      <figure>
        <img
          src={resolvePhotoURL(photoMap, block.photoId)}
          alt={block.alt}
          loading="lazy"
          data-orientation={block.orientation}
          style={{ objectPosition: objectPositionFor(resolvePhotoFocal(photoMap, block.photoId, block.focal)) }}
        />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    </div>
  )
}

// layout(2026-10 接線——types.ts 定義已久,但渲染端從未讀取,是死欄位。
// 'row' 用來處理「段落圖片很多」的情境,見 BlogArticle.css
// [data-layout="row"] 規則的完整說明:取消主圖大小分層、一列排更多張,
// 整組照片統一縮小,避免張數多的站點把版面拉得很長。
// 'split'(2026-10 新增)——固定 3 張的「左直右兩橫堆疊」拼貼版面,見
// types.ts GalleryBlock.layout 的完整說明(items 順序對應固定位置,
// 不是自動判斷)。'grid'(預設/省略)維持既有「第一張大圖+其餘固定
// 2 欄小圖」版面,不受這次改動影響。
//
// effectiveLayout(2026-10 code review 修正)——types.ts 原本的註解坦承
// 「items 長度不是 3 張時,渲染端行為未定義(目前沒有防呆)」,
// TypeScript 編譯期無法攔截陣列長度錯誤,錯誤只會在頁面上以版面跑掉
// (CSS nth-child 選到的格位缺圖或溢出)的形式出現,難以定位是哪篇文章
// 哪個 block 寫錯。這裡補上執行期防呆:'split' 但張數不是 3 張時,
// 退回 'grid'(現有、對任意張數都安全的版面),並印一行 console.warn
// 方便之後追查是哪個 photoId 組合寫錯了張數。 */
function renderGalleryBlock(block: GalleryBlock, photoMap: Map<string, PublicUploadedPhoto>) {
  const effectiveLayout = block.layout === 'split' && block.items.length !== 3 ? 'grid' : block.layout
  if (block.layout === 'split' && block.items.length !== 3) {
    console.warn(
      `[BlogArticlePage] gallery block ${block.id} 用了 layout:'split' 但 items 有 ${block.items.length} 張(需要剛好 3 張),已退回 grid 版面。photoIds: ${block.items.map((i) => i.photoId).join(', ')}`,
    )
  }
  return (
    <div
      key={block.id}
      className="theme-page-demo-stop-gallery"
      data-layout={effectiveLayout === 'grid' ? undefined : effectiveLayout}
    >
      {block.items.map((photo) => (
        <figure key={photo.photoId}>
          <img
            src={resolvePhotoURL(photoMap, photo.photoId)}
            alt={photo.alt}
            loading="lazy"
            data-orientation={photo.orientation}
            style={{ objectPosition: objectPositionFor(resolvePhotoFocal(photoMap, photo.photoId, photo.focal)) }}
          />
          {photo.caption && <figcaption>{photo.caption}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function StopCard({ block, index, photoMap }: { block: StopBlock; index: number; photoMap: Map<string, PublicUploadedPhoto> }) {
  return (
    <article className="theme-page-demo-stop" data-index={index}>
      <div className="theme-page-demo-stop-head">
        {block.index && <span className="theme-page-demo-stop-index">{block.index}</span>}
        <h2>{block.name}</h2>
      </div>
      <p className="theme-page-demo-stop-body">{block.desc}</p>
      {block.blurb && <p className="theme-page-demo-stop-blurb">{block.blurb}</p>}
      {block.media.map((m) => (m.kind === 'image' ? renderImageBlock(m, photoMap) : renderGalleryBlock(m, photoMap)))}
      {block.info && block.info.length > 0 && (
        <dl className="theme-page-demo-info-box">
          {block.info.map(([label, value]) => (
            <div className="theme-page-demo-info-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

// renderBlock:頂層 blocks 陣列的分流渲染——switch 窮舉現有 kind,
// default 分支靜默回傳 null(未知 kind 不中斷整頁渲染,見 types.ts
// 開頭說明第 6 點「未知 kind 不中斷渲染」的設計意圖,這裡是演練這個
// 防禦寫法,不是多餘分支)。'scroll-timeline-start'/'anchor'/'end' 這
// 三種標記不會被傳進這支函式——它們在渲染前已經被 groupScrollTimelineBlocks
// 收斂成 ScrollTimelineGroup,改由 renderScrollTimelineGroup 處理,見該
// 函式的完整說明。
function renderBlock(block: ThemePageBlock, index: number, photoMap: Map<string, PublicUploadedPhoto>) {
  switch (block.kind) {
    case 'paragraph':
      // data-variant(非 className 拼接)對齊 data-palette/data-theme 的
      // 既有「具名變體交給 CSS 端決定視覺數值」慣例(見 types.ts
      // ParagraphVariant 的完整說明)。省略時屬性不存在,CSS 選擇器
      // [data-variant="xxx"] 自然不會命中任何規則,維持改動前的既有
      // 外觀,不需要額外判斷。
      return <p key={block.id} className="theme-page-demo-paragraph" data-variant={block.variant}>{block.text}</p>
    case 'image':
      return renderImageBlock(block, photoMap)
    case 'gallery':
      return renderGalleryBlock(block, photoMap)
    case 'stop':
      return <StopCard key={block.id} block={block} index={index} photoMap={photoMap} />
    default:
      return null
  }
}

// ===== 捲動時間軸(ScrollTimeline)小工具——扁平標記點分組 =====
//
// 見 types.ts ScrollTimelineStartBlock 開頭的完整設計說明:blocks 陣列
// 裡插入 'scroll-timeline-start'(帶 ScrollTimeline 本身的設定值)、若干
// 'scroll-timeline-anchor'(帶單一錨點的中繼資料),以及一個
// 'scroll-timeline-end'(純邊界),三者之間與之後的一般 block 維持完全
// 扁平,不是巢狀結構。groupScrollTimelineBlocks(見 scrollTimelineGrouping.ts,
// 獨立成檔案方便單元測試覆蓋容錯分支)在渲染前做「一次線性掃描」把這些
// 標記收斂成 RenderItem 清單——一般 block 包成 { type: 'block' },整段
// start...anchor...anchor...end 包成 { type: 'scroll-timeline', group }。
// 這個轉換只在渲染時發生,不改變底層資料結構本身(content.blocks 仍然
// 是扁平陣列),對齊本檔開頭說明「資料驅動,渲染端自行決定怎麼組裝」
// 的既有模式(isThemePageContentShape 也是同一種「後端只管存取,前端
// 自己把關形狀」的分工)。

// renderScrollTimelineGroup:把一組 ScrollTimelineGroup 組裝成真正的
// <ScrollTimeline><ScrollTimeline.Anchor>...JSX——欄位對應關係見
// types.ts ScrollTimelineStartBlock/ScrollTimelineAnchorBlock 的完整
// 說明。每個錨點的 content 陣列,遞迴呼叫 renderBlock 渲染(這裡不會
// 再遇到 scroll-timeline-* kind,因為 groupScrollTimelineBlocks 已經
// 把它們從一般 block 流程裡抽走,不會被收進某個 anchor 的 content)。
function renderScrollTimelineGroup(group: ScrollTimelineGroup, key: string, photoMap: Map<string, PublicUploadedPhoto>) {
  const { start, anchors } = group
  if (anchors.length === 0) return null
  return (
    <ScrollTimeline
      key={key}
      city={start.city}
      accentColor={start.accentColor}
      defaultOpenTheme={start.defaultOpenTheme}
      mapRestrictRadiusKm={start.mapRestrictRadiusKm}
    >
      {anchors.map(({ meta, content }) => (
        <ScrollTimeline.Anchor
          key={meta.id}
          id={meta.id}
          thumb={meta.thumb}
          theme={meta.theme}
          center={meta.center}
          label={meta.label}
        >
          {content.map((b, i) => renderBlock(b, i, photoMap))}
        </ScrollTimeline.Anchor>
      ))}
    </ScrollTimeline>
  )
}

// FetchState:三態——'loading' 剛掛載還沒拿到回應,渲染一個簡單的
// 載入中畫面;'api' 成功拿到後端已發布的內容;'not-found' 查無這篇
// 文章或任何其他失敗(404、網路錯誤、200 但內容形狀不對)統一視為
// 「這裡沒有內容可顯示」,渲染 NotFoundPage。
//
// 2026-10 移除原本的 'fallback' 狀態(見上方 BlogArticlePage 的完整
// 說明)——原本區分 'not-found'(明確 404)跟 'fallback'(其他失敗,
// 退回 sampleTainanChikan 假資料)兩種狀態,是為了在假資料還存在時
// 保留「後端真的掛了」跟「這篇文章不存在」的語意差異。假資料移除後,
// 這兩種失敗情境面對讀者的正確處理方式其實相同(都該告知「這裡看不到
// 內容」,不該顯示任何文章),不需要再分開維護兩種 state、兩套渲染
// 邏輯。
type FetchState =
  | { kind: 'loading' }
  | { kind: 'api'; content: ThemePageContent }
  | { kind: 'not-found' }

// EMPTY_CONTENT(2026-10 取代原本的 sampleTainanChikan 假資料)——
// state.kind !== 'api' 時給 content 變數的最小化佔位值,只填滿型別要求
// 的必填欄位(version/slug/title/blocks),不含任何看起來像真實文章的
// 文字內容。見 BlogArticlePage 內 content 變數賦值處的完整說明:這個
// 值只是讓後續 hook 呼叫有東西可以安全存取,最終一定會被
// LoadingPlaceholder/NotFoundPage 的 early return 蓋掉,不會真的被
// 渲染給讀者看到。
const EMPTY_CONTENT: ThemePageContent = { version: 1, slug: '', title: '', status: 'draft', blocks: [] }

// LoadingPlaceholder:文章內容還在等待後端回應時的過渡畫面(2026-10
// 新增,取代原本借用 sampleTainanChikan 撐出完整假文章頁面的做法)。
// 純文字置中,不嘗試模擬任何 Hero/排版結構——這個狀態通常只會短暫
// 出現(一次 API round trip 的時間),不需要骨架屏等更精緻的呈現,
// 保持最簡單、不含任何可能被誤認成真實內容的文字。
function LoadingPlaceholder() {
  return (
    <div className="theme-page-demo-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--ink-soft, #5A5148)' }}>載入中…</p>
    </div>
  )
}

// isThemePageContentShape:最小的執行期結構檢查——只驗證會被這個檔案
// 直接存取的欄位(title 是字串、blocks 是陣列),不逐一檢查每個 Block
// kind 內部欄位(那層驗證複雜度不值得放在渲染前的守門邏輯)。原本
// 這裡直接把 API 回應的 content `as ThemePageContent` 斷言過去,一旦
// 後端回應的內容缺少 blocks/title(例如後端驗證漏洞放過的非物件
// content,或未來的 schema 不一致),會在渲染時直接對 undefined 呼叫
// .length/.split() 拋錯——此時 HTTP 狀態是 200,fetchPublicThemePage
// 的 Promise 會 resolve 而非 reject,.catch() 永遠不會被觸發,FetchState
// 設計的「失敗退回 not-found」機制就完全失效。這裡在 resolve 分支裡
// 自己做最小驗證,驗證失敗時手動轉成 not-found 狀態,讓這個防線真正
// 涵蓋「HTTP 成功但內容形狀不對」的情況,不只是「HTTP 失敗」。
function isThemePageContentShape(v: unknown): v is ThemePageContent {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return typeof obj.title === 'string' && Array.isArray(obj.blocks)
}

export function BlogArticlePage({ handle, slug }: { handle: string; slug: string }) {
  const { theme, dark, toggleTheme, setTheme } = useThemeToggle()
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  // 掛載時打一次 GET /v1/blog/{handle}/{slug}(見 api.ts
  // fetchPublicBlogArticle 的完整說明),依路由傳入的作者 handle + 文章
  // slug 讀取對應的已發布內容。任何失敗(404、網路錯誤、或 200 但
  // 內容形狀不對,見上方 isThemePageContentShape 的完整說明)一律歸為
  // 'not-found'(見上方 FetchState 的完整說明,2026-10 移除假資料
  // fallback 後,這些失敗情境不再區分處理)。handle/slug 變動時(例如
  // 同一元件在不同路由參數下重新掛載)重新查詢。
  useEffect(() => {
    let cancelled = false
    fetchPublicBlogArticle(GUEST_CFG, handle, slug)
      .then((res) => {
        if (cancelled) return
        if (!isThemePageContentShape(res.content)) {
          setState({ kind: 'not-found' })
          return
        }
        setState({ kind: 'api', content: res.content })
      })
      .catch((err) => {
        if (cancelled) return
        // ApiError 以外的例外(理論上不該出現,request() 內部已把所有
        // 失敗包裝成 ApiError,見 api.ts 的完整說明)仍歸為 'not-found'
        // ——不再嘗試區分 404 跟其他失敗原因,兩者面對讀者的正確處理
        // 方式相同(見上方 FetchState 的完整說明)。err 本身不需要保留
        // 在 state 裡,但仍留一行 console.error,方便開發時從瀏覽器
        // console 看出這次載入失敗的實際原因(例如網路錯誤、CORS、
        // API 回應格式跑掉),不是完全靜默吞掉。
        console.error('[BlogArticlePage] fetchPublicBlogArticle 失敗:', err)
        setState({ kind: 'not-found' })
      })
    return () => { cancelled = true }
  }, [handle, slug])

  // content 佔位值(2026-10 改成最小化的空物件,取代原本的
  // sampleTainanChikan 假資料)——只在 state.kind !== 'api' 時被後面的
  // hook(useScrollProgress 等)存取,此時元件最終會 early return
  // 渲染 LoadingPlaceholder/NotFoundPage(見下方),不會真的渲染這個
  // 佔位 content 的任何欄位,存在的唯一目的是讓 hook 呼叫順序在每次
  // render 都保持一致(React Hooks 規則),不是要給使用者看到的內容。
  const content: ThemePageContent = state.kind === 'api' ? state.content : EMPTY_CONTENT

  // 套用 content.preferredTheme(見 ThemePageContent.preferredTheme 的
  // 完整說明)——只在真正拿到後端內容(state.kind === 'api')、有指定
  // 建議值、且讀者目前的 theme 仍是 null(代表還沒手動切換過)時才
  // 套用。theme !== null 時代表讀者已經手動選過自己的偏好(不論是在
  // 這篇文章裡切換、或是從別處帶著既有偏好進來——這個 hook 的 state
  // 只存在記憶體,實務上通常是前者),不該被這篇文章的建議值覆寫掉。
  // 依賴陣列只放 content.preferredTheme/state.kind,不放 theme——
  // 刻意只在「這兩個值變化」時重新判斷是否要套用,不是每次 theme
  // 改變都重新跑一次這個 effect(那樣會在讀者手動切換的當下,因為
  // theme 變化觸發 effect 重跑,但此時條件判斷 theme !== null 已經
  // 擋下,不會真的誤套用,只是沒必要的重跑,加上 theme 不放依賴陣列
  // 可以避免這個無意義的重跑)。
  useEffect(() => {
    if (state.kind !== 'api') return
    if (!content.preferredTheme) return
    setTheme((prev) => (prev === null ? content.preferredTheme! : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.preferredTheme, state.kind])

  const mapIntroRef = useRef<HTMLDivElement | null>(null)
  const { blocks } = content
  useScrollProgress(blocks.length, mapIntroRef)

  // photoMap:content.blocks 裡所有出現過的 photoId,批次展開成實際
  // 可顯示的圖片資訊(見 collectPhotoIds/fetchPublicBlogPhotosByIDs 的
  // 完整說明)。只在 state.kind === 'api'(真正拿到後端內容)時才查詢
  // ——沒有用 useMemo 快取 collectPhotoIds 的結果,因為這份收集本身很
  // 便宜(linear scan 一次 blocks)。
  //
  // 2026-10 code review 修正:原本依賴陣列只放 [blocks],在 'loading'
  // 狀態下 content 是空的 EMPTY_CONTENT(見上方 content 的三元運算式),
  // blocks 是空陣列——effect 本身對空陣列執行雖然無害(collectPhotoIds
  // 回傳空集合,fetchPublicBlogPhotosByIDs 查詢空集合),但仍是一次
  // 無意義的請求(元件掛載時 state 預設是 'loading',幾乎每次載入文章
  // 都會先打到這次空查詢)。改成多檢查 state.kind,'api' 以外的狀態都
  // 不觸發查詢、維持空 Map。
  const [photoMap, setPhotoMap] = useState<Map<string, PublicUploadedPhoto>>(new Map())
  useEffect(() => {
    if (state.kind !== 'api') return
    let cancelled = false
    const ids = collectPhotoIds(blocks, content.heroPhotoId, content.heroStandalonePhotoId)
    fetchPublicBlogPhotosByIDs(GUEST_CFG, ids)
      .then((res) => {
        if (cancelled) return
        setPhotoMap(new Map(res.photos.map((p) => [p.id, p])))
      })
      .catch((err) => {
        if (cancelled) return
        // 查詢失敗不視為錯誤——resolvePhotoURL 對查不到的 photoId 有
        // 自己的降級行為(退回舊式路徑拼接,見該函式的完整說明),這裡
        // 維持空 Map 即可,不需要另外顯示錯誤畫面擋住整篇文章。但至少
        // 留一行 console.warn(2026-10 code review 修正:原本完全靜默
        // 吞掉,後端持續性失敗時,所有真實 photoId 會全部退回
        // photoUrl(photoId) 這個舊式路徑拼接出一個必定無效的網址,畫面
        // 上只看到破圖、console 乾淨,完全沒有線索指出問題出在查詢
        // 失敗而非圖片本身不存在)。
        console.warn('[BlogArticlePage] fetchPublicBlogPhotosByIDs 失敗,圖片將顯示為降級狀態:', err)
      })
    return () => { cancelled = true }
  }, [state.kind, blocks, content.heroPhotoId, content.heroStandalonePhotoId])

  // loading/not-found 都不走下面完整的 content 渲染邏輯,放在所有
  // Hook 呼叫之後才 early return,維持 Hook 呼叫順序在每次 render 都
  // 一致(React Hooks 規則:Hook 不能被條件式跳過)。
  //
  // loading(2026-10 新增,取代原本借用 sampleTainanChikan 撐出完整
  // 假文章頁面的做法,見 BlogArticlePage 開頭的完整說明)——使用者
  // 實機回報「介面載入中時都會先顯示赤崁」,根因就是這裡原本沒有
  // loading 的 early return,元件在 API 回應抵達前會直接拿
  // sampleTainanChikan 渲染出一個看起來完整的赤崁文章頁。改成渲染
  // LoadingPlaceholder(純文字置中,不含任何特定文章的內容)。
  if (state.kind === 'loading') return <LoadingPlaceholder />
  // not-found:查無這篇文章、或任何其他失敗(見上方 FetchState 的
  // 完整說明),渲染真正的 404 畫面,不冒充成任何文章的內容。
  if (state.kind === 'not-found') return <NotFoundPage />

  return (
    <div className="theme-page-demo-page" data-theme={theme ?? undefined} data-palette={content.palette}>
      {/* 商標+登入按鈕——比照 TainanChikanPage.tsx 的既有掛載方式
          (見 SiteNavButtons.tsx 的完整說明),這個頁面轉正前完全沒有
          任何站台導覽 UI。pageLabel 省略(文章頁沒有固定城市/主題標籤,
          不比照城市介紹頁那種「九份」「赤崁・府城」式的頁面標籤)。 */}
      <SiteNavBrand />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'blog-article', position: 'nav' })}>登入</SiteNavCta>
      {/* heroPhotoId(2026-10 新增,見 types.ts ThemePageContent.heroPhotoId
          的完整說明)——有設定時,Hero 整塊疊在全寬背景圖上(data-hero-photo
          切換 BlogArticle.css 對應樣式:深色漸層遮罩+白色文字),沒有設定
          時維持原本的純文字置中版面,兩種版面共用同一份 JSX 結構,只靠
          這個屬性切換視覺,不是另外寫一份重複的 header。 */}
      <header className="theme-page-demo-hero" data-hero-photo={content.heroPhotoId ? 'true' : undefined}>
        {content.heroPhotoId && (
          <img
            className="theme-page-demo-hero-bg"
            src={resolvePhotoURL(photoMap, content.heroPhotoId)}
            alt=""
            aria-hidden="true"
          />
        )}
        <div className="theme-page-demo-hero-content">
          {content.eyebrow && <span className="theme-page-demo-hero-eyebrow">{content.eyebrow}</span>}
          <h1>
            {content.title.split('\n').map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </h1>
          {content.lede && <p>{content.lede}</p>}
          {/* 作者資訊:標題+導言下方,頭像+作者名+發布日期一行——見
              renderAuthorBelowLede 的完整說明。試做階段曾同時比較三種
              位置方案(eyebrow 上方/導言下方/獨立卡片),這裡保留的是
              導言下方這個,讓讀者先專注標題與導言,再看到作者身份。 */}
          {renderAuthorBelowLede()}
        </div>
      </header>

      {/* heroStandalonePhotoId(2026-10 新增,使用者要求「兩個都做看看」
          比較後,進一步要求兩種呈現各自用不同照片——改用獨立欄位,不再
          共用 heroPhotoId,見 types.ts 該欄位的完整說明):標題區塊下方
          再放一張獨立全幅大圖,不是背景疊字,是文章開頭的「代表照」,
          呼應傳統遊記開頭放一張定場照片的版面。目前先讓兩種呈現同時
          存在方便比較,之後確定要留哪一種再移除另一種。 */}
      {content.heroStandalonePhotoId && (
        <div className="theme-page-demo-hero-standalone">
          <img src={resolvePhotoURL(photoMap, content.heroStandalonePhotoId)} alt={content.title} />
        </div>
      )}

      <section className="theme-page-demo-stops">
        {/* renderItems:groupScrollTimelineBlocks 把扁平 blocks 陣列轉成
            「一般 block」與「已收斂的 ScrollTimeline 分組」混合的清單,
            見該函式的完整說明。Day 分隔線邏輯維持直接查 blocks(原始
            扁平陣列,未分組前的索引),不受分組影響——分組只決定「這個
            block 的 JSX 要畫在哪裡(獨立一格,還是收進某個 ScrollTimeline
            錨點內部)」,不改變 blocks 本身的順序或內容,Day 分隔線判斷
            「相鄰兩個 stop 的 day 是否不同」這件事不需要知道分組結果。 */}
        {groupScrollTimelineBlocks(blocks).map((item) => {
          if (item.type === 'scroll-timeline') {
            return renderScrollTimelineGroup(item.group, item.key, photoMap)
          }
          const { block, index: i } = item
          // Day 分隔線只在相鄰兩個 stop 區塊的 day 不同時插入——非 stop
          // 區塊(paragraph/image/gallery)沒有 day 概念,不參與這個判斷。
          // 用 findLast 風格往前找最近一個 stop 區塊的 day,而不是直接
          // 看 blocks[i - 1](前一個 block 可能是 paragraph,沒有 day)。
          let prevDay: number | undefined
          if (block.kind === 'stop') {
            for (let j = i - 1; j >= 0; j--) {
              const prev = blocks[j]
              if (prev.kind === 'stop') { prevDay = prev.day; break }
            }
          }
          const showDayDivider = block.kind === 'stop' && block.day !== undefined && prevDay !== undefined && block.day !== prevDay
          return (
            <div key={block.id}>
              {showDayDivider && block.kind === 'stop' && (
                <div className="theme-page-demo-day-divider">
                  <div className="theme-page-demo-day-divider-line" />
                  <span>Day {block.day}</span>
                  <div className="theme-page-demo-day-divider-line" />
                </div>
              )}
              {renderBlock(block, i, photoMap)}
            </div>
          )
        })}
      </section>

      {/* 頁尾——比照 TainanChikanPage.tsx 的既有掛載方式(整個頁面內容
          最下方,見 CityPageFooter.tsx 的完整說明)。accentColor 傳
          "var(--brick)",跟這個頁面(BlogArticle.css,整份複製
          TainanChikanPage.css 改名而來)已經定義的 --brick/--brick-soft
          色票一致,不另外客製化。 */}
      <CityPageFooter accentColor="var(--brick)" />
    </div>
  )
}
