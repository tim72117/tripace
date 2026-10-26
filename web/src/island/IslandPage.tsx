import { useEffect, useMemo, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import { SiteNavBrand } from '../home/SiteNavButtons'
import { loadIslandData } from './islandData'
import { mountIsland } from './mountIsland'
import { SEO_DESCRIPTION, SEO_TITLE } from './seo'
import './ui/hud.css'

// IslandPage——/island:由部落客文章「夜遊九份」生成的互動旅遊小島(完整版)。
//
// 三個部分:①外層容器 .island-root 由 mountIsland 接手(three 場景 + HUD 都在裡面,React 不碰);
// ②站台導覽的品牌字(回首頁);③視覺隱藏、與畫面同源的文字摘要(標題、各站名稱與摘錄、原文連結)——
// 3D 畫面對爬蟲與螢幕閱讀器是空白的,文字版保留在 DOM 供搜尋引擎與輔助科技使用。
// 這頁是深色場景,所以外層固定 data-theme="dark"(讓導覽的品牌字用深色模式的 token,在深色背景上看得清楚)。
// <title> 由這裡宣告;description、canonical、og:*、twitter:* 由伺服器 seo_meta.go 輸出(見 seo.ts)。
export function IslandPage() {
  const rootRef = useRef<HTMLDivElement>(null)
  const { island } = useMemo(() => loadIslandData(), [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    return mountIsland(root, window.location.search)
  }, [])

  return (
    <div className="app-theme-root island-page" data-theme="dark">
      <Helmet>
        <title>{SEO_TITLE}</title>
      </Helmet>
      <div className="island-root" ref={rootRef} />
      <SiteNavBrand pageLabel="夜遊九份島" />
      <section className="island-sr" aria-label="夜遊九份島的文字摘要">
        <h1>{island.meta.title}</h1>
        <p>{SEO_DESCRIPTION}</p>
        {island.meta.lede && <p>{island.meta.lede}</p>}
        <ol>
          {island.stops.map((s) => (
            <li key={s.stopId}>
              <strong>{s.name}</strong>({s.time}):{s.excerpt}
            </li>
          ))}
        </ol>
        <p>
          文・{island.meta.byline.name}。
          {island.meta.byline.articleUrl && <a href={island.meta.byline.articleUrl}>閱讀原文遊記</a>}
        </p>
      </section>
    </div>
  )
}
