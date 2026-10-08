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
import './TainanPage.css';
import './ScrollTimelineContainer.css';

// LANDING_ASSETS_BASE:見 JiufenPage.tsx 對應常數的完整說明,同一個公開
// 可讀 GCS bucket(shuttle-tripace-web-assets),landing/{城市 slug}/
// n{編號}.jpg 目錄慣例延續使用,這裡的 slug 是 tainan。STOPS 6 站現在
// 全數都有實際照片(安平古堡/億載金城/運河淤積轉折/安平樹屋/延平街
// 老街/海山館,依序對應 n1/n8/n2/n3/n4/n7),取自 Wikimedia Commons
// (CC BY-SA 3.0/CC BY-SA 4.0/公眾領域/CC BY-SA 2.0/CC BY-SA 4.0/
// CC BY-SA 3.0,各站 credit 見下方 STOPS 該欄位)。n5/n6 這兩個 GCS
// 物件(原分別對應已下架的 Meller墨樂咖啡、地理跳出安平區的神農街)
// 仍留在 bucket 裡未刪除,但目前沒有任何 STOPS 項目引用,不要誤用
// 這兩個編號;編號順序因此不連續(n1/n2/n3/n4/n7/n8),是刻意保留
// 歷史編號、不重新排序的結果,不是遺漏。
const LANDING_ASSETS_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing'

// SEO_TITLE/SEO_DESCRIPTION — 見 JiufenPage.tsx 對應常數的完整說明。
// 2026-10 修正(兩輪):description/canonical/og 與 twitter 系列標籤已
// 改由 server/cmd/server/seo_meta.go 的 seoMetaByPath 統一輸出(見該
// 檔案開頭的完整說明:react-helmet-async 不會移除 index.html 裡原有的
// 靜態標籤,只會在旁邊追加一份,導致 JS 渲染後同時存在兩個互相矛盾的
// canonical);第二輪 code review 抓到 SEO_TITLE/<title> 不該一併
// 移除——react-helmet-async 對 title 是直接覆寫 document.title,不會
// 重複/衝突,SPA 內部換頁時仍需要它才能正確更新分頁標題,故保留。
// SEO_DESCRIPTION/SEO_URL 仍用於下方 JSON-LD structured data(那個
// server 端沒有處理,仍交給前端動態生成)。內容必須跟 seo_meta.go 的
// seoMetaByPath["/tainan-anping"] 保持一致,修改其中一邊記得同步另一邊。
const SEO_TITLE = '台南・安平——荷蘭城堡與老街風土交織的港町故事 | Tripace'
const SEO_DESCRIPTION = '從熱蘭遮城的築城選址，到運河淤積後老街的重生，再到蜜餞、豆花、冬瓜茶交織的巷弄風土——跟著 Tripace 走一趟台南安平的散策路線，讀懂這座港町為何長成現在的樣子。'
const SEO_URL = `${SITE_SEO_BASE_URL}/tainan-anping`

// STOPS — 目前 6 筆,其中 5 筆(安平古堡/運河淤積轉折/安平樹屋/延平街
// 老街/海山館)取自資料庫已建檔的 attraction 資料(見 server/internal/
// api/geo_outline.go publicPlaceDetailsAllowlist 新增的台南段落,placeId
// 逐一對應);億載金城這一站是純敘事文字,對應景點目前不在資料庫/
// allowlist 裡,地圖上不會顯示對應的可點擊 marker。desc 文案是
// 仿照 JiufenPage.tsx/KyotoPage.tsx「地形/產業限制 → 路徑 → 人文」的因果鏈
// 敘事風格新寫的簡短版本(資料庫裡的 summary 欄位是給地圖資訊卡用的
// 一句話簡介,不足以撐起整頁的敘事段落,故這裡另外擴寫,核心史實
// 仍對齊資料庫 summary)。
//
// photo/credit 欄位目前 6 站全數已補上真實照片(見上方 LANDING_ASSETS_
// BASE 的完整說明)。photo?/credit? 顯式標成可選欄位(而非讓 TypeScript
// 從目前資料反推),是因為下方 JSX 仍保留「沒有 photo 時退回
// TainanPage.css .tainan-stop-photo-label 純色塊佔位」的分支——若不
// 顯式標可選,TypeScript 會因為現在剛好每一站都有 photo 而把該分支收窄
// 成 never、觸發型別錯誤(未來新增沒有照片的站點時,這個退回分支要能
// 繼續正常運作,不是死路徑)。
//
// center:2026-10 套用 ScrollTimeline 新增(見 ScrollTimeline.Anchor 的
// center prop 完整說明,用法比照 TainanChikanPage.tsx STOPS 的既有
// 模式)——這個頁面只有「安平古堡」是資料庫裡的主題點(isTheme=true),
// 其餘 5 站都不是,全部靠 center 直接指定座標移動地圖中心,不透過
// theme 比對。已在 attractions 資料庫的 4 站(安平古堡/安平樹屋/延平街
// /海山館——延平街沒有單獨建檔,座標取自 CLI geocode 實查;安平古堡/
// 安平樹屋座標取自資料庫記錄本身)+ 不在資料庫的 2 站(億載金城/運河
// 淤積與港口機能轉移——運河淤積是抽象轉折敘事沒有單一地標,座標取
// 「安平運河公園」代表港區淤積後的實際地理範圍)座標皆為 2026-10
// 用 CLI geocode 工具實查 Google Places 拿到的真實座標,不是憑印象
// 猜測。
const STOPS: {
  index: string
  kind: string
  name: string
  center: { lat: number; lng: number }
  desc: string
  layout: 'stacked'
  photo?: string
  credit?: string
}[] = [
  {
    index: '壱',
    kind: '地理',
    name: '安平古堡（熱蘭遮城）',
    // 座標取自資料庫「安平古堡」記錄(isTheme=true 的主題點本身)。
    center: { lat: 23.0015093, lng: 120.1606244 },
    desc: '1624年荷蘭東印度公司選址於此構築熱蘭遮城——台江內海的潟湖地形提供了天然良港，讓這裡成為全台最早的對外貿易據點。城堡本身是整條敘事的起點：先有港口，才有之後所有的聚落與商業發展。',
    layout: 'stacked',
    photo: `${LANDING_ASSETS_BASE}/tainan/n1.jpg`,
    credit: 'CEphoto, Uwe Aranas / Wikimedia Commons, CC BY-SA 3.0',
  },
  {
    index: '弐',
    kind: '防務',
    name: '億載金城（二鯤鯓砲臺）',
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標(查詢關鍵字「億載金城 台南」,比對到
    // 「二鯤鯓砲臺(億載金城)」)。
    center: { lat: 22.987883, lng: 120.159255 },
    desc: '1874年牡丹社事件後，清廷派沈葆楨來台籌辦海防，1876年建成全台第一座西式砲臺——法國工程師設計、以熱蘭遮城磚材混合洋式紅磚砌成，配備英國阿姆斯壯大砲。安平在失去港口地位之前，最後一次以軍事要地之姿站上歷史舞台。',
    layout: 'stacked',
    photo: `${LANDING_ASSETS_BASE}/tainan/n8.jpg`,
    credit: 'Aa940325 / Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    index: '参',
    kind: '轉折',
    name: '運河淤積與港口機能轉移',
    // 這一站是抽象的地質/產業轉折敘事,沒有對應單一地標——座標取「安平
    // 運河公園」(CLI geocode 查詢關鍵字「安平運河 台南」),代表淤積後
    // 港區機能轉移的實際地理範圍,比照赤崁頁「神農街」這類無單一地標
    // 站點的處理方式(用代表性地標座標,不是精確對應某棟建築)。
    center: { lat: 22.997428, lng: 120.1757359 },
    desc: '19世紀末台江內海逐漸淤積成陸，安平失去了深水港的地位，商業重心轉往台南市區——地質變遷直接改寫了這座聚落的角色，從貿易門戶轉為以老街生活機能為主的地方。',
    layout: 'stacked',
    photo: `${LANDING_ASSETS_BASE}/tainan/n2.jpg`,
    credit: '1930年代安平港景（作者不詳）/ Wikimedia Commons, Public Domain',
  },
  {
    index: '四',
    kind: '人文',
    name: '安平樹屋',
    // 座標取自資料庫「安平樹屋」記錄。
    center: { lat: 23.0038453, lng: 120.1598012 },
    desc: '老榕樹盤根錯節包覆廢棄倉庫建築，是港口機能外移後閒置空間被自然重新接管的具體見證——樹根與磚牆纏繞的樣貌，成了安平歷史軸線上最直觀的時間痕跡。',
    layout: 'stacked',
    photo: `${LANDING_ASSETS_BASE}/tainan/n3.jpg`,
    credit: 'Sun Taro / Wikimedia Commons, CC BY-SA 2.0',
  },
  {
    index: '伍',
    kind: '產業',
    name: '延平街與老街商業群聚',
    // 延平街本身不在 attractions 資料庫裡(資料庫只建檔了林永泰興蜜餞行
    // /同記安平豆花/義豐冬瓜茶這幾家老店個別記錄,沒有「延平街」這條街
    // 本身的記錄),座標是用 CLI geocode 工具查 Google Places 拿到的
    // 真實座標(查詢關鍵字「延平街 安平 台南」)。
    center: { lat: 23.0005548, lng: 120.1632351 },
    desc: '港口貿易帶來的人潮與財富，在老街兩側沉澱成百年老店群聚——林永泰興蜜餞行、同記安平豆花、義豐冬瓜茶，各自傳承數代，是安平從貿易港口轉型為生活聚落後，商業活動留下的具體痕跡。',
    layout: 'stacked',
    photo: `${LANDING_ASSETS_BASE}/tainan/n4.jpg`,
    credit: 'Chongkian / Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    index: '陸',
    kind: '重生',
    name: '海山館',
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標(查詢關鍵字「海山館 台南」)。
    center: { lat: 23.0014144, lng: 120.1626313 },
    desc: '清代福州海壇鎮標水師班兵會館，安平五館中唯一留存至今的一座——曾一度荒廢、轉為民宅，1975年由市府收購整建，現今開放參觀並展售文創商品，是安平巷弄裡另一種「老屋找到新角色」的具體見證，跟運河淤積後整座聚落的轉型軌跡一脈相承。',
    layout: 'stacked',
    photo: `${LANDING_ASSETS_BASE}/tainan/n7.jpg`,
    credit: 'Pbdragonwang / Wikimedia Commons, CC BY-SA 3.0',
  },
]

// TainanPage — 比照 JiufenPage.tsx 的頁面外殼架構(品牌列/日夜切換/
// ScrollTimeline 左側時間軸+嵌入式地圖/結尾 CTA+頁尾),class 名稱前綴
// 改 jiufen- → tainan-。跟 JiufenPage.tsx 一樣只有單一主題點(安平
// 古堡),故沿用同一套 defaultOpenTheme 退回值邏輯(見下方 ScrollTimeline
// 掛載處的完整說明),不像 KyotoPage.tsx 需要處理兩個平等並存的主題點。
export function TainanPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();

  return (
    <div className="tainan-page" data-theme={theme ?? undefined}>
      <Helmet>
        {/* <title> 保留在這裡——react-helmet-async 對 title 是直接覆寫
            document.title,單一值覆寫不會重複/衝突,SPA 內部換頁(例如從
            首頁點進這頁)時仍需要它才能正確更新分頁標題與 GA4 等工具讀到
            的頁面標題。description/canonical/og 與 twitter 系列標籤則已
            移除——那些是用 DOM insert 新節點、不會移除 index.html 原有的
            靜態標籤,兩份並存會互相矛盾(見上方 SEO_DESCRIPTION 常數的
            完整說明),改由 server/cmd/server/seo_meta.go 的 seoMetaByPath
            統一輸出。og:type/twitter:card 這兩個固定值(不隨頁面變化)
            本來就跟 index.html 的首頁預設值相同,直接沿用、不需要個別
            頁面覆寫。
            JSON-LD 結構化資料 — 見 JiufenPage.tsx 同一段落的完整說明,
            這裡是同一套機制的台南版本,server 端沒有處理,仍交給前端
            動態生成。 */}
        <title>{SEO_TITLE}</title>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TouristDestination',
            name: '台南・安平',
            description: SEO_DESCRIPTION,
            url: SEO_URL,
            image: `${LANDING_ASSETS_BASE}/tainan/n1.jpg`,
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
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: `${SITE_SEO_BASE_URL}/` },
              { '@type': 'ListItem', position: 2, name: '台南・安平', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      {/* 2026-09:使用者要求「主題介紹頁的右上按鈕」跟首頁對齊大小,回報
          「怎麼都沒改」後發現這四個城市頁原本各自維護一份獨立樣式,
          完全沒有跟 HomePage.tsx/ProductPage.tsx 共用的 SiteNavButtons
          對齊,這裡一併改用同一份共用元件(見 SiteNavButtons.tsx/
          JiufenPage.tsx 的完整說明)。 */}
      <SiteNavBrand pageLabel="台南・安平" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'tainan', position: 'nav' })}>立即開始</SiteNavCta>
      <SiteNavCta
        href="/product"
        variant="accent"
        slot="2-wide"
        onClick={() => trackEvent('landing_feature_intro_click', { page: 'tainan' })}
      >
        功能介紹
      </SiteNavCta>

      <header className="tainan-hero">
        <span className="tainan-hero-eyebrow">港口決定了這一切</span>
        <h1>安平的港口地形，寫下了一段貿易與重生的故事</h1>
        <p>
          潟湖地形帶來了荷蘭人的城堡，運河淤積又讓貿易重心轉移，最終在老街巷弄裡
          長出蜜餞、豆花與選物店交織的生活風土——這是一條地理、貿易、產業、人文交織的因果鏈。
        </p>
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
          (做法對齊 TainanChikanPage.tsx 的既有改造模式)。
          defaultOpenTheme="安平古堡":這個頁面唯一的主題點
          (isTheme=true),當成共用退回值;theme prop 不逐站填——6 站裡
          只有安平古堡本身是主題點,其餘 5 站(億載金城/運河淤積/安平
          樹屋/延平街/海山館)theme 比對不到東西,全部改用 center(見
          STOPS 陣列各站旁的座標來源註解)直接指定座標移動地圖中心。
          initialZoom/centerNorthOffsetKm 這兩個原本傳給
          InteractiveExploreMap 的校準 prop,ScrollTimeline 目前沒有
          對應的透傳介面(只有 mapRestrictRadiusKm 控制可拖曳範圍)——
          嵌入式小地圖本身只有 260px 高,縮放層級由地圖元件自己的預設值
          決定,這兩個原本針對「滿版大地圖」校準的參數不再適用,故省略
          不傳。thumb 用每一站的 photo(跟原本 MobileMapReveal 只取
          ANPING_FORT_PHOTO_URL 單一縮圖的既有慣例相比,現在每一站都
          各自有自己的時間軸縮圖)。 */}
      <div className="tainan-stops scroll-timeline-container">
      <ScrollTimeline city="台南" accentColor="var(--brick)" defaultOpenTheme="安平古堡">
        {STOPS.map((stop) => (
          <ScrollTimeline.Anchor
            key={stop.name}
            id={stop.name}
            thumb={stop.photo ?? ''}
            center={stop.center}
            label={stop.name}
          >
            <article className="tainan-stop">
              <div className={`tainan-stop-inner tainan-stop-inner--${stop.layout}`}>
                <div className="tainan-stop-photo">
                  {'photo' in stop ? (
                    <>
                      <img src={stop.photo} alt={stop.name} loading="lazy" />
                      <span className="tainan-stop-credit">Photo: {stop.credit}</span>
                    </>
                  ) : (
                    <span className="tainan-stop-photo-label">{stop.name}</span>
                  )}
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
          </ScrollTimeline.Anchor>
        ))}
      </ScrollTimeline>
      </div>

      <section className="tainan-final-cta">
        <h2>把安平的故事，排進你的下一趟行程</h2>
        <p>在 Tripace 上探索景點、拖曳排入日程，規劃一趟屬於自己的台南港町之旅。</p>
        <Link
          to="/app"
          className="tainan-btn-primary"
          onClick={() => trackEvent('landing_cta_click', { page: 'tainan', position: 'final' })}
        >
          開始使用
        </Link>
      </section>

      <ExploreOtherCities currentSlug="tainan-anping" accentColor="var(--brick)" />

      <CityPageFooter accentColor="var(--brick)" />
    </div>
  );
}
