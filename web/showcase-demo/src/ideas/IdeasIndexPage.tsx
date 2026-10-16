import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IDEA_GROUPS } from './groups'
import { ideasOfGroup } from './registry'
import styles from './IdeasIndexPage.module.css'

// IdeasIndexPage:所有構想的總覽,依群組分段,可用關鍵字篩選。
// 每個構想的內容在 ideas/<群組>/ 底下的資料檔,點進去由 IdeaPage 渲染。
export function IdeasIndexPage() {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const groups = useMemo(
    () =>
      IDEA_GROUPS.map((g) => ({
        meta: g,
        ideas: ideasOfGroup(g.id).filter((i) => {
          if (!q) return true
          const hay = [i.title, i.summary, i.proposer ?? '', ...(i.tags ?? [])].join(' ').toLowerCase()
          return hay.includes(q)
        }),
        total: ideasOfGroup(g.id).length,
      })),
    [q],
  )
  const shown = groups.reduce((n, g) => n + g.ideas.length, 0)
  const total = groups.reduce((n, g) => n + g.total, 0)

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>← 產品方向雛形試做</Link>
        <h1 className={styles.heading}>構想總覽</h1>
        <p className={styles.subheading}>
          原本散在 docs/ 的產品構想、AI 排行程的多輪設計討論、行程規劃設計討論與研究發想,
          改寫成一個構想一頁。純供內部查看。
        </p>
        <input
          className={styles.search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋標題、摘要、提出者"
          aria-label="搜尋構想"
        />
        <p className={styles.count}>
          {q ? `符合 ${shown} / 共 ${total} 個構想` : `共 ${total} 個構想`}
        </p>

        {groups.map(({ meta, ideas, total: groupTotal }) => (
          <section key={meta.id} className={styles.group}>
            <h2 className={styles.groupTitle}>
              {meta.title}
              <span className={styles.groupCount}>{q ? `${ideas.length} / ${groupTotal}` : groupTotal}</span>
            </h2>
            <p className={styles.groupBlurb}>{meta.blurb}</p>
            {ideas.length === 0 ? (
              <p className={styles.empty}>{groupTotal === 0 ? '尚無內容' : '沒有符合的構想'}</p>
            ) : (
              <ul className={styles.list}>
                {ideas.map((i) => (
                  <li key={i.id}>
                    <Link to={`/ideas/${i.id}`} className={styles.item}>
                      <div className={styles.itemTitle}>
                        {i.title}
                        {i.proposer && <span className={styles.chip}>{i.proposer}</span>}
                      </div>
                      <p className={styles.itemSummary}>{i.summary}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
