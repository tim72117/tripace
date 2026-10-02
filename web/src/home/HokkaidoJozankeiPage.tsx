import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import { MobileMapReveal } from './MobileMapReveal';
import { ScrollHint } from './ScrollHint';
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons';
import { CityPageFooter } from './CityPageFooter';
import { useThemeToggle } from '../hooks/useThemeToggle';
import { useScrollProgress } from '../hooks/useScrollProgress';
import './HokkaidoJozankeiPage.css';

// HokkaidoJozankeiPage — 北海道・定山溪賞楓主題頁,見
// docs/research-hokkaido-jozankei-autumn-theme-2026-09.md 的完整說明。
// 2026-09:從「只有地圖+外殼骨架」升級成完整的捲動敘事頁(比照
// TainanChikanPage.tsx 的結構),補上 STOPS 陣列與進度點導覽——先寫
// 「簡單版」的旅遊攻略語氣文案(直接介紹景點特色,不像 KyotoPage.tsx/
// JiufenPage.tsx 走地形/歷史因果鏈敘事,對齊研究文件裡「文案語氣定案:
// 不用詩意修辭,回歸直接介紹式」的既有結論)。
//
// 圖片先用佔位圖(CLI attraction-add 建檔時 Pexels API 自動媒合的圖,
// 見 server/internal/geo 的補圖機制)——這批圖是用地點名稱關鍵字比對,
// 部分語意不夠精準(例如二見吊橋比對到的其實是山口縣角島大橋的照片,
// 不是紅色吊橋),先求版面效果能看,之後再視需要換成精準對應或正式
// 拍攝的照片,不逐張人工驗證语意匹配度。
//
// STOPS 只放 6 個精選點,不含主題點本身「定山溪溫泉」(對齊 JiufenPage.tsx/
// KyotoPage.tsx 的既有慣例:主題點只在地圖上逐點揭露,不重複佔一個
// 捲動站位)。排序依經度由西到東,對應溫泉街沿豐平川的實際步行動線:
// 二見吊橋(最西)→定山溪物產館→定山源泉公園→岩戸觀音堂→定山溪神社
// (最東)→Exclamation Bakery(山之風町獨立園區,溫泉街以北的延伸站,
// 排在最後當作散策尾聲的甜點站)。
const STOPS = [
  {
    index: '壱',
    kind: '地標',
    name: '二見吊橋',
    desc: '溫泉街散策路上最好認的地標——全長23公尺的紅色吊橋，站上橋面能俯瞰豐平川，還能望見「夫婦岩」與傳說中河童出沒的河童淵。吊橋是1880年接手溫泉經營的佐藤伊勢三所取名，紅葉季（10月中下旬到11月初）站在橋上拍照，兩岸楓紅配紅色吊橋，是這趟散策最經典的一張照片。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/1/13/%E5%AE%9A%E5%B1%B1%E6%B8%93%E4%BA%8C%E8%A6%8B%E5%90%8A%E6%A9%8B_%28Jozankei_Futami_suspension_bridge%29_-_panoramio.jpg',
    credit: 't-konno / Wikimedia Commons, CC BY-SA 3.0',
    layout: 'stacked',
  },
  {
    index: '弐',
    kind: '伴手禮',
    name: '定山溪物產館',
    desc: '1926年開業的溫泉饅頭老店，是散策途中最值得停下來的一站。每天早上現做的溫泉饅頭有黑糖、艾草兩種口味，常常中午前就賣完，想吃要趁早。店裡也賣手工醃菜跟各種河童主題的伴手禮——定山溪溫泉的吉祥物就是河童，這裡幾乎什麼都能買到河童造型商品。全年無休，早上8點開到晚上9點，散策前後都能順路逛。',
    photo: 'https://images.pexels.com/photos/36521756/pexels-photo-36521756.jpeg?auto=compress&cs=tinysrgb&h=1200&w=1600',
    credit: 'Pexels（示意圖，非定山溪物產館實景）',
    layout: 'side',
  },
  {
    index: '参',
    kind: '放鬆',
    name: '定山源泉公園',
    desc: '溫泉街中心、月見橋畔的免費足湯，不用門票、7點開到晚上9點，走累了隨時能坐下來泡腳。園內還有個特別的「溫玉之湯」——直接用公園裡80度以上的高溫源泉，自己動手煮一顆溫泉蛋，是很少見的親手體驗。公園裡立著溫泉發現者美泉定山的雕像，配上一旁的美泉瀑布，泡腳順便拍照兩不誤。',
    photo: 'https://images.pexels.com/photos/35588344/pexels-photo-35588344.jpeg?auto=compress&cs=tinysrgb&h=1200&w=1600',
    credit: 'Leila Chen / Pexels（示意圖，非定山源泉公園實景）',
    layout: 'stacked',
  },
  {
    index: '四',
    kind: '秘境',
    name: '岩戸觀音堂',
    desc: '這站比較特別——不是廟宇的正殿，是一座深120公尺的山洞，裡面安置了33尊觀音像。1936年為了紀念定山溪到小樽道路工程中殉職的工人而建，現在的洞窟本體是1967年重建的。近年因為獨特的洞窟景觀變成話題景點，民間傳說對考試、戀愛、生意興隆特別靈驗——如果散策途中想找個跟其他站完全不一樣的體驗，這裡值得繞進去看看。',
    photo: 'https://images.pexels.com/photos/32988332/pexels-photo-32988332.jpeg?auto=compress&cs=tinysrgb&h=1200&w=1600',
    credit: 'Pexels（示意圖，非岩戸觀音堂實景）',
    layout: 'side',
  },
  {
    index: '伍',
    kind: '信仰',
    name: '定山溪神社',
    desc: '1911年創立，供奉大己貴神、少彦名神等六柱神明，就在溫泉街步行圈內，散策途中順路就能參拜。不趕時間的話，每年9月10日的例祭日前後造訪，可以感受到在地溫泉鄉的節慶氣氛——平常日子造訪則是安靜、適合祈求旅途平安的小型神社。',
    photo: 'https://images.pexels.com/photos/32772917/pexels-photo-32772917.jpeg?auto=compress&cs=tinysrgb&h=1200&w=1600',
    credit: 'Pexels（示意圖，非定山溪神社實景）',
    layout: 'stacked',
  },
  {
    index: '陸',
    kind: '甜點',
    name: 'Exclamation Bakery',
    desc: '溫泉街以北「山之風町」園區裡的現烤麵包坊，用北海道產小麥、倶知安石川養雞場的雞蛋跟北海道奶油，每天新鮮出爐。最特別的是可以邊吃麵包邊泡免費足湯——散策一圈走累了，這裡很適合當作最後一站，坐下來歇腳、順便把肚子填飽。四季會更換顏色的大暖簾是找店的招牌標誌，營業到下午5點，別太晚才過來。',
    photo: 'https://images.pexels.com/photos/20752921/pexels-photo-20752921.jpeg?auto=compress&cs=tinysrgb&h=1200&w=1600',
    credit: 'Pexels（示意圖，非Exclamation Bakery實景）',
    layout: 'side',
  },
] as const;

// 跟 TainanChikanPage.tsx 一樣是試做/內部審閱用途,刻意不接 <Helmet>
// SEO meta/JSON-LD——這頁不會被搜尋引擎索引,也不打算被外部分享。
// 若這版定案要正式上線,除了換成精準/正式攝影的照片外,還需要補
// Helmet SEO meta,不是直接讓這個檔案「轉正」。
export function HokkaidoJozankeiPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();
  const mapIntroRef = useRef<HTMLDivElement | null>(null);
  const { activeIndex, stopRefs } = useScrollProgress(STOPS.length, mapIntroRef);

  return (
    <div className="hokkaido-jozankei-page" data-theme={theme ?? undefined}>
      <SiteNavBrand pageLabel="定山溪賞楓（試做）" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">立即開始</SiteNavCta>

      <header className="hokkaido-jozankei-hero">
        <span className="hokkaido-jozankei-hero-eyebrow">賞楓＋溫泉放鬆路線</span>
        <h1>定山溪溫泉街，紅葉季的步行散策路線</h1>
        <p>
          紅色吊橋、免費足湯、山洞觀音、現烤麵包——
          從西到東走一圈定山溪溫泉街，紅葉季最值得散步的六個停靠站。
        </p>
        <ScrollHint />
      </header>

      <nav className="hokkaido-jozankei-progress-rail" aria-label="站點進度">
        <button
          type="button"
          className={`hokkaido-jozankei-progress-dot${activeIndex === -1 ? ' is-active' : ''}`}
          onClick={() => mapIntroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到互動地圖"
          title="回到互動地圖"
        />
        {STOPS.map((stop, i) => (
          <button
            key={stop.name}
            type="button"
            className={`hokkaido-jozankei-progress-dot${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => stopRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`跳到「${stop.name}」`}
            title={stop.name}
          />
        ))}
      </nav>

      <section className="hokkaido-jozankei-stops">
        {STOPS.map((stop, i) => (
          <article
            className="hokkaido-jozankei-stop"
            key={stop.name}
            data-index={i}
            ref={(el) => { stopRefs.current[i] = el; }}
          >
            <div className={`hokkaido-jozankei-stop-inner hokkaido-jozankei-stop-inner--${stop.layout}`}>
              <div className="hokkaido-jozankei-stop-photo">
                <img src={stop.photo} alt={stop.name} loading="lazy" />
                <span className="hokkaido-jozankei-stop-credit">Photo: {stop.credit}</span>
              </div>
              <div className="hokkaido-jozankei-stop-text">
                <div className="hokkaido-jozankei-stop-meta">
                  <span className="hokkaido-jozankei-stop-index">{stop.index}</span>
                  <span className="hokkaido-jozankei-stop-kind">{stop.kind}</span>
                </div>
                <h2>{stop.name}</h2>
                <p>{stop.desc}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      {/* 互動地圖——2026-09:比照 TainanChikanPage.tsx 的順序放在分站
          列表結束、結尾 CTA 之前,讓使用者先看完文字介紹,再用地圖總覽
          6 個站點的實際地理分佈。 */}
      <div className="hokkaido-jozankei-map-intro" ref={mapIntroRef} data-index="-1">
        <MobileMapReveal photoUrl="https://images.pexels.com/photos/775201/pexels-photo-775201.jpeg?cs=srgb&fm=jpg&w=1600" photoAlt="定山溪紅葉">
          {/* initialZoom={17}:定山溪各地點經緯度跨度約 700-1000 公尺
              (見 CLI attraction-list 實測量測),聚落腹地比京都更小、跟
              九份接近,預設值(InteractiveExploreMap.tsx INITIAL_ZOOM=15)
              在這個尺度會顯得過遠,比照 JiufenPage.tsx 同樣理由拉近到
              17。 */}
          <InteractiveExploreMap city="定山溪" showThemeToggle={false} externalTheme={theme} defaultOpenTheme="定山溪溫泉" initialZoom={17} />
        </MobileMapReveal>
      </div>

      <section className="hokkaido-jozankei-final-cta">
        <h2>這是一版簡單版文案</h2>
        <p>
          6 個站點沿用 docs/research-hokkaido-jozankei-autumn-theme-2026-09.md
          的既有清單，文案先寫成直接介紹式的旅遊攻略語氣——若方向確認，
          下一步是換成精準對應或正式拍攝的照片。
        </p>
        <Link to="/" className="hokkaido-jozankei-btn-primary">
          回首頁
        </Link>
      </section>

      <CityPageFooter />
    </div>
  );
}
