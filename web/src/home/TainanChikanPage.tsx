import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import { MobileMapReveal } from './MobileMapReveal';
import { ScrollHint } from './ScrollHint';
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons';
import { CityPageFooter } from './CityPageFooter';
import { useThemeToggle } from '../hooks/useThemeToggle';
import { useScrollProgress } from '../hooks/useScrollProgress';
import './TainanChikanPage.css';

// TainanChikanPage — 赤崁文化園區「建築工法×職人技藝」混合敘事試做頁,
// 見 docs/research-tainan-chikan-craft-theme-2026-09.md 的完整說明。
// 這是純試做/內部審閱用途,刻意不做以下正式頁面(JiufenPage/KyotoPage)
// 才有的部分:
//   1. 不接 <Helmet> SEO meta/JSON-LD——這頁不會被搜尋引擎索引,也不
//      打算被外部分享,加這些沒有意義。
//   2. 圖片全部是 Pexels 示意圖(非台南實景),語意對應到每一站的
//      工法/技藝主題,不是實際地點照片——跟 JiufenPage.tsx 現有慣例
//      (多數站點也是示意圖,非九份實景)一致,這裡因為主題還在試做
//      階段、尚未安排正式拍攝,示意程度更高。
// 互動地圖(見下方)已接上真實資料——赤崁樓/祀典武廟/祀典大天后宮/
// 全美戲院/金得春捲/富盛號碗粿/林百貨這 7 個地點已建進 attractions
// 資料庫(2026-09,比照 docs/research-taiwan-attraction-candidates-2026-09.md
// 其餘 12 個主題的既有建檔流程),city="台南" 查回來的資料會跟既有
// TainanPage.tsx(安平老街,主題點:安平古堡)共用同一個城市查詢結果
// ——這是刻意的,兩個主題各自的主題點(赤崁樓/安平古堡)平等並存於
// 同一張地圖,使用者可以點開任一個看它對應的精選點,不是這個試做頁
// 獨占的專屬地圖。defaultOpenTheme="赤崁樓" 讓這個頁面一進來就先開好
// 赤崁樓這個主題點(對齊 JiufenPage.tsx 單一主題點城市的既有慣例),
// 不預先強制打開安平古堡。
// 若這版敘事定案要正式上線,除了地點已建檔外,還需要補上 Helmet SEO
// meta/正式攝影,不是直接讓這個檔案「轉正」。

// LANDING_ASSETS_BASE 不沿用——這版全部用 Pexels 直接連結(images.pexels.com),
// 不是這個專案自己的 GCS bucket 素材,故不比照 JiufenPage.tsx/KyotoPage.tsx
// 定義同名常數,避免暗示這些圖片走的是同一套正式素材管理流程。

// STOPS:6 個精選點,對應研究文件裡「建築工法」/「職人技藝」兩類交替
// 呈現的敘事設計(見文件的判準段落)——不再是「政治→信仰→商業」的
// 時間軸因果鏈,是「同一條路上能看到哪些工法/技藝」的空間並置敘事,
// kind 欄位直接標「建築工法」或「職人技藝」二選一,取代原本歷史版本
// kind 欄位裡「地形/起源/轉折」這種敘事階段標籤。
const STOPS = [
  {
    index: '壱',
    kind: '建築工法',
    name: '赤崁樓——一座樓，兩種工法',
    desc: '1653 年荷蘭人建普羅民遮城，地基是十七世紀荷式稜堡磚造結構；地面上的海神廟、文昌閣卻是清代重修的閩南式木構閣樓——兩種完全不同體系的工法疊在同一棟建築裡，不是政權更替的政治敘事，而是一場關於「怎麼疊上去的」建築考古懸念。',
    photo: 'https://images.pexels.com/photos/12476799/pexels-photo-12476799.jpeg?cs=srgb&fm=jpg&w=1600',
    credit: 'Serena Koi / Pexels（示意圖，非赤崁樓實景）',
    layout: 'stacked',
  },
  {
    index: '弐',
    kind: '建築工法',
    name: '祀典武廟——出磚入石的紅牆',
    desc: '緊鄰赤崁樓的紅牆，是傳統閩南廟宇「出磚入石」砌法的代表案例；馬背式屋脊、燕尾翹脊皆是清代官式廟宇工法的教材等級範本。不談祀典源流，只看磚石怎麼一塊一塊疊出這面全台灣最好認的紅牆。',
    photo: 'https://images.pexels.com/photos/34471014/pexels-photo-34471014.jpeg?cs=srgb&fm=jpg&w=1600',
    credit: 'Da Na / Pexels（示意圖，非祀典武廟實景）',
    layout: 'side',
  },
  {
    index: '参',
    kind: '建築工法',
    name: '祀典大天后宮——屋頂上的交趾陶',
    desc: '原明寧靖王府邸改建，木構架上的交趾陶、剪黏裝飾至今仍色彩鮮明。抬頭看屋脊，燕尾與馬背並存，是官建廟宇規格的視覺密碼——這一站不進殿參拜，只在廟埕抬頭看屋頂。',
    photo: 'https://images.pexels.com/photos/4369712/pexels-photo-4369712.jpeg?cs=srgb&fm=jpg&w=1600',
    credit: '竟傲 汤 / Pexels（示意圖，非祀典大天后宮實景）',
    layout: 'stacked',
  },
  {
    index: '四',
    kind: '職人技藝',
    name: '全美戲院——手繪半世紀的看板',
    desc: '全台僅存仍在使用手繪電影看板的戲院，國寶畫師顏振發近半世紀的手繪功力，是少數幾個能親眼看到職人現場作畫的場合。這裡看的不是電影，是一支畫筆怎麼在幾層樓高的看板上畫出一張臉。',
    photo: 'https://images.pexels.com/photos/4070403/pexels-photo-4070403.jpeg?cs=srgb&fm=jpg&w=1600',
    credit: 'Natã Romualdo / Pexels（示意圖，非全美戲院實景）',
    layout: 'side',
  },
  {
    index: '伍',
    kind: '職人技藝',
    name: '金得春捲・富盛號——手路菜現場',
    desc: '金得春捲 70 年老店，現場手工包入九種配料的潤餅皮製程；富盛號的長米碗粿與自製蒜蓉醬，也是站在攤前就能看到的手工現場。兩攤都不用等，站著看老闆的手怎麼動，比排隊等吃更值得。',
    photo: 'https://images.pexels.com/photos/34674806/pexels-photo-34674806.jpeg?cs=srgb&fm=jpg&w=1600',
    credit: '大董 / Pexels（示意圖，非金得春捲/富盛號實景）',
    layout: 'stacked',
  },
  {
    index: '陸',
    kind: '建築工法',
    name: '林百貨——興亞式建築的外牆',
    desc: '1932 年南台灣第一間百貨，全台唯一設神社的百貨建築。外牆磁磚與洗石子工法是昭和時期常民建築技術的範本——跟赤崁樓的荷式磚造、武廟的出磚入石，剛好是這條路上第三種截然不同的建築語彙。',
    photo: 'https://images.pexels.com/photos/30183034/pexels-photo-30183034.jpeg?cs=srgb&fm=jpg&w=1600',
    credit: 'Hamdi Kılınç / Pexels（示意圖，非林百貨實景）',
    layout: 'side',
  },
] as const;

export function TainanChikanPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();
  // mapIntroRef 對齊 JiufenPage.tsx/KyotoPage.tsx 的既有命名——現在真的
  // 掛了互動地圖區塊(見下方),不再是觀察 hero 本身,activeIndex 的 -1
  // 特殊值對應地圖容器。
  const mapIntroRef = useRef<HTMLDivElement | null>(null);
  const { activeIndex, stopRefs } = useScrollProgress(STOPS.length, mapIntroRef);

  return (
    <div className="tainan-chikan-page" data-theme={theme ?? undefined}>
      {/* 2026-09:使用者要求「主題介紹頁的右上按鈕」跟首頁對齊大小,回報
          「怎麼都沒改」後發現這四個城市頁原本各自維護一份獨立樣式,
          完全沒有跟 HomePage.tsx/ProductPage.tsx 共用的 SiteNavButtons
          對齊,這裡一併改用同一份共用元件(見 SiteNavButtons.tsx/
          JiufenPage.tsx 的完整說明)。 */}
      <SiteNavBrand pageLabel="赤崁工法巡禮（試做）" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">立即開始</SiteNavCta>

      <header className="tainan-chikan-hero">
        <span className="tainan-chikan-hero-eyebrow">不是歷史故事，是一條看工法的路</span>
        <h1>赤崁樓到林百貨，六種工法與手藝疊在同一條路上</h1>
        <p>
          這裡不談政治行政中心如何變成信仰核心、再變成庶民市集——
          只帶你看荷式城堡地基、閩南出磚入石、交趾陶剪黏、手繪看板、
          手工潤餅、興亞式洗石子外牆，六種時代語彙怎麼並存在同一條路上。
        </p>
        <ScrollHint />
      </header>

      {/* 2026-09:使用者要求把開頭互動地圖從頁面最頂端搬到分站列表結束、
          結尾 CTA 之前(見下方 .tainan-chikan-map-intro 掛載處的完整
          說明)——「回到互動地圖」這顆進度點原本排在最前面,現在改排在
          最後面(STOPS 之後),對齊地圖搬移後的新視覺順序。 */}
      <nav className="tainan-chikan-progress-rail" aria-label="站點進度">
        {STOPS.map((stop, i) => (
          <button
            key={stop.name}
            type="button"
            className={`tainan-chikan-progress-dot${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => stopRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`跳到「${stop.name}」`}
            title={stop.name}
          />
        ))}
        <button
          type="button"
          className={`tainan-chikan-progress-dot${activeIndex === -1 ? ' is-active' : ''}`}
          onClick={() => mapIntroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到互動地圖"
          title="回到互動地圖"
        />
      </nav>

      <section className="tainan-chikan-stops">
        {STOPS.map((stop, i) => (
          <article
            className="tainan-chikan-stop"
            key={stop.name}
            data-index={i}
            ref={(el) => { stopRefs.current[i] = el; }}
          >
            <div className={`tainan-chikan-stop-inner tainan-chikan-stop-inner--${stop.layout}`}>
              <div className="tainan-chikan-stop-photo">
                <img src={stop.photo} alt={stop.name} loading="lazy" />
                <span className="tainan-chikan-stop-credit">Photo: {stop.credit}</span>
              </div>
              <div className="tainan-chikan-stop-text">
                <div className="tainan-chikan-stop-meta">
                  <span className="tainan-chikan-stop-index">{stop.index}</span>
                  <span className="tainan-chikan-stop-kind">{stop.kind}</span>
                </div>
                <h2>{stop.name}</h2>
                <p>{stop.desc}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      {/* 互動地圖——2026-09:使用者要求把這個區塊從頁面最頂端搬到這裡,
          分站列表結束、結尾 CTA 之前。讓你可以直接看這 7 個地點(赤崁樓/
          祀典武廟/祀典大天后宮/全美戲院/金得春捲/富盛號碗粿/林百貨)
          的實際地理分佈——三座國定古蹟(赤崁樓/武廟/大天后宮)在百公尺
          內,全美戲院/金得春捲/富盛號沿民族路/國華街步行可達,林百貨
          稍遠一點在中正路口,地圖上可以直接看出這個「廣場放射」型動線
          跟九份/京都那種單一坡道動線的差異。
          defaultOpenTheme="赤崁樓":這個試做頁只關心赤崁樓這個主題點,
          一進頁面就先開好,不用使用者自己點(對齊 JiufenPage.tsx 單一
          主題點城市的既有慣例)——即使同一次查詢也會查到安平古堡(見
          檔案開頭的完整說明),地圖上兩個主題點都會顯示,但只有赤崁樓
          預先展開。data-index="-1" 手寫在 JSX 上(不像其餘三頁完全
          依賴 useScrollProgress hook 動態補上)——這是既有寫法,hook
          掛載時會再次執行 setAttribute 覆蓋成同樣的值,冗餘但無害,
          搬移位置不影響這個機制,故保留原樣不動。 */}
      <div className="tainan-chikan-map-intro" ref={mapIntroRef} data-index="-1">
        <MobileMapReveal photoUrl={STOPS[0].photo} photoAlt="赤崁樓">
          <InteractiveExploreMap city="台南" showThemeToggle={false} externalTheme={theme} defaultOpenTheme="赤崁樓" />
        </MobileMapReveal>
      </div>

      <section className="tainan-chikan-final-cta">
        <h2>這是一版敘事試做</h2>
        <p>
          6 個地點沿用 docs/research-tainan-attraction-candidates-2026-09.md
          的既有清單，敘事換成建築工法×職人技藝混合版本——若方向確認，
          下一步是把地點建進資料庫，才能接上真正的互動地圖。
        </p>
        <Link to="/" className="tainan-chikan-btn-primary">
          回首頁
        </Link>
      </section>

      <CityPageFooter />
    </div>
  );
}
