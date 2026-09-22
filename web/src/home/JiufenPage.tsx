import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import { MobileMapReveal } from './MobileMapReveal';
import { ScrollHint } from './ScrollHint';
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons';
import { CityPageFooter } from './CityPageFooter';
import { useThemeToggle } from '../hooks/useThemeToggle';
import { useScrollProgress } from '../hooks/useScrollProgress';
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

// activeIndex/stopRefs/mapIntroRef 的捲動進度邏輯已抽到 useScrollProgress
// (見 src/hooks/useScrollProgress.ts 的完整說明)——原本這裡有一份約
// 25 行逐字說明「-1 是開頭互動地圖區塊的專屬哨兵值」「threshold 0.5
// 避免進度點跳來跳去」等細節,現在集中寫在該 hook 檔案裡,不重複貼在
// 三個城市頁各自的檔案。
export function JiufenPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();
  const mapIntroRef = useRef<HTMLDivElement | null>(null);
  const { activeIndex, stopRefs } = useScrollProgress(STOPS.length, mapIntroRef);

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
      {/* 2026-09:使用者要求「主題介紹頁的右上按鈕」跟首頁對齊大小,回報
          「怎麼都沒改」後發現這四個城市頁(Jiufen/Kyoto/Tainan/
          TainanChikan)原本各自維護一份獨立樣式(.jiufen-theme-toggle/
          .jiufen-app-cta 等),完全沒有跟 HomePage.tsx/ProductPage.tsx
          共用的 SiteNavButtons 對齊,這裡一併改用同一份共用元件(見
          SiteNavButtons.tsx 的完整說明),徹底消除「各頁各自一份、容易
          走鐘」的問題根源。pageLabel="九份" 對應原本獨立的
          .jiufen-brand-page 純文字頁面標籤(不是連結,見 SiteNavBrand
          的 pageLabel prop 完整說明)。 */}
      <SiteNavBrand pageLabel="九份" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">立即開始</SiteNavCta>

      <header className="jiufen-hero">
        <span className="jiufen-hero-eyebrow">地形決定了這一切</span>
        <h1>九份的地形，寫下了一段淘金與衰落的故事</h1>
        <p>
          陡峭山勢逼出層疊石階，礦脈枯竭又讓聚落幾乎成為空城，最終因一部電影意外重生——
          這是一條地質、產業、衰敗、人文交織的因果鏈。
        </p>
        {/* 2026-09 code review 抓到:JiufenPage 是唯一漏掉 <ScrollHint />
            的城市頁——KyotoPage/TainanPage/TainanChikanPage 都在 hero
            段落後掛了這個提示(見 ScrollHint.tsx 的完整說明:地圖搬到
            分站列表之後,原本內建在 MobileMapReveal 縮圖裡的 SCROLL
            提示已改成這個共用元件,由呼叫端各自掛在 hero 下方),補上
            維持四頁一致。 */}
        <ScrollHint />
      </header>

      {/* 進度指示——固定右側,捲動敘事本身不畫路徑地圖或游標,純粹用 9 個點
          呈現目前捲動到第幾個區塊。點擊可直接跳到對應區塊,不必一路捲
          過去。2026-09:使用者要求把開頭互動地圖從頁面最頂端搬到分站
          列表結束、結尾 CTA 之前(見下方 .jiufen-map-intro 掛載處的
          完整說明)——「回到互動地圖」這顆進度點原本排在最前面(對應
          地圖當時在頁面最頂端的視覺順序),現在改排在最後面(STOPS 之
          後),對齊地圖搬移後的新視覺順序,使用者從進度列點下去的體感
          方向(往下捲到最後)才會跟頁面實際排列一致。activeIndex 的
          特殊值 -1(見上方 IntersectionObserver 的完整說明)本身不受
          這次排列順序調整影響,純粹是 CSS 渲染順序(這顆 button 在
          JSX 裡寫在後面)。 */}
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
        <button
          type="button"
          className={`jiufen-progress-dot${activeIndex === -1 ? ' is-active' : ''}`}
          onClick={() => mapIntroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到互動地圖"
          title="回到互動地圖"
        />
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

      {/* 開頭互動地圖——2026-09:使用者要求把這個區塊從頁面最頂端(hero
          標題之前)搬到這裡,分站列表結束、結尾 CTA 之前。跟首頁
          (HomePage.tsx)同一個元件(InteractiveExploreMap,已參數化成
          city prop,見該檔案開頭的完整說明),傳 city="九份"直接沿用,
          不是另外複製一份重複邏輯。showThemeToggle 傳 false:這個頁面
          已經有自己的日夜切換鈕(.jiufen-theme-toggle,上方
          toggleTheme),不需要 InteractiveExploreMap 內建的第二顆重複
          按鈕。
          外層 div 用 .jiufen-map-intro 覆寫 --kiyomizu-page-padding
          (預設 48px 24px,見 InteractiveExploreMap.module.css 的說明)
          ——原本這裡有額外加大的上邊距(88px)讓地圖容器避開頂部
          position: fixed 的品牌標記/切換鈕/CTA(該區塊之前放在頁面最
          頂端會被蓋住),搬到這個新位置後不再緊鄰頂部固定 UI,這個
          補償上邊距的理由已經不成立,已在 JiufenPage.css 對應規則改回
          正常間距(見該處完整說明)。改用具名 class(而非直接 inline
          style)是因為手機版還需要額外加大右側 padding(見
          JiufenPage.css 該 class 的 media query),inline style 沒辦法
          寫 media query。
          externalTheme 傳這個頁面自己的 theme state(見上方
          .jiufen-theme-toggle 的 toggleTheme)——InteractiveExploreMap
          原本假設 showThemeToggle=false 的呼叫端沒有自己的切換鈕、只
          需要掛載時讀一次系統偏好即可,但這個頁面確實有獨立的手動切換
          鈕,若不傳這個 prop,使用者按下切換鈕後頁面背景會換色但地圖
          底圖不會跟著換。
          defaultOpenTheme="九份老街":這個頁面只有一個主題點,使用者
          一進頁面就先看到地圖是空的、要點一下地圖才看得到內容,體驗
          上不如直接開好給他看。
          initialZoom={17}/centerNorthOffsetKm={-0.1}:九份聚落腹地小、
          景點彼此距離近,拉近縮放層級並抵消共用預設的往北偏移,讓九份
          的初始中心落回九份老街本身(校準理由同先前版本,見 git 歷史
          此區塊移動前的完整說明)。 */}
      <div className="jiufen-map-intro" ref={mapIntroRef}>
        <MobileMapReveal photoUrl={`${LANDING_ASSETS_BASE}/jiufen/n0.jpg`} photoAlt="九份老街">
          <InteractiveExploreMap city="九份" showThemeToggle={false} externalTheme={theme} defaultOpenTheme="九份老街" initialZoom={17} centerNorthOffsetKm={-0.1} />
        </MobileMapReveal>
      </div>

      <section className="jiufen-final-cta">
        <h2>把九份的故事，排進你的下一趟行程</h2>
        <p>在 Tripace 上探索景點、拖曳排入日程，規劃一趟屬於自己的東北角之旅。</p>
        <Link to="/app" className="jiufen-btn-primary">
          免費開始使用
        </Link>
      </section>

      <CityPageFooter />
    </div>
  );
}
