import { Link } from 'react-router-dom'
import { trackEvent } from '../analytics'
import styles from './ExploreOtherCities.module.css'

// LANDING_ASSETS_BASE——城市介紹頁共用的 CDN 資源根目錄(見
// JiufenPage.tsx/KyotoPage.tsx/TainanPage.tsx 各自檔頭對這個常數的完整
// 說明:後端漸進補圖機制的固定素材,目錄格式固定
// landing/{城市 slug}/n{編號}.jpg)——這裡重複定義一份而非從某一頁
// import,是因為那幾個常數是各頁檔案私有的模組變數,沒有對外匯出;四頁
// 的值目前完全相同,重複一份字串常數的風險遠低於建立跨頁的匯出依賴。
const LANDING_ASSETS_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing'

// CityLink——「選一個地方，開始探索」卡片的最小資料形狀。photo 直接
// 沿用各城市頁自己當作 og:image/代表圖使用的同一張圖(見呼叫端各自的
// n0.jpg/n1.jpg 編號差異,四頁的檔名編號並未統一,故在 CITIES 常數裡
// 各自寫好完整網址,不嘗試從 slug 推導檔名)。
interface CityLink {
  slug: string
  path: string
  name: string
  desc: string
  photo: string
  photoAlt: string
}

// CITIES——四個主題介紹頁的卡片資料,文案沿用 HomePage.tsx 的
// DESTINATIONS 區塊(id="destinations",標題同樣是「選一個地方，開始
// 探索」)既有的城市名稱/一句話簡介,維持全站用詞一致,不是這裡重新
//發明一套不同的介紹文字。
const CITIES: CityLink[] = [
  {
    slug: 'kyoto',
    path: '/kyoto-kiyomizu',
    name: '日本 · 京都',
    desc: '清水寺、産寧坂、祇園——地形、信仰與人文交織的東山散策路線',
    photo: `${LANDING_ASSETS_BASE}/kyoto/n1.jpg`,
    photoAlt: '京都清水寺',
  },
  {
    slug: 'jiufen',
    path: '/jiufen',
    name: '台灣 · 九份',
    desc: '礦業興衰與人文重生的山城故事，老街、茶樓與海景交錯的散策路線',
    photo: `${LANDING_ASSETS_BASE}/jiufen/n0.jpg`,
    photoAlt: '九份老街',
  },
  {
    slug: 'tainan-anping',
    path: '/tainan-anping',
    name: '台灣 · 台南安平',
    desc: '港口地形、貿易與淤積轉型的故事，古堡、老街與老屋活化交織的散策路線',
    photo: `${LANDING_ASSETS_BASE}/tainan/n1.jpg`,
    photoAlt: '台南安平古堡',
  },
  {
    slug: 'tainan-chikan',
    path: '/tainan-chikan',
    name: '台灣 · 赤崁・府城',
    desc: '老地方的前世今生——歷史建築活化、住宿、景點與美食的兩日遊路線',
    // TainanChikanPage.tsx 的圖片素材走不同的 bucket/路徑(PHOTO_TAGGING_PREVIEW_BASE,
    // 見該檔案的完整說明),不是 LANDING_ASSETS_BASE/{slug}/n{編號}.jpg 這個
    // 格式,故這裡寫完整網址,不走上面 LANDING_ASSETS_BASE 組合。
    photo: 'https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan/IMG_9812.webp',
    photoAlt: '赤崁樓',
  },
]

// ExploreOtherCities——「選一個地方，開始探索」卡片區塊,放在結尾 CTA
// 之後、CityPageFooter 之前(使用者明確要求的位置),讓看完一個城市
// 介紹頁的使用者能順勢點進其他城市頁,而不是只能往下滑到頁尾或回首頁
// 重新選一次。
//
// 2026-10 新增,起點是 HomePage.tsx 的 DESTINATIONS 區塊(同樣標題「選
// 一個地方，開始探索」,但那裡是純文字列表,不含縮圖)——這裡使用者
// 明確要求卡片式(圖片+城市名+簡介),故新建獨立元件,不是重用首頁那個
// 文字列表的呈現方式,只沿用它的文案與標題。
//
// currentSlug:排除目前這一頁自己,不會列出「點了等於沒換頁」的卡片。
export function ExploreOtherCities({ currentSlug }: { currentSlug: CityLink['slug'] }) {
  const others = CITIES.filter((c) => c.slug !== currentSlug)
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.eyebrow}>更多目的地</div>
        <h2 className={styles.title}>選一個地方，開始探索</h2>
        <div className={styles.grid}>
          {others.map((city) => (
            <Link
              key={city.slug}
              to={city.path}
              className={styles.card}
              onClick={() => trackEvent('landing_destination_click', { destination: city.name, source: currentSlug })}
            >
              <img className={styles.photo} src={city.photo} alt={city.photoAlt} loading="lazy" />
              <div className={styles.body}>
                <span className={styles.name}>{city.name}</span>
                <span className={styles.desc}>{city.desc}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
