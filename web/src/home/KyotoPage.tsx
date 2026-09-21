import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Moon, Sun } from 'lucide-react';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import { MobileMapReveal } from './MobileMapReveal';
import './KyotoPage.css';

// LANDING_ASSETS_BASE — 同 JiufenPage.tsx 的說明,同一個公開可讀 GCS
// bucket(shuttle-tripace-web-assets),landing/{城市 slug}/n{編號}.jpg 目錄
// 慣例延續使用,這裡的 slug 是 kyoto。原本這幾張照片(含 full/thumb 兩種
// 尺寸)在 web/public/kyoto-demo/ 底下,是 HomePage.tsx 舊版滾動視差敘事
// 在用的——該敘事與互動地圖已從首頁整個移除(見 HomePage.tsx 開頭說明),
// 本機那份圖片目錄也已一併刪除,現在只有這裡在用,已用 gsutil 上傳到
// GCS 這個路徑(僅搬遷 full 尺寸,thumb 版本沒有對應用途,未搬遷)。
const LANDING_ASSETS_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing'

// SEO_TITLE/SEO_DESCRIPTION——見 JiufenPage.tsx 對應常數的完整說明,同一
// 套 <Helmet> 動態 meta 機制,文案對齊首頁「目的地」列表區塊的簡介。
const SEO_TITLE = '京都・清水寺——地形、信仰與人文交織的東山散策 | Tripace'
const SEO_DESCRIPTION = '從清水寺的懸崖地形，到八坂神社的參拜人潮，再到祇園花見小路的茶屋文化——跟著 Tripace 走一趟京都東山的散策路線，讀懂地質、信仰、商業與人文如何層層疊加成這座古都。'
const SEO_URL = 'https://tripace.shuttle.tools/kyoto-kiyomizu'

// STOPS — 文案逐字照搬 HomePage.tsx 的 STOPS 陣列(京都東山探索路線的
// 8 個停靠點介紹文字),不重寫/不改編任何一句話,理由見本檔案的任務
// 說明:這個頁面要讓使用者「一眼就覺得跟首頁看到的一樣」。HomePage.tsx
// 的第一個停靠點(索引 0,「起點」東山山麓)沒有對應照片(id: null,見
// 該檔案 PHOTO_DATA 的完整說明,只有其餘 7 個站點各自對應一張
// lmk_xxx → n{1..7}.jpg 的照片),故這裡跳過它作為獨立站點,直接放進
// hero 區塊的介紹文字(對齊 JiufenPage.tsx hero 段落「先給一段濃縮的
// 因果鏈總覽,再逐站細看」的既有結構),其餘 7 站(清水寺→祇園・花見
// 小路)各自對應 GCS 上的 n1.jpg~n7.jpg(見上方 LANDING_ASSETS_BASE 的
// 說明,已用 gsutil 從 web/public/kyoto-demo/ 搬遷過去)。
// layout 固定 'stacked'——HomePage.tsx 原始照片都是橫式(505×900/
// 600×900 等,實測皆為直式其實,但這裡沿用 JiufenPage.tsx 的版面判斷
// 慣例:8 張照片來源、尺寸不一,不特別為每張各自標註 side/stacked,一律
// 用 stacked(圖上文下)這個能撐住任何長寬比的通用版面,避免額外引入
// HomePage.tsx 原本沒有的版面判斷邏輯。
const STOPS = [
  {
    index: '壱',
    kind: '地理',
    name: '清水寺',
    desc: '778年僧延鎮於音羽山中腹結庵祀觀音，798年坂上田村麻呂建佛殿成為敕願寺。山中湧泉音羽の滝自創建以來持續湧流——陡峭的懸崖地形，逼出了「舞台造」這種懸空木構工法，讓正殿得以立於山腹而不需削平地形。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n1.jpg`,
    layout: 'stacked',
  },
  {
    index: '弐',
    kind: '路徑',
    name: '產寧坂・二年坂',
    desc: '清水寺參拜者必經的山麓坡道——地形限制下唯一可行的參道，因而自然發展成帶狀商店街，1976年指定為重要傳統的建造物群保存地區。人潮沿著地形走出的這條路，成了整條路線的空間骨架。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n2.jpg`,
    layout: 'stacked',
  },
  {
    index: '参',
    kind: '地標',
    name: '八坂の塔（法観寺）',
    desc: '由出土瓦當樣式推斷創建可溯及7世紀。塔身立於山麓緩坡，在周邊低矮町家群中格外醒目，成為東山天際線的視覺地標——也是產寧坂北端通往祇園途中，一個明確的方向指標。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n3.jpg`,
    layout: 'stacked',
  },
  {
    index: '四',
    kind: '寺院',
    name: '高台寺',
    desc: '1606年豐臣秀吉正室北政所（寧寧）為弔念秀吉建立，德川家康因政治考量提供鉅額資助。與清水寺、八坂の塔同屬沿東山山麓分布的寺院系列——地形宜建寺的邏輯，在這裡延續。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n4.jpg`,
    layout: 'stacked',
  },
  {
    index: '伍',
    kind: '轉型',
    name: '圓山公園',
    desc: '1871年明治神佛分離政策下，原屬八坂神社、雙林寺等的境內地被收公；1886年開設為京都第一座近代公園。這片土地從寺院境內轉為公共空間，正是承接了前面幾座寺院所留下的空間脈絡。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n5.jpg`,
    layout: 'stacked',
  },
  {
    index: '陸',
    kind: '信仰',
    name: '八坂神社',
    desc: '社傳天神降臨於東山山麓的祇園林，選址與山麓森林直接相關。祇園祭起源可溯及869年的疫病祈禳，970年左右成為固定年度祭典——香火鼎盛的參拜人潮，即將沿著神社正門向外匯聚。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n6.jpg`,
    layout: 'stacked',
  },
  {
    index: '柒',
    kind: '人文',
    name: '祇園・花見小路',
    desc: '江戶初期作為八坂神社參拜與賞花客的休憩茶屋聚落發展，水茶屋逐漸轉為夜間營業的お茶屋，藝妓文化由此形成。地形決定了寺院的位置，信仰帶來了人潮，人潮聚集出了茶屋——最終，長成了獨特的人文藝能。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n7.jpg`,
    layout: 'stacked',
  },
] as const;

function isCurrentlyDark(t: 'dark' | 'light' | null, systemPrefersDark: boolean) {
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return systemPrefersDark;
}

// KyotoPage — 比照 JiufenPage.tsx 的頁面外殼架構(品牌列/日夜切換/進度
// 導覽點/開頭互動地圖+捲動敘事區塊+結尾 CTA+頁尾),class 名稱前綴改
// jiufen- → kyoto-。跟 JiufenPage.tsx 唯一的結構性差異:少了「起點」
// 這個獨立站點(併入 hero 文字,見上方 STOPS 說明的理由),故 STOPS 只有
// 7 筆而非 8 筆,其餘 IntersectionObserver/進度點/data-index="-1" 地圖
// 哨兵索引邏輯完全比照 JiufenPage.tsx,不需要為了少一筆而調整機制本身。
export function KyotoPage() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  // activeIndex — 同 JiufenPage.tsx 的說明:-1 是開頭互動地圖區塊的專屬
  // 哨兵值,0 以上對應 STOPS 陣列索引,初始值 -1 是因為頁面一載入使用者
  // 就正在看地圖區塊。
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
    <div className="kyoto-page" data-theme={theme ?? undefined}>
      <Helmet>
        <title>{SEO_TITLE}</title>
        <meta name="description" content={SEO_DESCRIPTION} />
        <link rel="canonical" href={SEO_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={SEO_URL} />
        <meta property="og:title" content={SEO_TITLE} />
        <meta property="og:description" content={SEO_DESCRIPTION} />
        <meta property="og:image" content={`${LANDING_ASSETS_BASE}/kyoto/n1.jpg`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SEO_TITLE} />
        <meta name="twitter:description" content={SEO_DESCRIPTION} />
        <meta name="twitter:image" content={`${LANDING_ASSETS_BASE}/kyoto/n1.jpg`} />
        {/* JSON-LD 結構化資料——見 JiufenPage.tsx 同一段落的完整說明,
            這裡是同一套機制的京都版本,containsPlace 用 STOPS 陣列動態
            產生清水寺/八坂神社/祇園・花見小路等具名地標。 */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TouristDestination',
            name: '京都・東山',
            description: SEO_DESCRIPTION,
            url: SEO_URL,
            image: `${LANDING_ASSETS_BASE}/kyoto/n1.jpg`,
            address: {
              '@type': 'PostalAddress',
              addressLocality: '東山区',
              addressRegion: '京都府',
              addressCountry: 'JP',
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
              { '@type': 'ListItem', position: 2, name: '京都・清水寺', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      {/* 品牌列——結構/理由同 JiufenPage.tsx 對應區塊的完整說明,「・京都」
          純文字標示目前頁面,不做成連結。 */}
      <div className="kyoto-brand-row">
        <Link to="/" className="kyoto-brand-mark">Tripace</Link>
        <span className="kyoto-brand-page">京都 · 清水寺</span>
      </div>
      <button
        type="button"
        className="kyoto-theme-toggle"
        onClick={toggleTheme}
        aria-label={dark ? '切換至淺色模式' : '切換至深色模式'}
      >
        {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
      <Link to="/app" className="kyoto-app-cta">立即開始</Link>

      {/* 開頭互動地圖——同 JiufenPage.tsx 的說明,傳 city="京都"。
          defaultOpenTheme 刻意不傳(維持 undefined):京都目前有清水寺、
          八坂神社兩個平等並存的主題點(見 InteractiveExploreMap.tsx
          defaultOpenTheme 該 prop 的完整說明與 HomePage.tsx 的既有理由)
          ——這個頁面雖然不是首頁,但同樣是「兩個主題點並存、沒有明確
          誰更優先」的情境(不像九份只有單一主題點),預先選定其中一個
          仍然會暗示優先順序,故沿用首頁的既有判斷,不預設打開任何一個,
          讓使用者自己點地圖決定先看哪一個。這是本次任務裡需要人工判斷
          的模糊地帶之一,見最終報告的說明,使用者可事後調整。 */}
      <div className="kyoto-map-intro" ref={mapIntroRef}>
        <MobileMapReveal photoUrl={`${LANDING_ASSETS_BASE}/kyoto/n1.jpg`} photoAlt="清水寺">
          <InteractiveExploreMap city="京都" showThemeToggle={false} externalTheme={theme} />
        </MobileMapReveal>
      </div>

      <header className="kyoto-hero">
        <span className="kyoto-hero-eyebrow">地形決定了這一切</span>
        <h1>東山的地形，寫下了一段信仰與人文交織的故事</h1>
        <p>
          東山是花崗岩隆起的丘陵，山麓緩坡與湧泉，是歷代寺院選址於此的物理基礎——地形逼出了清水寺的懸空舞台造，
          參拜人潮踩出了產寧坂的坡道商店街，明治年間的土地政策把寺院境內地變成了圓山公園，
          而八坂神社門前的參拜人流，最終孕育出祇園的茶屋與藝妓文化。地質、信仰、商業、人文，是同一條因果鏈。
        </p>
      </header>

      {/* 進度指示——同 JiufenPage.tsx 的說明,第一個點對應開頭互動地圖區塊
          (activeIndex 的特殊值 -1)。 */}
      <nav className="kyoto-progress-rail" aria-label="站點進度">
        <button
          type="button"
          className={`kyoto-progress-dot${activeIndex === -1 ? ' is-active' : ''}`}
          onClick={() => mapIntroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到互動地圖"
          title="回到互動地圖"
        />
        {STOPS.map((stop, i) => (
          <button
            key={stop.name}
            type="button"
            className={`kyoto-progress-dot${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => stopRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`跳到「${stop.name}」`}
            title={stop.name}
          />
        ))}
      </nav>

      <section className="kyoto-stops">
        {STOPS.map((stop, i) => (
          <article
            className="kyoto-stop"
            key={stop.name}
            data-index={i}
            ref={(el) => { stopRefs.current[i] = el; }}
          >
            <div className={`kyoto-stop-inner kyoto-stop-inner--${stop.layout}`}>
              <div className="kyoto-stop-photo">
                <img src={stop.photo} alt={stop.name} loading="lazy" />
              </div>
              <div className="kyoto-stop-text">
                <div className="kyoto-stop-meta">
                  <span className="kyoto-stop-index">{stop.index}</span>
                  <span className="kyoto-stop-kind">{stop.kind}</span>
                </div>
                <h2>{stop.name}</h2>
                <p>{stop.desc}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="kyoto-final-cta">
        <h2>這條路線，只是一個開始</h2>
        <p>每一個地方都有自己的地景、歷史與生活脈絡。探索，就是把這些點連成一條屬於你的路。</p>
        <Link to="/app" className="kyoto-btn-primary">
          規劃我的探索路線
        </Link>
      </section>

      <footer className="kyoto-footer">
        <span className="kyoto-footer-brand">Tripace · 行程規劃</span>
        <div className="kyoto-footer-sitemap">
          <div className="kyoto-footer-sitemap-col">
            <span className="kyoto-footer-sitemap-title">產品功能</span>
            <Link to="/product">產品介紹</Link>
            <Link to="/app">開始使用</Link>
          </div>
          <div className="kyoto-footer-sitemap-col">
            <span className="kyoto-footer-sitemap-title">更多景點</span>
            <Link to="/jiufen">台灣・九份</Link>
          </div>
        </div>
        <div className="kyoto-footer-bar">
          <span className="kyoto-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="kyoto-footer-links">
            <Link to="/">回首頁</Link>
            <Link to="/privacy">隱私權政策</Link>
            <Link to="/terms">服務條款</Link>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="kyoto-footer-onagent"
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
