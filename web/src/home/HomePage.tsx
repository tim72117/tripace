import { useEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { trackEvent } from '../analytics'
import './HomePage.css'

// HomePage — 網站首頁("/" 路由)。原本以京都東山探索路線的捲動視差敘事
// (SVG 手繪路徑動畫 + 逐站文字 + bloom 展開照片)與互動地圖(當時叫
// KiyomizuDemoPage,2026-09 稍後改名為 InteractiveExploreMap,見該
// 元件開頭的完整說明)構成主體,2026-09 應使用者要求整段移除——京都的
// 完整體驗已搬到獨立的 /kyoto-kiyomizu 頁面(KyotoPage.tsx,複用同一套
// STOPS 文案與 InteractiveExploreMap 元件),首頁本身簡化成只有
// hero(品牌主張)+ destinations(目的地列表)+ footer 三段,不再重複
// 呈現同一份京都內容。
// 舊版那段命令式 rAF/IntersectionObserver 捲動動畫、STOPS 資料、
// PHOTO_DATA、mapExpanded 手機版滿版擴張邏輯已整段刪除,不是保留但停用
// ——沒有對應 JSX 掛載目標的情況下讓那些 querySelector 邏輯留在檔案裡
//只會是死碼且容易誤導後續維護者。若需要參考當初的實作細節,見 git 歷史
// (移除前的最後一個 commit)。
//
// 功能介紹頁另外在 ProductPage.tsx("/product" 路由),不在這個元件的
// 範圍內。
export function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null)
  // theme:手動日夜間切換,寫進根元素的 data-theme 屬性——CSS 已支援
  // .kyoto-bloom[data-theme="dark"]/[data-theme="light"](見
  // HomePage.css),沒有 data-theme 時預設跟隨系統的
  // prefers-color-scheme。初始值給 null
  // (跟隨系統),使用者按下切換鈕後才會有明確值,且只在按下當下才決定
  // 「跟現在系統顯示的相反」,不用一開始就去讀 matchMedia。
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null)
  // systemPrefersDark:theme 為 null(使用者還沒手動切換過)時,切換鈕的
  // 圖示/文字要知道系統目前實際顯示的是深色還是淺色,才能正確提示「按下
  // 去會變成怎樣」——用獨立的 useEffect 監聽 matchMedia 變化(使用者可能
  // 在頁面開著的當下切換系統設定),不是只在掛載時讀一次。
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const isCurrentlyDark = (t: 'dark' | 'light' | null) => (t === null ? systemPrefersDark : t === 'dark')

  return (
    <div className="kyoto-bloom" ref={rootRef} data-theme={theme ?? undefined}>
      {/* 品牌標記——固定在左上角,不隨頁面捲動,跟日夜間切換鈕對稱(見下方
          .theme-toggle)。用純文字「Tripace」而非圖示,對齊全站既有慣例
          (ProductPage.tsx/LegalPage.tsx/NotFoundPage.tsx 的品牌標記都是
          純文字標記,不是 favicon.svg 那個圖示)——這個元件是獨立 scope
          的 .kyoto-bloom,不共用 landing.css,故在 HomePage.css 裡另外
          定義一份視覺上一致的樣式。這個元件本身就是首頁("/"),連結指向
          "/" 是回到最上方而非離開頁面。 */}
      <a className="brand-mark" href="/">Tripace</a>
      {/* 日夜間切換——固定在右上角,不隨頁面捲動。theme 為 null(預設)時
          跟隨系統的 prefers-color-scheme,按下後切成明確的 dark/light,
          之後每次按下在兩者之間互切(不會回到「跟隨系統」,同大多數網站
          手動切換慣例一致)。圖示依「按下後會變成的樣子」顯示(currently
          light 時顯示月亮,代表按下去會變暗;反之顯示太陽),是動作提示
          而非目前狀態指示。 */}
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setTheme((t) => (isCurrentlyDark(t) ? 'light' : 'dark'))}
        title={isCurrentlyDark(theme) ? '切換成日間模式' : '切換成夜間模式'}
        aria-label={isCurrentlyDark(theme) ? '切換成日間模式' : '切換成夜間模式'}
      >
        {isCurrentlyDark(theme) ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
      {/* 右上角直接進入 App 的捷徑——跟 .theme-toggle 同一組固定右上角,
          排在它左邊(theme-toggle 本身 right: 16px,這裡再往左讓開它的
          寬度+間距)。不用等使用者捲到結尾 CTA 或頁尾連結才找得到入口。 */}
      <a className="app-cta" href="/app">登入</a>
      {/* 功能介紹——原本只在 footer 網站地圖裡才找得到(該 sitemap 區塊
          後來已從首頁 footer 移除,見下方 <footer> 的簡化版結構),使用者
          要求提升能見度、搬到右上角常駐功能列。跟 .app-cta 用同一個
          class(.app-cta,而非另建一個 class)——兩者視覺上就是同一種
          樣式的按鈕(透明底+細框線),沒有需要另外命名的差異,只是連結
          目標跟文字不同;再往左讓開一顆 .app-cta 的寬度+間距(46px,見
          HomePage.css .app-cta-feature 的計算說明)。 */}
      <a
        className="app-cta app-cta-feature"
        href="/product"
        onClick={() => trackEvent('landing_feature_intro_click')}
      >
        功能介紹
      </a>
      <section className="hero">
        <svg className="hero-ridge" viewBox="0 0 1200 300" preserveAspectRatio="none">
          <path
            d="M0,300 L0,220 Q120,140 260,190 T520,150 Q620,110 720,170 T980,140 Q1080,120 1200,180 L1200,300 Z"
            fill="none" stroke="currentColor" strokeWidth="1" opacity="0.18" style={{ color: 'var(--moss)' }}
          />
          <path
            d="M0,300 L0,250 Q160,190 320,230 T620,200 Q740,170 860,220 T1200,210 L1200,300 Z"
            fill="currentColor" opacity="0.06" style={{ color: 'var(--ink)' }}
          />
        </svg>

        <div className="hero-eyebrow">Travel Planning</div>
        <h1 className="hero-title">走進一個地方<br /><em>而不只是到過</em></h1>
        <p className="hero-sub">從地景、歷史、人文到日常生活，探索城市與自然之間那些容易錯過的風景。</p>
        <div className="hero-actions">
          {/* startBtn:原本 scrollIntoView 到下方捲動敘事區塊(#explore)
              的入口,該區塊已隨本次移除一併刪除。曾一度改成直接連到京都
              的獨立頁面 /kyoto-kiyomizu,但按鈕上的 ↓ 向下箭頭視覺上暗示
              「往下捲」,點下去卻直接跳頁,跟下方 .destinations 區塊自己
              的標題「選一個地方,開始探索」語意打架(兩個「開始探索」
              指向不同結果)。改回錨點捲動到 #destinations(見下方
              .destinations 的 id),↓ 箭頭的視覺暗示與實際行為重新一致
              ——hero 現在的角色是「帶你去選目的地」,不是替使用者預先
              選定京都。 */}
          <a className="hero-cta" href="#destinations">
            開始探索
            <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v9M4.5 9L8 12.5 11.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </a>
        </div>
      </section>

      {/* destinations:目的地清單——每個城市的介紹頁面(見 App.tsx 對應
          路由)集中列在這裡,取代舊版首頁「捲動看完一個城市的完整敘事」
          的單一路徑,改成「先看有哪些目的地,自己選一個點進去」。簡約
          文字列表樣式(不放縮圖),對齊使用者明確選擇的方向——之後新增
          城市頁面,只需要在 DESTINATIONS 陣列多加一筆。
          landing_destination_click:每個項目的點擊事件(見 src/analytics.ts
          trackEvent 的萬用機制,GTM 後台已有比對所有事件名稱的通用
          trigger,不需要額外設定),destination 帶城市名稱——用來看首頁
          目的地清單裡哪個城市的點擊率較高,GTM 未設定分析追蹤時(本機
          開發)trackEvent 直接 no-op,不影響正常導覽。 */}
      <section className="destinations" id="destinations">
        <div className="destinations-inner">
          <div className="explore-eyebrow">目的地</div>
          <h2 className="explore-title">選一個地方，開始探索</h2>
          <div className="destination-list">
            <a
              className="destination-item"
              href="/kyoto-kiyomizu"
              onClick={() => trackEvent('landing_destination_click', { destination: '京都' })}
            >
              <span className="destination-row">
                <span className="destination-name">日本 · 京都</span>
                <svg className="destination-arrow" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="destination-desc">清水寺、産寧坂、祇園——地形、信仰與人文交織的東山散策路線</span>
            </a>
            <a
              className="destination-item"
              href="/jiufen"
              onClick={() => trackEvent('landing_destination_click', { destination: '九份' })}
            >
              <span className="destination-row">
                <span className="destination-name">台灣 · 九份</span>
                <svg className="destination-arrow" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="destination-desc">礦業興衰與人文重生的山城故事，老街、茶樓與海景交錯的散策路線</span>
            </a>
            <a
              className="destination-item"
              href="/tainan-anping"
              onClick={() => trackEvent('landing_destination_click', { destination: '台南安平' })}
            >
              <span className="destination-row">
                <span className="destination-name">台灣 · 台南安平</span>
                <svg className="destination-arrow" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="destination-desc">港口地形、貿易與淤積轉型的故事，古堡、老街與老屋活化交織的散策路線</span>
            </a>
          </div>
        </div>
      </section>

      {/* footer——結構對齊全站既有的頁尾慣例(品牌名、法律資訊列、信用
          背書連結,見 ProductPage.tsx/LegalPage.tsx 各自的 footer)。這個
          元件是獨立 scope 的 .kyoto-bloom,不共用 landing.css,故在
          HomePage.css 裡另外定義一份視覺上一致的樣式(kyoto-footer 開頭
          的 class 前綴,避免跟既有的 explore、stop 開頭的 class 撞名)。
          隱私權政策/服務條款連結沿用同一組既有頁面(/privacy、/terms),
          「聯絡我們」跟其他頁面一樣先用佔位連結。 */}
      <footer className="kyoto-footer">
        <span className="kyoto-footer-brand">Tripace · 旅程規劃</span>
        <div className="kyoto-footer-bar">
          <span className="kyoto-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="kyoto-footer-links">
            <a href="/privacy">隱私權政策</a>
            <a href="/terms">服務條款</a>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="kyoto-footer-poweredby"
          href="https://onagent.shuttle.tools"
          target="_blank"
          rel="noreferrer"
        >
          Powered by onagent
        </a>
      </footer>
    </div>
  )
}
