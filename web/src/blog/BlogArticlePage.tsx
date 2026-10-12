import { useEffect, useRef, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { ApiError, fetchPublicBlogArticle, fetchPublicBlogPhotosByIDs, type ClientConfig, type PublicUploadedPhoto } from '../api'
import { NotFoundPage } from '../home/NotFoundPage'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { useScrollProgress } from '../hooks/useScrollProgress'
import { ScrollTimeline } from '../home/ScrollTimeline'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import { trackEvent } from '../analytics'
import { CityPageFooter } from '../home/CityPageFooter'
import { sampleTainanChikan } from './sampleTainanChikan'
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
function collectPhotoIds(blocks: ThemePageBlock[]): string[] {
  const ids = new Set<string>()
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
// ——這是為了相容 sampleTainanChikan.ts 那份純展示用的常數資料(API
// 失敗時的 fallback 內容,見本檔開頭 BlogArticlePage 的完整說明):那
// 份資料本來就不是真實的 uploaded_photos 記錄,photoId 欄位存的其實是
// 固定 GCS bucket 下的檔名字串(例如 "IMG_9812.webp"),不會出現在批次
// 查詢回來的 photoMap 裡,刻意讓這個 fallback 兼容兩種來源,不需要
// 另外用一個欄位或旗標區分「這是真的 photoId 還是舊式檔名」。
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

// BlogArticlePage:部落客發文正式頁面——驗證 docs/
// refactor-theme-page-content-cms-plan-2026-10.md 定的 ThemePageContent
// 規格(見 types.ts)是否能從扁平 blocks 陣列還原排版。資料實際來源是
// 依 props 傳入的 handle/slug,呼叫 fetchPublicBlogArticle(見 api.ts)向
// 後端查詢對應作者、對應文章的已發布內容;API 失敗(含尚未 publish、
// 後端端點尚未就緒等情況)退回 sampleTainanChikan 常數,讓頁面在沒有
// 真實資料時仍能展示排版效果(見下方 FetchState 的完整說明)。
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
function renderImageBlock(block: ImageBlock, photoMap: Map<string, PublicUploadedPhoto>) {
  return (
    <div key={block.id} className="theme-page-demo-stop-gallery theme-page-demo-stop-gallery--single">
      <figure>
        <img
          src={resolvePhotoURL(photoMap, block.photoId)}
          alt={block.alt}
          loading="lazy"
          style={{ objectPosition: objectPositionFor(resolvePhotoFocal(photoMap, block.photoId, block.focal)) }}
        />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    </div>
  )
}

function renderGalleryBlock(block: GalleryBlock, photoMap: Map<string, PublicUploadedPhoto>) {
  return (
    <div key={block.id} className="theme-page-demo-stop-gallery">
      {block.items.map((photo) => (
        <figure key={photo.photoId}>
          <img
            src={resolvePhotoURL(photoMap, photo.photoId)}
            alt={photo.alt}
            loading="lazy"
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

// FetchState:四態——'loading' 剛掛載還沒拿到回應;'api' 成功拿到後端
// 已發布的內容;'not-found' 後端明確回 404(該 handle/slug 查無已發布
// 文章),渲染真正的 404 畫面,不冒充成任何其他文章的內容;'fallback'
// 其他失敗(server 沒開、網路錯誤、200 但內容形狀不對)時退回
// sampleTainanChikan 常數,讓這個頁面原本「展示排版效果」的既有用途
// (後端尚未就緒時仍能預覽)繼續成立。
//
// 2026-10 修正:這個頁面轉正前是固定讀單一 demo slug 的試做版本,任何
// 失敗(包含 404)一律退回 sample 常數是合理的——那時沒有「查無特定
// 文章」這個情境,只有「後端有沒有準備好」。轉正成依路徑參數讀取任意
// 作者/文章後,404 代表「這篇文章真的不存在」,此時顯示另一篇文章
// (赤崁)的完整內容會讓使用者誤以為查到了真實存在的文章,是錯誤的
// 使用者體驗,必須跟「後端真的掛了」分開處理。
type FetchState =
  | { kind: 'loading' }
  | { kind: 'api'; content: ThemePageContent }
  | { kind: 'not-found' }
  | { kind: 'fallback'; reason: string }

// isThemePageContentShape:最小的執行期結構檢查——只驗證會被這個檔案
// 直接存取的欄位(title 是字串、blocks 是陣列),不逐一檢查每個 Block
// kind 內部欄位(那層驗證複雜度不值得放在渲染前的守門邏輯)。原本
// 這裡直接把 API 回應的 content `as ThemePageContent` 斷言過去,一旦
// 後端回應的內容缺少 blocks/title(例如後端驗證漏洞放過的非物件
// content,或未來的 schema 不一致),會在渲染時直接對 undefined 呼叫
// .length/.split() 拋錯——此時 HTTP 狀態是 200,fetchPublicThemePage
// 的 Promise 會 resolve 而非 reject,.catch() 永遠不會被觸發,FetchState
// 設計的「失敗退回 fallback」機制就完全失效。這裡在 resolve 分支裡
// 自己做最小驗證,驗證失敗時手動轉成 fallback 狀態,讓這個防線真正
// 涵蓋「HTTP 成功但內容形狀不對」的情況,不只是「HTTP 失敗」。
function isThemePageContentShape(v: unknown): v is ThemePageContent {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return typeof obj.title === 'string' && Array.isArray(obj.blocks)
}

export function BlogArticlePage({ handle, slug }: { handle: string; slug: string }) {
  const { theme, dark, toggleTheme } = useThemeToggle()
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  // 掛載時打一次 GET /v1/blog/{handle}/{slug}(見 api.ts
  // fetchPublicBlogArticle 的完整說明),依路由傳入的作者 handle + 文章
  // slug 讀取對應的已發布內容。失敗(包含 404,例如還沒 publish、後端
  // 端點尚未就緒,或 200 但內容形狀不對,見上方 isThemePageContentShape
  // 的完整說明)一律退回常數資料,見上方 FetchState 的完整說明,不讓
  // 使用者看到空白頁或錯誤畫面。handle/slug 變動時(例如同一元件在
  // 不同路由參數下重新掛載)重新查詢。
  useEffect(() => {
    let cancelled = false
    fetchPublicBlogArticle(GUEST_CFG, handle, slug)
      .then((res) => {
        if (cancelled) return
        if (!isThemePageContentShape(res.content)) {
          setState({ kind: 'fallback', reason: 'API 回應的 content 形狀不符 ThemePageContent（缺少 title/blocks）' })
          return
        }
        setState({ kind: 'api', content: res.content })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.call.status === 404) {
          setState({ kind: 'not-found' })
          return
        }
        setState({ kind: 'fallback', reason: err instanceof Error ? err.message : String(err) })
      })
    return () => { cancelled = true }
  }, [handle, slug])

  const content = state.kind === 'api' ? state.content : sampleTainanChikan
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
  // 與 'fallback' 狀態下 content 會是 sampleTainanChikan 常數(見上方
  // content 的三元運算式),此時 blocks 裡的 photoId 其實是
  // sampleTainanChikan.ts 的假檔名字串(例如 "IMG_9812.webp"),從來
  // 不會在 uploaded_photos 查到任何結果——但 effect 仍會無條件對真實
  // 後端 /public/blog/photos 發出一次查詢,保證查無結果,是一次單純的
  // 浪費(元件掛載時 state 預設是 'loading',幾乎每次載入文章都會打到
  // 這次多餘的請求)。改成多檢查 state.kind,'api' 以外的狀態都不觸發
  // 查詢、維持空 Map。
  const [photoMap, setPhotoMap] = useState<Map<string, PublicUploadedPhoto>>(new Map())
  useEffect(() => {
    if (state.kind !== 'api') return
    let cancelled = false
    const ids = collectPhotoIds(blocks)
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
  }, [state.kind, blocks])

  // not-found 直接渲染真正的 404 畫面,不走下面的 content 渲染邏輯
  // ——見上方 FetchState 的完整說明。放在所有 Hook 呼叫之後才 early
  // return,維持 Hook 呼叫順序在每次渲染都一致(React Hooks 規則:
  // Hook 不能被條件式跳過)。
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
      <header className="theme-page-demo-hero">
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
      </header>

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
