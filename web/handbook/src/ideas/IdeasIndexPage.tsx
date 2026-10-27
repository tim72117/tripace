import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IDEA_GROUPS } from './groups'
import { getCategory } from '../categories'
import type { IdeaGroupId } from './types'
import { ideasOfGroup } from './registry'
import styles from './IdeasIndexPage.module.css'

// IdeasIndexPage:所有構想的總覽,依群組分段,可用關鍵字篩選。
// 每個構想的內容在 ideas/<群組>/ 底下的資料檔,點進去由 IdeaPage 渲染。
// category——從首頁分類進來(/category/:id)時帶入該分類的 id,只列出該分類的群組、標題改成分類名稱;
// 沒帶(/ideas 總覽)就列出全部群組。
export function IdeasIndexPage({ category: categoryId }: { category?: string }) {
  const category = getCategory(categoryId)
  const groupIds: IdeaGroupId[] | undefined = category?.groupIds
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const groups = useMemo(
    () =>
      IDEA_GROUPS.filter((g) => !groupIds || groupIds.includes(g.id)).map((g) => ({
        meta: g,
        ideas: ideasOfGroup(g.id).filter((i) => {
          if (!q) return true
          const hay = [i.title, i.summary, i.proposer ?? '', ...(i.tags ?? [])].join(' ').toLowerCase()
          return hay.includes(q)
        }),
        total: ideasOfGroup(g.id).length,
      })),
    [q, groupIds],
  )
  const shown = groups.reduce((n, g) => n + g.ideas.length, 0)
  const total = groups.reduce((n, g) => n + g.total, 0)

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>← 首頁</Link>
        <h1 className={styles.heading}>{category ? category.title : '構想總覽'}</h1>
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
