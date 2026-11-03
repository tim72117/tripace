import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Sparkles, MapPin, Image as ImageIcon, Type, Images, X, GripVertical, Quote, Pilcrow } from 'lucide-react'
import type * as api from '../api'
import * as apiFns from '../api'
import { errMsg } from '../AppCommon'
import { PhotoManagerBody, type StagedController } from './PhotoManagerPage'
import { PhotoPickerModal } from './PhotoPickerModal'
import { useConfirmDialog } from '../components/ConfirmDialog'
import {
  NEW_ARTICLE_KEY,
  deleteArticleDraft,
  draftScope,
  loadArticleDraft,
  saveArticleDraft,
  type ArticleDraft,
} from './draftStore'
import { ArticleAiPanel, BLOG_ARTICLE_AI_ENABLED } from './ArticleAiPanel'
import type { ArticleEditorHandle } from './articleTools'
import {
  combinePhotos,
  dropStagedBlocks,
  isStagedId,
  remapPhotoIds,
  stagedIdsIn,
  stagedKeyOf,
  type StagedPhotoView,
} from './stagedPhotos'
import type {
  ThemePageBlock,
  ThemePageContent,
  ThemePagePalette,
  ParagraphBlock,
  ParagraphVariant,
  ImageBlock,
  GalleryBlock,
  StopBlock,
  ImageWidth,
  ImageFloat,
} from './types'
import styles from './ArticleEditor.module.css'

// ArticleEditor:2026-10 從 demo/RouteEditor.tsx(旅程分享/路徑編輯器
// 試做)整個搬過來重用成「文章編輯器」骨架,第二輪(2026-10)已改成
// 正式對齊 blog/types.ts 的 ThemePageContent 規格,並串接
// content_pages 的 create/update/publish API(見 api.ts
// createMyContentPage/updateMyContentPage/fetchMyContentPage/
// setMyContentPagePublished 的完整說明)——不再是純前端假資料原型。
//
// 這一輪的支援範圍(使用者明確要求):
//  - paragraph/image/gallery 三種 block 真正可編輯、可插入、會存進
//    content 並透過 API 存檔——image/gallery 插入時從「圖片素材庫」
//    (下方 PhotoManagerBody)選真實 photoId,不是舊版的隨機漸層色塊
//    佔位。
//  - stop(站點卡片,對齊規格裡的逐站介紹 widget,見 types.ts
//    StopBlock 的完整說明)這一輪只做「如果內容裡已經有這個 kind,
//    渲染端要能正常展示」——沿用先前版本的地點卡視覺(縮圖+名稱+
//    描述),但編輯器選單的「插入地點」目前停用並標註「規劃中」,
//    不會讓使用者透過這個編輯器新增/編輯 stop block。理由:使用者
//    明確要求「改成類似時間軸的 widget,讓使用者選用,先保留前端示範
//    樣式跟設定規格就好,先不做進正式資料」——跟 scroll-timeline-*
//    系列(這一輪完全不支援插入 UI)是同一個層級的決定,stop 比
//    scroll-timeline-* 多保留「既有內容要能展示」這一步,是因為
//    stop 在規格文件裡本來就有完整定義、且先前版本已經有一套視覺
//    可以直接沿用展示,不是從零設計。
//
// 左側常駐地圖(選點/即時連線)刻意先不做(見下方 BLOG_EDITOR_ENABLED
// 的既有說明)——插入圖片/圖組一樣只能從已上傳的素材庫選,不能從地圖
// 選點/帶入既有 attraction 資料;選單裡繼續停用「插入路線總覽圖」
// (需要地圖上的站點座標才能畫)。
//
// 型別/互動沿用 artifact mockup 驗證過的設計:contentEditable 風格的
// 行內編輯(點什麼就編什麼,沒有另外的「編輯模式」),區塊間隙 hover 浮現
// 插入按鈕,圖片區塊可切換全寬/靠左文繞/靠右文繞。

let blockSeq = 0
function newBlockId() {
  blockSeq += 1
  return `blk_${blockSeq}`
}

// EditableImageBlock/EditableGalleryBlock:這份型別跟 types.ts 的
// ImageBlock/GalleryBlock 完全相同,只是重新 export 出來給本檔其餘函式
// 簽名引用,避免每個用到的地方都要寫一次完整聯集路徑。
type EditableBlock = ParagraphBlock | ImageBlock | GalleryBlock | StopBlock

function emptyParagraph(): ParagraphBlock {
  return { id: newBlockId(), kind: 'paragraph', text: '' }
}

function emptyImage(photo: api.UploadedPhoto): ImageBlock {
  return {
    id: newBlockId(),
    kind: 'image',
    photoId: photo.id,
    alt: '',
    width: 'full',
    float: 'none',
  }
}

function emptyGallery(photos: api.UploadedPhoto[]): GalleryBlock {
  return {
    id: newBlockId(),
    kind: 'gallery',
    items: photos.map((p) => ({ photoId: p.id, alt: '' })),
    layout: 'grid',
  }
}

// photoURLFor:從素材庫清單裡找出指定 photoId 對應的縮圖網址——優先用
// thumbnail variant(列表/編輯畫面不需要原圖解析度),找不到(例如還在
// pending 處理中)退回 originalUrl。找不到這個 photoId 本身(素材庫
// 清單裡已被刪除)回傳 undefined,呼叫端顯示「圖片已移除」的提示。
function photoURLFor(photos: api.UploadedPhoto[], photoId: string): string | undefined {
  const p = photos.find((x) => x.id === photoId)
  if (!p) return undefined
  const thumb = p.variants?.find((v) => v.kind === 'thumbnail')
  return thumb?.url ?? p.originalUrl
}

// photoAspectRatioFor:從素材庫清單裡找出指定 photoId 的真實寬高比
// (width/height),供渲染端當 CSS aspect-ratio 用,取代原本寫死的固定
// 比例(例如 1.4/1)佔位——2026-10 使用者明確要求「圖片用佔位的實際圖
// 大小」,圖片載入前就用真實比例撐出空間,避免載入完成後版面跳動,也
// 避免寫死比例的佔位框跟實際圖片形狀不符(例如直式照片套橫式佔位)。
// 優先用 thumbnail variant 的尺寸(理由同 photoURLFor:編輯畫面顯示的
// 就是這個 variant),查無 variant 尺寸時退回原圖的 width/height(見
// UploadedPhoto.width/height 的完整說明:選填,後端尚未處理完成時可能
// 是 undefined)。兩者都查無時回傳 undefined,呼叫端退回 CSS 既有的
// 固定比例(見 ArticleEditor.module.css 各區塊原本的 aspect-ratio
// 規則,當成找不到真實尺寸時的合理預設值,不是整組拔掉)。
function photoAspectRatioFor(photos: api.UploadedPhoto[], photoId: string): number | undefined {
  const p = photos.find((x) => x.id === photoId)
  if (!p) return undefined
  const thumb = p.variants?.find((v) => v.kind === 'thumbnail')
  if (thumb) return thumb.width / thumb.height
  if (p.width && p.height) return p.width / p.height
  return undefined
}

// PARAGRAPH_VARIANTS:段落變體切換選單的選項清單——對齊 types.ts
// ParagraphVariant 的四個值,label 用單字簡短標示(按鈕空間有限),完整
// 語意說明見該型別定義處。undefined(一般內文)不在清單裡,用「清除
// 變體」按鈕另外處理(見 ParagraphVariantMenu)。
const PARAGRAPH_VARIANTS: { value: ParagraphVariant; label: string }[] = [
  { value: 'heading', label: 'H' },
  { value: 'emphasis', label: 'E' },
  { value: 'quote', label: '"' },
  { value: 'caption', label: 'C' },
]

// ParagraphVariantMenu:段落左側 hover 浮現的樣式變體切換選單——對齊
// types.ts ParagraphVariant 的完整說明(heading/emphasis/quote/
// caption),選中目前已套用的變體會高亮,再點一次會清除(切回一般
// 內文,undefined)。
function ParagraphVariantMenu({
  value,
  onChange,
}: {
  value: ParagraphVariant | undefined
  onChange: (next: ParagraphVariant | undefined) => void
}) {
  return (
    <div className={styles.sideMenu}>
      {PARAGRAPH_VARIANTS.map((v) => (
        <button
          key={v.value}
          type="button"
          className={`${styles.sideMenuBtn}${value === v.value ? ` ${styles.sideMenuBtnActive}` : ''}`}
          title={v.value}
          onClick={() => onChange(value === v.value ? undefined : v.value)}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

function EditableDiv({
  className,
  value,
  placeholder,
  onChange,
  previewing = false,
  dataVariant,
}: {
  className: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  previewing?: boolean
  // dataVariant:輸出 data-variant 屬性(2026-10 第五輪新增)——對齊
  // ArticleEditor.module.css [data-variant="xxx"] 與 BlogArticle.css
  // 同名屬性選擇器的既有慣例,讓段落變體樣式套用在編輯器跟公開頁用
  // 同一套屬性選擇器機制。undefined 時不輸出屬性,維持一般內文樣式。
  dataVariant?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className={className}
      contentEditable={!previewing}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-variant={dataVariant}
      onBlur={(e) => onChange(e.currentTarget.textContent ?? '')}
    >
      {value}
    </div>
  )
}

function InsertMenu({
  open,
  onToggle,
  onInsertParagraph,
  onInsertImage,
  onInsertGallery,
}: {
  open: boolean
  onToggle: () => void
  onInsertParagraph: () => void
  onInsertImage: () => void
  onInsertGallery: () => void
}) {
  return (
    <div className={styles.gap}>
      <div className={styles.gapLine} />
      <div className={`${styles.insertBtn}${open ? ` ${styles.menuOpen}` : ''}`} onClick={onToggle}>
        +
      </div>
      {open && (
        <div className={styles.insertMenu}>
          <button type="button" className={styles.insertMenuItem} onClick={onInsertImage}>
            <span className={styles.insertMenuIcon}><ImageIcon size={15} strokeWidth={2} /></span>
            插入圖片
          </button>
          <button type="button" className={styles.insertMenuItem} onClick={onInsertGallery}>
            <span className={styles.insertMenuIcon}><Images size={15} strokeWidth={2} /></span>
            插入圖組
          </button>
          {/* 插入地點(stop widget)——使用者明確要求這一輪先不接進正式
              資料,見本檔開頭說明,停用並標註「規劃中」,不是移除整個
              選項(日後設計成類似 ScrollTimeline 的可選 widget 時,
              這裡預留了選單位置)。 */}
          <button type="button" className={styles.insertMenuItem} disabled title="站點卡片 widget 規劃中,尚未開放插入">
            <span className={styles.insertMenuIcon}><MapPin size={15} strokeWidth={2} /></span>
            插入地點（規劃中）
          </button>
          <button type="button" className={styles.insertMenuItem} onClick={onInsertParagraph}>
            <span className={styles.insertMenuIcon}><Type size={15} strokeWidth={2} /></span>
            插入段落
          </button>
        </div>
      )}
    </div>
  )
}

// buildContent:把編輯器目前的 state 組裝成要送給後端的 ThemePageContent
// ——slug 由呼叫端(save)決定,這裡只負責 title/lede/blocks 這些編輯器
// 直接管理的欄位,version/status 固定值(見 ThemePageContent 的完整
// 說明:version 目前固定 1,status 由獨立的發布/取消發布流程決定,
// save 本身不動 status)。
function buildContent(
  slug: string,
  title: string,
  lede: string,
  blocks: EditableBlock[],
  status: 'draft' | 'published',
  palette: ThemePagePalette | undefined,
  heroPhotoId: string | undefined,
  extra: Record<string, unknown>,
): ThemePageContent {
  return {
    // extra:載入時編輯器不管理的欄位(eyebrow、heroStandalonePhotoId、preferredTheme,以及未來新增的欄位)原樣帶回,
    // 否則在編輯器存一次就會把它們從後端內容洗掉。放最前面,讓下面編輯器管理的欄位覆蓋。
    ...(extra as Partial<ThemePageContent>),
    version: 1,
    slug,
    title,
    lede: lede || undefined,
    blocks: blocks as ThemePageBlock[],
    status,
    palette,
    heroPhotoId,
  }
}

// slugify:從標題產生一個網址友善的 slug——只在「新建文章」且使用者
// 還沒手動指定過 slug 時用來帶一個預設值,不是強制規則(使用者可以在
// 存檔前自己改,見下方 slug 欄位)。非常簡化(只處理英數字/中文,其餘
// 字元換成連字號),不追求對齊完整的 URL slug 規範,夠用即可。
function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return base || `article-${Date.now()}`
}

// cfg:掛載 PhotoManagerBody(圖片上傳/管理)跟串接 content_pages API
// 都需要的登入設定。slug——要打開哪一篇既有文章,null 代表「新建」
// (見 planning/member/desktop/Content.tsx editingArticleSlug 的說明)。onBack(選填)
// ——使用者明確要求「編輯畫面要可以返回清單」,呼叫端(planning/member/desktop/Content.tsx)
// 傳入時切回 panelMode:'blog';省略時不顯示返回按鈕(維持這個元件可以
// 在沒有面板系統的情境下獨立渲染的彈性)。
export function ArticleEditor({
  cfg,
  slug: initialSlug,
  onBack,
}: {
  cfg: api.ClientConfig
  slug?: string | null
  onBack?: () => void
}) {
  const [loading, setLoading] = useState(initialSlug != null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [slug, setSlug] = useState(initialSlug ?? '')
  const [slugLocked, setSlugLocked] = useState(initialSlug != null)
  const [title, setTitle] = useState('')
  const [lede, setLede] = useState('')
  const [blocks, setBlocks] = useState<EditableBlock[]>([])
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  // palette:對齊 types.ts ThemePageContent.palette(2026-10 第五輪
  // 新增)——undefined 代表省略(套用預設的 paper-warm 基調,見
  // ArticleEditor.module.css 的完整說明,不需要額外的 data-palette
  // 屬性值)。作者在編輯器裡切換,存檔時原樣寫進 content.palette,公開
  // 頁讀到同一個值套用一致的配色。
  const [palette, setPalette] = useState<ThemePagePalette | undefined>(undefined)
  // heroPhotoId:文章封面(types.ts ThemePageContent.heroPhotoId,公開頁當 Hero 滿版背景)。從素材庫挑;
  // 可以是尚未上傳的 staged:<key>,儲存時跟區塊裡的待上傳圖片一起上傳並換成真實 id。
  const [heroPhotoId, setHeroPhotoId] = useState<string | undefined>(undefined)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [openMenuAt, setOpenMenuAt] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [picker, setPicker] = useState<{ mode: 'single' | 'multi'; atIndex: number } | null>(null)
  // serverPhotos:後端素材庫;stagedList:已選檔、尚未上傳的圖片(PhotoManagerBody 的待上傳區回報)。
  // photos = 兩者合併,編輯畫面、選圖器與 AI 工具都用它——待上傳的圖以 staged:<key> 當 photoId,儲存前才上傳並換成真實 id(見 stagedPhotos.ts)。
  const [serverPhotos, setPhotos] = useState<api.UploadedPhoto[]>([])
  const [stagedList, setStagedList] = useState<StagedPhotoView[]>([])
  const photos = useMemo(() => combinePhotos(serverPhotos, stagedList), [serverPhotos, stagedList])
  const stagedCtlRef = useRef<StagedController | null>(null)
  const extraContentRef = useRef<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // AI 協助撰寫(ArticleAiPanel + articleTools)的控制介面。工具在同一輪裡會連續呼叫多次,React 還沒重繪就要讀到
  // 前一次的結果,所以另外用 ref 保存「最新」的 title/lede/blocks/photos,setState 時同步更新 ref 再寫進 state。
  // 只改編輯器裡未存檔的狀態,所以一律標記為 dirty。
  const latestRef = useRef({
    title: '',
    lede: '',
    blocks: [] as EditableBlock[],
    photos: [] as api.UploadedPhoto[],
    staged: [] as StagedPhotoView[],
    slug: '',
    slugLocked: false,
    status: 'draft' as 'draft' | 'published',
    palette: undefined as ThemePagePalette | undefined,
    heroPhotoId: undefined as string | undefined,
    dirty: false,
    hasPendingDraft: false,
    draftKey: NEW_ARTICLE_KEY,
    scope: 'anon',
    draftFailed: false,
  })
  latestRef.current.slug = slug
  latestRef.current.slugLocked = slugLocked
  latestRef.current.status = status
  latestRef.current.palette = palette
  latestRef.current.heroPhotoId = heroPhotoId
  latestRef.current.dirty = dirty
  latestRef.current.title = title
  latestRef.current.lede = lede
  latestRef.current.blocks = blocks
  latestRef.current.photos = photos
  // aiOpen:AI 側欄是否展開。預設:新文章(沒有 slug)展開——那正是「輸入概略讓 AI 排章節」的入口,既有文章收合;
  // 使用者手動開關後記在 localStorage(同一個瀏覽器延續)。localStorage 取不到時退回預設。
  const [aiOpen, setAiOpen] = useState<boolean>(() => {
    if (!BLOG_ARTICLE_AI_ENABLED) return false
    try {
      const v = localStorage.getItem('blog.articleAi.open')
      if (v === '1') return true
      if (v === '0') return false
    } catch {
      /* 無痕/封鎖儲存時忽略 */
    }
    return initialSlug == null
  })
  const [aiBusy, setAiBusy] = useState(false)
  // flashBlockId:AI 剛新增/修改的區塊 id,短暫加上閃爍樣式並捲到視窗內。
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null)
  function toggleAi() {
    setAiOpen((v) => {
      const next = !v
      try {
        localStorage.setItem('blog.articleAi.open', next ? '1' : '0')
      } catch {
        /* 同上 */
      }
      return next
    })
  }
  const aiToggleRef = useRef<HTMLButtonElement | null>(null)
  function closeAi() {
    setAiOpen(false)
    try {
      localStorage.setItem('blog.articleAi.open', '0')
    } catch {
      /* 同上 */
    }
    aiToggleRef.current?.focus()
  }
  // 本機草稿(IndexedDB,見 draftStore.ts):有未儲存的變更時 debounce 寫入,重新整理/誤關分頁後再開同一篇會詢問是否還原。
  // pendingDraft:偵測到、尚未決定還原或捨棄的草稿;決定之前不寫入新草稿,避免蓋掉它。
  const scope = draftScope(cfg.token)
  const [pendingDraft, setPendingDraft] = useState<ArticleDraft | null>(null)
  const draftKey = slugLocked ? slug : NEW_ARTICLE_KEY
  const { ask, dialog: confirmDialog } = useConfirmDialog()
  latestRef.current.hasPendingDraft = pendingDraft !== null
  latestRef.current.draftKey = draftKey
  latestRef.current.scope = scope

  // flushDraft:立刻把目前未儲存的內容寫進本機草稿(不等 debounce)。離開編輯器、卸載、關分頁前呼叫,
  // 避免最後 0.5 秒內的改動沒存到。一律讀 latestRef,不依賴 render 當下的值。
  function flushDraft() {
    const c = latestRef.current
    if (!c.dirty || c.hasPendingDraft) return
    if (!c.slugLocked && c.title === '' && c.lede === '' && c.blocks.length === 0) return
    void saveArticleDraft(c.scope, c.draftKey, {
      title: c.title,
      lede: c.lede,
      blocks: c.blocks,
      palette: c.palette,
      heroPhotoId: c.heroPhotoId,
      savedAt: Date.now(),
    }).then((ok) => {
      latestRef.current.draftFailed = !ok
    })
  }
  const flushDraftRef = useRef(flushDraft)
  flushDraftRef.current = flushDraft
  // 關閉/重新整理分頁前:先把草稿寫進本機;只有「本機草稿寫入失敗」(例如瀏覽器封鎖 IndexedDB)時才啟用瀏覽器原生的
  // 離開提示——那個提示文字與樣式無法自訂,平常有草稿兜底就不打擾使用者。元件卸載(切到別的面板)也補寫一次。
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!latestRef.current.dirty) return
      flushDraftRef.current()
      if (latestRef.current.draftFailed) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flushDraftRef.current()
    }
  }, [])

  // handleBack:返回文章列表。有未儲存變更時先確認——離開不會丟內容(已寫進本機草稿,下次開啟可還原),
  // 但那份草稿只存在這個瀏覽器、也不會出現在公開頁,讓使用者知道這件事再決定。
  async function handleBack() {
    if (!latestRef.current.dirty) {
      onBack?.()
      return
    }
    flushDraft()
    const draftOk = !latestRef.current.draftFailed
    const choice = await ask({
      title: '有尚未儲存的變更',
      message: draftOk
        ? '這篇文章有尚未儲存的變更。\n不儲存直接離開的話,內容會暫存在這個瀏覽器,下次開啟這篇時可以還原,但不會出現在你的文章裡。'
        : '這篇文章有尚未儲存的變更,而且這個瀏覽器無法暫存草稿——不儲存就離開,這些變更會遺失。',
      choices: [
        { id: 'save', label: '儲存並離開', variant: 'primary' },
        { id: 'leave', label: draftOk ? '不儲存,直接離開' : '放棄變更並離開', variant: 'secondary' },
      ],
      cancelLabel: '繼續編輯',
    })
    if (choice === 'leave') {
      onBack?.()
    } else if (choice === 'save') {
      setSaveErr(null)
      setSaving(true)
      try {
        const r = await persistArticle()
        if (r.warning) {
          // 儲存不完整(有圖片沒上傳成功)——留在編輯器讓使用者處理,不直接離開。
          setSaveErr(r.warning)
          return
        }
        onBack?.()
      } catch (e) {
        setSaveErr(errMsg(e))
      } finally {
        setSaving(false)
      }
    }
  }
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  // refreshPhotos:重新抓後端素材庫(含剛上傳的圖)。只用 ref 與 setState,身分穩定,AI 工具與儲存流程共用。
  const refreshPhotosRef = useRef(async (): Promise<api.UploadedPhoto[]> => {
    try {
      const list = await apiFns.fetchMyUploadedPhotos(cfgRef.current)
      latestRef.current.photos = combinePhotos(list, latestRef.current.staged)
      setPhotos(list)
    } catch {
      /* 抓不到就用目前快取 */
    }
    return latestRef.current.photos
  })
  // handleStagedChange:待上傳區變動——同步寫進 ref(AI 工具立刻讀得到)並更新畫面。
  const handleStagedChange = useCallback((list: StagedPhotoView[]) => {
    latestRef.current.staged = list
    latestRef.current.photos = combinePhotos(latestRef.current.photos.filter((p) => !isStagedId(p.id)), list)
    setStagedList(list)
  }, [])
  // handleStagedUploaded:一張待上傳圖片上傳成功,區塊裡的 staged:key 換成真實 photoId,並重新讀素材庫讓畫面有網址可用。
  const handleStagedUploaded = useCallback((key: string, photoId: string) => {
    const next = remapPhotoIds(latestRef.current.blocks, { [`staged:${key}`]: photoId })
    if (next !== latestRef.current.blocks) {
      latestRef.current.blocks = next
      setBlocks(next)
      setDirty(true)
    }
    if (latestRef.current.heroPhotoId === `staged:${key}`) {
      latestRef.current.heroPhotoId = photoId
      setHeroPhotoId(photoId)
      setDirty(true)
    }
    void refreshPhotosRef.current()
  }, [])
  const aiHandleRef = useRef<ArticleEditorHandle | null>(null)
  if (aiHandleRef.current === null) {
    aiHandleRef.current = {
      getState: () => ({ title: latestRef.current.title, lede: latestRef.current.lede, blocks: latestRef.current.blocks }),
      setState: (next) => {
        const before = new Map(latestRef.current.blocks.map((b) => [b.id, JSON.stringify(b)]))
        const changed = (next.blocks as EditableBlock[]).find((b) => before.get(b.id) !== JSON.stringify(b))
        if (changed) setFlashBlockId(changed.id)
        latestRef.current.title = next.title
        latestRef.current.lede = next.lede
        latestRef.current.blocks = next.blocks as EditableBlock[]
        setTitle(next.title)
        setLede(next.lede)
        setBlocks(next.blocks as EditableBlock[])
        setDirty(true)
      },
      getPhotos: () => latestRef.current.photos,
      refreshPhotos: refreshPhotosRef.current,
      isPublished: () => latestRef.current.status === 'published',
      save: async () => {
        setSaveErr(null)
        setSaving(true)
        try {
          const r = await persistArticle()
          if (r.warning) setSaveErr(r.warning)
          return r
        } catch (e) {
          setSaveErr(errMsg(e))
          throw e
        } finally {
          setSaving(false)
        }
      },
    }
  }

  // 載入素材庫清單(插入圖片/圖組的候選、以及渲染既有 image/gallery
  // block 需要的縮圖網址,見 photoURLFor 的完整說明)——跟下方掛載的
  // PhotoManagerBody 各自獨立呼叫 fetchMyUploadedPhotos,不是共用同一份
  // state:兩者生命週期不同(這裡只在掛載時載入一次,PhotoManagerBody
  // 有自己的上傳/輪詢/刪除流程要維護最新狀態),重複一次輕量查詢換取
  // 兩邊邏輯互相獨立、不必為了共用狀態而耦合。
  useEffect(() => {
    let cancelled = false
    apiFns.fetchMyUploadedPhotos(cfg).then(
      (list) => {
        if (!cancelled) setPhotos(list)
      },
      () => {
        // 素材庫清單載入失敗不中斷編輯器——頂多插入圖片時選不到候選,
        // 不是編輯文章本身的阻斷性錯誤。
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token])

  // 開啟既有文章——initialSlug 非 null 時載入完整內容,解析 content 填進
  // 各個 state。content 是 unknown(見 api.ts MyContentPageDetail 的
  // 完整說明,後端不驗證內部結構),這裡用寬鬆的型別斷言取值,缺欄位時
  // 退回安全預設值,不假設一定符合 ThemePageContent 的完整形狀(萬一
  // 是舊版本/其他工具寫入的內容,至少不會讓整個編輯器崩潰)。
  useEffect(() => {
    if (initialSlug == null) return
    let cancelled = false
    setLoading(true)
    setLoadErr(null)
    apiFns.fetchMyContentPage(cfg, initialSlug).then(
      (page) => {
        if (cancelled) return
        const content = (page.content ?? {}) as Partial<ThemePageContent>
        setSlug(page.slug)
        setTitle(content.title ?? page.title ?? '')
        setLede(content.lede ?? '')
        setBlocks(Array.isArray(content.blocks) ? (content.blocks as EditableBlock[]) : [])
        setStatus(page.status)
        setPalette(content.palette)
        setHeroPhotoId(content.heroPhotoId)
        // 編輯器管理的欄位以外的內容保留起來,儲存時原樣帶回(見 buildContent 的 extra)。
        const { version: _v, slug: _s, title: _t, lede: _l, blocks: _b, status: _st, palette: _p, heroPhotoId: _h, ...rest } = content
        extraContentRef.current = rest
        setLoading(false)
      },
      (e) => {
        if (cancelled) return
        setLoadErr(errMsg(e))
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, initialSlug])

  // 載入完成(新文章=一開始;既有文章=伺服器內容填入後)檢查有沒有本機草稿。內容跟目前畫面完全相同的草稿沒有意義,直接丟掉。
  useEffect(() => {
    if (loading || loadErr) return
    let cancelled = false
    const key = initialSlug ?? NEW_ARTICLE_KEY
    loadArticleDraft(scope, key).then((d) => {
      if (cancelled || !d) return
      const cur = latestRef.current
      const same =
        d.title === cur.title &&
        d.lede === cur.lede &&
        (d.palette ?? null) === (cur.palette ?? null) &&
        (d.heroPhotoId ?? null) === (cur.heroPhotoId ?? null) &&
        JSON.stringify(d.blocks) === JSON.stringify(cur.blocks)
      const empty = d.title === '' && d.lede === '' && d.blocks.length === 0
      if (same || empty) {
        void deleteArticleDraft(scope, key)
        return
      }
      setPendingDraft(d)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadErr, scope, initialSlug])

  // 有未儲存變更時 debounce 寫入草稿;全空的新文章不存。
  useEffect(() => {
    if (loading || loadErr || !dirty || pendingDraft) return
    const t = setTimeout(() => {
      if (!slugLocked && title === '' && lede === '' && blocks.length === 0) {
        void deleteArticleDraft(scope, draftKey)
        return
      }
      void saveArticleDraft(scope, draftKey, { title, lede, blocks, palette, heroPhotoId, savedAt: Date.now() }).then((ok) => {
        latestRef.current.draftFailed = !ok
      })
    }, 500)
    return () => clearTimeout(t)
  }, [loading, loadErr, dirty, pendingDraft, scope, draftKey, slugLocked, title, lede, blocks, palette, heroPhotoId])

  function restoreDraft() {
    const d = pendingDraft
    if (!d) return
    setTitle(d.title)
    setLede(d.lede)
    setBlocks(d.blocks as EditableBlock[])
    setPalette(d.palette as ThemePagePalette | undefined)
    setHeroPhotoId(d.heroPhotoId)
    setDirty(true)
    setPendingDraft(null)
  }

  function discardDraft() {
    void deleteArticleDraft(scope, initialSlug ?? NEW_ARTICLE_KEY)
    setPendingDraft(null)
  }

  // 閃爍區塊:捲到視窗內,1.6 秒後移除樣式。
  useEffect(() => {
    if (!flashBlockId) return
    document.querySelector(`[data-block-id="${flashBlockId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const t = setTimeout(() => setFlashBlockId(null), 1600)
    return () => clearTimeout(t)
  }, [flashBlockId])

  function markDirty() {
    setDirty(true)
  }

  const placeCount = blocks.filter((b) => b.kind === 'stop').length

  function insertAt(index: number, block: EditableBlock) {
    setBlocks((prev) => {
      const next = prev.slice()
      next.splice(index, 0, block)
      return next
    })
    setOpenMenuAt(null)
    markDirty()
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
    markDirty()
  }

  function updateBlock(id: string, patch: Partial<EditableBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as EditableBlock) : b)))
    markDirty()
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      return
    }
    setBlocks((prev) => {
      const next = prev.slice()
      const [moved] = next.splice(dragIndex, 1)
      const insertIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
      next.splice(insertIndex, 0, moved)
      return next
    })
    setDragIndex(null)
    markDirty()
  }

  function openPicker(mode: 'single' | 'multi', atIndex: number) {
    setOpenMenuAt(null)
    setPicker({ mode, atIndex })
  }

  function handlePickerConfirm(selected: api.UploadedPhoto[]) {
    if (!picker) return
    const block = picker.mode === 'single' ? emptyImage(selected[0]) : emptyGallery(selected)
    insertAt(picker.atIndex, block)
    setPicker(null)
  }

  // persistArticle:實際存檔。一律讀 latestRef(最新狀態),不讀 render 當下的 state——AI 工具(save_article)
  // 在同一輪裡剛改完文章就會呼叫,React 還沒重繪,直接讀 state 會存到舊內容。成功回傳最終 slug 與是否為新建。
  //
  // 區塊引用到尚未上傳的圖片(staged:)時,先上傳換成真實 photoId 再存;後端內容不會出現 staged: id。
  // 照片上傳失敗不擋文章儲存:失敗的圖片區塊只從「送後端的內容」略過(編輯器裡仍保留,可再按儲存重試),
  // 回傳的 warning 說明略過了幾張與原因;有略過時保持 dirty,也不清本機草稿(草稿裡還有那些圖片區塊)。
  async function persistArticle(): Promise<{ slug: string; created: boolean; warning?: string }> {
    let warning: string | undefined
    const pendingIds = stagedIdsIn(latestRef.current.blocks)
    const heroNow = latestRef.current.heroPhotoId
    if (heroNow && isStagedId(heroNow) && !pendingIds.includes(heroNow)) pendingIds.push(heroNow)
    if (pendingIds.length > 0) {
      const ctl = stagedCtlRef.current
      if (ctl) {
        const { failed } = await ctl.uploadStaged(pendingIds.map(stagedKeyOf))
        await refreshPhotosRef.current()
        if (failed.length > 0) warning = failed.map((f) => f.message).join(';')
      } else {
        warning = '待上傳圖片區尚未就緒'
      }
    }
    const cur = latestRef.current
    const dropped = dropStagedBlocks(cur.blocks)
    const sendBlocks = dropped.blocks
    // 封面還是待上傳(上傳失敗)時,送後端的內容先不帶封面。
    const heroUnresolved = cur.heroPhotoId !== undefined && isStagedId(cur.heroPhotoId)
    const sendHero = heroUnresolved ? undefined : cur.heroPhotoId
    const skipped = dropped.skipped + (heroUnresolved ? 1 : 0)
    if (skipped > 0) {
      warning = `有 ${skipped} 張圖片沒能上傳,文章已先儲存但略過這些圖片區塊(編輯器裡還保留,修正後再按儲存):${warning ?? '圖片不在待上傳區'}`
    } else {
      warning = undefined
    }
    let finalSlug = cur.slug.trim()
    if (finalSlug === '') finalSlug = slugify(cur.title)
    const content = buildContent(finalSlug, cur.title, cur.lede, sendBlocks, cur.status, cur.palette, sendHero, extraContentRef.current)
    let created = false
    if (cur.slugLocked) {
      await apiFns.updateMyContentPage(cfg, finalSlug, content)
    } else {
      await apiFns.createMyContentPage(cfg, finalSlug, content)
      created = true
      latestRef.current.slugLocked = true
      setSlugLocked(true)
    }
    latestRef.current.slug = finalSlug
    setSlug(finalSlug)
    if (!warning) {
      setDirty(false)
      // 已完整存到伺服器,本機草稿作廢(新文章的草稿存在 NEW_ARTICLE_KEY,存檔後改用 slug,兩個都清)。
      void deleteArticleDraft(scope, NEW_ARTICLE_KEY)
      void deleteArticleDraft(scope, finalSlug)
    } else if (created) {
      // 新文章已建立但草稿還有略過的圖片:草稿改以 slug 為 key 繼續保存(NEW_ARTICLE_KEY 那份作廢)。
      void deleteArticleDraft(scope, NEW_ARTICLE_KEY)
    }
    return { slug: finalSlug, created, warning }
  }

  async function handleSave() {
    setSaveErr(null)
    setSaving(true)
    try {
      const r = await persistArticle()
      if (r.warning) setSaveErr(r.warning)
    } catch (e) {
      setSaveErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleTogglePublish() {
    if (!slugLocked) return
    setSaveErr(null)
    const nextPublished = status !== 'published'
    try {
      // 發布前若畫面有未儲存的變更(或上次儲存略過了上傳失敗的圖片),先存一次再發布——否則公開的是舊版本。
      // 儲存不完整(有略過圖片)時不發布,把原因顯示出來讓使用者處理。取消發布不受影響。
      if (nextPublished && latestRef.current.dirty) {
        setSaving(true)
        try {
          const r = await persistArticle()
          if (r.warning) {
            setSaveErr(`已先儲存但內容不完整,未發布:${r.warning}`)
            return
          }
        } finally {
          setSaving(false)
        }
      }
      await apiFns.setMyContentPagePublished(cfg, slug, nextPublished)
      setStatus(nextPublished ? 'published' : 'draft')
    } catch (e) {
      setSaveErr(errMsg(e))
    }
  }

  if (loading) {
    return (
      <div className={styles.editor}>
        <div className={styles.loadingNotice}>載入文章內容…</div>
      </div>
    )
  }

  if (loadErr) {
    return (
      <div className={styles.editor}>
        <div className={styles.loadingNotice}>載入失敗：{loadErr}</div>
      </div>
    )
  }

  return (
    <div className={styles.editor} data-palette={palette}>
      <div className={styles.topbar}>
        <div className={styles.topbarMeta}>
          {onBack && (
            <button type="button" className={styles.backBtn} onClick={handleBack}>
              <ArrowLeft size={14} strokeWidth={2} />
              返回文章列表
            </button>
          )}
          <div className={styles.topbarTitleGroup}>
            <span className={styles.topbarEyebrow}>文章編輯器 · {status === 'published' ? '已發布' : '草稿'}</span>
            <span className={styles.topbarStatus}>
              <span className="dot" />
              {saveErr ? saveErr : dirty ? '有未儲存的變更' : saving ? '儲存中…' : '已儲存'}
            </span>
          </div>
        </div>
        <div className={styles.topbarRight}>
          {/* palette 切換(2026-10 第五輪新增)——對齊 types.ts
              ThemePagePalette 的三個值,所見即所得:切換時 .editor 的
              data-palette 立刻套用對應配色(見 ArticleEditor.module.css
              的完整說明),存檔時原樣寫進 content.palette。 */}
          <select
            className={styles.paletteSelect}
            value={palette ?? ''}
            onChange={(e) => { setPalette((e.target.value || undefined) as ThemePagePalette | undefined); markDirty() }}
            title="風格基調"
          >
            <option value="">紙感和風（預設）</option>
            <option value="ocean-cool">海洋藍調</option>
            <option value="night-market">夜市暖橙</option>
          </select>
          {BLOG_ARTICLE_AI_ENABLED && (
            <button
              type="button"
              ref={aiToggleRef}
              className={styles.btn}
              onClick={toggleAi}
              aria-pressed={aiOpen}
              aria-controls="article-ai-side"
              title="AI 協助撰寫"
            >
              <Sparkles size={14} strokeWidth={2} style={{ marginRight: 6 }} />
              AI
              {aiBusy && <span className={styles.aiToggleDot} />}
            </button>
          )}
          <button type="button" className={styles.btn} onClick={() => setPreviewing((v) => !v)}>
            {previewing ? '返回編輯' : '預覽'}
          </button>
          <button type="button" className={styles.btn} onClick={handleTogglePublish} disabled={!slugLocked}>
            {status === 'published' ? '取消發布' : '發布'}
          </button>
          <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>

      {pendingDraft && (
        <div className={styles.draftBanner} role="status">
          <span>
            發現這篇文章在這個瀏覽器有未儲存的草稿(
            {new Date(pendingDraft.savedAt).toLocaleString('zh-TW', { hour12: false })}
            ),要還原嗎?
          </span>
          <button type="button" className={styles.btn} onClick={restoreDraft}>
            還原草稿
          </button>
          <button type="button" className={styles.btn} onClick={discardDraft}>
            捨棄
          </button>
        </div>
      )}
      <div className={styles.body}>
      <div className={styles.articlePane}>
        <div className={styles.cover}>
          {heroPhotoId && photoURLFor(photos, heroPhotoId) && (
            <>
              <img src={photoURLFor(photos, heroPhotoId)} alt="" className={styles.coverImg} />
              <div className={styles.coverShade} />
            </>
          )}
          <div className={styles.coverActions}>
            <button type="button" className={styles.coverBtn} onClick={() => setCoverPickerOpen(true)}>
              {heroPhotoId ? '更換封面' : '選擇封面'}
            </button>
            {heroPhotoId && (
              <button type="button" className={styles.coverBtn} onClick={() => { setHeroPhotoId(undefined); markDirty() }}>
                移除封面
              </button>
            )}
          </div>
          <div className={styles.coverCaption}>
            <div className={styles.coverEyebrow}>
              {placeCount > 0 ? `${placeCount} 個站點 · ` : ''}
              {slugLocked ? `/${slug}` : '尚未儲存'}
            </div>
            <EditableDiv className={styles.coverTitle} value={title} placeholder="輸入文章標題" onChange={(v) => { setTitle(v); markDirty() }} />
          </div>
        </div>

        {!slugLocked && (
          <div className={styles.slugRow}>
            <label className={styles.slugLabel} htmlFor="article-slug">網址 slug</label>
            <input
              id="article-slug"
              className={styles.slugInput}
              value={slug}
              placeholder={title ? slugify(title) : '例如：kyoto-higashiyama'}
              onChange={(e) => { setSlug(e.target.value); markDirty() }}
            />
          </div>
        )}

        <div className={styles.articleInner}>
          <EditableDiv className={styles.lede} value={lede} placeholder="寫一段整體介紹……" onChange={(v) => { setLede(v); markDirty() }} />

          <InsertMenu
            open={openMenuAt === 0}
            onToggle={() => setOpenMenuAt((v) => (v === 0 ? null : 0))}
            onInsertParagraph={() => insertAt(0, emptyParagraph())}
            onInsertImage={() => openPicker('single', 0)}
            onInsertGallery={() => openPicker('multi', 0)}
          />

          {blocks.map((block, i) => (
            <div
              key={block.id}
              data-block-id={block.id}
              className={block.id === flashBlockId ? styles.blockFlash : undefined}
              draggable={!previewing}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
            >
              {block.kind === 'paragraph' && (
                <div className={styles.sideMenuWrap}>
                  {!previewing && (
                    <ParagraphVariantMenu
                      value={block.variant}
                      onChange={(variant) => updateBlock(block.id, { variant })}
                    />
                  )}
                  <EditableDiv
                    className={styles.paragraph}
                    value={block.text}
                    placeholder="寫下這段的故事……"
                    onChange={(v) => updateBlock(block.id, { text: v })}
                    previewing={previewing}
                    dataVariant={block.variant}
                  />
                </div>
              )}

              {block.kind === 'image' && (
                <ImageBlockView
                  block={block}
                  photos={photos}
                  previewing={previewing}
                  onChange={(patch) => updateBlock(block.id, patch)}
                  onRemove={() => removeBlock(block.id)}
                />
              )}

              {block.kind === 'gallery' && (
                <GalleryBlockView
                  block={block}
                  photos={photos}
                  previewing={previewing}
                  onChangeLayout={(layout) => updateBlock(block.id, { layout })}
                  onRemove={() => removeBlock(block.id)}
                />
              )}

              {block.kind === 'stop' && (
                <StopBlockView block={block} photos={photos} />
              )}

              {!previewing && (
                <InsertMenu
                  open={openMenuAt === i + 1}
                  onToggle={() => setOpenMenuAt((v) => (v === i + 1 ? null : i + 1))}
                  onInsertParagraph={() => insertAt(i + 1, emptyParagraph())}
                  onInsertImage={() => openPicker('single', i + 1)}
                  onInsertGallery={() => openPicker('multi', i + 1)}
                />
              )}
            </div>
          ))}

          <footer className={styles.endNote}>
            <MapPin size={13} strokeWidth={2} />
            {placeCount} 個站點
          </footer>

          <div className={`${styles.photoLibrary} article-photo-library`}>
            <div className={styles.photoLibraryHead}>
              <div className={styles.photoLibraryEyebrow}>附屬工具</div>
              <div className={styles.photoLibraryHeading}>圖片素材庫</div>
              <div className={styles.photoLibraryHint}>
                先在這裡上傳、管理這篇文章要用的圖片，再回到上方正文用「插入圖片」或「插入圖組」放進內容。
              </div>
            </div>
            <PhotoManagerBody
              cfg={cfg}
              onStagedChange={handleStagedChange}
              onStagedUploaded={handleStagedUploaded}
              controllerRef={stagedCtlRef}
            />
          </div>
        </div>
      </div>
      {BLOG_ARTICLE_AI_ENABLED && (
        <ArticleAiPanel handle={aiHandleRef.current} open={aiOpen} onClose={closeAi} onBusyChange={setAiBusy} />
      )}
      </div>

      {confirmDialog}
      {coverPickerOpen && (
        <PhotoPickerModal
          photos={photos}
          mode="single"
          title="選擇封面圖片"
          onClose={() => setCoverPickerOpen(false)}
          onConfirm={(selected) => {
            setHeroPhotoId(selected[0].id)
            setCoverPickerOpen(false)
            markDirty()
          }}
        />
      )}

      {picker && (
        <PhotoPickerModal
          photos={photos}
          mode={picker.mode}
          onClose={() => setPicker(null)}
          onConfirm={handlePickerConfirm}
        />
      )}
    </div>
  )
}

// ImageBlockView:單圖區塊——width/float 對齊 types.ts ImageBlock 的
// 完整說明。width='column' 時才能切換 float(靠左/靠右文繞),wide/full
// 時 float 欄位由渲染端忽略(這裡則直接隱藏文繞按鈕,避免使用者誤以為
// 全寬圖也能文繞)。2026-10 第五輪新增 wide/full 出血切換(對齊
// BlogArticle.css [data-width] 的完整說明)跟 overlayText 疊字版面
// 切換——有 overlayText 時改走完全不同的版面結構(圖當背景、文字疊在
// 上面),不是疊加在原本結構上的小修改,對齊 BlogArticlePage.tsx
// renderImageBlock 的既有分流邏輯(overlayText 存在時忽略 width/float)。
function ImageBlockView({
  block,
  photos,
  previewing,
  onChange,
  onRemove,
}: {
  block: ImageBlock
  photos: api.UploadedPhoto[]
  previewing: boolean
  onChange: (patch: Partial<ImageBlock>) => void
  onRemove: () => void
}) {
  const url = photoURLFor(photos, block.photoId)
  // aspectRatio:2026-10 第六輪新增,見 photoAspectRatioFor 的完整說明
  // ——用真實圖片比例當佔位框,undefined 時退回 CSS 既有的固定比例
  // (不傳 inline aspectRatio,讓 CSS 規則生效)。
  const aspectRatio = photoAspectRatioFor(photos, block.photoId)

  function setWidth(width: ImageWidth) {
    onChange(width === 'column' ? { width } : { width, float: 'none' as ImageFloat })
  }

  // sideMenu:2026-10 第六輪改成左側 hover 選單(取代原本頂部內嵌的
  // .imageToolbar),對齊 ParagraphVariantMenu 的互動模式——使用者
  // 明確要求「圖片左邊出現跟文字一樣的選單，做圖片排列方式」,統一
  // 編輯器裡所有 block 排列調整的互動位置,見
  // ArticleEditor.module.css .sideMenu 的完整說明。overlayText 版面
  // 跟一般 width/float 版面是互斥的兩種結構(見本函式開頭說明),但
  // 兩者都共用同一個左側選單,只是選單內容不同(overlayText 版面只有
  // 「改回一般圖說版面」一顆按鈕)。
  const isOverlay = block.overlayText != null

  return (
    <div className={styles.sideMenuWrap}>
      {!previewing && (
        <div className={styles.sideMenu}>
          {isOverlay ? (
            <button
              type="button"
              className={styles.sideMenuBtn}
              title="改回一般圖說版面"
              onClick={() => onChange({ overlayText: undefined })}
            >
              <Pilcrow size={13} strokeWidth={2} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.sideMenuBtn}${block.width === 'column' && block.float === 'left' ? ` ${styles.sideMenuBtnActive}` : ''}`}
                title="靠左文繞（欄寬）"
                onClick={() => onChange({ width: 'column', float: 'left' })}
              >
                <GripVertical size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`${styles.sideMenuBtn}${block.width === 'column' && block.float === 'none' ? ` ${styles.sideMenuBtnActive}` : ''}`}
                title="欄寬，不文繞"
                onClick={() => setWidth('column')}
              >
                <ImageIcon size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`${styles.sideMenuBtn}${block.width === 'wide' ? ` ${styles.sideMenuBtnActive}` : ''}`}
                title="出血放大"
                onClick={() => setWidth('wide')}
              >
                W
              </button>
              <button
                type="button"
                className={`${styles.sideMenuBtn}${block.width === 'full' ? ` ${styles.sideMenuBtnActive}` : ''}`}
                title="全寬出血"
                onClick={() => setWidth('full')}
              >
                F
              </button>
              <button
                type="button"
                className={`${styles.sideMenuBtn}${block.width === 'column' && block.float === 'right' ? ` ${styles.sideMenuBtnActive}` : ''}`}
                title="靠右文繞（欄寬）"
                onClick={() => onChange({ width: 'column', float: 'right' })}
              >
                <GripVertical size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className={styles.sideMenuBtn}
                title="改成疊字版面"
                onClick={() => onChange({ overlayText: '' })}
              >
                <Quote size={13} strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      )}

      {isOverlay ? (
        <div className={styles.imageOverlay}>
          {!previewing && (
            <button type="button" className={styles.imageRemove} onClick={onRemove} title="刪除圖片">
              <X size={12} strokeWidth={2} />
            </button>
          )}
          {url ? (
            <img
              src={url}
              alt={block.alt}
              className={styles.imageOverlayImg}
              style={aspectRatio ? { aspectRatio } : undefined}
            />
          ) : (
            <div className={styles.imageFill} style={{ background: 'var(--paper-dim)', aspectRatio }} />
          )}
          <EditableDiv
            className={styles.imageOverlayText}
            value={block.overlayText ?? ''}
            placeholder="疊在圖片上的文字……"
            onChange={(v) => onChange({ overlayText: v })}
            previewing={previewing}
          />
        </div>
      ) : (
        (() => {
          const widthClass =
            block.width === 'wide' ? styles.imageBlockWide : block.width === 'full' ? styles.imageBlockFull : ''
          const floatClass =
            block.width === 'column' && block.float === 'left'
              ? styles.imageBlockFloatLeft
              : block.width === 'column' && block.float === 'right'
                ? styles.imageBlockFloatRight
                : ''
          return (
            <div className={`${styles.imageBlock}${widthClass ? ` ${widthClass}` : ''}${floatClass ? ` ${floatClass}` : ''}`}>
              {!previewing && (
                <button type="button" className={styles.imageRemove} onClick={onRemove} title="刪除圖片">
                  <X size={12} strokeWidth={2} />
                </button>
              )}
              {url ? (
                <img
                  src={url}
                  alt={block.alt}
                  className={styles.imageFillPhoto}
                  style={aspectRatio ? { aspectRatio, height: 'auto' } : undefined}
                />
              ) : (
                <div className={styles.imageFill} style={{ background: 'var(--paper-dim)', aspectRatio }} />
              )}
              <EditableDiv
                className={styles.imageCaption}
                value={block.caption ?? ''}
                placeholder="這張圖的說明文字……"
                onChange={(v) => onChange({ caption: v || undefined })}
                previewing={previewing}
              />
            </div>
          )
        })()
      )}
    </div>
  )
}

// GalleryBlockView:多圖群組——2026-10 第五輪對齊 BlogArticle.css
// 完整的 grid/row/split 三態渲染(取代先前版本只做 grid 靜態預覽的
// 簡化版)。split 固定需要剛好 3 張,對齊 types.ts GalleryBlock.layout
// 與 BlogArticlePage.tsx renderGalleryBlock 的既有防呆(張數不符時
// 公開頁渲染端會自動退回 grid 並印 console.warn)——這裡在編輯階段
// 直接停用 split 切換按鈕(而非讓使用者切了之後才在公開頁發現被退回),
// 屬於比公開頁更早一步的防呆,理由一致、時機提前。
function GalleryBlockView({
  block,
  photos,
  previewing,
  onChangeLayout,
  onRemove,
}: {
  block: GalleryBlock
  photos: api.UploadedPhoto[]
  previewing: boolean
  onChangeLayout: (layout: GalleryBlock['layout']) => void
  onRemove: () => void
}) {
  const gridClass =
    block.layout === 'row' ? styles.galleryRow : block.layout === 'split' ? styles.gallerySplit : ''
  const canSplit = block.items.length === 3
  return (
    <div className={styles.sideMenuWrap}>
      {/* sideMenu:2026-10 第六輪改成左側 hover 選單(取代原本頂部內嵌
          的 .galleryToolbar),理由同 ImageBlockView 的完整說明。 */}
      {!previewing && (
        <div className={styles.sideMenu}>
          <button
            type="button"
            className={`${styles.sideMenuBtn}${block.layout === 'grid' ? ` ${styles.sideMenuBtnActive}` : ''}`}
            title="主圖+小圖"
            onClick={() => onChangeLayout('grid')}
          >
            大
          </button>
          <button
            type="button"
            className={`${styles.sideMenuBtn}${block.layout === 'row' ? ` ${styles.sideMenuBtnActive}` : ''}`}
            title="統一縮小、密集排列"
            onClick={() => onChangeLayout('row')}
          >
            密
          </button>
          <button
            type="button"
            className={`${styles.sideMenuBtn}${block.layout === 'split' ? ` ${styles.sideMenuBtnActive}` : ''}`}
            title={canSplit ? '左直大圖＋右兩橫圖拼貼' : '需要剛好 3 張圖片才能用拼貼版面'}
            disabled={!canSplit}
            onClick={() => onChangeLayout('split')}
          >
            拼
          </button>
        </div>
      )}
      <div className={styles.galleryBlock}>
        {!previewing && (
          <button type="button" className={styles.imageRemove} onClick={onRemove} title="刪除圖組">
            <X size={12} strokeWidth={2} />
          </button>
        )}
        <div className={`${styles.galleryGrid}${gridClass ? ` ${gridClass}` : ''}`}>
          {block.items.map((item, idx) => {
            const url = photoURLFor(photos, item.photoId)
            const aspectRatio = photoAspectRatioFor(photos, item.photoId)
            return (
              <div key={`${item.photoId}-${idx}`} className={styles.galleryGridItem}>
                {url ? (
                  <img
                    src={url}
                    alt={item.alt}
                    className={styles.galleryGridImg}
                    style={aspectRatio ? { aspectRatio } : undefined}
                  />
                ) : (
                  <div className={styles.imageFill} style={{ aspectRatio }} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// StopBlockView:站點卡片——純展示,見本檔開頭說明「這一輪只做展示,
// 不開放編輯/插入」。2026-10 第五輪改用公開頁 BlogArticlePage.tsx
// StopCard 的完整版面(編號圓徽/標題/內文/blurb/media[0]縮圖/
// info-box),取代先前版本的簡化雙欄卡片——使用者明確要求「編輯文章
// 的樣式要跟實際的文章一樣」,既然這一輪要顯示 stop 內容,就直接顯示
// 成跟公開頁一致的樣子。media 只取第一張 image(若存在)當縮圖,
// gallery media 項或 media[1] 之後的項目不逐一渲染(展示用途夠用,
// 不是要做出完整對齊公開頁渲染邏輯的第二套實作——公開頁會渲染完整
// media 陣列,這裡只是編輯器預覽,次要圖片省略不影響作者判斷內容是否
// 正確)。
function StopBlockView({ block, photos }: { block: StopBlock; photos: api.UploadedPhoto[] }) {
  const firstImage = block.media.find((m) => m.kind === 'image') as ImageBlock | undefined
  const url = firstImage ? photoURLFor(photos, firstImage.photoId) : undefined
  return (
    <article className={styles.stopCard}>
      <div className={styles.stopHead}>
        {block.index && <span className={styles.stopIndex}>{block.index}</span>}
        <h2 className={styles.stopName}>{block.name}</h2>
      </div>
      <p className={styles.stopBody}>{block.desc}</p>
      {block.blurb && <p className={styles.stopBlurb}>{block.blurb}</p>}
      <div className={styles.stopPhoto}>
        {url ? (
          <img src={url} alt="" className={styles.stopPhotoImg} />
        ) : (
          <div className={styles.stopPhotoEmpty}>
            <MapPin size={16} strokeWidth={2} />
            站點卡片 widget 規劃中，暫無法在編輯器內編輯圖片
          </div>
        )}
      </div>
      {block.info && block.info.length > 0 && (
        <dl className={styles.stopInfoBox}>
          {block.info.map(([label, value]) => (
            <div className={styles.stopInfoRow} key={label}>
              <dt className={styles.stopInfoLabel}>{label}</dt>
              <dd className={styles.stopInfoValue}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}
