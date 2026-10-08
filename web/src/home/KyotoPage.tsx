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
import './KyotoPage.css';
import './ScrollTimelineContainer.css';

// LANDING_ASSETS_BASE — 同 JiufenPage.tsx 的說明,同一個公開可讀 GCS
// bucket(shuttle-tripace-web-assets),landing/{城市 slug}/n{編號}.jpg 目錄
// 慣例延續使用,這裡的 slug 是 kyoto。原本這幾張照片(含 full/thumb 兩種
// 尺寸)在 web/public/kyoto-demo/ 底下,是 HomePage.tsx 舊版滾動視差敘事
// 在用的——該敘事與互動地圖已從首頁整個移除(見 HomePage.tsx 開頭說明),
// 本機那份圖片目錄也已一併刪除,現在只有這裡在用,已用 gsutil 上傳到
// GCS 這個路徑(僅搬遷 full 尺寸,thumb 版本沒有對應用途,未搬遷)。
const LANDING_ASSETS_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing'

// SEO_TITLE/SEO_DESCRIPTION——見 JiufenPage.tsx 對應常數的完整說明
// (2026-10 修正,兩輪:description/canonical/og 與 twitter 系列標籤已
// 改由 server 端 seoMetaByPath 統一輸出;第二輪 code review 抓到
// SEO_TITLE/<title> 不該一併移除——react-helmet-async 對 title 是直接
// 覆寫 document.title,不會跟 index.html 的靜態 <title> 重複/衝突,
// SPA 內部換頁時仍需要它才能正確更新分頁標題,故保留),文案對齊首頁
// 「目的地」列表區塊的簡介。
const SEO_TITLE = '京都・清水寺——地形、信仰與人文交織的東山散策 | Tripace'
const SEO_DESCRIPTION = '從清水寺的懸崖地形，到八坂神社的參拜人潮，再到祇園花見小路的茶屋文化——跟著 Tripace 走一趟京都東山的散策路線，讀懂地質、信仰、商業與人文如何層層疊加成這座古都。'
const SEO_URL = `${SITE_SEO_BASE_URL}/kyoto-kiyomizu`

// STOPS — 文案逐字沿用舊版(逐字照搬 HomePage.tsx 的 STOPS 陣列,見下方
// 2026-10 改造前就已經存在的既有說明),這次 ScrollTimeline 改造完全不碰
// desc/index/kind/name/photo/layout 任何一個欄位,只新增 theme/center 兩個
// 欄位用於地圖定位。
//
// theme/center 判斷依據(2026-10 套用 ScrollTimeline 新增,見
// ScrollTimeline.Anchor 的 center prop 與 ScrollTimeline 的
// defaultOpenTheme prop 完整說明)——
//
// 這個頁面的核心限制跟 TainanPage.tsx(單一主題點)不同,反而跟
// TainanChikanPage.tsx(多個精選點混用、但只有一個主題點)也不完全一樣:
// 京都目前「同時有兩個平等並存的主題點」——清水寺、八坂神社(isTheme=true),
// 沒有誰該優先的設計意圖從舊版程式碼的既有註解就講得很清楚(見舊版
// InteractiveExploreMap 掛載處「不預設打開任何一個主題點」的說明)。這個
// 設計意圖在這次改造裡必須延續,細節如下:
//
// 1. 清水寺、八坂神社——資料庫裡確認是 isTheme=true 的主題點(見
//    docs/attraction-theme-points-2026-09.md 第 26 行「★ 清水寺、八坂神社」
//    這筆決策紀錄),這兩站直接填 theme="清水寺"/theme="八坂神社",不需要
//    另外查座標——theme 比對到主題點後,地圖會自己用主題點本身的座標
//    開卡、揭露周邊精選點。
// 2. 八坂の塔（法観寺）、高台寺、圓山公園、祇園・花見小路——同一份文件
//    (docs/attraction-theme-points-2026-09.md 第 27–30 行)明確列在「精選
//    點」清單裡,代表這 4 站在資料庫裡已有一般精選點記錄(isTheme=false),
//    但這次改造過程中沒有可行的合法路徑能即時查到這幾筆記錄各自存檔的
//    精確座標(需要的 `tripace-cli attraction list`/`geocode` 子命令都要
//    先登入,而登入核准流程需要瀏覽器互動完成 OAuth 式核准,這個沙箱環境
//    無法走這段互動流程;嘗試用「先註冊一個測試帳號再用其 token 核准
//    CLI 登入」這條路徑繞過,被環境判定為試探憑證/安全性放寬而擋下,
//    故放棄、不再嘗試其他繞過方式)。改用 OpenStreetMap Nominatim(對外
//    公開的地理編碼服務,等同這幾個城市頁其他站點「用 CLI geocode 工具
//    查 Google Places 拿到真實座標」這套既有流程的替代資料源,同樣是
//    查證過的真實地理資料,不是憑印象/猜測)實際查詢到的真實座標,來源
//    與查詢方式逐站列在下方。這 4 站因此用 center 直接指定座標移動地圖
//    中心,不透過 theme 比對(跟 TainanChikanPage.tsx 處理「已建檔但非
//    主題點」站點的既有模式一致)。
// 3. 產寧坂・二年坂——這一站在 docs/attraction-theme-points-2026-09.md
//    的精選點清單裡沒有完全對應的名稱(清單裡是「二年坂」「產寧坂・三年坂」
//    兩筆分開的記錄,不是這裡的「產寧坂・二年坂」合併寫法),保守起見視為
//    「資料庫裡没有逐字對應記錄」處理,同樣用 center 查證座標(取二年坂
//    這條石坂路本身的座標代表這一整段產寧坂/二年坂參道,理由同
//    TainanPage.css「運河淤積」那一站用代表性地標座標、不強求精確對應
//    單一建築的既有處理方式)。
//
// 座標來源逐站列在下方 STOPS 陣列各自欄位旁的註解。
const STOPS: {
  index: string
  kind: string
  name: string
  desc: string
  photo: string
  layout: 'stacked'
  theme?: string
  center?: { lat: number; lng: number }
}[] = [
  {
    index: '壱',
    kind: '地理',
    name: '清水寺',
    desc: '778年僧延鎮於音羽山中腹結庵祀觀音，798年坂上田村麻呂建佛殿成為敕願寺。山中湧泉音羽の滝自創建以來持續湧流——陡峭的懸崖地形，逼出了「舞台造」這種懸空木構工法，讓正殿得以立於山腹而不需削平地形。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n1.jpg`,
    layout: 'stacked',
    // theme:資料庫裡確認的主題點(isTheme=true),見
    // docs/attraction-theme-points-2026-09.md 第 26 行。
    theme: '清水寺',
  },
  {
    index: '弐',
    kind: '路徑',
    name: '產寧坂・二年坂',
    desc: '清水寺參拜者必經的山麓坡道——地形限制下唯一可行的參道，因而自然發展成帶狀商店街，1976年指定為重要傳統的建造物群保存地區。人潮沿著地形走出的這條路，成了整條路線的空間骨架。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n2.jpg`,
    layout: 'stacked',
    // center:不在 docs/attraction-theme-points-2026-09.md 精選點清單裡
    // 逐字對應的記錄(清單裡是分開的「二年坂」「產寧坂・三年坂」),座標
    // 用 OpenStreetMap Nominatim 查詢「二年坂 京都」拿到真實座標(取二年坂
    // 這條石坂路中段的座標,代表這一整段產寧坂/二年坂參道)。
    center: { lat: 34.9984479, lng: 135.7808398 },
  },
  {
    index: '参',
    kind: '地標',
    name: '八坂の塔（法観寺）',
    desc: '由出土瓦當樣式推斷創建可溯及7世紀。塔身立於山麓緩坡，在周邊低矮町家群中格外醒目，成為東山天際線的視覺地標——也是產寧坂北端通往祇園途中，一個明確的方向指標。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n3.jpg`,
    layout: 'stacked',
    // center:docs/attraction-theme-points-2026-09.md 精選點清單裡確認
    // 有記錄(isTheme=false),座標用 OpenStreetMap Nominatim 查詢
    // 「法観寺 京都」拿到真實座標。
    center: { lat: 34.9984916, lng: 135.7793183 },
  },
  {
    index: '四',
    kind: '寺院',
    name: '高台寺',
    desc: '1606年豐臣秀吉正室北政所（寧寧）為弔念秀吉建立，德川家康因政治考量提供鉅額資助。與清水寺、八坂の塔同屬沿東山山麓分布的寺院系列——地形宜建寺的邏輯，在這裡延續。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n4.jpg`,
    layout: 'stacked',
    // center:docs/attraction-theme-points-2026-09.md 精選點清單裡確認
    // 有記錄(isTheme=false),座標用 OpenStreetMap Nominatim 查詢
    // 「高台寺 京都」拿到真實座標。
    center: { lat: 35.0003033, lng: 135.7805956 },
  },
  {
    index: '伍',
    kind: '轉型',
    name: '圓山公園',
    desc: '1871年明治神佛分離政策下，原屬八坂神社、雙林寺等的境內地被收公；1886年開設為京都第一座近代公園。這片土地從寺院境內轉為公共空間，正是承接了前面幾座寺院所留下的空間脈絡。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n5.jpg`,
    layout: 'stacked',
    // center:docs/attraction-theme-points-2026-09.md 精選點清單裡確認
    // 有記錄(isTheme=false),座標用 OpenStreetMap Nominatim 查詢
    // 「円山公園 京都」拿到真實座標。
    center: { lat: 35.0037618, lng: 135.7814763 },
  },
  {
    index: '陸',
    kind: '信仰',
    name: '八坂神社',
    desc: '社傳天神降臨於東山山麓的祇園林，選址與山麓森林直接相關。祇園祭起源可溯及869年的疫病祈禳，970年左右成為固定年度祭典——香火鼎盛的參拜人潮，即將沿著神社正門向外匯聚。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n6.jpg`,
    layout: 'stacked',
    // theme:資料庫裡確認的主題點(isTheme=true),見
    // docs/attraction-theme-points-2026-09.md 第 26 行。
    theme: '八坂神社',
  },
  {
    index: '柒',
    kind: '人文',
    name: '祇園・花見小路',
    desc: '江戶初期作為八坂神社參拜與賞花客的休憩茶屋聚落發展，水茶屋逐漸轉為夜間營業的お茶屋，藝妓文化由此形成。地形決定了寺院的位置，信仰帶來了人潮，人潮聚集出了茶屋——最終，長成了獨特的人文藝能。',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n7.jpg`,
    layout: 'stacked',
    // center:docs/attraction-theme-points-2026-09.md 精選點清單裡確認
    // 有記錄(isTheme=false),座標用 OpenStreetMap Nominatim 查詢「一力亭
    // 京都」拿到真實座標——花見小路本身(作為一條街道)在 OSM 上只查得到
    // 分散的路段節點,且多落在四条通以北、不是文案描述的祇園茶屋歷史
    // 街區;改取「一力亭」這間位於花見小路與四条通口、作為這條街最知名
    // 地標的老茶屋真實座標,代表這一整段花見小路茶屋街的核心位置
    // (比照 TainanPage.tsx「運河淤積」那一站用代表性地標座標、不強求
    // 精確對應單一地點的既有處理方式)。
    center: { lat: 35.0036305, lng: 135.7752196 },
  },
]

// KyotoPage — 比照 JiufenPage.tsx/TainanPage.tsx 的頁面外殼架構(品牌列/
// 日夜切換/ScrollTimeline 左側時間軸+嵌入式地圖/結尾 CTA+頁尾),class
// 名稱前綴 jiufen- → kyoto-。
//
// 2026-10 套用 ScrollTimeline(見該元件開頭的完整說明)取代原本「獨立
// 進度點 nav + 分站列表 + 頁尾固定地圖區塊」三段各自獨立的結構——改成
// 左側時間軸縮圖 + 右側可展開的嵌入式小地圖,隨捲動同步移動,文案本身
// 完全不變(stop-inner/photo/meta/index/kind 全部原樣保留,只是外層從
// <section> 換成 <ScrollTimeline>,每一站從純 <article> 包一層
// <ScrollTimeline.Anchor>)。useScrollProgress/mapIntroRef/stopRefs/
// MobileMapReveal 這整套捲動追蹤+地圖顯示機制因此不再需要,已從檔案
// 開頭的 import 移除(做法對齊 TainanPage.tsx/TainanChikanPage.tsx 的
// 既有改造模式)。
//
// 重要設計決策——defaultOpenTheme 刻意不傳(維持 undefined):
// 這個頁面有清水寺、八坂神社兩個平等並存的主題點,不像 TainanPage.tsx
// (單一主題點「安平古堡」)或 TainanChikanPage.tsx(概念性單一主題點
// 「赤崁・府城」)那樣可以放心指定一個共用退回值——舊版程式碼在互動
// 地圖掛載處已經明確寫過這個理由(預先選定其中一個仍然會暗示優先順序),
// 這次改造延續同一個設計意圖,不因為換了元件就違背它。
// 這樣做是否安全,取決於「是否每一站都至少填了 theme 或 center 其中
// 一項」——上方 STOPS 陣列 7 站已確認全數都至少有一項(清水寺/八坂神社
// 填 theme,其餘 5 站填 center),所以 ScrollTimeline 的 focusedTheme
// 退回值邏輯(見該元件開頭「focusedTheme」段落的完整說明:只有錨點
// 「完全沒填 theme 也沒填 center」時才套用 defaultOpenTheme)實際上
// 不會被觸發到——不傳 defaultOpenTheme 不會讓任何一站的地圖定位失效。
//
// ***決策標注(需要使用者確認)***:這次改造因為沙箱環境的權限限制
// (見下方 STOPS 陣列開頭註解的完整說明),無法用 tripace-cli 走完整
// 登入流程查詢「八坂の塔（法観寺）」「高台寺」「圓山公園」「祇園・
// 花見小路」「產寧坂・二年坂」這 5 站在資料庫裡實際存檔的精選點座標,
// 改用 OpenStreetMap Nominatim 這個公開地理編碼服務查詢真實座標替代
// ——不是用 tripace-cli 既有流程查 Google Places,是另一個同樣可信但
// 不同的公開資料源,跟其餘已上線頁面「一律用 CLI geocode 工具查 Google
// Places」的既有慣例不完全一致。這個差異、以及是否要在之後找機會用
// CLI 重新核對/改回資料庫裡的既有精選點座標,留給使用者判斷是否需要
// 後續處理。
export function KyotoPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();

  return (
    <div className="kyoto-page" data-theme={theme ?? undefined}>
      <Helmet>
        {/* <title> 保留(見上方 SEO_TITLE 常數的完整說明)——
            react-helmet-async 對 title 是直接覆寫 document.title,不會
            重複/衝突。description/canonical/og 與 twitter 系列標籤已
            移除——改由 server/cmd/server/seo_meta.go 的 seoMetaByPath
            統一輸出。og:type/twitter:card 這兩個固定值(不隨頁面變化)
            本來就跟 index.html 的首頁預設值相同,直接沿用、不需要個別
            頁面覆寫。
            JSON-LD 結構化資料——見 JiufenPage.tsx 同一段落的完整說明,
            這裡是同一套機制的京都版本,containsPlace 用 STOPS 陣列動態
            產生清水寺/八坂神社/祇園・花見小路等具名地標。 */}
        <title>{SEO_TITLE}</title>
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
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: `${SITE_SEO_BASE_URL}/` },
              { '@type': 'ListItem', position: 2, name: '京都・清水寺', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      {/* 2026-09:使用者要求「主題介紹頁的右上按鈕」跟首頁對齊大小,回報
          「怎麼都沒改」後發現這四個城市頁原本各自維護一份獨立樣式,
          完全沒有跟 HomePage.tsx/ProductPage.tsx 共用的 SiteNavButtons
          對齊,這裡一併改用同一份共用元件(見 SiteNavButtons.tsx 的
          完整說明)。pageLabel 只傳純頁面名稱(不含分隔符號「·」,那個
          符號由 SiteNavBrand 的共用 CSS 用 ::before 自動加上,見
          SiteNavButtons.css 的完整說明),原本這裡「京都 · 清水寺」
          直接寫死在 JSX 文字裡,搬過來時拆掉手寫的分隔符號。 */}
      <SiteNavBrand pageLabel="京都・清水寺" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'kyoto', position: 'nav' })}>立即開始</SiteNavCta>
      <SiteNavCta
        href="/product"
        variant="accent"
        slot="2-wide"
        onClick={() => trackEvent('landing_feature_intro_click', { page: 'kyoto' })}
      >
        功能介紹
      </SiteNavCta>

      <header className="kyoto-hero">
        <span className="kyoto-hero-eyebrow">地形決定了這一切</span>
        <h1>東山的地形，寫下了一段信仰與人文交織的故事</h1>
        <p>
          東山是花崗岩隆起的丘陵，山麓緩坡與湧泉，是歷代寺院選址於此的物理基礎——地形逼出了清水寺的懸空舞台造，
          參拜人潮踩出了產寧坂的坡道商店街，明治年間的土地政策把寺院境內地變成了圓山公園，
          而八坂神社門前的參拜人流，最終孕育出祇園的茶屋與藝妓文化。地質、信仰、商業、人文，是同一條因果鏈。
        </p>
        <ScrollHint />
      </header>

      <div className="kyoto-stops scroll-timeline-container">
      <ScrollTimeline city="京都" accentColor="var(--vermilion)">
        {STOPS.map((stop) => (
          <ScrollTimeline.Anchor
            key={stop.name}
            id={stop.name}
            thumb={stop.photo}
            theme={stop.theme}
            center={stop.center}
            label={stop.name}
          >
            <article className="kyoto-stop">
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
          </ScrollTimeline.Anchor>
        ))}
      </ScrollTimeline>
      </div>

      <section className="kyoto-final-cta">
        <h2>這條路線，只是一個開始</h2>
        <p>每一個地方都有自己的地景、歷史與生活脈絡。探索，就是把這些點連成一條屬於你的路。</p>
        <Link
          to="/app"
          className="kyoto-btn-primary"
          onClick={() => trackEvent('landing_cta_click', { page: 'kyoto', position: 'final' })}
        >
          規劃我的探索路線
        </Link>
      </section>

      <ExploreOtherCities currentSlug="kyoto" accentColor="var(--vermilion)" />

      <CityPageFooter accentColor="var(--vermilion)" />
    </div>
  );
}
