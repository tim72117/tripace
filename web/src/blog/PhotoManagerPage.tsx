import { useCallback, useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { useAppState } from '../hooks/useAppState'
import { LoginForm, LoginCard } from '../home/LoginForm'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import * as api from '../api'
import type { UploadedPhoto } from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import { Button } from '../components/Button'
import { PhotoFocalEditor } from './PhotoFocalEditor'
import { photoDisplayStatus, canEditFocal, objectPositionFor, type FocalPoint } from './photoFocalMath'
import { BlogProfileSettings } from './BlogProfileSettings'
import { BlogArticleList } from './BlogArticleList'
import { trackEvent } from '../analytics'
import styles from './PhotoManagerPage.module.css'

// PhotoManagerPage——/blog/photos 路由的頁面外殼,「需要登入才能使用」的模式:訪客可以到達
// 這個網址,頁面內自己用 useAppState() 取 cfg/isGuest/onAuthed,isGuest 時
// 內嵌 LoginForm,不是未登入就擋下或導轉到別的路由。這個專案沒有
// <RequireAuth> 這類包裝元件的先例,不自己發明新機制。
//
// POLLING_INTERVAL_MS:上傳後輪詢列表,直到這張圖片的狀態變成
// ready/failed 為止——任務規格允許「簡單的提示使用者稍後重新整理」或
// 「輪詢直到完成」兩種做法,這裡選輪詢:背景處理預期在 30 秒內完成(見
// 後端 photoProcessingTimeout 的完整說明),輪詢幾次就能讓使用者在同一頁
// 看到縮圖產生完成,體驗比「請重新整理頁面」明顯更好,且實作複雜度不高
// (不需要 WebSocket)。
const POLLING_INTERVAL_MS = 3000
// POLLING_MAX_ATTEMPTS:輪詢上限次數,避免背景處理異常卡住時無限輪詢
// 下去——3 秒 * 20 次 = 60 秒,高於後端 30 秒的處理逾時上限,留了一些
// 餘裕(逾時後端會把狀態寫成 failed,輪詢會在那之前偵測到並停止)。
const POLLING_MAX_ATTEMPTS = 20

// SITE_NAV_DARK/SITE_NAV_TOGGLE:這個頁面本來就有自己的主題狀態來源
// (useAppState() 的 theme/setTheme,三態、寫 localStorage,見 theme.ts
// 開頭說明),跟城市介紹頁用的 useThemeToggle()(獨立記憶體 state,
// 不持久化)是兩套不同機制——不能直接套用 useThemeToggle(),否則
// SiteNavThemeToggle 按下去切換的會是一份跟畫面實際 data-theme 無關的
// 獨立 state,按了沒反應。這裡改成讀 useAppState() 既有的 theme 算出
// SiteNavThemeToggle 需要的 boolean dark(簡化成 dark/light 兩態切換,
// 放棄「跟隨系統」第三態——同 useThemeToggle() hook 本身的既有簡化
// 慣例,SiteNavThemeToggle 原本的設計就是兩態圖示切換鈕,不支援三態)。
function isDarkNow(theme: ReturnType<typeof useAppState>['theme']): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function PhotoManagerPage() {
  const { cfg, theme, setTheme, isGuest, onAuthed } = useAppState()
  const dark = isDarkNow(theme)
  const toggleTheme = () => setTheme(dark ? 'light' : 'dark')

  if (isGuest) {
    return (
      <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
        {/* 商標+日夜切換——比照 TainanChikanPage.tsx 的既有掛載方式(見
            SiteNavButtons.tsx 的完整說明)。這個分支本來就會顯示下方
            LoginCard/LoginForm 這個頁面專屬的登入表單,兩者角色不同
            (一個是全站共通的導覽列小元素,一個是這個頁面的內容主體),
            不衝突,故不在這裡額外放 SiteNavCta 登入按鈕,避免跟下方
            大塊登入表單產生意義重複的兩個「登入」入口。 */}
        <SiteNavBrand />
        <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
        <LoginCard title="登入後管理你的圖片" subtitle="請先登入或註冊帳號。">
          <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} pill />
        </LoginCard>
      </div>
    )
  }

  return (
    <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
      {/* 商標+日夜切換+CTA——比照 TainanChikanPage.tsx 的既有掛載方式。
          已登入時用 CTA 顯示「返回應用」導去 /app,不是「登入」(已經
          登入,不需要再顯示登入按鈕)。原本 .header 裡的品牌文字連結
          (<Link className={styles.brand}>Tripace</Link>)已改由這裡的
          共用 SiteNavBrand 取代,避免左上角出現兩個重複的品牌標記;
          .header 保留純粹的頁面標題列角色。
          2026-10:標題從「我的圖片」改成「部落格管理」——圖片管理區塊
          (PhotoManagerBody)已整個搬進 blog/ArticleEditor.tsx(見
          PhotoManagerContent 掛載處的完整說明),這個頁面現在的內容是
          文章列表+部落格身份設定,「我的圖片」已經不準確描述頁面
          內容。 */}
      <SiteNavBrand />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'photo-manager', position: 'nav' })}>返回應用</SiteNavCta>
      <header className={styles.header}>
        <span className={styles.title}>部落格管理</span>
      </header>
      <PhotoManagerContent cfg={cfg} />
    </div>
  )
}

// PhotoManagerContent:2026-10 從 PhotoManagerPage 拆出——不含登入檢查/
// SiteNavBrand 等「獨立整頁」才需要的外殼,純粹是「我的文章列表+設定
// 部落格身份」這兩塊內容本體。拆出來是為了讓 planning/member/desktop/Content.tsx 的
// panelMode==='blog' 分支(見該檔案完整說明)可以直接渲染這份內容,
// 保留左側導覽列(desktop/Nav)不離開 /app——使用者明確要求「進去後要保留
// 左邊的功能頁」,原本整頁 navigate('/blog/photos') 的做法離開了
// /app 的畫面結構,導覽列不在 /blog/photos 這條獨立路由裡,
// 保留不了。這裡渲染時呼叫端(planning/member/desktop/Content)已經保證是已登入狀態
// (/app 本身就是登入後才會出現的畫面),不需要重複 isGuest 分支;
// /blog/photos 路由本身繼續由 PhotoManagerPage 完整保留(含登入檢查
// 外殼),未登入也能直接打網址到達這個頁面的既有行為不受影響,兩個
// 進入點共用同一份內容元件,不是互斥的兩套實作。
//
// 2026-10:圖片管理(PhotoManagerBody)已整個搬進 blog/ArticleEditor.tsx
// ——使用者明確要求「照片上傳搬進文章編輯」,整個圖片管理區塊(縮圖
// 網格/上傳/刪除/評分/裁切焦點)不再顯示在這個部落格管理面板裡,只在
// 編輯一篇文章時才看得到(見 ArticleEditor.tsx 掛載 PhotoManagerBody
// 處的完整說明)。這個檔案(PhotoManagerPage.tsx)仍然是
// PhotoManagerBody 實際定義的所在地(見下方,已改成 export),只是不再
// 由這裡的 PhotoManagerContent 渲染。
//
// onArticleEdit(2026-10 新增,選填)——原樣透傳給 BlogArticleList 的
// onEdit(見該元件開頭的完整說明,null 代表「新建一篇」)。只有
// planning/member/desktop/Content.tsx 渲染時會傳(切到 panelMode:'blog-editor'),
// PhotoManagerPage(/blog/photos 獨立路由)不傳,維持該路由原本「點
// 已發布文章連去公開閱讀頁、不顯示新增文章按鈕」的既有行為。
export function PhotoManagerContent({
  cfg,
  onArticleEdit,
}: {
  cfg: api.ClientConfig
  onArticleEdit?: (article: api.MyContentPage | null) => void
}) {
  return (
    <div className={styles.body}>
      <BlogArticleList cfg={cfg} onEdit={onArticleEdit} />
      <BlogProfileSettings cfg={cfg} />
    </div>
  )
}

// PhotoManagerBody(2026-10 改成 export)——圖片管理區塊本體(上傳/
// 縮圖網格/刪除/評分/裁切焦點),現在由 blog/ArticleEditor.tsx 掛載
// (見該檔案的完整說明),不再由上面的 PhotoManagerContent 渲染。留在
// 這個檔案裡(而非搬去 ArticleEditor.tsx 或另開新檔案)是因為它依賴的
// UploadedPhoto/api.* 呼叫、POLLING_* 常數都定義在這個檔案作用域內,
// 搬動反而要跟著搬一整組依賴,維持原地 export 改動範圍最小。
export function PhotoManagerBody({ cfg }: { cfg: api.ClientConfig }) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // uploadProgress:多選上傳時目前第幾張/總共幾張——null 代表沒有正在
  // 進行中的批次上傳。見 handleFileSelected 的完整說明:逐一依序上傳
  // (不是並行),這個狀態用來讓按鈕文字顯示進度,而不是單純的「上傳中」
  // 四個字(多張時完全看不出目前卡在哪)。
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [editingPhoto, setEditingPhoto] = useState<UploadedPhoto | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setPhotos(await api.fetchMyUploadedPhotos(cfg))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token])

  useEffect(() => {
    load()
  }, [load])

  // 卸載時清掉未完成的輪詢計時器,避免元件卸載後還觸發 setState。
  useEffect(() => {
    return () => {
      if (pollTimerRef.current != null) clearTimeout(pollTimerRef.current)
    }
  }, [])

  // pollUntilSettled:每隔 POLLING_INTERVAL_MS 重新呼叫一次列表 API,直到
  // 這張圖片的狀態不再是 pending(變成 ready 或 failed)或達到輪詢上限
  // 為止——見本檔案開頭 POLLING_INTERVAL_MS 的完整說明。
  const pollUntilSettled = useCallback(
    (photoId: string, attemptsLeft: number) => {
      if (attemptsLeft <= 0) return
      pollTimerRef.current = setTimeout(async () => {
        let latest: UploadedPhoto[]
        try {
          latest = await api.fetchMyUploadedPhotos(cfg)
        } catch {
          // 輪詢途中查詢失敗不中斷整個流程(可能是暫時性網路問題),
          // 靜默略過這一次,等下一輪再試。
          pollUntilSettled(photoId, attemptsLeft - 1)
          return
        }
        setPhotos(latest)
        const target = latest.find((p) => p.id === photoId)
        if (target && photoDisplayStatus(target.status) === 'pending') {
          pollUntilSettled(photoId, attemptsLeft - 1)
        }
      }, POLLING_INTERVAL_MS)
    },
    [cfg],
  )

  // uploadOneFile:單一檔案的上傳流程本體(簽發 pre-signed URL→PUT→
  // complete→樂觀插入列表→觸發輪詢)——從 handleFileSelected 抽出,讓
  // 多選上傳(逐一呼叫這支函式)跟單選上傳共用同一套邏輯,不重複寫。
  // 失敗時拋出 error,呼叫端(handleFileSelected)決定要不要中斷整批。
  async function uploadOneFile(file: File) {
    const { photoId, uploadUrl, publicUrl } = await api.createPhotoUploadURL(cfg, file.type)

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!putRes.ok) {
      throw new Error(`上傳到儲存空間失敗(HTTP ${putRes.status}）`)
    }

    await api.completePhotoUpload(cfg, photoId)

    // 樂觀地把這張圖以 pending 狀態插入列表,讓使用者立刻看到回饋,不用
    // 等下一次輪詢/手動重新整理才出現在畫面上。
    const now = new Date().toISOString()
    setPhotos((prev) => [
      {
        id: photoId,
        ownerId: '',
        originalUrl: publicUrl,
        status: 'pending',
        variants: [],
        createdAt: now,
        updatedAt: now,
      },
      ...prev,
    ])

    pollUntilSettled(photoId, POLLING_MAX_ATTEMPTS)
  }

  // handleFileSelected:多選上傳入口——逐一依序上傳(不是 Promise.all
  // 並行),理由對齊 CLI blog-photo upload -skip-process 開頭說明的
  // 既有教訓:Cloud Run 預設只在處理 HTTP 請求期間分配 CPU,短時間內
  // 平行觸發大量背景處理(每張上傳完成後端都會另外起一個背景 goroutine
  // 做 resize)容易疊加成資源競爭甚至 OOM,逐一上傳讓每一張的背景處理
  // 有機會在下一張開始前先完成一部分。其中一張失敗不中斷整批——累積
  // 失敗訊息,讓使用者看到「幾張成功、哪幾張失敗」,不是選了 10 張結果
  // 第 3 張失敗就讓後面 7 張全部不上傳。
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 允許連續選同樣的檔案觸發 onChange
    if (files.length === 0) return

    setUploading(true)
    setErr(null)
    const failures: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ done: i, total: files.length })
        try {
          await uploadOneFile(files[i])
        } catch (e) {
          failures.push(`${files[i].name}: ${errMsg(e)}`)
        }
      }
      setUploadProgress({ done: files.length, total: files.length })
      if (failures.length > 0) {
        setErr(`部分圖片上傳失敗(${failures.length}/${files.length}):${failures.join('；')}`)
      }
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  async function handleRetry(photoId: string) {
    setErr(null)
    try {
      await api.retryPhotoProcessing(cfg, photoId)
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, status: 'pending' } : p)),
      )
      pollUntilSettled(photoId, POLLING_MAX_ATTEMPTS)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  async function handleDelete(photoId: string) {
    setErr(null)
    try {
      await api.deleteUploadedPhoto(cfg, photoId)
      setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  // handleRatingChange:點星星設定評分——再點一次目前已選中的那顆星會
  // 清空評分(傳 null),而不是重複設成同樣的分數,讓使用者不需要額外
  // 的「清除」按鈕就能把一張圖打回「尚未評分」狀態。
  //
  // 2026-10 code review 修正:這裡原本的註解寫「樂觀更新本地 state,
  // 失敗時用 reload 校正」,但跟下面實際程式碼對不上——setPhotos 本來
  // 就寫在 await api.setPhotoRating 成功之後才執行(不是樂觀更新),
  // 失敗時 catch 只 setErr,本地 state 完全沒被更動過,不需要回滾也
  // 沒有「看起來存成功、其實沒生效」的問題。修正這段過時描述,避免
  // 之後維護者誤信註解、以為這裡真的有樂觀更新邏輯要維護。
  async function handleRatingChange(photo: UploadedPhoto, rating: number) {
    const next = photo.rating === rating ? null : rating
    setErr(null)
    try {
      await api.setPhotoRating(cfg, photo.id, next)
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, rating: next ?? undefined } : p)),
      )
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  function handlePhotoClick(photo: UploadedPhoto) {
    if (!canEditFocal(photo.status)) return
    setEditingPhoto(photo)
  }

  function handleFocalSaved(focal: FocalPoint) {
    if (!editingPhoto) return
    setPhotos((prev) =>
      prev.map((p) => (p.id === editingPhoto.id ? { ...p, focalX: focal.x, focalY: focal.y } : p)),
    )
    setEditingPhoto(null)
  }

  return (
    <div className={styles.body}>
      <ErrorBanner msg={err} />

      <div className={styles.toolbar}>
        {/* compact:2026-10 code review 修正——這顆按鈕嵌入文章編輯器
            卡片(article-photo-library)時需要桌面藥丸尺寸,原本改用
            PhotoManagerPage.module.css 全域選擇器覆寫,現在直接用
            Button 既有的 compact prop(見該元件開頭說明),/blog/photos
            獨立路由(沒有 compact 視覺需求差異,但維持一致尺寸也沒有
            壞處)跟編輯器卡片共用同一個外觀。 */}
        <Button variant="primary" compact onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploadProgress
            ? `上傳中…(${uploadProgress.done}/${uploadProgress.total})`
            : uploading
              ? '上傳中…'
              : '上傳圖片'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className={styles.hiddenFileInput}
          onChange={handleFileSelected}
        />
      </div>

      {loading ? (
        <div className="empty">載入中…</div>
      ) : photos.length === 0 ? (
        <div className="empty">還沒有上傳過任何圖片。</div>
      ) : (
        <div className={styles.grid}>
          {photos.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              onClick={() => handlePhotoClick(photo)}
              onRetry={() => handleRetry(photo.id)}
              onDelete={() => handleDelete(photo.id)}
              onRatingChange={(rating) => handleRatingChange(photo, rating)}
            />
          ))}
        </div>
      )}

      {editingPhoto && (
        <div className="rp-modal-backdrop" onClick={() => setEditingPhoto(null)}>
          <div className={`rp-modal ${styles.focalModal}`} onClick={(e) => e.stopPropagation()}>
            <PhotoFocalEditor
              cfg={cfg}
              photo={editingPhoto}
              onClose={() => setEditingPhoto(null)}
              onSaved={handleFocalSaved}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// PhotoCard:縮圖網格的單一卡片——依狀態顯示不同的疊加內容(pending 處理
// 中提示、failed 錯誤+重試按鈕、ready 可點擊進入焦點編輯器)。
function PhotoCard({
  photo,
  onClick,
  onRetry,
  onDelete,
  onRatingChange,
}: {
  photo: UploadedPhoto
  onClick: () => void
  onRetry: () => void
  onDelete: () => void
  onRatingChange: (rating: number) => void
}) {
  const status = photoDisplayStatus(photo.status)
  const thumbnail = photo.variants?.find((v) => v.kind === 'thumbnail')
  const thumbURL = thumbnail?.url ?? photo.originalUrl
  const focal = photo.focalX != null && photo.focalY != null ? { x: photo.focalX, y: photo.focalY } : undefined

  return (
    <div
      className={status === 'ready' ? `${styles.card} ${styles.cardClickable}` : styles.card}
      onClick={status === 'ready' ? onClick : undefined}
      role={status === 'ready' ? 'button' : undefined}
      tabIndex={status === 'ready' ? 0 : undefined}
      title={status === 'pending' ? '處理中,請稍候' : status === 'failed' ? '處理失敗' : '點擊設定裁切焦點'}
    >
      <div
        className={styles.thumbWrap}
        style={photo.width && photo.height ? { aspectRatio: `${photo.width} / ${photo.height}` } : undefined}
      >
        <img
          src={thumbURL}
          alt=""
          className={styles.thumbImage}
          style={{ objectPosition: objectPositionFor(focal) }}
        />
        {status === 'pending' && (
          <div className={styles.overlay}>
            <span className={styles.overlayText}>處理中…</span>
          </div>
        )}
        {status === 'failed' && (
          <div className={`${styles.overlay} ${styles.overlayError}`}>
            <span className={styles.overlayText}>處理失敗</span>
          </div>
        )}
      </div>
      <div className={styles.meta} onClick={(e) => e.stopPropagation()}>
        <span className={styles.photoId}>{photo.id}</span>
        {/* 品質評分——1~3 顆星,給自己編排文章時參考(3 分適合當 gallery
            主圖,1 分適合合併成陪襯小圖,見 api.ts setPhotoRating 的
            完整說明)。再點一次目前已選中的那顆星會清空評分,見
            handleRatingChange 的完整說明。pending/failed 狀態的圖片也
            能評分(不像焦點編輯器限制只有 ready 才能點,評分純粹是
            文字/數值標注,不需要縮圖/variants 就緒)。 */}
        <div className={styles.rating} title="品質評分(再點一次可清除)">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className={styles.ratingStar}
              onClick={() => onRatingChange(n)}
              aria-label={`評 ${n} 星`}
              aria-pressed={photo.rating != null && photo.rating >= n}
            >
              <Star
                size={14}
                strokeWidth={1.8}
                fill={photo.rating != null && photo.rating >= n ? 'currentColor' : 'none'}
              />
            </button>
          ))}
        </div>
        {photo.note ? (
          <span className={styles.note} title={photo.note}>{photo.note}</span>
        ) : (
          <span className={styles.noteEmpty}>未標注</span>
        )}
      </div>
      <div className={styles.cardFooter}>
        {status === 'failed' ? (
          <button
            type="button"
            className={styles.retryBtn}
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
          >
            重試
          </button>
        ) : (
          <span className={styles.statusText}>
            {status === 'pending' ? '處理中' : '已就緒'}
          </span>
        )}
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="刪除這張圖片"
        >
          刪除
        </button>
      </div>
    </div>
  )
}
