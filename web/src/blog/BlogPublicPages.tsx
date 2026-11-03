import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BASE_URL } from '../AppCommon'
import {
  fetchBlogIndex,
  fetchPublicBlogAuthor,
  fetchPublicBlogPhotosByIDs,
  type BlogArticleSummary,
  type BlogAuthor,
  type ClientConfig,
  type PublicUploadedPhoto,
} from '../api'
import { NotFoundPage } from '../home/NotFoundPage'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import { trackEvent } from '../analytics'
import styles from './BlogPublicPages.module.css'
import './BlogArticle.css'

// 部落格公開頁:作者頁 /u/:handle(BlogAuthorPage)與部落格首頁 /blog(BlogIndexPage)。
// 兩頁都是免登入的唯讀列表,只顯示已發布文章(後端 GET /v1/blog/{handle}、/v1/blog-index 已過濾),
// 共用同一組文章卡與外殼(沿用文章頁的主題切換與站台導覽,視覺上跟 /u/:handle/:slug 同一套)。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// useCoverMap:把一批文章的 heroPhotoId 批次展開成可顯示的圖片(失敗就沒有封面,卡片退回純文字,不影響列表)。
function useCoverMap(articles: BlogArticleSummary[]): Map<string, PublicUploadedPhoto> {
  const [map, setMap] = useState<Map<string, PublicUploadedPhoto>>(new Map())
  useEffect(() => {
    const ids = [...new Set(articles.map((a) => a.heroPhotoId).filter((id): id is string => !!id))]
    if (ids.length === 0) return
    let cancelled = false
    fetchPublicBlogPhotosByIDs(GUEST_CFG, ids)
      .then((res) => {
        if (!cancelled) setMap(new Map(res.photos.map((p) => [p.id, p])))
      })
      .catch((err) => console.warn('[BlogPublicPages] 封面圖查詢失敗,卡片將不顯示封面:', err))
    return () => {
      cancelled = true
    }
  }, [articles])
  return map
}

function ArticleCards({ articles, author }: { articles: BlogArticleSummary[]; author?: BlogAuthor }) {
  const covers = useCoverMap(articles)
  return (
    <ul className={styles.cards}>
      {articles.map((a) => {
        const handle = a.handle ?? author?.handle ?? ''
        const avatar = a.avatarUrl ?? author?.avatarUrl
        const cover = a.heroPhotoId ? covers.get(a.heroPhotoId) : undefined
        const coverUrl = cover ? (cover.variants?.find((v) => v.kind === 'thumbnail')?.url ?? cover.originalUrl) : undefined
        return (
          <li key={`${handle}/${a.slug}`}>
            <Link className={styles.card} to={`/u/${encodeURIComponent(handle)}/${encodeURIComponent(a.slug)}`}>
              {coverUrl && <img className={styles.cardCover} src={coverUrl} alt="" loading="lazy" />}
              <div className={styles.cardBody}>
                <h2 className={styles.cardTitle}>{a.title || a.slug}</h2>
                {a.lede && <p className={styles.cardLede}>{a.lede}</p>}
                <div className={styles.cardMeta}>
                  {avatar && <img className={styles.cardAvatar} src={avatar} alt="" />}
                  {a.handle && <span>{a.handle}</span>}
                  {a.handle && <span aria-hidden="true">·</span>}
                  <time>{formatDate(a.publishedAt)}</time>
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function PageShell({ pageKey, children }: { pageKey: string; children: React.ReactNode }) {
  const { theme, dark, toggleTheme } = useThemeToggle()
  return (
    <div className={`theme-page-demo-page ${styles.page}`} data-theme={theme ?? undefined}>
      <SiteNavBrand />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: pageKey, position: 'nav' })}>登入</SiteNavCta>
      <main className={styles.main}>{children}</main>
    </div>
  )
}

type ListState<T> = { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'not-found' }

export function BlogAuthorPage({ handle }: { handle: string }) {
  const [state, setState] = useState<ListState<{ author: BlogAuthor; articles: BlogArticleSummary[] }>>({ kind: 'loading' })
  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    fetchPublicBlogAuthor(GUEST_CFG, handle)
      .then((res) => {
        if (!cancelled) setState({ kind: 'ok', data: res })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[BlogAuthorPage] fetchPublicBlogAuthor 失敗:', err)
        setState({ kind: 'not-found' })
      })
    return () => {
      cancelled = true
    }
  }, [handle])

  if (state.kind === 'not-found') return <NotFoundPage />
  return (
    <PageShell pageKey="blog-author">
      {state.kind === 'loading' ? (
        <p className={styles.hint}>載入中…</p>
      ) : (
        <>
          <header className={styles.authorHead}>
            {state.data.author.avatarUrl && <img className={styles.authorAvatar} src={state.data.author.avatarUrl} alt={state.data.author.handle} />}
            <h1 className={styles.authorName}>{state.data.author.handle}</h1>
            <p className={styles.hint}>{state.data.articles.length} 篇文章</p>
          </header>
          {state.data.articles.length === 0 ? (
            <p className={styles.hint}>還沒有發布任何文章。</p>
          ) : (
            <ArticleCards articles={state.data.articles} author={state.data.author} />
          )}
        </>
      )}
    </PageShell>
  )
}

export function BlogIndexPage() {
  const [state, setState] = useState<ListState<BlogArticleSummary[]>>({ kind: 'loading' })
  useEffect(() => {
    let cancelled = false
    fetchBlogIndex(GUEST_CFG)
      .then((res) => {
        if (!cancelled) setState({ kind: 'ok', data: res.articles })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[BlogIndexPage] fetchBlogIndex 失敗:', err)
        setState({ kind: 'not-found' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageShell pageKey="blog-index">
      <header className={styles.authorHead}>
        <h1 className={styles.authorName}>旅行誌</h1>
        <p className={styles.hint}>大家最近發布的旅行文章</p>
      </header>
      {state.kind === 'loading' ? (
        <p className={styles.hint}>載入中…</p>
      ) : state.kind === 'not-found' ? (
        <p className={styles.hint}>目前無法載入文章,請稍後再試。</p>
      ) : state.data.length === 0 ? (
        <p className={styles.hint}>還沒有人發布文章。</p>
      ) : (
        <ArticleCards articles={state.data} />
      )}
    </PageShell>
  )
}
