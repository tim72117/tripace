import { Helmet } from 'react-helmet-async';
import { ScrollTimeline } from './ScrollTimeline';
import './ScrollTimelineDemoPage.css';

// THUMB_BASE:時間軸圓形縮圖直接借用京都介紹頁(KyotoPage.tsx)既有的
// landing 圖片素材(同一個公開 GCS bucket)——這是示範頁,不需要另外準備
// 一組專屬縮圖,沿用已經在用的素材即可驗證「縮圖+點擊展開地圖」這個互動
// 本身。改用京都(而非原本的九份)是因為要示範「捲動切換錨點時地圖中心
// 跟著移動」這個效果,九份資料庫裡目前只有一個主題點(九份老街),不管
// 捲到哪個假錨點、地圖都只會停在同一個點,看不出中心點移動的效果;京都
// 有兩個真正的主題點(清水寺/八坂神社,見下方各錨點的 theme prop),才能
// 示範出中心點真的會隨錨點切換。
const THUMB_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing/kyoto';

// ScrollTimelineDemoPage:ScrollTimeline(見該檔案開頭說明)這個共用
// compound component 的其中一個呼叫端——這裡用假文案示範「文案自由
// 排版、只在想標記的地方插 <ScrollTimeline.Anchor>」這個新的使用方式。
// 2026-10 使用者明確要求從原本「丟一包 anchors[] 資料陣列」的寫法改成
// compound components,這個頁面因此直接把假文案寫成普通 JSX,不再維護
// 一份平行的資料陣列。路由 /demo/scroll-timeline,比照 /demo/pace 的
// 既有先例——內部驗證用的假資料展示頁,跟其餘正式行銷頁放同一層級。
//
// 之後要在某個主題介紹頁(九份/京都/台南等)加上同一套互動時,不需要
// 複製這個檔案的邏輯——該頁面只需要把 <ScrollTimeline city="..."
// defaultOpenTheme="...">包住自己的文案 JSX,在想標記成捲動錨點的地方
// 插入 <ScrollTimeline.Anchor id="..." thumb="..." theme="...">,並在
// 頁面自己的 CSS 作用域補上 --timeline-accent(指向該頁面既有的強調色
// 變數,見 ScrollTimelineDemoPage.css 對應規則的說明)即可——
// --paper/--ink/--ink-soft/--line/--card-shadow 這幾個 token 四個城市頁
// 本來就已經定義好,不需要額外處理。
export function ScrollTimelineDemoPage() {
  return (
    <div className="scroll-timeline-demo-page">
      <Helmet>
        <title>捲動時間軸示範 | Tripace</title>
      </Helmet>

      <header className="std-header">
        <span className="std-header-eyebrow">互動示範</span>
        <h1>隨捲動漸進顯示的時間軸</h1>
        <p>捲動右側文案，觀察左側時間軸如何只顯示目前錨點與其前後一點；點擊圓形縮圖可在右側展開地圖。</p>
      </header>

      <div className="std-page-body">
        {/* defaultOpenTheme="清水寺"——沒個別指定 theme 的錨點會退回這個值,
            這裡用不到(每個錨點都有自己的 theme),純粹示範這個 prop 的
            存在,呼應其他正式城市頁(JiufenPage.tsx 等)只有單一主題點、
            不需要逐一填 theme 的簡化寫法。 */}
        <ScrollTimeline city="京都" defaultOpenTheme="清水寺">
          <ScrollTimeline.Anchor id="stop-0" thumb={`${THUMB_BASE}/n1.jpg`} theme="清水寺" label="清水寺篇・起點">
            <h2>清水寺篇・起點</h2>
            <p>這是第一段示範文案，用來測試捲動進入這個錨點時，左側時間軸會不會正確只顯示「目前點」加上它的下一點（此時還沒有上一點）。文字長度刻意拉長一些，確保捲動的距離足夠讓 IntersectionObserver 有機會觸發，而不是一進頁面就同時看到兩個錨點都在可視範圍內。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-1" thumb={`${THUMB_BASE}/n2.jpg`} theme="清水寺" label="清水寺篇・續">
            <h2>清水寺篇・續</h2>
            <p>捲到這一段時，時間軸應該會滑動一格：上一點（起點）退到視窗左側、目前點（這一段）置中強調、下一點先預告但淡化顯示。這一段跟上一段共用同一個主題點（清水寺），用來驗證「同一個地點的相鄰錨點」不該讓地圖中心無意義地抖動——地圖應該維持原地不動，只有換到不同主題點時才會真的移動。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-2" thumb={`${THUMB_BASE}/n4.jpg`} theme="八坂神社" label="八坂神社篇">
            <h2>八坂神社篇</h2>
            <p>這是中間的段落，換成「八坂神社」這個不同的主題點——捲到這裡時，如果地圖面板是開著的，應該會看到地圖中心從清水寺平移到八坂神社，驗證「捲動切換錨點時地圖中心跟著即時移動」這個效果是否正常運作。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-3" thumb={`${THUMB_BASE}/n5.jpg`} theme="八坂神社" label="八坂神社篇・續">
            <h2>八坂神社篇・續</h2>
            <p>倒數第二段，同樣對應八坂神社，用來驗證視窗往後滑動時，前面的點是否正確地被隱藏，而不是單純疊加上去。文案長度維持跟其他段落接近，避免因為段落長短差異太大而讓觀察錨點的時間點變得不一致。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-4" thumb={`${THUMB_BASE}/n6.jpg`} theme="八坂神社" label="終點">
            <h2>終點</h2>
            <p>最後一段，用來驗證捲到最尾端時，時間軸只剩「上一點 + 目前點」（沒有下一點），視窗不會因為缺少下一點而出錯或留白過多。</p>
          </ScrollTimeline.Anchor>
        </ScrollTimeline>
      </div>
    </div>
  );
}
