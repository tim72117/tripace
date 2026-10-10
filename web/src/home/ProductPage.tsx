import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  CalendarClock,
  Layers,
  Wand2,
} from 'lucide-react';
import { ThemePointDemo } from './ThemePointDemo';
import { TimelineDemo } from './TimelineDemo';
import { AiPlanPhoneDemo } from './AiPlanPhoneDemo';
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons';
import { ExploreOtherCities } from './ExploreOtherCities';
import { trackEvent } from '../analytics';
import './ProductPage.css';

// SEO_TITLE:2026-10 這個頁面補上專屬 SEO meta 之前,canonical 一直沿用
// index.html 首頁的預設值,等同告訴 Google「這頁是首頁的重複內容」,
// 導致 /product 無法被獨立索引(跟九份/京都/台南那四頁同一類根因問題,
// 見 server/cmd/server/seo_meta.go 檔頭的完整說明)。description/
// canonical/og:*/twitter:* 已改由該檔案的 seoMetaByPath["/product"]
// 統一輸出;這裡只保留 <title>——react-helmet-async 對 title 是直接
// 覆寫 document.title,不會重複/衝突,SPA 內部換頁時仍需要它才能正確
// 更新分頁標題。內容必須跟 seoMetaByPath["/product"].title 保持一致,
// 修改其中一邊記得同步另一邊。
const SEO_TITLE = '功能介紹——AI編排行程、主題景點、時間軸排程 | Tripace'

const FEATURES = [
  {
    // 2026-09:「自動編排行程」改名為「AI編排行程」並移到第一個位置
    // （使用者明確要求），同時拿掉原本的「即將推出」徽章——不再是未上線
    // 的試做功能，比照另外兩張卡片的正式項目對待。icon 維持 Wand2
    // (魔杖,「自動生成/一鍵搞定」語意),避免跟「時間軸排程」的
    // CalendarClock(時鐘,強調時間刻度本身)、「主題景點」的 Layers
    // (圖層堆疊,強調空間分層)撞語意。
    icon: Wand2,
    title: 'AI編排行程',
    description: '描述你的旅行需求，AI 自動把景點排成一份完整的每日時間軸行程。',
  },
  {
    icon: Layers,
    title: '主題景點',
    description: '找景點沒有方向？點開主題點，就能看到周邊精心挑選的店家與景點。',
  },
  {
    icon: CalendarClock,
    title: '時間軸排程',
    description: '把景點排入每天的時間軸，安排順序，一眼掌握整趟旅程的節奏。',
  },
] as const;

function isCurrentlyDark(t: 'dark' | 'light' | null, systemPrefersDark: boolean) {
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return systemPrefersDark;
}

export function ProductPage() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);
    const handleChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  const dark = isCurrentlyDark(theme, systemPrefersDark);

  const toggleTheme = () => {
    setTheme(dark ? 'light' : 'dark');
  };

  return (
    <div className="product-page" data-theme={theme ?? undefined}>
      <Helmet>
        <title>{SEO_TITLE}</title>
      </Helmet>
      {/* 2026-09:使用者要求「主題介紹頁的按鈕也對齊(首頁)」,幾輪來回
          手動對齊數值後,使用者明確要求「都共用元件」「連定位一起改成
          同一套邏輯」——原本這裡是 <nav className="product-nav"> 的
          sticky nav bar,內用 flex 排列「立即開始」/日夜切換兩顆按鈕,
          跟 HomePage.tsx 的 fixed 浮動疊層是兩種不同的版面結構。現在
          整個拿掉 sticky nav bar,改用跟 HomePage.tsx 完全一致的固定
          左上/右上角疊層(SiteNavBrand/SiteNavThemeToggle/SiteNavCta,
          見 SiteNavButtons.tsx 的完整說明),兩個頁面的按鈕不只樣式
          共用同一份 CSS,連版面結構本身都統一,不再需要為了對齊尺寸/
          位置手動同步兩邊的規則。 */}
      <SiteNavBrand />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      {/* /app 內建登入/註冊表單(未登入時顯示,見 PhoneContent.tsx 的
          LoginCard/LoginForm),專案沒有獨立的 /login、/register 頁面,
          故單一 CTA 直接指向 /app,不分登入/註冊兩種連結。這裡只有一顆
          固定 CTA,不需要指定 slot(見 SiteNavCta 的 slot prop 說明,
          省略時走預設 right,對齊 HomePage「登入」那顆的位置)。 */}
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'product', position: 'nav' })}>立即開始</SiteNavCta>

      <header className="product-hero">
        <h1>把想去的地方，變成一份順暢的旅程</h1>
        <p>
          Tripace 讓你在地圖上探索景點、拖曳排入日程，並自動畫出每天的路徑，
          與旅伴協作、分享，輕鬆完成一趟旅行的規劃。
        </p>
        <div className="product-hero-actions">
          <Link
            to="/app"
            className="product-btn-primary"
            onClick={() => trackEvent('landing_cta_click', { page: 'product', position: 'hero' })}
          >
            開始使用
          </Link>
        </div>
      </header>

      <section className="product-features">
        <h2 className="product-section-title">核心功能</h2>
        <div className="product-features-grid">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div className="product-feature-card" key={title}>
              <div className="product-feature-icon">
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
              {/* ThemePointDemo:只在「主題景點」這張卡片內渲染(見上方
                  FEATURES 陣列的 Layers icon 那筆)——文字說明「點開
                  主題點,就能看到周邊精選店家」這句話本身仍是抽象敘述,
                  這裡用一個假地圖示意圖具體演示:中央大圓圈是主題點,
                  周圍散布的小點是精選點,純靜態展示(不含任何按鈕/
                  互動)——不是接真實 Google Maps(不需要,這裡純粹示範
                  「主題點揭露精選點」這個產品概念本身,跟任何真實城市/
                  資料庫內容無關),見 ThemePointDemo.tsx 的完整說明。
                  用 title 字串比對挑出這一張卡片,而非把 FEATURES 拆成
                  「主題景點」與「其餘」兩份陣列分開處理——FEATURES 的
                  渲染順序、其餘三張卡片的結構完全不受影響,只有這一張
                  卡片額外多渲染一段內容,改動範圍最小。
                  TimelineDemo:同樣邏輯,只在「時間軸排程」卡片內渲染
                  ——地圖上依序點選候選景點、依序飛入右側時間軸時段格
                  的假動畫,見 TimelineDemo.tsx 的完整說明。
                  AiPlanPhoneDemo:同樣邏輯,只在「AI編排行程」卡片內渲染
                  ——模擬手機外框內顯示固定手機版面的展示畫面
                  (AiPlanPhoneDemoScreen,不用 iframe),見 AiPlanPhoneDemo.tsx
                  的完整說明。 */}
              {title === '主題景點' && <ThemePointDemo dark={dark} />}
              {title === '時間軸排程' && <TimelineDemo dark={dark} />}
              {/* 點整支手機連到 /ai-plan 完整展示(站內路由,故用 <Link>,見
                  AiPlanPhoneDemo.tsx)。取代原本的「觀看展示」按鈕。 */}
              {title === 'AI編排行程' && (
                <AiPlanPhoneDemo
                  onClick={() => trackEvent('landing_cta_click', { page: 'product', position: 'feature-ai-plan' })}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="product-final-cta">
        <h2>準備好規劃下一趟旅程了嗎？</h2>
        <p>立即建立你的第一份旅程，體驗地圖探索與拖曳排程的便利。</p>
        <Link
          to="/app"
          className="product-btn-primary"
          onClick={() => trackEvent('landing_cta_click', { page: 'product', position: 'final' })}
        >
          開始使用
        </Link>
      </section>

      {/* 2026-10 使用者要求在功能介紹頁最下面(結尾 CTA 之後、頁尾之前,
          位置對齊九份/京都/台南/赤崁四個城市頁的既有慣例)加入「更多
          目的地」卡片區塊,讓看完功能介紹的使用者能順勢點進城市介紹頁。
          currentSlug 傳一個不在 ExploreOtherCities 內部 CITIES 清單裡
          的值("product")——這個頁面本身不是城市頁,不需要排除任何一張
          卡片,四個城市頁的卡片會全部顯示。eyebrow="精選景點":使用者
          明確要求這裡的小標文字跟其餘四頁預設的「更多目的地」不同,
          更貼合「從功能介紹頁推薦去哪裡玩」的情境(見 ExploreOtherCities.tsx
          該 prop 的完整說明)。 */}
      <ExploreOtherCities currentSlug="product" eyebrow="精選景點" accentColor="var(--vermilion)" />

      {/* footer——結構、文案對齊 HomePage.tsx 的 .kyoto-footer(品牌名、
          Copyright 列、法律/導覽連結、onagent 背書連結),只是 class 前綴
          換成 product-footer-*。 */}
      <footer className="product-footer">
        <span className="product-footer-brand">Tripace · 旅程規劃</span>
        <div className="product-footer-bar">
          <span className="product-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="product-footer-links">
            <Link to="/">回首頁</Link>
            <Link to="/privacy">隱私權政策</Link>
            <Link to="/terms">服務條款</Link>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="product-footer-onagent"
          href="https://onagent.shuttle.tools"
          target="_blank"
          rel="noreferrer"
        >
          Powered by onagent
        </a>
      </footer>
    </div>
  );
}
