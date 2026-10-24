import { Link, useParams } from 'react-router-dom'
import { getIdea, ideasOfGroup } from './registry'
import { IDEA_GROUPS } from './groups'
import styles from './IdeaPage.module.css'

// 依發言者的角色名稱決定氣泡配色。原文的角色名稱不固定(「新手旅行者」
// 「老手旅行者」「行程規劃師」「設計師」「仲裁(主代理)」…),用關鍵字比對,
// 比對不到就用中性色。
function speakerTone(speaker: string): string {
  if (speaker.includes('仲裁') || speaker.includes('主代理')) return styles.toneJudge
  if (speaker.includes('新手')) return styles.toneNovice
  if (speaker.includes('老手')) return styles.toneVeteran
  if (speaker.includes('規劃師')) return styles.tonePlanner
  if (speaker.includes('設計師')) return styles.toneDesigner
  return styles.toneNeutral
}

// IdeaPage:一個構想一頁的共用版型,依 ideas/types.ts 的 IdeaDoc 渲染。
// 內容全部來自資料檔,這裡不含任何構想本身的文字。
export function IdeaPage() {
  const { id = '' } = useParams()
  const idea = getIdea(id)

  if (!idea) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Link to="/ideas" className={styles.back}>← 構想總覽</Link>
          <h1 className={styles.title}>找不到這個構想</h1>
          <p className={styles.summary}>沒有識別碼為「{id}」的構想頁面。</p>
        </div>
      </div>
    )
  }

  const group = IDEA_GROUPS.find((g) => g.id === idea.group)
  const siblings = ideasOfGroup(idea.group)
  const index = siblings.findIndex((s) => s.id === idea.id)
  const prev = index > 0 ? siblings[index - 1] : undefined
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/ideas" className={styles.back}>← 構想總覽{group ? `／${group.title}` : ''}</Link>

        <header className={styles.header}>
          <h1 className={styles.title}>{idea.title}</h1>
          <div className={styles.meta}>
            {idea.proposer && <span className={styles.chip}>{idea.proposer}提出</span>}
            {idea.tags?.map((t) => (
              <span key={t} className={styles.tag}>{t}</span>
            ))}
          </div>
          <p className={styles.summary}>{idea.summary}</p>
        </header>

        {idea.sections.map((s) => (
          <section key={s.heading} className={styles.section}>
            <h2 className={styles.sectionHeading}>{s.heading}</h2>
            {s.paragraphs?.map((p, i) => (
              <p key={i} className={styles.paragraph}>{p}</p>
            ))}
            {s.bullets && (
              <ul className={styles.bullets}>
                {s.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {s.table && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {s.table.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.note && <p className={styles.note}>{s.note}</p>}
          </section>
        ))}

        {idea.discussion && idea.discussion.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>討論過程</h2>
            <ol className={styles.turns}>
              {idea.discussion.map((t, i) => (
                <li key={i} className={`${styles.turn} ${speakerTone(t.speaker)}`}>
                  <div className={styles.speaker}>{t.speaker}</div>
                  <p className={styles.turnText}>{t.text}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {idea.verdict && (
          <section className={styles.verdict}>
            <h2 className={styles.sectionHeading}>結論</h2>
            <p className={styles.paragraph}>{idea.verdict}</p>
          </section>
        )}

        <footer className={styles.footer}>
          {idea.source && idea.source.length > 0 && (
            <>
              <div className={styles.sourceLabel}>原始文件(已移除,需要原文請查 git 歷史)</div>
              <ul className={styles.sourceList}>
                {idea.source.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <nav className={styles.pager}>
            {prev ? <Link to={`/ideas/${prev.id}`} className={styles.pagerLink}>← {prev.title}</Link> : <span />}
            {next ? <Link to={`/ideas/${next.id}`} className={styles.pagerLink}>{next.title} →</Link> : <span />}
          </nav>
        </footer>
      </div>
    </div>
  )
}
