import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Moon, Sun } from 'lucide-react';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import './JiufenPage.css';

// SEO_TITLE/SEO_DESCRIPTION:這個頁面專屬的 <title>/<meta description>,
// 透過下方 <Helmet> 蓋掉 index.html 裡首頁共用的預設值(見該檔案的完整
// 說明)——搜尋引擎/社群分享預覽才能看到「九份」而非「Tripace 首頁」的
// 標題與描述。文案沿用首頁「目的地」列表區塊(HomePage.tsx)跟
// sitemap.xml 既有註解已經在用的同一句簡介,三處保持一致的措辭。
const SEO_TITLE = '九份——礦業興衰與人文重生的山城故事 | Tripace'
const SEO_DESCRIPTION = '從基隆山的地形限制，到金瓜石礦業的興衰，再到老街、茶樓與海景交錯的人文重生——跟著 Tripace 走一趟九份的散策路線，讀懂這座山城為何長成現在的樣子。'
const SEO_URL = 'https://tripace.shuttle.tools/jiufen'

// LANDING_ASSETS_BASE:landing page 系列頁面(目前只有這裡)用的靜態圖片
// GCS bucket——跟後端存 attraction 照片的 GCS_PHOTO_BUCKET
// (shuttle-tripace-photos)是完全不同的用途/bucket,這個 bucket
// (shuttle-tripace-web-assets)公開可讀取,專門放跟著網站頁面走、不經過
// 後端漸進補圖機制的固定素材。目錄格式固定 landing/{城市 slug}/n{編號}.jpg
// ——之後新增其他城市的介紹頁(例如京都、清邁)時,沿用同一個 bucket 底下
// 各自的 slug 子目錄,不需要每個城市各自建一個 bucket。這裡不是跟著
// Vite build 打包進 web/public/(那樣圖片會佔用前端 bundle 部署大小,
// 且每次新增城市頁面都要重新 build+deploy 前端才能上架圖片),GCS 物件
// 上傳跟前端程式碼部署完全解耦,加新地點的圖片只需要 gsutil cp,不需要
// 動到前端 repo。
const LANDING_ASSETS_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing'

// 各站照片多數取自 Pexels(https://www.pexels.com),見對應攝影師署名——非
// 九份實景照,是地形/建築/氛圍相近的示意用圖,待有實際景點照片時再替換。
// 以下站點例外,已換成 Wikimedia Commons 的實景照(見各站 credit 標註)：
//   - 「昇平戲院」(n5.jpg):作者 Kwb 已將版權釋出至公共領域(Public
//     Domain),不強制標註,仍禮貌性標註來源。來源:
//     https://commons.wikimedia.org/wiki/File:Shengping_Theater_entry_20050612.jpg
//   - 「輕便路與運礦軌道」(n4.jpg,金瓜石外九份溪水圳橋):CC BY-SA 4.0,
//     作者 JinBoTwn——這個授權條款強制要求標註作者/授權條款,且原圖已
//     裁切(6016×4016 縮放並裁切成 900×600 貼合版面),故 credit 額外
//     加註「已裁切」滿足 CC BY-SA 4.0 對衍生作品的標示義務。來源:
//     https://commons.wikimedia.org/wiki/File:金瓜石外九份溪水圳橋.jpg
// layout:'side'(左右並排)僅用於直式照片(目前只有 n3),讓照片完整顯示
// 又不會把版面撐得過高;其餘橫式照片維持 'stacked'(圖上文下),兩種版面
// 混用是刻意的,取決於各站實際照片的長寬比,不是隨機交錯。
const STOPS = [
  {
    index: '起點',
    kind: '地形',
    name: '基隆山與大肚美人山',
    desc: '第三紀砂頁岩夾雜金瓜石礦脈，山勢陡峭、腹地狹小——這個地形限制決定了聚落只能沿等高線層疊而建，而不是像平地城鎮那樣棋盤式展開。所有後面的敘事都源自這個「沒有平地可蓋」的物理條件。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n0.jpg`,
    credit: 'Stijn Dijkstra / Pexels',
    layout: 'stacked',
  },
  {
    index: '壱',
    kind: '起源',
    name: '九份地名由來',
    desc: '陡峭地形讓早期只有極少數移民願意落腳，相傳因聚落僅有九戶人家、外出採買習慣「一次購足九份」而得名——地名本身就是地形限制人口規模的證據。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n1.jpg`,
    credit: 'Marek Piwnicki / Pexels',
    layout: 'stacked',
  },
  {
    index: '弐',
    kind: '轉折',
    name: '小金瓜露頭與砂金發現',
    desc: '1890年代劉銘傳築鐵路工人在基隆河發現砂金，往上游追溯到小金瓜礦脈——地質構造直接觸發了整個淘金熱潮的起點，聚落自此從邊陲山村變成礦業重鎮。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n2.jpg`,
    credit: 'Chen Te / Pexels',
    layout: 'stacked',
  },
  {
    index: '参',
    kind: '路徑',
    name: '豎崎路',
    desc: '坡度太陡無法行車，逼出了石階步道成為聚落唯一的垂直動線，也決定了後來茶樓、店家沿石階兩側層疊而建的空間邏輯——地形逼出建築形式的代表案例。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n3.jpg`,
    credit: 'Sophie Otto / Pexels',
    layout: 'side',
  },
  {
    index: '四',
    kind: '產業',
    name: '輕便路與運礦軌道',
    desc: '礦業全盛期（1930年代日治）為了把礦石運下山，沿等高線鑿出的運輸路徑，後來轉型為聚落的水平向主街，商店沿線發展，成為橫向的空間骨架。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n4.jpg`,
    credit: 'JinBoTwn / Wikimedia Commons, CC BY-SA 4.0（已裁切）',
    layout: 'stacked',
  },
  {
    index: '伍',
    kind: '人文',
    name: '昇平戲院',
    desc: '礦業帶來的人口與財富催生的娛樂需求，全台最早的戲院之一，見證礦業經濟頂峰時期一夜聚集數千礦工的繁華榮景。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n5.jpg`,
    credit: 'Kwb / Wikimedia Commons, Public Domain',
    layout: 'stacked',
  },
  {
    index: '陸',
    kind: '衰退',
    name: '台陽公司停採',
    desc: '1971年金礦枯竭、礦脈耗盡，直接導致聚落人口外移、幾乎成為空城——地質資源的終結，是整條因果鏈的轉折點。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n6.jpg`,
    credit: 'Emman Marcial / Pexels',
    layout: 'stacked',
  },
  {
    index: '柒',
    kind: '重生',
    name: '悲情城市取景與觀光轉型',
    desc: '1989年侯孝賢電影意外帶動觀光復甦，原本因地形而生的礦業聚落景觀（層疊石階、狹窄街屋），轉為觀光賣點，茶樓文化重新繁盛——完成地質、礦業、衰敗、人文觀光的完整因果閉環。',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n7.jpg`,
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
  // activeIndex:目前捲動到視窗中央的區塊索引——驅動右側進度點與每個
  // 站點 section 的 is-active class(觸發文字淡入淡出),不牽涉座標/
  // 路徑計算,跟首頁 HomePage.tsx 那套「地圖游標+bloom 照片」的捲動
  // 邏輯是兩回事,這裡刻意不共用、不仿造那套複雜度。-1 是專屬於開頭
  // 互動地圖區塊(mapIntroRef)的特殊值,0 以上對應 STOPS 陣列的索引——
  // 初始值就是 -1,因為頁面一載入、還沒開始捲動時,使用者本來就正在
  // 看地圖區塊,這個 icon 點應該從一開始就是高亮狀態,不需要等使用者
  // 捲動一次才會顯示正確的高亮位置。
  const [activeIndex, setActiveIndex] = useState(-1);
  const stopRefs = useRef<(HTMLElement | null)[]>([]);
  // mapIntroRef:開頭互動地圖(InteractiveExploreMap)的容器——供進度點列
  // 第一個「回到地圖」圖示點擊時捲回去用,也跟 stopRefs 一起被同一個
  // IntersectionObserver 觀察(見下方),捲動到這個區塊時把 activeIndex
  // 設回 -1,讓地圖圖示點套用跟其餘站點點一致的 .is-active 變色效果
  // (見 JiufenPage.css 該 class 的完整說明)。
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
    // mapIntroRef 一併加入觀察名單(data-index="-1",對應上方 activeIndex
    // 的特殊值)——讓「回到地圖」圖示點在使用者實際捲動到地圖區塊時
    // 也能正確套用 .is-active 高亮效果,理由見該狀態的完整說明。
    if (mapIntroRef.current) mapIntroRef.current.setAttribute('data-index', '-1');
    const allEls = mapIntroRef.current ? [mapIntroRef.current, ...els] : els;
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
    allEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const dark = isCurrentlyDark(theme, systemPrefersDark);

  const toggleTheme = () => {
    setTheme(dark ? 'light' : 'dark');
  };

  return (
    <div className="jiufen-page" data-theme={theme ?? undefined}>
      <Helmet>
        <title>{SEO_TITLE}</title>
        <meta name="description" content={SEO_DESCRIPTION} />
        <link rel="canonical" href={SEO_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={SEO_URL} />
        <meta property="og:title" content={SEO_TITLE} />
        <meta property="og:description" content={SEO_DESCRIPTION} />
        <meta property="og:image" content={`${LANDING_ASSETS_BASE}/jiufen/n0.jpg`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SEO_TITLE} />
        <meta name="twitter:description" content={SEO_DESCRIPTION} />
        <meta name="twitter:image" content={`${LANDING_ASSETS_BASE}/jiufen/n0.jpg`} />
        {/* JSON-LD 結構化資料——搜尋引擎（主要是 Google）讀這段來產生
            豐富搜尋結果（rich result，例如搜尋列表下方多顯示地點資訊、
            麵包屑導覽路徑），純粹是曝光/點閱率的加分項，不影響頁面本身
            的渲染或排序邏輯，錯了也不會讓頁面壞掉，故直接內嵌在
            <Helmet> 裡讓 react-helmet-async 連同其餘 meta 一起注入
            <head>，不需要額外的建置步驟。
            TouristDestination：Schema.org 定義給「值得旅遊的地點/城市」
            用的型別（比泛用的 WebPage 更精確），containsPlace 用
            STOPS 陣列動態產生每個敘事段落對應的地標,讓搜尋引擎理解
            這個頁面實際涵蓋哪些具名地點(基隆山/豎崎路/昇平戲院等),
            而不是只從純文字內容猜測。 */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TouristDestination',
            name: '九份',
            description: SEO_DESCRIPTION,
            url: SEO_URL,
            image: `${LANDING_ASSETS_BASE}/jiufen/n0.jpg`,
            address: {
              '@type': 'PostalAddress',
              addressLocality: '瑞芳區',
              addressRegion: '新北市',
              addressCountry: 'TW',
            },
            containsPlace: STOPS.map((s) => ({
              '@type': 'TouristAttraction',
              name: s.name,
              description: s.desc,
            })),
          })}
        </script>
        {/* BreadcrumbList：告訴搜尋引擎這個頁面在網站架構裡的位置
            （首頁 › 九份），Google 搜尋結果會把網址列改顯示成路徑麵包屑
            而非原始 URL，提升可信度與點擊率。 */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: 'https://tripace.shuttle.tools/' },
              { '@type': 'ListItem', position: 2, name: '九份', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      {/* 品牌標記/切換鈕/CTA——對齊 HomePage.tsx 的浮動角落式樣式(非 sticky
          橫向 nav bar):品牌名 fixed 左上、日夜切換鈕 fixed 右上圓鈕、CTA
          排在切換鈕左邊,皆不隨頁面捲動。
          「・九份」是獨立的 <span>,不在 <Link> 裡面——Tripace 本身仍是
          唯一可點擊、回首頁的連結,旁邊的頁面名稱純粹是文字標示目前在哪
          個頁面,不該被誤以為點擊會停留在九份相關頁面。其餘子頁面
          (/product、/privacy、/terms)沒有對應的頁面名稱可加,故這個
          做法目前只在有明確主題城市的介紹頁(如這裡)使用,不是全站
          品牌標記的新慣例。 */}
      <div className="jiufen-brand-row">
        <Link to="/" className="jiufen-brand-mark">Tripace</Link>
        <span className="jiufen-brand-page">九份</span>
      </div>
      <button
        type="button"
        className="jiufen-theme-toggle"
        onClick={toggleTheme}
        aria-label={dark ? '切換至淺色模式' : '切換至深色模式'}
      >
        {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
      <Link to="/app" className="jiufen-app-cta">立即開始</Link>

      {/* 開頭互動地圖——跟首頁(HomePage.tsx)同一個元件(InteractiveExploreMap,
          已參數化成 city prop,見該檔案開頭的完整說明),傳 city="九份"
          直接沿用,不是另外複製一份重複邏輯。放在整個頁面最頂端(hero
          標題之前),讓使用者一進頁面就先看到可互動的真實地圖,再往下讀
          地形→礦業→衰退→重生的敘事文字——跟首頁「先敘事、地圖放在
          結尾」的順序刻意相反,這裡是介紹頁而非行銷首頁,不需要先鋪陳
          敘事才亮出產品能力。showThemeToggle 傳 false:這個頁面已經有
          自己的日夜切換鈕(.jiufen-theme-toggle,上方 toggleTheme),不
          需要 InteractiveExploreMap 內建的第二顆重複按鈕。
          外層 div 用 .jiufen-map-intro 覆寫 --kiyomizu-page-padding
          (預設 48px 24px,見 InteractiveExploreMap.module.css 的說明)——這個
          頁面的品牌標記/切換鈕/CTA 是 position: fixed 疊在畫面最頂端
          16px 處(.jiufen-brand-mark 等,見 JiufenPage.css),HomePage.tsx
          把這個元件放在頁面結尾不會撞到這排固定 UI,但這裡放在最頂端會
          直接被蓋住,故加大上邊距讓地圖容器往下讓開。改用具名 class
          (而非直接 inline style)是因為手機版還需要額外加大右側
          padding(見 JiufenPage.css 該 class 的 media query,讓地圖本身
          跟畫面右緣/右側進度點之間有實際留白,而不是靠調整進度點自己的
          位置去湊間隙),inline style 沒辦法寫 media query。HomePage.tsx
          不需要這層覆寫,不動它的預設值。
          externalTheme 傳這個頁面自己的 theme state(見上方
          .jiufen-theme-toggle 的 toggleTheme)——InteractiveExploreMap 原本
          假設 showThemeToggle=false 的呼叫端沒有自己的切換鈕、只需要
          掛載時讀一次系統偏好即可,但這個頁面確實有獨立的手動切換鈕,
          若不傳這個 prop,使用者按下切換鈕後頁面背景會換色但地圖底圖
          不會跟著換(2026-09 實測回報「不會即時換」,見該 prop 在
          InteractiveExploreMap.tsx 的完整說明)。
          defaultOpenTheme="九份老街":這個頁面只有一個主題點,使用者
          一進頁面就先看到地圖是空的、要點一下地圖才看得到內容,體驗
          上不如直接開好給他看(見該 prop 的完整說明)——跟首頁不套用
          這個行為的理由不同,首頁京都有兩個主題點平等並存,預先選定
          其中一個反而暗示了優先順序。
          initialZoom={17}:預設值(見 InteractiveExploreMap.tsx 的
          INITIAL_ZOOM=15)是拿京都景點分布校準出來的,九份聚落腹地小、
          景點(老街、茶樓、車站等)彼此距離近,同樣的縮放層級在九份地圖
          上顯得過遠,拉近到 17 讓一進頁面就能看清老街周邊的密集標記。
          曾一度改成 16(懷疑 17 標籤重疊,依據一次子代理的截圖判斷),
          但實際瀏覽器觀察發現 16 反而比 17 更擁擠——子代理當時的截圖
          判斷不可靠(該次截圖過程本身就記錄到 dev server 曾遇到 stale
          module 快取問題,見背景任務報告),故改回實測(使用者直接觀察)
          確認有效的 17。日後若還要調整,以實際瀏覽器觀察為準,不要單憑
          自動化截圖的一次性判斷推翻。
          centerNorthOffsetKm={-0.1}:抵消 InteractiveExploreMap.tsx
          預設的往北偏移 0.1km(該偏移是針對京都兩個主題點的中點校準,
          見該常數完整說明)——九份只有一個主題點,不需要「不偏袒任一邊」
          的置中考量,使用者要求「地圖中心點往下(南)100 公尺」,傳負值
          抵消掉共用預設,讓九份的初始中心落回九份老街本身。 */}
      <div className="jiufen-map-intro" ref={mapIntroRef}>
        <InteractiveExploreMap city="九份" showThemeToggle={false} externalTheme={theme} defaultOpenTheme="九份老街" initialZoom={17} centerNorthOffsetKm={-0.1} />
      </div>

      <header className="jiufen-hero">
        <span className="jiufen-hero-eyebrow">地形決定了這一切</span>
        <h1>九份的地形，寫下了一段淘金與衰落的故事</h1>
        <p>
          陡峭山勢逼出層疊石階，礦脈枯竭又讓聚落幾乎成為空城，最終因一部電影意外重生——
          這是一條地質、產業、衰敗、人文交織的因果鏈。
        </p>
        <div className="jiufen-hero-scroll-hint"><span>SCROLL</span><span className="bar" /></div>
      </header>

      {/* 進度指示——固定右側,捲動敘事本身不畫路徑地圖或游標,純粹用 9 個點
          呈現目前捲動到第幾個區塊。點擊可直接跳到對應區塊,不必一路捲
          過去。第一個對應開頭的互動地圖區塊(activeIndex 的特殊值 -1,
          見上方 IntersectionObserver 的完整說明),樣式/間距跟其餘 8 個
          站點點完全一致(對齊 HomePage.css 的 .progress-dot,見
          JiufenPage.css 該處的完整說明)——不是獨立的圖示按鈕,純粹是
          這排點裡對應到不同區塊的其中一個,不需要靠外觀特例才能分辨,
          位置(排在最前面)加上點擊行為(捲回地圖而非某個站點)已經
          足夠說明它的角色。 */}
      <nav className="jiufen-progress-rail" aria-label="站點進度">
        <button
          type="button"
          className={`jiufen-progress-dot${activeIndex === -1 ? ' is-active' : ''}`}
          onClick={() => mapIntroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到互動地圖"
          title="回到互動地圖"
        />
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
            <Link to="/kyoto-kiyomizu">日本・京都</Link>
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
