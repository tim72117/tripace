import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin,
  MousePointerClick,
  Route,
  MessageSquareText,
  Users,
  Share2,
  Moon,
  Sun,
} from 'lucide-react';
import './ProductPage.css';

const FEATURES = [
  {
    icon: MapPin,
    title: '地圖探索候選籃',
    description: '在地圖上探索景點、餐廳、住宿，一鍵加入候選籃，整理你想去的地方。',
  },
  {
    icon: MousePointerClick,
    title: '拖曳排入日程',
    description: '把候選籃裡的項目拖曳到日程表，安排每天的順序與時間。',
  },
  {
    icon: Route,
    title: '路徑地圖',
    description: '自動在地圖上畫出當天行程的路徑，掌握每天的動線。',
  },
  {
    icon: MessageSquareText,
    title: '自然語言查詢',
    description: '用一般口語描述需求，快速找到符合條件的地點。',
  },
  {
    icon: Users,
    title: '協作與權限',
    description: '邀請旅伴共同編輯行程，依角色設定檢視或編輯權限。',
  },
  {
    icon: Share2,
    title: '公開分享連結',
    description: '產生公開連結，把完成的行程分享給親友，免登入也能檢視。',
  },
] as const;

const STEPS = [
  {
    title: '建立行程',
    description: '輸入目的地與日期，建立一份屬於你的行程。',
  },
  {
    title: '探索與收藏',
    description: '在地圖上探索景點，把喜歡的地方加入候選籃。',
  },
  {
    title: '排入日程並分享',
    description: '把候選項目拖曳排入每天的日程，完成後分享給旅伴。',
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
        <h1>把想去的地方，變成一份順暢的行程</h1>
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
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="product-steps">
        <div className="product-steps-inner">
          <h2 className="product-section-title">三步驟開始規劃</h2>
          <div className="product-steps-grid">
            {STEPS.map((step, index) => (
              <div className="product-step" key={step.title}>
                <div className="product-step-number">{index + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="product-final-cta">
        <h2>準備好規劃下一趟旅程了嗎？</h2>
        <p>立即建立你的第一份行程，體驗地圖探索與拖曳排程的便利。</p>
        <Link to="/app" className="product-btn-primary">
          免費開始使用
        </Link>
      </section>

      {/* footer——結構、文案對齊 HomePage.tsx 的 .kyoto-footer(品牌名、
          Copyright 列、法律/導覽連結、onagent 背書連結),只是 class 前綴
          換成 product-footer-*。 */}
      <footer className="product-footer">
        <span className="product-footer-brand">Tripace · 行程規劃</span>
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
