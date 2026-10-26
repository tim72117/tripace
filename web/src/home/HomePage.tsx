import { useEffect, useRef, useState } from 'react'
import { ScrollPlanDemo } from './ScrollPlanDemo'
import { trackEvent } from '../analytics'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons'
import { FORECAST_YEAR } from '../momiji-front/momijiForecast'
import { HeroIsland } from './heroIsland/HeroIsland'
import { FeaturedItineraries } from './FeaturedItineraries'
import { heroIslandAvailableAtStart } from './heroIsland/available'
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
  // islandOff——縮小版 3D 島不可用(省流量、沒有 WebGL、版位太小、建立失敗)時由 HeroIsland 通知,
  // 整個島收起、hero 文字組回到垂直置中的原樣(不留空白骨架),見 heroIsland/HeroIsland.tsx。
  // 初始值就同步判斷(省流量、沒有 WebGL),不等 load 之後——否則 hero 版面會在 1~3 秒後從靠上跳回置中(見 available.ts)。
  const [islandOff, setIslandOff] = useState(() => !heroIslandAvailableAtStart())

  return (
    <div className="kyoto-bloom" ref={rootRef} data-theme={theme ?? undefined}>
      {/* 2026-09:使用者要求「主題介紹頁的按鈕也對齊」→「都共用元件」
          ——原本這裡各自寫死 .brand-mark/.theme-toggle/.app-cta 三組
          按鈕標記,現在改用 SiteNavButtons.tsx 的共用元件(跟
          ProductPage.tsx 共用同一份樣式來源,見該檔案開頭的完整說明),
          避免兩個頁面的按鈕尺寸/樣式每次改動都要手動同步、卻仍然容易
          走鐘不一致的問題。
          品牌標記:純文字「Tripace」,連結指向 "/"(這個元件本身就是
          首頁,回到最上方而非離開頁面)。
          日夜間切換:theme 為 null(預設)時跟隨系統的
          prefers-color-scheme,按下後切成明確的 dark/light,之後每次
          按下在兩者之間互切(不會回到「跟隨系統」)。
          登入/功能介紹:登入 CTA 用預設樣式;功能介紹用
          variant="accent"(主色文字/邊框區隔,見 SiteNavButtons.css
          的 .site-nav-cta-accent 完整說明),往左讓開一顆登入按鈕的
          寬度+間距,見 HomePage.css 對應的 nth-of-type 選擇器說明。 */}
      <SiteNavBrand />
      <SiteNavThemeToggle
        dark={isCurrentlyDark(theme)}
        onToggle={() => setTheme((t) => (isCurrentlyDark(t) ? 'light' : 'dark'))}
      />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'home', position: 'nav' })}>登入</SiteNavCta>
      <SiteNavCta
        href="/product"
        variant="accent"
        slot={2}
        onClick={() => trackEvent('landing_feature_intro_click')}
      >
        功能介紹
      </SiteNavCta>
      <section className={`hero${islandOff ? ' is-island-off' : ''}`}>
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

        {/* hero-copy——2026-10 新增的包裝:把原本四個文字元素(順序不變)包成一組,
            讓桌機可以左右並排(文字在左、縮小版 3D 島在右)、窄螢幕上下疊(文字在上、島在下)。
            DOM 順序文字在前、島在後,所以閱讀與 Tab 順序都是「標題 → 開始探索 → 島」。 */}
        <div className="hero-copy">
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
        </div>
        {/* 縮小版 3D 島(設計與取捨見 docs/island/hero-integration-plan.md):
            載入在頁面 load 完成後的閒置時間,首屏不下載 three;不可用時 onUnavailable 收起整個島。
            整座島是連結,連到完整版的 /island 頁。 */}
        {!islandOff && <HeroIsland dark={isCurrentlyDark(theme)} onUnavailable={() => setIslandOff(true)} />}
      </section>

      {/* ScrollPlanDemo——捲動式 AI 規劃展示(雛形):使用者往下捲時,
          行程一站一站排出來。取代原本靜態的 AiPlanPhoneDemo 手機展示
          ——後者只是一張固定畫面,看不出「AI 正在排」這個過程本身,而
          那正是這個產品最值得展示的部分。
          跟 /ai-plan 共用同一份劇本與渲染元件,差別只在誰推進播放
          (那邊是計時器、這裡是捲動位置),見 planSimScrollSource.ts。 */}
      <ScrollPlanDemo />

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
            <a
              className="destination-item"
              href="/tainan-chikan"
              onClick={() => trackEvent('landing_destination_click', { destination: '赤崁・府城' })}
            >
              <span className="destination-row">
                <span className="destination-name">台灣 · 赤崁・府城</span>
                <svg className="destination-arrow" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="destination-desc">老地方的前世今生——歷史建築活化、住宿、景點與美食的兩日遊路線</span>
            </a>
            {/* 旅遊雜記(2026-10 新增)——跟上面四項不同:上面是城市
                介紹頁(InteractiveExploreMap 式的互動探索體驗),這項
                連到實際發生過的一趟遊記(BlogArticlePage.tsx,部落格
                文章正式路徑 /u/{handle}/{slug},見 App.tsx 對應路由的
                完整說明)。用 destination-tag 標出「旅遊雜記」分類,
                跟其餘純目的地項目視覺上區分,不是另開一個獨立清單
                ——目前只有這一篇已發布(night-jiufen),之後有更多篇才
                考慮要不要拆出獨立的文章列表區塊。 */}
            <a
              className="destination-item"
              href="/u/tim72117/night-jiufen"
              onClick={() => trackEvent('landing_destination_click', { destination: '九份夜遊記' })}
            >
              <span className="destination-row">
                <span className="destination-name">
                  台灣 · 九份夜遊記
                  <span className="destination-tag">旅遊雜記</span>
                </span>
                <svg className="destination-arrow" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="destination-desc">帶孩子的九份夜晚散步——基山街小吃、豎崎路燈籠石階、阿妹茶樓喝茶，一趟實際走過的夜遊紀錄</span>
            </a>
            {/* 紅葉前線(2026-10 新增)——獨立的互動展示頁(見 App.tsx
                /momiji-front 與 momiji-front/MomijiFrontPage.tsx):依日本氣象
                的紅葉預測日,看楓葉由北往南轉紅的動畫。清單項目用攻略式標題
                (使用者要求「類似 最全【2026日本紅葉】完整預測攻略!賞楓時間」
                的寫法),不加 destination-tag。 */}
            <a
              className="destination-item"
              href="/momiji-front"
              onClick={() => trackEvent('landing_destination_click', { destination: `${FORECAST_YEAR} 紅葉預測` })}
            >
              <span className="destination-row">
                <span className="destination-name">
                  日本 · {FORECAST_YEAR} 紅葉預測
                </span>
                <svg className="destination-arrow" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="destination-desc">【{FORECAST_YEAR}日本紅葉】賞楓時間預測攻略！北海道到九州各地見頃日一次看，附知名賞楓景點</span>
            </a>
          </div>
        </div>
      </section>

      {/* 精選行程:目的地清單下方,資料庫已發布的行程(最多 3 筆)加「看全部」連結,見 FeaturedItineraries.tsx。 */}
      <FeaturedItineraries />

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
          href="https://onagents.dev"
          target="_blank"
          rel="noreferrer"
        >
          Powered by onagent
        </a>
      </footer>
    </div>
  )
}
