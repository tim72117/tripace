import { useEffect, useState } from 'react'
import * as api from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import { Button } from '../components/Button'
import { PhotoPickerModal } from './PhotoPickerModal'
import { useConfirmDialog } from '../components/ConfirmDialog'
import styles from './BlogProfileSettings.module.css'

// BlogProfileSettings——「設定你的部落格身份」區塊(handle + 頭像網址,
// 見 server/internal/api/blog_profile.go 開頭的完整說明)。以「新增」
// 的方式插入 PhotoManagerPage.tsx 最上方,不改動該檔案既有的圖片管理
// 邏輯——這個頁面已經是「部落客管理中心」的既有入口(/blog/photos),
// 使用者判斷整合進這裡比另開一條獨立路由更符合直覺,見本次任務規格。
//
// 讀取/儲存模式仿照 PhotoManagerPage.tsx 的既有慣例:載入時呼叫 GET
// 取得目前設定,404(尚未設定過)時顯示空白表單;送出走 POST 的
// upsert 語意,成功/失敗都用 ErrorBanner/行內文字給回饋(對齊該檔案
// 既有的 err/成功提示模式)。
export function BlogProfileSettings({ cfg }: { cfg: api.ClientConfig }) {
  const [loading, setLoading] = useState(true)
  const [handle, setHandle] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  // hasProfile:區分「第一次設定」與「編輯既有設定」——目前只影響按鈕
  // 文案,upsert 語意本身後端已經處理好,前端不需要為此切換不同的
  // API 呼叫。
  const [hasProfile, setHasProfile] = useState(false)
  // savedHandle:目前已儲存在後端的 handle。改成別的 handle 會讓所有已發布文章的舊網址(/u/舊handle/...)失效,
  // 所以改動時要警告並在送出前再確認。
  const [savedHandle, setSavedHandle] = useState('')
  // 頭像從素材庫挑:開啟時才抓清單(平常用不到,不為它多打一次請求)。
  const [avatarPicker, setAvatarPicker] = useState<api.UploadedPhoto[] | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setErr(null)
      try {
        const profile = await api.fetchMyBlogProfile(cfg)
        if (cancelled) return
        setHandle(profile.handle)
        setSavedHandle(profile.handle)
        setAvatarUrl(profile.avatarUrl ?? '')
        setHasProfile(true)
      } catch (e) {
        if (cancelled) return
        // 404(尚未設定過)不是錯誤,維持空白表單;其餘錯誤才顯示
        // 錯誤橫幅,理由同 api.ts fetchMyBlogProfile 的完整說明。
        if (e instanceof api.ApiError && e.call.status === 404) {
          setHasProfile(false)
        } else {
          setErr(errMsg(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token])

  async function openAvatarPicker() {
    setErr(null)
    setAvatarLoading(true)
    try {
      setAvatarPicker(await api.fetchMyUploadedPhotos(cfg))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setAvatarLoading(false)
    }
  }

  const handleChanged = hasProfile && handle.trim() !== savedHandle
  const { ask, dialog: confirmDialog } = useConfirmDialog()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (handleChanged) {
      const choice = await ask({
        title: '修改 handle',
        message: `確定要把 handle 從「${savedHandle}」改成「${handle.trim()}」嗎?

所有已發布文章的舊網址(/u/${savedHandle}/…)會立刻失效,已分享出去的連結會變成 404。`,
        choices: [{ id: 'change', label: '確定修改', variant: 'danger' }],
      })
      if (choice !== 'change') return
    }
    setErr(null)
    setSavedMsg(null)
    setSaving(true)
    try {
      const profile = await api.setMyBlogProfile(cfg, handle.trim(), avatarUrl.trim())
      setHandle(profile.handle)
      setSavedHandle(profile.handle)
      setAvatarUrl(profile.avatarUrl ?? '')
      setHasProfile(true)
      setSavedMsg('已儲存')
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className={styles.section}>
        <div className="empty">載入中…</div>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>設定你的部落格身份</h2>
      <ErrorBanner msg={err} />
      {savedMsg && <div className={styles.savedBanner}>{savedMsg}</div>}
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Handle(公開網址用,如 tim72117)</span>
          <input
            className={styles.input}
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="英數字、底線或連字符"
            required
          />
          {handleChanged && (
            <span className={styles.warn}>
              改 handle 會讓已發布文章的舊網址(/u/{savedHandle}/…)失效,已分享的連結會變成 404。
            </span>
          )}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>頭像網址(選填)</span>
          <input
            className={styles.input}
            type="text"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
          />
          <span className={styles.avatarRow}>
            {avatarUrl && <img className={styles.avatarPreview} src={avatarUrl} alt="頭像預覽" />}
            <Button type="button" variant="secondary" compact onClick={openAvatarPicker} disabled={avatarLoading}>
              {avatarLoading ? '載入素材庫…' : '從素材庫選擇'}
            </Button>
            {avatarUrl && (
              <Button type="button" variant="secondary" compact onClick={() => setAvatarUrl('')}>
                移除
              </Button>
            )}
          </span>
        </label>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? '儲存中…' : hasProfile ? '更新設定' : '建立設定'}
        </Button>
      </form>
      {confirmDialog}
      {avatarPicker && (
        <PhotoPickerModal
          photos={avatarPicker}
          mode="single"
          title="選擇頭像"
          onClose={() => setAvatarPicker(null)}
          onConfirm={(selected) => {
            const p = selected[0]
            // 存的是公開網址(頭像會顯示在公開文章頁):優先縮圖,沒有就用原圖。
            setAvatarUrl(p.variants?.find((v) => v.kind === 'thumbnail')?.url ?? p.originalUrl)
            setAvatarPicker(null)
          }}
        />
      )}
    </section>
  )
}
