import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { SponsoredPlanCard } from '../home/SponsoredPlanCard'
import { resolveSidebar, type SidebarLink } from './sidebarData'
import { SIDEBAR_AD } from './sidebarAd'
import type { SampleItinerary, SampleSidebarAd } from './types'
import styles from './ItinerarySidebar.module.css'

// ItinerarySidebar——行程頁左側的「相關資訊」區塊:站內連結 + 廣告版位。內容由資料決定:
// 連結只來自行程的 sidebar 欄位(沒設定就沒有連結);廣告沒設定時用全站預設(sidebarAd.ts)。見 sidebarData.ts。
//
// placement 決定它在頁面裡怎麼放(同一份內容、三種擺法):
//   - rail:一般單欄版。寬螢幕貼在置中欄位的左邊(捲動時黏住),窄螢幕接在內容下方。
//   - panel:地圖版,行程沒有美食清單時,獨立的左側面板(跟 FoodSpotPanel 同一個位置與風格)。
//   - inline:地圖版,行程有美食清單時,放進 FoodSpotPanel 的捲動區、清單下方。
// 地圖版的顯示寬度:panel 要 1024px 以上(右側時間軸 420px + 左側面板 300px 之後地圖還要有空間),
// inline 跟 FoodSpotPanel 一樣 768px 以上。

export type SidebarPlacement = 'rail' | 'panel' | 'inline'

interface Props {
  itinerary: SampleItinerary
  placement: SidebarPlacement
  // defaultAd——行程資料沒有指定 sidebar.ad 時用的全站預設廣告(sidebarAd.ts);測試可以覆寫。
  defaultAd?: SampleSidebarAd | null
}

export function ItinerarySidebar({ itinerary, placement, defaultAd = SIDEBAR_AD }: Props) {
  // 內容完全由 resolveSidebar 決定:行程資料的 sidebar 欄位優先,沒設定才用預設(見 sidebarData.ts)。
  const resolved = useMemo(() => resolveSidebar(itinerary, defaultAd), [itinerary, defaultAd])
  const sponsored = (
    <SponsoredPlanCard placement={`itinerary-${itinerary.id}`} fallbackPlacement="itinerary-sidebar" variant="compact" />
  )
  // 沒有連結也沒有廣告(例如資料寫 sections: [] 且沒有廣告):不渲染 aside,不留空面板或空 landmark。
  // 業主投放的方案不依賴這份資料,仍要能顯示——只渲染卡片本身(沒有已發布方案時它自己不渲染)。
  if (resolved.sections.length === 0 && !resolved.ad) return sponsored
  const body = (
    <aside className={`${styles.sidebar} ${styles[placement]}`} aria-label="相關資訊">
      {resolved.sections.map((sec, i) => <LinkBlock key={`${i}-${sec.heading}`} heading={sec.heading} links={sec.links} />)}
      {resolved.ad && <AdSlot ad={resolved.ad} />}
      {/* 業主自助控制台投放的方案先查這個行程專屬的版位 itinerary-<行程 id>,沒有再退回全行程共用的 itinerary-sidebar(見 server partnerconsole);都沒有已發布方案時元件不渲染。 */}
      {sponsored}
    </aside>
  )
  // rail 需要外層包一層:外層撐滿頁面高度當定位容器,內層用 sticky 黏住。
  return placement === 'rail' ? <div className={styles.railWrap}>{body}</div> : body
}

function LinkBlock({ heading, links }: { heading: string; links: ReadonlyArray<SidebarLink> }) {
  return (
    <section className={styles.block}>
      <h2 className={styles.heading}>{heading}</h2>
      <ul className={styles.links}>
        {links.map((l) => (
          <li key={l.id}>
            <Link to={l.to} className={styles.link}>
              <span className={styles.linkLabel}>{l.label}</span>
              <span className={styles.linkHint}>{l.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AdSlot({ ad }: { ad: SampleSidebarAd }) {
  return (
    <div className={styles.ad}>
      <span className={styles.adLabel}>廣告</span>
      <a className={styles.adLink} href={ad.href} target="_blank" rel="sponsored noopener noreferrer">
        <img className={styles.adImg} src={ad.imageUrl} alt={ad.alt} loading="lazy" />
      </a>
    </div>
  )
}
