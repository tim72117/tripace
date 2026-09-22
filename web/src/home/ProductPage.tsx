import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Layers,
  Moon,
  Sun,
  Wand2,
} from 'lucide-react';
import { ThemePointDemo } from './ThemePointDemo';
import { TimelineDemo } from './TimelineDemo';
import { AutoPlanDemo } from './AutoPlanDemo';
import './ProductPage.css';

const FEATURES = [
  {
    icon: Layers,
    title: '主題景點',
    description: '找景點沒有方向？點開主題點，就能看到周邊精心挑選的店家與景點。',
  },
  {
    icon: CalendarClock,
    title: '時間軸排程',
    description: '把候選景點排入每天的時間軸，安排順序，一眼掌握整趟旅程的節奏。',
  },
  {
    // 2026-09:「自然語言查詢」改主題為「自動編排行程」——icon 從
    // MessageSquareText 換成 Wand2(魔杖,「自動生成/一鍵搞定」語意),
    // 避免跟同一組卡片裡「時間軸排程」的 CalendarClock(時鐘,強調時間
    // 刻度本身)、「主題景點」的 Layers(圖層堆疊,強調空間分層)撞語意
    // ——這三個 icon 分別對應「自動生成」「時間排程」「空間分層」三種
    // 不同的視覺隱喻,不會讓人混淆這三張卡片在講同一件事。
    icon: Wand2,
    title: '自動編排行程',
    description: '描述你的旅行需求，系統自動把候選景點排成一份完整的每日時間軸行程。',
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
      <nav className="product-nav">
        <Link to="/" className="product-nav-brand">
          Tripace
        </Link>
        <div className="product-nav-actions">
          {/* /app 內建登入/註冊表單(未登入時顯示,見 PhoneContent.tsx 的
              LoginCard/LoginForm),專案沒有獨立的 /login、/register 頁面,
              故單一 CTA 直接指向 /app,不分登入/註冊兩種連結。 */}
          <Link to="/app" className="product-nav-cta">
            立即開始
          </Link>
          <button
            type="button"
            className="product-theme-toggle"
            onClick={toggleTheme}
            aria-label={dark ? '切換至淺色模式' : '切換至深色模式'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </nav>

      <header className="product-hero">
        <h1>把想去的地方，變成一份順暢的旅程</h1>
        <p>
          Tripace 讓你在地圖上探索景點、拖曳排入日程，並自動畫出每天的路徑，
          與旅伴協作、分享，輕鬆完成一趟旅行的規劃。
        </p>
        <div className="product-hero-actions">
          <Link to="/app" className="product-btn-primary">
            免費開始使用
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
              <h3>
                {title}
                {/* product-feature-badge:「即將推出」提示——2026-09
                    使用者要求只在「自動編排行程」卡片標題旁加這個小
                    膠囊(這個功能還沒實際上線,跟另外兩張已上線的卡片
                    區隔開),用 title 字串比對挑出這一張卡片,寫法同
                    下方 ThemePointDemo/TimelineDemo/AutoPlanDemo 依
                    title 決定要不要多渲染內容的既有慣例。樣式見
                    ProductPage.css 的 .product-feature-badge。 */}
                {title === '自動編排行程' && (
                  <span className="product-feature-badge">即將推出</span>
                )}
              </h3>
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
                  AutoPlanDemo:同樣邏輯,只在「自動編排行程」卡片內
                  渲染(2026-09 由「自然語言查詢」改主題,見 FEATURES
                  陣列該筆資料的完整說明)——模擬打出一句旅行需求文字、
                  送出後系統自動把候選景點依序排成一份時間軸行程的假
                  動畫,聊天輸入框視覺沿用 planning-demo/
                  AIPlanTimelinePage.tsx 的樣式,時間軸呈現方式則另外
                  簡化設計,見 AutoPlanDemo.tsx 的完整說明。 */}
              {title === '主題景點' && <ThemePointDemo dark={dark} />}
              {title === '時間軸排程' && <TimelineDemo dark={dark} />}
              {title === '自動編排行程' && <AutoPlanDemo dark={dark} />}
            </div>
          ))}
        </div>
      </section>

      <section className="product-final-cta">
        <h2>準備好規劃下一趟旅程了嗎？</h2>
        <p>立即建立你的第一份旅程，體驗地圖探索與拖曳排程的便利。</p>
        <Link to="/app" className="product-btn-primary">
          免費開始使用
        </Link>
      </section>

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
