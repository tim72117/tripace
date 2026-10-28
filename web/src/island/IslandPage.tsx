import { useEffect, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { SiteNavBrand } from '../home/SiteNavButtons'
import { mountIsland } from './mountIsland'
import { DEFAULT_SCENE_ID, SCENES, getScene, preloadScene, sceneHref } from './scenes/registry'
import type { SceneDef } from './scenes/types'
import { useIslandScene } from './scenes/useIslandScene'
import './ui/hud.css'

// IslandPage——/island(預設場景)與 /island/:sceneId(其餘場景):由部落客文章生成的互動旅遊小島(完整版)。
// 有哪些場景、各自的網址與文案見 scenes/registry.ts;新增場景不需要改這支元件。
//
// 外層只做路由判斷:場景 id 不存在 → 回 /island;預設場景的 id 網址(/island/night-jiufen)→ 回 /island(同一場景只有一個網址)。
// 場景本身放在 IslandScene,用 key={sceneId} 讓切換場景時整個重掛——舊場景的 three 與 HUD 一定先被卸載(IslandApp.dispose)
// 才建立新的,不會同時存在兩個 WebGL context。
export function IslandPage() {
  const { sceneId: param } = useParams<{ sceneId?: string }>()
  const sceneId = param ?? DEFAULT_SCENE_ID
  const def = getScene(sceneId)
  if (!def || (param !== undefined && sceneId === DEFAULT_SCENE_ID)) return <Navigate to="/island" replace />
  return <IslandScene key={def.id} def={def} />
}

// IslandScene——一個場景的頁面,三個部分:①外層容器 .island-root 由 mountIsland 接手(three 場景 + HUD 都在裡面,
// React 不碰);②站台導覽的品牌字(回首頁);③視覺隱藏、與畫面同源的文字摘要(標題、各站名稱與摘錄、原文連結)——
// 3D 畫面對爬蟲與螢幕閱讀器是空白的,文字版保留在 DOM 供搜尋引擎與輔助科技使用。
// 場景資料載入前顯示「載入中」、失敗顯示錯誤與重試(覆蓋層,不動 .island-root)。
// 這頁是深色場景,所以外層固定 data-theme="dark"(讓導覽的品牌字用深色模式的 token,在深色背景上看得清楚)。
// <title> 由這裡宣告;description、canonical、og:*、twitter:* 由伺服器 seo_meta.go 輸出(見 scenes/*/index.ts 的 seo)。
function IslandScene({ def }: { def: SceneDef }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { state, retry } = useIslandScene(def.id)
  const data = state.status === 'ready' ? state.data : null

  // navigate 與 def 的身分穩定(def 來自模組常數、navigate 由 router 保證穩定),把最新值放 ref,effect 只依賴 data
  const navRef = useRef(navigate)
  navRef.current = navigate

  useEffect(() => {
    const root = rootRef.current
    if (!root || !data) return
    return mountIsland(root, window.location.search, data, {
      ctaLabel: def.ctaLabel,
      scenes: SCENES.map((s) => ({ id: s.id, label: s.label })),
      sceneId: def.id,
      onSwitchScene: (id) => navRef.current(sceneHref(id)),
      onPreloadScene: preloadScene,
    })
  }, [data, def])

  const island = data?.island
  return (
    <div className="app-theme-root island-page" data-theme="dark">
      <Helmet>
        <title>{def.seo.title}</title>
      </Helmet>
      <div className="island-root" ref={rootRef} />
      {state.status === 'loading' && (
        <div className="island-status" role="status" aria-live="polite">載入「{def.label}」…</div>
      )}
      {state.status === 'error' && (
        <div className="island-status" role="alert">
          <div>場景載入失敗,請檢查網路後再試一次。</div>
          <button type="button" onClick={retry}>重試</button>
        </div>
      )}
      <SiteNavBrand pageLabel={def.pageLabel} />
      <section className="island-sr" aria-label={`${def.pageLabel}的文字摘要`}>
        <h1>{island?.meta.title ?? def.label}</h1>
        <p>{def.seo.description}</p>
        {island?.meta.lede && <p>{island.meta.lede}</p>}
        {island && (
          <>
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
          </>
        )}
      </section>
    </div>
  )
}
