import { useCallback, useEffect, useRef, useState } from 'react'
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
import styles from './PhotoManagerPage.module.css'

// PhotoManagerPage——/blog/photos 路由的頁面外殼,仿照 trip-plan/TripPlanRoute.tsx
// 「需要登入才能使用」的既有模式(見該檔案開頭的完整說明):訪客可以到達
// 這個網址,頁面內自己用 useAppState() 取 cfg/isGuest/onAuthed,isGuest 時
// 內嵌 LoginForm,不是未登入就擋下或導轉到別的路由。這個專案沒有
// <RequireAuth> 這類包裝元件的先例,沿用 TripPlanRoute 這個既有做法,不
// 自己發明新機制。
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
          .header 保留純粹的頁面標題列角色(「我的圖片」)。 */}
      <SiteNavBrand />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">返回應用</SiteNavCta>
      <header className={styles.header}>
        <span className={styles.title}>我的圖片</span>
      </header>
      {/* BlogProfileSettings:新增的「設定你的部落格身份」區塊,插在
          既有圖片管理內容之前——這個頁面本身已經是 /blog/photos 這個
          部落客管理中心的既有入口,整合進來比另開一條獨立路由更直覺
          (見該元件開頭的完整說明)。純新增,不改動下方
          PhotoManagerBody 既有的任何邏輯。 */}
      <div className={styles.body}>
        <BlogProfileSettings cfg={cfg} />
      </div>
      <PhotoManagerBody cfg={cfg} />
    </div>
  )
}

function PhotoManagerBody({ cfg }: { cfg: api.ClientConfig }) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
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

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 允許連續選同一個檔案觸發 onChange
    if (!file) return

    setUploading(true)
    setErr(null)
    try {
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
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setUploading(false)
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
        <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? '上傳中…' : '上傳圖片'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
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
            />
          ))}
        </div>
      )}

      {editingPhoto && (
        <div className="rp-modal-backdrop" onClick={() => setEditingPhoto(null)}>
          <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
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
}: {
  photo: UploadedPhoto
  onClick: () => void
  onRetry: () => void
  onDelete: () => void
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
      <div className={styles.thumbWrap}>
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
