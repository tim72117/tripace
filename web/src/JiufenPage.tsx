import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { JiufenMap } from './JiufenMap';
import { JiufenHandDrawnMap } from './JiufenHandDrawnMap';
import './JiufenPage.css';

// 8 個站點的真實座標——用 tripace-cli attraction-add -place 查 Google
// Places 取得(非手動猜測/捏造)。stopIndex 對應 STOPS 陣列的實際索引
// (用來讓 JiufenMap 的 onSelect 跳到正確站點),不是這個陣列自身的順序
// ——基隆山(STOPS 索引 0,起點)刻意不畫在地圖上(不是真正可抵達的
// 站點座標,只是概略山區位置),故這裡從索引 1 開始,陣列長度比 STOPS
// 少一筆。跟 STOPS 分開宣告是因為 STOPS 本身用 `as const` 鎖住形狀給
// TS 推導站點種類,這裡的座標資料只給 JiufenMap 用,不需要跟著鎖。
const STOP_COORDS: { name: string; index: string; stopIndex: number; lat: number; lng: number }[] = [
  { name: '九份地名由來', index: '壱', stopIndex: 1, lat: 25.109806, lng: 121.845223 },
  { name: '小金瓜露頭與砂金發現', index: '弐', stopIndex: 2, lat: 25.100941, lng: 121.854550 },
  { name: '豎崎路', index: '参', stopIndex: 3, lat: 25.108688, lng: 121.843534 },
  { name: '輕便路與運礦軌道', index: '四', stopIndex: 4, lat: 25.108587, lng: 121.843089 },
  { name: '昇平戲院', index: '伍', stopIndex: 5, lat: 25.108606, lng: 121.843381 },
  { name: '台陽公司停採', index: '陸', stopIndex: 6, lat: 25.106136, lng: 121.859637 },
  { name: '悲情城市取景與觀光轉型', index: '柒', stopIndex: 7, lat: 25.108563, lng: 121.843607 },
];

// 各站照片取自 Pexels(https://www.pexels.com),見對應攝影師署名——非九份
// 實景照,是地形/建築/氛圍相近的示意用圖,待有實際景點照片時再替換。
// layout:'side'(左右並排)僅用於直式照片(目前只有 n3),讓照片完整顯示
// 又不會把版面撐得過高;其餘橫式照片維持 'stacked'(圖上文下),兩種版面
// 混用是刻意的,取決於各站實際照片的長寬比,不是隨機交錯。
const STOPS = [
  {
    index: '起點',
    kind: '地形',
    name: '基隆山與大肚美人山',
    desc: '第三紀砂頁岩夾雜金瓜石礦脈，山勢陡峭、腹地狹小——這個地形限制決定了聚落只能沿等高線層疊而建，而不是像平地城鎮那樣棋盤式展開。所有後面的敘事都源自這個「沒有平地可蓋」的物理條件。',
    photo: '/jiufen/n0.jpg',
    credit: 'Stijn Dijkstra / Pexels',
    layout: 'stacked',
  },
  {
    index: '壱',
    kind: '起源',
    name: '九份地名由來',
    desc: '陡峭地形讓早期只有極少數移民願意落腳，相傳因聚落僅有九戶人家、外出採買習慣「一次購足九份」而得名——地名本身就是地形限制人口規模的證據。',
    photo: '/jiufen/n1.jpg',
    credit: 'Marek Piwnicki / Pexels',
    layout: 'stacked',
  },
  {
    index: '弐',
    kind: '轉折',
    name: '小金瓜露頭與砂金發現',
    desc: '1890年代劉銘傳築鐵路工人在基隆河發現砂金，往上游追溯到小金瓜礦脈——地質構造直接觸發了整個淘金熱潮的起點，聚落自此從邊陲山村變成礦業重鎮。',
    photo: '/jiufen/n2.jpg',
    credit: 'Chen Te / Pexels',
    layout: 'stacked',
  },
  {
    index: '参',
    kind: '路徑',
    name: '豎崎路',
    desc: '坡度太陡無法行車，逼出了石階步道成為聚落唯一的垂直動線，也決定了後來茶樓、店家沿石階兩側層疊而建的空間邏輯——地形逼出建築形式的代表案例。',
    photo: '/jiufen/n3.jpg',
    credit: 'Sophie Otto / Pexels',
    layout: 'side',
  },
  {
    index: '四',
    kind: '產業',
    name: '輕便路與運礦軌道',
    desc: '礦業全盛期（1930年代日治）為了把礦石運下山，沿等高線鑿出的運輸路徑，後來轉型為聚落的水平向主街，商店沿線發展，成為橫向的空間骨架。',
    photo: '/jiufen/n4.jpg',
    credit: 'ON VIXION / Pexels',
    layout: 'stacked',
  },
  {
    index: '伍',
    kind: '人文',
    name: '昇平戲院',
    desc: '礦業帶來的人口與財富催生的娛樂需求，全台最早的戲院之一，見證礦業經濟頂峰時期一夜聚集數千礦工的繁華榮景。',
    photo: '/jiufen/n5.jpg',
    credit: 'Max Chen / Pexels',
    layout: 'stacked',
  },
  {
    index: '陸',
    kind: '衰退',
    name: '台陽公司停採',
    desc: '1971年金礦枯竭、礦脈耗盡，直接導致聚落人口外移、幾乎成為空城——地質資源的終結，是整條因果鏈的轉折點。',
    photo: '/jiufen/n6.jpg',
    credit: 'Emman Marcial / Pexels',
    layout: 'stacked',
  },
  {
    index: '柒',
    kind: '重生',
    name: '悲情城市取景與觀光轉型',
    desc: '1989年侯孝賢電影意外帶動觀光復甦，原本因地形而生的礦業聚落景觀（層疊石階、狹窄街屋），轉為觀光賣點，茶樓文化重新繁盛——完成地質、礦業、衰敗、人文觀光的完整因果閉環。',
    photo: '/jiufen/n7.jpg',
    credit: 'Wei86 Travel / Pexels',
    layout: 'side',
  },
] as const;

function isCurrentlyDark(t: 'dark' | 'light' | null, systemPrefersDark: boolean) {
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return systemPrefersDark;
}

export function JiufenPage() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  // activeIndex:目前捲動到視窗中央的站點——只驅動右側進度點與每個站點
  // section 的 is-active class(觸發文字淡入淡出),不牽涉座標/路徑計算,
  // 跟首頁 HomePage.tsx 那套「地圖游標+bloom 照片」的捲動邏輯是兩回事,
  // 這裡刻意不共用、不仿造那套複雜度。
  const [activeIndex, setActiveIndex] = useState(0);
  const stopRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);
    const handleChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const els = stopRefs.current.filter((el): el is HTMLElement => el !== null);
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('is-active'));
      return;
    }
    // threshold 0.5:站點區塊過半進入視窗才算「目前站點」,避免捲動途中
    // 兩個區塊同時觸發、進度點跳來跳去。
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
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const dark = isCurrentlyDark(theme, systemPrefersDark);

  const toggleTheme = () => {
    setTheme(dark ? 'light' : 'dark');
  };

  return (
    <div className="jiufen-page" data-theme={theme ?? undefined}>
      {/* 品牌標記/切換鈕/CTA——對齊 HomePage.tsx 的浮動角落式樣式(非 sticky
          橫向 nav bar):品牌名 fixed 左上、日夜切換鈕 fixed 右上圓鈕、CTA
          排在切換鈕左邊,皆不隨頁面捲動。 */}
      <Link to="/" className="jiufen-brand-mark">Tripace</Link>
      <button
        type="button"
        className="jiufen-theme-toggle"
        onClick={toggleTheme}
        aria-label={dark ? '切換至淺色模式' : '切換至深色模式'}
      >
        {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
      <Link to="/app" className="jiufen-app-cta">立即開始</Link>

      <header className="jiufen-hero">
        <span className="jiufen-hero-eyebrow">地形決定了這一切</span>
        <h1>九份的地形，寫下了一段淘金與衰落的故事</h1>
        <p>
          陡峭山勢逼出層疊石階，礦脈枯竭又讓聚落幾乎成為空城，最終因一部電影意外重生——
          這是一條地質、產業、衰敗、人文交織的因果鏈。
        </p>
        <div className="jiufen-hero-scroll-hint"><span>SCROLL</span><span className="bar" /></div>
      </header>

      {/* 進度指示——固定右側,捲動敘事本身不畫路徑地圖或游標,純粹用 8 個點
          呈現目前捲動到第幾個站點。點擊可直接跳到對應站點,不必一路捲
          過去。下方 .jiufen-overview-map 是另一張獨立的手繪風地點總覽圖,
          放在 hero 與敘事區塊之間,兩者用途不同、不衝突。 */}
      <nav className="jiufen-progress-rail" aria-label="站點進度">
        {STOPS.map((stop, i) => (
          <button
            key={stop.name}
            type="button"
            className={`jiufen-progress-dot${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => stopRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`跳到「${stop.name}」`}
            title={stop.name}
          />
        ))}
      </nav>

      {/* 地點總覽圖——兩種版本並排試做比較(使用者要求先並存,尚未決定
          取捨),左邊是真實地理座標地圖(JiufenMap.tsx,Google Maps API +
          古紙復古 styler),右邊是純手繪風示意 SVG(JiufenHandDrawnMap.tsx,
          不依賴地圖 API)。兩者都關閉/不含一般 POI,只標示這幾個敘事
          站點——基隆山(起點)刻意都不畫出來(見 STOP_COORDS 說明)。
          點擊任一版本的標記都可直接跳到對應站點敘事段落。 */}
      <div className="jiufen-overview-map jiufen-overview-map--compare">
        <div className="jiufen-overview-map-col">
          <span className="jiufen-overview-map-label">Google Maps・古紙復古風</span>
          <JiufenMap
            stops={STOP_COORDS}
            onSelect={(stop) => {
              if (stop.stopIndex !== undefined) {
                stopRefs.current[stop.stopIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }}
          />
        </div>
        <div className="jiufen-overview-map-col">
          <span className="jiufen-overview-map-label">手繪風示意圖</span>
          <JiufenHandDrawnMap
            onSelect={(stopIndex) => stopRefs.current[stopIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          />
        </div>
      </div>

      <section className="jiufen-stops">
        {STOPS.map((stop, i) => (
          <article
            className="jiufen-stop"
            key={stop.name}
            data-index={i}
            ref={(el) => { stopRefs.current[i] = el; }}
          >
            <div className={`jiufen-stop-inner jiufen-stop-inner--${stop.layout}`}>
              <div className="jiufen-stop-photo">
                <img src={stop.photo} alt={stop.name} loading="lazy" />
                <span className="jiufen-stop-credit">Photo: {stop.credit}</span>
              </div>
              <div className="jiufen-stop-text">
                <div className="jiufen-stop-meta">
                  <span className="jiufen-stop-index">{stop.index}</span>
                  <span className="jiufen-stop-kind">{stop.kind}</span>
                </div>
                <h2>{stop.name}</h2>
                <p>{stop.desc}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="jiufen-final-cta">
        <h2>把九份的故事，排進你的下一趟行程</h2>
        <p>在 Tripace 上探索景點、拖曳排入日程，規劃一趟屬於自己的東北角之旅。</p>
        <Link to="/app" className="jiufen-btn-primary">
          免費開始使用
        </Link>
      </section>

      <footer className="jiufen-footer">
        <span className="jiufen-footer-brand">Tripace · 行程規劃</span>
        <div className="jiufen-footer-sitemap">
          <div className="jiufen-footer-sitemap-col">
            <span className="jiufen-footer-sitemap-title">產品功能</span>
            <Link to="/product">產品介紹</Link>
            <Link to="/app">開始使用</Link>
          </div>
          <div className="jiufen-footer-sitemap-col">
            <span className="jiufen-footer-sitemap-title">更多景點</span>
            <Link to="/">日本・東山</Link>
          </div>
        </div>
        <div className="jiufen-footer-bar">
          <span className="jiufen-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="jiufen-footer-links">
            <Link to="/">回首頁</Link>
            <Link to="/privacy">隱私權政策</Link>
            <Link to="/terms">服務條款</Link>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="jiufen-footer-onagent"
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
