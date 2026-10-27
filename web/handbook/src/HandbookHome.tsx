import { Link } from 'react-router-dom'
import { HANDBOOK_CATEGORIES, type HandbookCategory } from './categories'
import { itemCountOfMode } from './HandbookIndex'
import { ideasOfGroup } from './ideas/registry'
import styles from './HandbookIndex.module.css'

// HandbookHome:handbook 首頁(/)——只列項目分類,點進分類頁(/category/:id)才列文章清單。
// 版型沿用 HandbookIndex 的卡片樣式。這些頁面純供內部查看,不對外公開連結。
function countOf(c: HandbookCategory): number {
  if (c.groupIds) return c.groupIds.reduce((n, g) => n + ideasOfGroup(g).length, 0)
  return itemCountOfMode(c.id as 'prototypes' | 'system-docs')
}

export function HandbookHome() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.heading}>Tripace Handbook</h1>
        <p className={styles.subheading}>
          內部文件與構想的入口,依項目分類;點進分類後才列出文章清單。這些頁面純供內部查看,不對外公開連結。
        </p>
        <ul className={styles.list}>
          {HANDBOOK_CATEGORIES.map((c) => (
            <li key={c.id}>
              <Link to={`/category/${c.id}`} className={styles.item}>
                <div className={styles.itemTitle}>
                  {c.title}
                  <span className={styles.itemStatus}>{countOf(c)} 篇</span>
                </div>
                <p className={styles.itemDesc}>{c.blurb}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
