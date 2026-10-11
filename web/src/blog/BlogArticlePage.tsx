import { useEffect, useRef, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { fetchPublicBlogArticle, type ClientConfig } from '../api'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { useScrollProgress } from '../hooks/useScrollProgress'
import { ScrollTimeline } from '../home/ScrollTimeline'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
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

// FAKE_AUTHOR——2026-10 暫時假資料(使用者要求「先把三種位置都放進去
// 比較」):後端 theme_pages 表目前沒有 owner/userId/作者頭像等欄位
// (見 docs/brainstorm/2026-10-product-direction-brainstorm.md 構想五
// 的完整說明,這批功能排在後端 userId 欄位與查詢改造之後才會真的接上
// 真實資料),這裡只是讓三種版面位置有內容可以渲染比較,之後要接真實
// 作者資料時,整個换成從 content(或後端回應)讀取真正欄位即可,三個
// renderAuthorXxx 函式本身不需要大改,只是資料來源從這個假常數換成
// 真實欄位。
const FAKE_AUTHOR = {
  name: 'tim72117',
  avatarUrl: 'https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan/IMG_9812.webp',
  bio: '喜歡到處走走拍照，把走過的路線整理成文章分享給大家。',
  publishedAt: '2026-10-12',
}

// renderAuthorInline——方案一:Hero eyebrow 上方,小圓形頭像+作者名+
// 發布日期一行,對齊 Medium 的慣例(讀者進頁第一眼先看到作者身份)。
function renderAuthorInline() {
  return (
    <div className="theme-page-demo-author theme-page-demo-author--inline">
      <img className="theme-page-demo-author-avatar" src={FAKE_AUTHOR.avatarUrl} alt={FAKE_AUTHOR.name} />
      <span className="theme-page-demo-author-name">{FAKE_AUTHOR.name}</span>
      <span className="theme-page-demo-author-sep">·</span>
      <time className="theme-page-demo-author-date">{FAKE_AUTHOR.publishedAt}</time>
    </div>
  )
}

// renderAuthorBelowLede——方案二:導言(lede)下方,同樣是頭像+作者名+
// 發布日期一行,只是位置延後到標題/導言讀完之後,讓讀者先專注內容本身。
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

// renderAuthorCard——方案三:獨立作者卡片,放在文章內文結尾,頭像更大
// 一些、附上簡介(bio),類似部落格常見的「關於作者」區塊。
function renderAuthorCard() {
  return (
    <div className="theme-page-demo-author-card">
      <img className="theme-page-demo-author-card-avatar" src={FAKE_AUTHOR.avatarUrl} alt={FAKE_AUTHOR.name} />
      <div className="theme-page-demo-author-card-body">
        <div className="theme-page-demo-author-card-name">{FAKE_AUTHOR.name}</div>
        <p className="theme-page-demo-author-card-bio">{FAKE_AUTHOR.bio}</p>
      </div>
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
function renderImageBlock(block: ImageBlock) {
  return (
    <div key={block.id} className="theme-page-demo-stop-gallery theme-page-demo-stop-gallery--single">
      <figure>
        <img
          src={photoUrl(block.file)}
          alt={block.alt}
          loading="lazy"
          style={{ objectPosition: objectPositionFor(block.focal) }}
        />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    </div>
  )
}

function renderGalleryBlock(block: GalleryBlock) {
  return (
    <div key={block.id} className="theme-page-demo-stop-gallery">
      {block.items.map((photo) => (
        <figure key={photo.file}>
          <img
            src={photoUrl(photo.file)}
            alt={photo.alt}
            loading="lazy"
            style={{ objectPosition: objectPositionFor(photo.focal) }}
          />
          {photo.caption && <figcaption>{photo.caption}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function StopCard({ block, index }: { block: StopBlock; index: number }) {
  return (
    <article className="theme-page-demo-stop" data-index={index}>
      <div className="theme-page-demo-stop-head">
        {block.index && <span className="theme-page-demo-stop-index">{block.index}</span>}
        <h2>{block.name}</h2>
      </div>
      <p className="theme-page-demo-stop-body">{block.desc}</p>
      {block.blurb && <p className="theme-page-demo-stop-blurb">{block.blurb}</p>}
      {block.media.map((m) => (m.kind === 'image' ? renderImageBlock(m) : renderGalleryBlock(m)))}
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
function renderBlock(block: ThemePageBlock, index: number) {
  switch (block.kind) {
    case 'paragraph':
      return <p key={block.id} className="theme-page-demo-paragraph">{block.text}</p>
    case 'image':
      return renderImageBlock(block)
    case 'gallery':
      return renderGalleryBlock(block)
    case 'stop':
      return <StopCard key={block.id} block={block} index={index} />
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
function renderScrollTimelineGroup(group: ScrollTimelineGroup, key: string) {
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
          {content.map((b, i) => renderBlock(b, i))}
        </ScrollTimeline.Anchor>
      ))}
    </ScrollTimeline>
  )
}

// FetchState:三態——'loading' 剛掛載還沒拿到回應;'api' 成功拿到後端
// 已發布的內容;'fallback' 打 API 失敗(server 沒開、該 slug 還沒
// publish、404 等)時退回 sampleTainanChikan 常數,讓這個試做頁在沒有
// 後端可用時仍能預覽排版效果,不會整頁空白。
type FetchState =
  | { kind: 'loading' }
  | { kind: 'api'; content: ThemePageContent }
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
        setState({ kind: 'fallback', reason: err instanceof Error ? err.message : String(err) })
      })
    return () => { cancelled = true }
  }, [handle, slug])

  const content = state.kind === 'api' ? state.content : sampleTainanChikan
  const mapIntroRef = useRef<HTMLDivElement | null>(null)
  const { blocks } = content
  useScrollProgress(blocks.length, mapIntroRef)

  return (
    <div className="theme-page-demo-page" data-theme={theme ?? undefined} data-palette={content.palette}>
      {/* 商標+登入按鈕——比照 TainanChikanPage.tsx 的既有掛載方式
          (見 SiteNavButtons.tsx 的完整說明),這個頁面轉正前完全沒有
          任何站台導覽 UI。pageLabel 省略(文章頁沒有固定城市/主題標籤,
          不比照城市介紹頁那種「九份」「赤崁・府城」式的頁面標籤)。 */}
      <SiteNavBrand />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">登入</SiteNavCta>
      <header className="theme-page-demo-hero">
        {/* 方案一:eyebrow 上方——見 renderAuthorInline 的完整說明。 */}
        {renderAuthorInline()}
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
        {/* 方案二:導言下方——見 renderAuthorBelowLede 的完整說明。 */}
        {renderAuthorBelowLede()}
      </header>

      {/* 方案三:獨立作者卡片,文章內文結尾——見 renderAuthorCard 的
          完整說明。這裡先放在時間軸/內文 section 之前(文章最開頭),
          方便跟方案一/二同時在同一頁比較;之後選定方案時這裡的位置
          會跟著調整(例如移到 section 結尾)。 */}
      {renderAuthorCard()}

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
            return renderScrollTimelineGroup(item.group, item.key)
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
              {renderBlock(block, i)}
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
