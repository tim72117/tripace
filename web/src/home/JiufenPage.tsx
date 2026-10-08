import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ScrollTimeline } from './ScrollTimeline';
import { ScrollHint } from './ScrollHint';
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons';
import { CityPageFooter } from './CityPageFooter';
import { ExploreOtherCities } from './ExploreOtherCities';
import { useThemeToggle } from '../hooks/useThemeToggle';
import { trackEvent } from '../analytics';
import { SITE_SEO_BASE_URL } from '../AppCommon';
import './JiufenPage.css';
import './ScrollTimelineContainer.css';

// SEO_TITLE/SEO_DESCRIPTION/SEO_URL:這個頁面專屬的文案。
// 2026-10 修正(兩輪):description/canonical/og:*/twitter:* 這幾個標籤
// 原本也透過下方 <Helmet> 直接蓋掉 index.html 裡首頁共用的預設值——但
// 實測(Search Console 即時測試工具的 HTML 分頁,看 Googlebot 真正渲染
// 後拿到的內容)發現 react-helmet-async 不會移除 index.html 裡原有的
// 靜態標籤,只會在旁邊追加一份自己管理的新標籤,導致 JS 渲染後 <head>
// 同時存在兩個互相矛盾的 <link rel="canonical">(一個指向首頁、一個
// 指向這個頁面),這本身是會讓 Google 直接忽略所有 canonical hint 的
// 錯誤訊號。改成這幾個標籤改由 server/cmd/server/seo_meta.go 的
// seoMetaByPath 統一輸出(唯一事實來源),不再經過下方 <Helmet> 宣告。
//
// 第二輪 code review 抓到:上一輪連 SEO_TITLE/<title> 也一併移除了,
// 這是過度修正——react-helmet-async 對 <title> 的實作是直接改寫
// document.title(單一值覆寫,不是像 meta/link 那樣用 DOM 插入新節點),
// 本來就不會出現「index.html 的 <title> 殘留 + Helmet 插入第二個
// <title>」這種重複衝突,只有 meta/link 標籤才有這個問題。拿掉
// <title> 會讓 SPA 內部換頁(例如從這頁點 ExploreOtherCities 的連結
// 連到京都頁)時分頁標題不會跟著更新、GA4 的 page_title 也會記錄成
// 錯誤的值——Googlebot 每次都是整頁重新載入,不受影響,但實際使用者
// 體感跟分析數據會受影響,故補回來。SEO_TITLE 現在只用於下方
// <Helmet><title>,不再用於 meta/og/twitter(那些由 server 端輸出)。
// SEO_DESCRIPTION/SEO_URL 仍用於下方 JSON-LD structured data(那個
// server 端沒有處理,仍交給前端動態生成)。內容必須跟 seo_meta.go 的
// seoMetaByPath["/jiufen"] 保持一致,修改其中一邊記得同步另一邊。
// 文案沿用首頁「目的地」列表區塊(HomePage.tsx)跟 sitemap.xml 既有
// 註解已經在用的同一句簡介,三處保持一致的措辭。
const SEO_TITLE = '九份——礦業興衰與人文重生的山城故事 | Tripace'
const SEO_DESCRIPTION = '從基隆山的地形限制，到金瓜石礦業的興衰，再到老街、茶樓與海景交錯的人文重生——跟著 Tripace 走一趟九份的散策路線，讀懂這座山城為何長成現在的樣子。'
const SEO_URL = `${SITE_SEO_BASE_URL}/jiufen`

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

// 2026-10 套用 ScrollTimeline(見該元件開頭的完整說明,改造範本是
// TainanPage.tsx/TainanChikanPage.tsx 的既有改造模式)取代原本
// 「獨立進度點 nav + 分站列表 + 頁尾固定地圖」三段各自獨立的結構——
// activeIndex/stopRefs/mapIntroRef 這整套 useScrollProgress 捲動進度
// 追蹤機制(連同開頭互動地圖 MobileMapReveal+InteractiveExploreMap)
// 因此不再需要,已從上方 import 移除(useScrollProgress hook 本身仍留著
// 給 KyotoPage.tsx 使用,不要誤刪該檔案)。
export function JiufenPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();

  return (
    <div className="jiufen-page" data-theme={theme ?? undefined}>
      <Helmet>
        {/* <title> 保留在這裡(見上方 SEO_TITLE 常數的完整說明)——
            react-helmet-async 對 title 是直接覆寫 document.title,不會
            跟 index.html 的靜態 <title> 重複/衝突,SPA 內部換頁時仍需要
            它才能正確更新分頁標題。description/canonical/og 與 twitter
            系列標籤已移除——這些是用 DOM 插入新節點、不會移除原有標籤,
            改由 server/cmd/server/seo_meta.go 的 seoMetaByPath 統一輸出。
            og:type/twitter:card 這兩個固定值(不隨頁面變化)本來就跟
            index.html 的首頁預設值相同,直接沿用、不需要個別頁面覆寫。
            JSON-LD 結構化資料——搜尋引擎（主要是 Google）讀這段來產生
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
        <title>{SEO_TITLE}</title>
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
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: `${SITE_SEO_BASE_URL}/` },
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
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'jiufen', position: 'nav' })}>立即開始</SiteNavCta>
      <SiteNavCta
        href="/product"
        variant="accent"
        slot="2-wide"
        onClick={() => trackEvent('landing_feature_intro_click', { page: 'jiufen' })}
      >
        功能介紹
      </SiteNavCta>

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

      {/* 2026-10 套用 ScrollTimeline(見該元件開頭的完整說明)取代原本
          「獨立進度點 nav + 分站列表 + 頁尾固定地圖區塊」三段各自獨立的
          結構——改成左側時間軸縮圖 + 右側可展開的嵌入式小地圖,隨捲動
          同步移動,文案本身完全不變(stop-inner/photo/meta/index/kind
          全部原樣保留,只是外層從 <section> 換成 <ScrollTimeline>,
          每一站從純 <article> 包一層 <ScrollTimeline.Anchor>)。
          useScrollProgress/mapIntroRef/stopRefs/MobileMapReveal 這整套
          捲動追蹤+地圖顯示機制因此不再需要,已從檔案開頭的 import 移除
          (做法對齊 TainanPage.tsx/TainanChikanPage.tsx 的既有改造模式)。
          defaultOpenTheme="九份老街":這個頁面唯一的主題點(對應原本
          InteractiveExploreMap 同樣只傳一個 defaultOpenTheme 的既有
          行為),當成共用退回值;theme/center prop 都不逐站填——8 站
          全部不是資料庫裡的獨立主題點,也沒有確切查證過的個別座標,
          跟 TainanPage.tsx(6 站各自有 center)/TainanChikanPage.tsx
          (8 站各自有 center)的多站各自定位情境不同,九份是最簡單的
          單一主題點情境,直接靠 defaultOpenTheme 這個共用退回值運作
          即可,不畫蛇添足幫每一站加 center 座標。
          initialZoom={17}/centerNorthOffsetKm={-0.1} 這兩個原本傳給
          InteractiveExploreMap 的校準 prop,ScrollTimeline 目前沒有
          對應的透傳介面(只有 mapRestrictRadiusKm 控制可拖曳範圍)——
          嵌入式小地圖本身只有 260px 高,這兩個原本針對「滿版大地圖」
          校準的參數不再適用,故省略不傳(同 TainanPage.tsx 這段註解的
          說明)。thumb 用每一站的 photo(跟原本 MobileMapReveal 只取
          n0.jpg 單一縮圖的既有慣例相比,現在每一站都各自有自己的時間軸
          縮圖)。 */}
      <div className="jiufen-stops scroll-timeline-container">
      <ScrollTimeline city="九份" accentColor="var(--vermilion)" defaultOpenTheme="九份老街">
        {STOPS.map((stop) => (
          <ScrollTimeline.Anchor
            key={stop.name}
            id={stop.name}
            thumb={stop.photo}
            label={stop.name}
          >
            <article className="jiufen-stop">
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
          </ScrollTimeline.Anchor>
        ))}
      </ScrollTimeline>
      </div>

      <section className="jiufen-final-cta">
        <h2>把九份的故事，排進你的下一趟行程</h2>
        <p>在 Tripace 上探索景點、拖曳排入日程，規劃一趟屬於自己的東北角之旅。</p>
        <Link
          to="/app"
          className="jiufen-btn-primary"
          onClick={() => trackEvent('landing_cta_click', { page: 'jiufen', position: 'final' })}
        >
          開始使用
        </Link>
      </section>

      <ExploreOtherCities currentSlug="jiufen" accentColor="var(--vermilion)" />

      <CityPageFooter accentColor="var(--vermilion)" />
    </div>
  );
}
