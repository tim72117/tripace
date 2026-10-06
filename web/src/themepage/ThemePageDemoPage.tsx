import { useEffect, useRef, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { fetchPublicThemePage, type ClientConfig } from '../api'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { useScrollProgress } from '../hooks/useScrollProgress'
import { sampleTainanChikan } from './sampleTainanChikan'
import type { GalleryBlock, ImageBlock, StopBlock, ThemePageBlock, ThemePageContent, ThemePagePalette } from './types'
import './ThemePageDemo.css'

// GUEST_CFG:這個試做頁跟 InteractiveExploreMap.tsx 的既有理由一樣——
// 讀取已發布內容是公開頁面的訪客動作,不需要使用者自己的 JWT,token
// 傳 null(走訪客)。baseURL 沿用 AppCommon.tsx 的 BASE_URL(建置時
// VITE_API_BASE,或退回目前頁面 origin)。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// DEMO_SLUG:這個試做頁固定讀取/demo/theme-page 對應的 slug——驗證
// CLI 寫入的內容(tripace-cli theme-page set -slug tainan-chikan ...)
// 能不能原樣從 API 讀出來渲染,不是通用的「依路由參數決定 slug」頁面
// (那是之後正式頁面才需要的功能)。
const DEMO_SLUG = 'tainan-chikan'

// PALETTE_OPTIONS:試做頁專用的風格切換選單——純粹是這個 demo 頁拿來
// 肉眼驗證「同一份內容資料套用不同 palette 值,視覺是否如預期切換」
// 用的,不是正式功能(正式的 palette 值是存在 ThemePageContent.palette
// 裡,由內容本身決定,不是讀者在前端自由切換)。選項對齊 types.ts
// 的 ThemePagePalette 列舉值,新增 palette 時這裡也要補一筆。
const PALETTE_OPTIONS: Array<{ value: ThemePagePalette | undefined; label: string }> = [
  { value: undefined, label: '紙感和風（預設）' },
  { value: 'ocean-cool', label: '海洋藍調' },
  { value: 'night-market', label: '夜市暖調' },
]

// ThemePageDemoPage:規格化內容渲染試做——驗證 docs/
// refactor-theme-page-content-cms-plan-2026-10.md 定的 ThemePageContent
// 規格(見 types.ts)是否能從扁平 blocks 陣列還原 TainanChikanPage.tsx
// 現有排版。資料來源是 sampleTainanChikan.ts(手動把 TainanChikanPage
// 的 STOPS 轉成新規格,不碰資料庫/CLI/API——這一步只驗證「規格本身
// 夠不夠用」)。
//
// 樣式沿用 TainanChikanPage.css 整份複製改名(ThemePageDemo.css,
// class 前綴 tainan-chikan- → theme-page-demo-),刻意不改動任何視覺
// 數值——這個試做頁的目的是證明「同一份排版效果可以從規格化 JSON
// 渲染出來」,不是重新設計視覺。
//
// 照片網址:TainanChikanPage.tsx 的 PHOTO_TAGGING_PREVIEW_BASE 常數值,
// 直接沿用(同一批 GCS 物件,公開可讀)。
const PHOTO_BASE = 'https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan'

function photoUrl(file: string) {
  return `${PHOTO_BASE}/${file}`
}

// renderImageBlock/renderGalleryBlock:image/gallery 這兩種 kind 同時
// 出現在頂層 blocks 與 StopBlock.media 裡(見 types.ts,media 複用同一組
// 型別),抽成獨立函式讓兩處呼叫同一份渲染邏輯,不需要各自重寫一次。
function renderImageBlock(block: ImageBlock) {
  return (
    <div key={block.id} className="theme-page-demo-stop-gallery theme-page-demo-stop-gallery--single">
      <figure>
        <img src={photoUrl(block.file)} alt={block.alt} loading="lazy" />
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
          <img src={photoUrl(photo.file)} alt={photo.alt} loading="lazy" />
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
// 防禦寫法,不是多餘分支)。
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

export function ThemePageDemoPage() {
  const { theme } = useThemeToggle()
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  // 掛載時打一次 GET /v1/theme-pages/tainan-chikan——驗證「CLI 寫入的
  // 內容能不能從 API 原樣讀出來渲染」,不是重新發明一套資料來源。失敗
  // (包含 404,例如還沒 publish,或 200 但內容形狀不對,見上方
  // isThemePageContentShape 的完整說明)一律退回常數資料,見上方
  // FetchState 的完整說明,不讓使用者看到空白頁或錯誤畫面。
  useEffect(() => {
    let cancelled = false
    fetchPublicThemePage(GUEST_CFG, DEMO_SLUG)
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
  }, [])

  const content = state.kind === 'api' ? state.content : sampleTainanChikan
  const mapIntroRef = useRef<HTMLDivElement | null>(null)
  const { blocks } = content
  useScrollProgress(blocks.length, mapIntroRef)

  // paletteOverride:demo 專用的試玩狀態,預設套用 content.palette(資料
  // 本身指定的風格),但允許在這個試做頁上直接點按鈕切換,不用改資料
  // 重新整理頁面就能比較效果——正式頁面不會有這個選單,只會讀
  // content.palette 本身的值(見上方 PALETTE_OPTIONS 的完整說明)。
  //
  // 這個 state 用 content.palette 初始化一次,之後若 API 回應才抵達
  // (loading → api 的切換)不會覆蓋使用者已經手動點選的 override——
  // 用 useState 的初始值語意即可達成,不需要額外 useEffect 同步。
  const [paletteOverride, setPaletteOverride] = useState<ThemePagePalette | undefined>(content.palette)

  return (
    <div className="theme-page-demo-page" data-theme={theme ?? undefined} data-palette={paletteOverride}>
      <div className="theme-page-demo-data-source">
        {state.kind === 'loading' && '讀取中…'}
        {state.kind === 'api' && `已從 API 讀取 /v1/theme-pages/${DEMO_SLUG}`}
        {state.kind === 'fallback' && `API 讀取失敗，顯示內建範例資料（${state.reason}）`}
      </div>
      <div className="theme-page-demo-palette-switcher">
        {PALETTE_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`theme-page-demo-palette-btn${paletteOverride === opt.value ? ' is-active' : ''}`}
            onClick={() => setPaletteOverride(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
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
      </header>

      <section className="theme-page-demo-stops">
        {blocks.map((block, i) => {
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
    </div>
  )
}
