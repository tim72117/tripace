import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Moon, Sun } from 'lucide-react';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import { MobileMapReveal } from './MobileMapReveal';
import './TainanPage.css';

// ANPING_FORT_PHOTO_URL:手機版地圖縮圖(見下方 MobileMapReveal)用的
// 安平古堡照片——比照 JiufenPage.tsx/KyotoPage.tsx 用各自 hero 首圖當
// 縮圖的慣例,但這兩者用的是 LANDING_ASSETS_BASE(shuttle-tripace-web-
// assets,landing page 專用素材 bucket,見該常數完整說明),台南目前
// 沒有對應素材。這裡直接借用資料庫裡安平古堡這筆 attraction 已有的
// GCS 照片(shuttle-tripace-photos bucket,後端漸進補圖機制落地的
// 實景照,見 server/internal/store/attractions.go UpdateAttractionPhoto
// 的說明),同樣是公開可讀取的 GCS 物件——好過憑空引用一個不存在的
// landing/tainan/n{N}.jpg 網址造成縮圖破圖。之後若比照九份/京都補上
// 專屬的 landing 素材,再換成同一套慣例。
const ANPING_FORT_PHOTO_URL = 'https://storage.googleapis.com/shuttle-tripace-photos/attractions/lmk_f6269a0e607d.jpeg'

// SEO_TITLE/SEO_DESCRIPTION — 見 JiufenPage.tsx 對應常數的完整說明,同一套
// <Helmet> 動態 meta 機制。
const SEO_TITLE = '台南・安平——荷蘭城堡與老街風土交織的港町故事 | Tripace'
const SEO_DESCRIPTION = '從熱蘭遮城的築城選址，到運河淤積後老街的重生，再到蜜餞、豆花、冬瓜茶交織的巷弄風土——跟著 Tripace 走一趟台南安平的散策路線，讀懂這座港町為何長成現在的樣子。'
const SEO_URL = 'https://tripace.shuttle.tools/tainan-anping'

// STOPS — 目前 7 筆全數取自資料庫已建檔的 attraction 資料(見
// server/internal/api/geo_outline.go publicPlaceDetailsAllowlist 新增的
// 台南段落,placeId 逐一對應),不是這裡另外編造的新地點。desc 文案是
// 仿照 JiufenPage.tsx/KyotoPage.tsx「地形/產業限制 → 路徑 → 人文」的因果鏈
// 敘事風格新寫的簡短版本(資料庫裡的 summary 欄位是給地圖資訊卡用的
// 一句話簡介,不足以撐起整頁的敘事段落,故這裡另外擴寫,核心史實
// 仍對齊資料庫 summary)。
//
// photo/credit 欄位目前沒有實際照片(見 TainanPage.css .tainan-stop-photo
// 的完整說明,改用純 CSS 漸層色塊佔位)——之後補上真實照片時,比照
// JiufenPage.tsx 的做法:把 photo 換成
// `${LANDING_ASSETS_BASE}/tainan/n{N}.jpg`、credit 填上攝影師/來源署名,
// 並把下方 JSX 的 .tainan-stop-photo 內容從純色塊換回
// <img src={stop.photo} alt={stop.name} loading="lazy" />
// + <span className="tainan-stop-credit">。
const STOPS = [
  {
    index: '壱',
    kind: '地理',
    name: '安平古堡（熱蘭遮城）',
    desc: '1624年荷蘭東印度公司選址於此構築熱蘭遮城——台江內海的潟湖地形提供了天然良港，讓這裡成為全台最早的對外貿易據點。城堡本身是整條敘事的起點：先有港口，才有之後所有的聚落與商業發展。',
    layout: 'stacked',
  },
  {
    index: '弐',
    kind: '轉折',
    name: '運河淤積與港口機能轉移',
    desc: '19世紀末台江內海逐漸淤積成陸，安平失去了深水港的地位，商業重心轉往台南市區——地質變遷直接改寫了這座聚落的角色，從貿易門戶轉為以老街生活機能為主的地方。',
    layout: 'stacked',
  },
  {
    index: '参',
    kind: '人文',
    name: '安平樹屋',
    desc: '老榕樹盤根錯節包覆廢棄倉庫建築，是港口機能外移後閒置空間被自然重新接管的具體見證——樹根與磚牆纏繞的樣貌，成了安平歷史軸線上最直觀的時間痕跡。',
    layout: 'stacked',
  },
  {
    index: '四',
    kind: '產業',
    name: '延平街與老街商業群聚',
    desc: '港口貿易帶來的人潮與財富，在老街兩側沉澱成百年老店群聚——林永泰興蜜餞行、同記安平豆花、義豐冬瓜茶，各自傳承數代，是安平從貿易港口轉型為生活聚落後，商業活動留下的具體痕跡。',
    layout: 'stacked',
  },
  {
    index: '伍',
    kind: '轉型',
    name: 'Meller墨樂咖啡',
    desc: '老屋改建的復古咖啡店，結合乾燥花藝與手沖咖啡——老街近年的第二次轉型，從單純的傳統小吃聚落，逐漸長出適合久坐、慢步調的新型態空間。',
    layout: 'stacked',
  },
  {
    index: '陸',
    kind: '重生',
    name: '正興街與選物店',
    desc: '0343選物店所在的正興街，是老屋活化的另一個方向——保留原有街屋結構，注入盆器、植物、選物等新內容，跟安平運河淤積後「重新找到自己角色」的敘事一脈相承。',
    layout: 'stacked',
  },
] as const;

function isCurrentlyDark(t: 'dark' | 'light' | null, systemPrefersDark: boolean) {
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return systemPrefersDark;
}

// TainanPage — 比照 JiufenPage.tsx 的頁面外殼架構(品牌列/日夜切換/進度
// 導覽點/開頭互動地圖+捲動敘事區塊+結尾 CTA+頁尾),class 名稱前綴改
// jiufen- → tainan-。跟 JiufenPage.tsx 一樣只有單一主題點(安平古堡),
// 故沿用同一套 defaultOpenTheme/單站點 IntersectionObserver 邏輯,不像
// KyotoPage.tsx 需要處理兩個平等並存的主題點。
export function TainanPage() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const stopRefs = useRef<(HTMLElement | null)[]>([]);
  const mapIntroRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);
    const handleChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const els = stopRefs.current.filter((el): el is HTMLElement => el !== null);
    if (mapIntroRef.current) mapIntroRef.current.setAttribute('data-index', '-1');
    const allEls = mapIntroRef.current ? [mapIntroRef.current, ...els] : els;
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('is-active'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number(entry.target.getAttribute('data-index'));
          entry.target.classList.toggle('is-active', entry.isIntersecting);
          if (entry.isIntersecting) setActiveIndex(idx);
        });
      },
      { threshold: 0.5 },
    );
    allEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const dark = isCurrentlyDark(theme, systemPrefersDark);

  const toggleTheme = () => {
    setTheme(dark ? 'light' : 'dark');
  };

  return (
    <div className="tainan-page" data-theme={theme ?? undefined}>
      <Helmet>
        <title>{SEO_TITLE}</title>
        <meta name="description" content={SEO_DESCRIPTION} />
        <link rel="canonical" href={SEO_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={SEO_URL} />
        <meta property="og:title" content={SEO_TITLE} />
        <meta property="og:description" content={SEO_DESCRIPTION} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SEO_TITLE} />
        <meta name="twitter:description" content={SEO_DESCRIPTION} />
        {/* JSON-LD 結構化資料 — 見 JiufenPage.tsx 同一段落的完整說明,這裡是
            同一套機制的台南版本。 */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TouristDestination',
            name: '台南・安平',
            description: SEO_DESCRIPTION,
            url: SEO_URL,
            address: {
              '@type': 'PostalAddress',
              addressLocality: '安平區',
              addressRegion: '台南市',
              addressCountry: 'TW',
            },
            containsPlace: STOPS.map((s) => ({
              '@type': 'TouristAttraction',
              name: s.name,
              description: s.desc,
            })),
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: 'https://tripace.shuttle.tools/' },
              { '@type': 'ListItem', position: 2, name: '台南・安平', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      <div className="tainan-brand-row">
        <Link to="/" className="tainan-brand-mark">Tripace</Link>
        <span className="tainan-brand-page">台南・安平</span>
      </div>
      <button
        type="button"
        className="tainan-theme-toggle"
        onClick={toggleTheme}
        aria-label={dark ? '切換至淺色模式' : '切換至深色模式'}
      >
        {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
      <Link to="/app" className="tainan-app-cta">立即開始</Link>

      {/* 開頭互動地圖 — 同 JiufenPage.tsx 的說明,傳 city="台南"。
          defaultOpenTheme="安平古堡":這個頁面目前只有安平古堡一個主題點
          (isTheme: true,見剛查到的 attraction-list 結果),理由同
          JiufenPage.tsx 對這個 prop 的完整說明——單一主題點時直接開好
          給使用者看,不需要多一次點擊。
          initialZoom={17}/centerNorthOffsetKm={-0.1}:直接沿用
          JiufenPage.tsx 的校準值(見該檔案對應 prop 的完整說明)——安平
          古堡周邊 7 個景點分布範圍跟九份聚落相近(腹地小、景點密集),
          實測(見上方截圖驗證)套用元件預設值(INITIAL_ZOOM=15,對京都
          景點分布較開闊的情境校準)時景點分散在畫面各處、不夠聚焦,
          拉近到 17 讓一進頁面就能看清安平老街周邊的密集標記,不需要
          使用者自己手動放大。centerNorthOffsetKm 傳 -0.1 抵消元件預設
          的往北偏移(該偏移是針對京都兩個主題點的中點校準),這裡只有
          單一主題點(安平古堡),不需要「不偏袒任一邊」的置中考量,讓
          初始中心落回安平古堡本身,理由同 JiufenPage.tsx。 */}
      {/* MobileMapReveal:手機版先顯示安平古堡縮圖,點擊才真正掛載地圖
          ——比照 JiufenPage.tsx/KyotoPage.tsx 已套用的同一套機制(見
          MobileMapReveal.tsx 的完整說明),桌面版不受影響、直接渲染
          children。photoUrl 見上方 ANPING_FORT_PHOTO_URL 的說明。 */}
      <div className="tainan-map-intro" ref={mapIntroRef}>
        <MobileMapReveal photoUrl={ANPING_FORT_PHOTO_URL} photoAlt="安平古堡">
          <InteractiveExploreMap
            city="台南"
            showThemeToggle={false}
            externalTheme={theme}
            defaultOpenTheme="安平古堡"
            initialZoom={17}
            centerNorthOffsetKm={-0.1}
          />
        </MobileMapReveal>
      </div>

      <header className="tainan-hero">
        <span className="tainan-hero-eyebrow">港口決定了這一切</span>
        <h1>安平的港口地形，寫下了一段貿易與重生的故事</h1>
        <p>
          潟湖地形帶來了荷蘭人的城堡，運河淤積又讓貿易重心轉移，最終在老街巷弄裡
          長出蜜餞、豆花與選物店交織的生活風土——這是一條地理、貿易、產業、人文交織的因果鏈。
        </p>
      </header>

      <nav className="tainan-progress-rail" aria-label="站點進度">
        <button
          type="button"
          className={`tainan-progress-dot${activeIndex === -1 ? ' is-active' : ''}`}
          onClick={() => mapIntroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到互動地圖"
          title="回到互動地圖"
        />
        {STOPS.map((stop, i) => (
          <button
            type="button"
            key={stop.name}
            className={`tainan-progress-dot${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => stopRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`跳到「${stop.name}」`}
            title={stop.name}
          />
        ))}
      </nav>

      <section className="tainan-stops">
        {STOPS.map((stop, i) => (
          <article
            className="tainan-stop"
            key={stop.name}
            data-index={i}
            ref={(el) => { stopRefs.current[i] = el; }}
          >
            <div className={`tainan-stop-inner tainan-stop-inner--${stop.layout}`}>
              <div className="tainan-stop-photo">
                <span className="tainan-stop-photo-label">{stop.name}</span>
              </div>
              <div className="tainan-stop-text">
                <div className="tainan-stop-meta">
                  <span className="tainan-stop-index">{stop.index}</span>
                  <span className="tainan-stop-kind">{stop.kind}</span>
                </div>
                <h2>{stop.name}</h2>
                <p>{stop.desc}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="tainan-final-cta">
        <h2>把安平的故事，排進你的下一趟行程</h2>
        <p>在 Tripace 上探索景點、拖曳排入日程，規劃一趟屬於自己的台南港町之旅。</p>
        <Link to="/app" className="tainan-btn-primary">
          免費開始使用
        </Link>
      </section>

      <footer className="tainan-footer">
        <span className="tainan-footer-brand">Tripace · 行程規劃</span>
        <div className="tainan-footer-sitemap">
          <div className="tainan-footer-sitemap-col">
            <span className="tainan-footer-sitemap-title">產品功能</span>
            <Link to="/product">產品介紹</Link>
            <Link to="/app">開始使用</Link>
          </div>
          <div className="tainan-footer-sitemap-col">
            <span className="tainan-footer-sitemap-title">更多景點</span>
            <Link to="/jiufen">台灣・九份</Link>
            <Link to="/kyoto-kiyomizu">日本・京都</Link>
          </div>
        </div>
        <div className="tainan-footer-bar">
          <span className="tainan-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="tainan-footer-links">
            <Link to="/">回首頁</Link>
            <Link to="/privacy">隱私權政策</Link>
            <Link to="/terms">服務條款</Link>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="tainan-footer-onagent"
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
