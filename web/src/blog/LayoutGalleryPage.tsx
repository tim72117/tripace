import './BlogArticle.css'
import styles from './LayoutGalleryPage.module.css'

// LayoutGalleryPage:開發用的版型目錄頁(2026-10 新增)——使用者要求
// 「製作一個獨立頁面,陳列所有版型搭配」,方便編排文章時快速比對
// BlogArticle.css 目前實際支援哪些版型、長什麼樣子,不用每次都翻
// types.ts 的 JSDoc 或到真實文章裡試。
//
// 不複用 BlogArticlePage.tsx 的 renderBlock/renderImageBlock/
// renderGalleryBlock——那些函式吃的是真實的 PublicUploadedPhoto
// (透過 photoMap 查詢,需要打後端 API),這個頁面刻意不依賴任何真實
// 照片/API 查詢(使用者要求「都用骨架圖跟範例文字呈現」),純粹是
// BlogArticle.css 既有 class/data-* 選擇器的靜態展示,所以這裡直接
// 手刻跟渲染函式輸出結構相同的 JSX,img 的 src 固定指向
// SKELETON_IMG(見下方)。
//
// 這是開發工具頁,不是產品功能——路由刻意不加進任何站內導覽/連結,
// 只能直接輸入網址 /dev/layouts 訪問(對齊 server/cmd/server/static.go
// knownRoutePatterns 的註冊方式,見該檔案的完整說明:新增路由都要
// 同步這份清單,否則正式環境直接重新整理這個網址會 404)。
//
// SKELETON_IMG:純前端 inline SVG data URI 當骨架圖——不打 GCS 或任何
// 外部網址,純色塊背景+對角線,語意上清楚傳達「這裡是圖片佔位,不是
// 真實內容」,同時仍是一個真正的 <img src>,能正確吃到 BlogArticle.css
// 既有的 aspect-ratio/object-fit/data-orientation 等選擇器規則(骨架圖
// 本身的寬高比不重要,CSS 的 aspect-ratio 會接管实际呈現比例)。
const SKELETON_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
      <rect width="800" height="600" fill="#d8d2c4"/>
      <path d="M0 0 L800 600 M800 0 L0 600" stroke="#c4bca9" stroke-width="6"/>
    </svg>`,
  )

// SAMPLE_TEXT:範例文字,跟 docs/blog-article-content skill 裡的版型
// 目錄一一對應,段落長度刻意區分「夠長能撐起繞排」與「太短只適合
// overlayText」兩種情境,呼應 2026-10 文繞排試做失敗(短段落配 float
// 底下留一片空白)後新增 overlayText 的完整緣由。
const LONG_PARAGRAPH =
  '沿著石階一路往上,紅燈籠一盞接一盞亮起,照出斑駁的磚牆跟窄巷裡攢動的人影。賣芋圓的小店飄出陣陣甜香,茶樓二樓傳來隱約的絲竹聲,混著遊客的交談聲跟相機快門聲,構成九份夜裡最鮮明的記憶片段。這種氛圍很難用三言兩語說清楚,得親自走過一趟才能體會那種時間感被拉長、步調刻意放慢的奇妙感覺。'
const SHORT_PARAGRAPH = '下山的路上回頭看了一眼,整座山城在夜色裡亮著。'

function SkeletonFigure({ caption, orientation }: { caption?: string; orientation?: 'landscape' | 'portrait' }) {
  return (
    <figure>
      <img src={SKELETON_IMG} alt="" data-orientation={orientation} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionNote}>{note}</p>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

export function LayoutGalleryPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>版型目錄</h1>
        <p>
          開發用頁面,陳列 BlogArticle.css 目前支援的所有版型組合,骨架圖+範例文字,不依賴真實照片或後端資料。
          對應的資料欄位組合見每個版型下方的標注,完整挑選依據見 .claude/skills/blog-article-content/SKILL.md。
        </p>
      </header>

      <Section title="Gallery · grid(預設)" note="GalleryBlock, layout: 'grid'——第一張大圖+其餘固定 2 欄小圖,適合 2~4 張、無特別強調的站點照片。">
        <div className="theme-page-demo-stop-gallery">
          <SkeletonFigure caption="主圖(第一張,較寬比例)" />
          <SkeletonFigure caption="小圖" />
          <SkeletonFigure caption="小圖" />
        </div>
      </Section>

      <Section title="Gallery · row(密集小圖)" note="GalleryBlock, layout: 'row'——取消主圖大小分層,統一縮小、一列排更多張,適合 ≥5 張的站點,避免版面被拉得很長。">
        <div className="theme-page-demo-stop-gallery" data-layout="row">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonFigure key={i} />
          ))}
        </div>
      </Section>

      <Section title="Image · 直式比例(data-orientation=&quot;portrait&quot;)" note="ImageBlock/GalleryBlock items[], orientation: 'portrait'——直式原圖改走 1/1.5 比例(跟 PhotoFocalEditor 裁切框一致),非橫式裁切。">
        <div className="theme-page-demo-stop-gallery theme-page-demo-stop-gallery--single">
          <SkeletonFigure caption="直式單圖" orientation="portrait" />
        </div>
      </Section>

      <Section title="Image · wide(較寬出血)" note="ImageBlock, width: 'wide'——突破內文欄寬,相對容器放大,適合想要比一般內文更有存在感、但不到滿版的單張照片。">
        <div className="theme-page-demo-stop-gallery" data-width="wide">
          <SkeletonFigure />
        </div>
      </Section>

      <Section title="Image · full(滿版出血)" note="ImageBlock, width: 'full'——最大出血幅度,適合構圖完整、適合獨立成作品看待的代表照(例如空景、地標遠景)。">
        <div className="theme-page-demo-stop-gallery" data-width="full">
          <SkeletonFigure />
        </div>
      </Section>

      <Section
        title="Image · 文繞排(column + float)"
        note="ImageBlock, width: 'column', float: 'left'/'right'——圖片靠一側、後續段落繞排。前提:緊接其後的文字段落要夠長(至少約 120 字以上),太短會造成文字繞沒幾行就結束、圖片底下一片空白(2026-10 實機踩過這個坑)。"
      >
        <div>
          <div className="theme-page-demo-stop-gallery" data-float="right">
            <SkeletonFigure />
          </div>
          <p className="theme-page-demo-paragraph">{LONG_PARAGRAPH}</p>
        </div>
      </Section>

      <Section
        title="Image · overlayText(疊字)"
        note="ImageBlock, overlayText——文字直接疊在圖片上(深色漸層遮罩+白字置中),不依賴「文字要夠長」的前提,適合短句、氛圍感強的收尾照片。跟 width/float 互斥,overlayText 存在時忽略 width/float。"
      >
        <div className="theme-page-demo-image-overlay">
          <img src={SKELETON_IMG} alt="" />
          <p className="theme-page-demo-image-overlay-text">{SHORT_PARAGRAPH}</p>
        </div>
      </Section>

      <Section title="Hero · 背景疊字(heroPhotoId)" note="ThemePageContent.heroPhotoId——Hero 區塊整個疊在全寬背景圖上,深色漸層遮罩+白色文字。跟下面的 heroStandalonePhotoId 是兩種獨立呈現,可以同時使用不同照片。">
        <header className="theme-page-demo-hero" data-hero-photo="true" style={{ position: 'relative' }}>
          <img className="theme-page-demo-hero-bg" src={SKELETON_IMG} alt="" aria-hidden="true" />
          <div className="theme-page-demo-hero-content">
            <span className="theme-page-demo-hero-eyebrow">範例 EYEBROW</span>
            <h1>範例標題</h1>
            <p>範例導言文字,說明這篇文章的主題與基調。</p>
          </div>
        </header>
      </Section>

      <Section title="Hero · 下方定場大圖(heroStandalonePhotoId)" note="ThemePageContent.heroStandalonePhotoId——標題區塊下方的獨立全幅大圖,呼應傳統遊記開頭放一張代表照的版面,不疊字。">
        <div className="theme-page-demo-hero-standalone">
          <img src={SKELETON_IMG} alt="" />
        </div>
      </Section>
    </div>
  )
}
