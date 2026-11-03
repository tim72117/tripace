import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import { Button } from '../components/Button'
import { useConfirmDialog } from '../components/ConfirmDialog'
import { NEW_ARTICLE_KEY, draftScope, listArticleDrafts, deleteArticleDraft, type ArticleDraftSummary } from './draftStore'
import styles from './BlogArticleList.module.css'

// BlogArticleList——「我的文章列表」區塊,列出目前登入者自己發表過的
// content_pages(不分 draft/published,見後端 handleMyContentPageList
// 的完整說明)。插在 blog/PhotoManagerPage.tsx 的 PhotoManagerContent
// 最上方(見該檔案掛載處的完整說明)——沿用 BlogProfileSettings.tsx 的
// 既有模式(新增區塊插在既有圖片管理內容之前,不改動該檔案既有邏輯)。
//
// 讀取模式仿照 PhotoManagerPage.tsx 的既有慣例:cfg 變動時重新載入,
// 卸載/cfg 變動時用 cancelled 旗標避免過期的 setState。同時載入
// fetchMyBlogProfile 取得 handle,才能組出 /u/{handle}/{slug} 這種
// 「點進去看文章」的連結(見 handle 為 null 時的降級說明)。
//
// onEdit(2026-10 新增,選填)——使用者明確要求「點文章時開啟編輯器,
// 而不是開啟文章(閱讀頁)」:這個元件有兩個進入點共用(見
// PhotoManagerPage.tsx PhotoManagerContent 掛載處的完整說明),行為
// 要分開——
//  - planning/member/desktop/Content.tsx 的 panelMode==='blog' 面板裡渲染時會傳入
//    onEdit(切到 panelMode:'blog-editor',見該檔案的完整說明),點文章
//    一律開啟編輯器,不分 draft/published(編輯動作本來就該不分發布
//    狀態都能進去)。onEdit 參數為 null 代表「新建一篇」(見下方
//    「新增文章」按鈕),跟點既有文章(傳該篇的 MyContentPage)共用
//    同一個 callback,呼叫端(ArticleEditor)只需要分辨 slug 是否為
//    null 就能決定走建立或讀取流程,不需要兩支不同的 callback prop。
//  - /blog/photos 這條獨立路由(PhotoManagerPage,未登入也能打開)
//    沒有 panelMode 概念可以切換,不傳這個 prop 時維持原本行為:已
//    發布且有 handle 才連去 /u/{handle}/{slug} 公開閱讀頁,其餘顯示
//    成不可點擊的純文字列項(見 ArticleRow 原本的既有邏輯),且不顯示
//    「新增文章」按鈕(這條路由本來就不是編輯入口)。
export function BlogArticleList({
  cfg,
  onEdit,
}: {
  cfg: api.ClientConfig
  onEdit?: (article: api.MyContentPage | null) => void
}) {
  const [loading, setLoading] = useState(true)
  const [articles, setArticles] = useState<api.MyContentPage[]>([])
  // handle:用來組文章連結(/u/{handle}/{slug})——尚未設定部落格身份時
  // (fetchMyBlogProfile 404)維持 null,下方渲染改成不可點擊的純文字
  // 列項,而不是連去一個註定 404 的連結(handlePublicBlogArticle 要先
  // 解析 handle 才能查到文章,沒有 handle 就沒有合法的公開網址)。
  const [handle, setHandle] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // drafts:這個瀏覽器裡尚未儲存的本機草稿(見 draftStore.ts)。既有文章的草稿標在該列,
  // 還沒儲存過的新文章草稿(NEW_ARTICLE_KEY)獨立一列,否則使用者沒點「新增文章」根本不知道它存在。
  const scope = draftScope(cfg.token)
  const { ask, dialog: confirmDialog } = useConfirmDialog()
  const [drafts, setDrafts] = useState<ArticleDraftSummary[]>([])
  useEffect(() => {
    let cancelled = false
    listArticleDrafts(scope).then((d) => {
      if (!cancelled) setDrafts(d)
    })
    return () => {
      cancelled = true
    }
  }, [scope])
  const draftBySlug = new Map(drafts.map((d) => [d.slugKey, d]))
  const newDraft = draftBySlug.get(NEW_ARTICLE_KEY)

  async function handleDelete(article: api.MyContentPage) {
    const label = article.title || article.slug
    const extra = article.status === 'published' ? '\n這篇已發布,刪除後公開網址會變成 404。' : ''
    const choice = await ask({
      title: '刪除文章',
      message: `確定要刪除「${label}」嗎?${extra}\n\n刪除後無法復原。`,
      choices: [{ id: 'delete', label: '刪除', variant: 'danger' }],
    })
    if (choice !== 'delete') return
    setErr(null)
    try {
      await api.deleteMyContentPage(cfg, article.slug)
      setArticles((prev) => prev.filter((a) => a.id !== article.id))
      void deleteArticleDraft(scope, article.slug)
      setDrafts((prev) => prev.filter((d) => d.slugKey !== article.slug))
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setErr(null)
      try {
        const [pages, profile] = await Promise.all([
          api.fetchMyContentPages(cfg),
          api.fetchMyBlogProfile(cfg).catch((e) => {
            // 尚未設定部落格身份(404)不是錯誤,只是沒有 handle 可以
            //組連結——理由同 BlogProfileSettings.tsx 的既有判斷邏輯。
            if (e instanceof api.ApiError && e.call.status === 404) return null
            throw e
          }),
        ])
        if (cancelled) return
        setArticles(pages)
        setHandle(profile?.handle ?? null)
      } catch (e) {
        if (cancelled) return
        setErr(errMsg(e))
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

  return (
    <section className={styles.section}>
      <div className={styles.headRow}>
        <h2 className={styles.heading}>我的文章</h2>
        {onEdit && (
          <Button compact variant="primary" onClick={() => onEdit(null)}>
            新增文章
          </Button>
        )}
      </div>
      <ErrorBanner msg={err} />
      {loading ? (
        <div className="empty">載入中…</div>
      ) : articles.length === 0 && !newDraft ? (
        <div className="empty">還沒有發表過任何文章。</div>
      ) : (
        <ul className={styles.list}>
          {newDraft && onEdit && (
            <li className={styles.row}>
              <button type="button" className={styles.rowLink} onClick={() => onEdit(null)}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{newDraft.title || '(未命名的新文章)'}</span>
                  <span className={styles.statusDraft}>本機草稿</span>
                </div>
                <span className={styles.rowMeta}>尚未儲存 · {new Date(newDraft.savedAt).toLocaleString('zh-TW', { hour12: false })}</span>
              </button>
            </li>
          )}
          {articles.map((a) => (
            <ArticleRow
              key={a.id}
              article={a}
              handle={handle}
              onEdit={onEdit}
              localDraft={draftBySlug.get(a.slug)}
              onDelete={onEdit ? () => handleDelete(a) : undefined}
            />
          ))}
        </ul>
      )}
      {confirmDialog}
    </section>
  )
}

function ArticleRow({
  article,
  handle,
  onEdit,
  localDraft,
  onDelete,
}: {
  article: api.MyContentPage
  handle: string | null
  onEdit?: (article: api.MyContentPage) => void
  localDraft?: ArticleDraftSummary
  onDelete?: () => void
}) {
  const title = article.title || article.slug
  const published = article.status === 'published'
  const updatedAt = new Date(article.updatedAt).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const inner = (
    <>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={published ? styles.statusPublished : styles.statusDraft}>
          {published ? '已發布' : '草稿'}
        </span>
        {localDraft && <span className={styles.statusDraft} title="這個瀏覽器裡有尚未儲存的變更,開啟時可還原">有未儲存的變更</span>}
      </div>
      <span className={styles.rowMeta}>{updatedAt} 更新</span>
    </>
  )

  // onEdit 有傳時(見本檔開頭的完整說明,目前只有 planning/member/desktop/Content.tsx 的
  // panelMode==='blog' 面板會傳)一律開啟編輯器,不分 draft/published
  // ——編輯動作本來就該不分發布狀態都能進去,不像下面的公開閱讀連結
  // 需要「已發布」這個前提。
  if (onEdit) {
    return (
      <li className={styles.row}>
        <button type="button" className={styles.rowLink} onClick={() => onEdit(article)}>
          {inner}
        </button>
        {onDelete && (
          <button type="button" className={styles.rowDelete} onClick={onDelete} aria-label={`刪除 ${title}`} title="刪除這篇文章">
            刪除
          </button>
        )}
      </li>
    )
  }

  // 只有已發布的文章、且目前使用者已設定 handle,才有合法的公開網址
  // 可以連過去(handlePublicBlogArticle 只回傳 status==="published"
  // 的內容,草稿連過去只會看到 404;沒有 handle 則整個 /u/{handle}/...
  // 路徑無法組出)——其餘情況顯示成不可點擊的純文字列項。
  if (published && handle) {
    return (
      <li className={styles.row}>
        <Link className={styles.rowLink} to={`/u/${encodeURIComponent(handle)}/${encodeURIComponent(article.slug)}`}>
          {inner}
        </Link>
      </li>
    )
  }
  return (
    <li className={`${styles.row} ${styles.rowStatic}`}>
      {inner}
    </li>
  )
}
