import { Helmet } from 'react-helmet-async';
import { ScrollTimeline } from './ScrollTimeline';
import './ScrollTimelineDemoPage.css';

// THUMB_BASE:時間軸圓形縮圖直接借用九份介紹頁(JiufenPage.tsx)既有的
// landing 圖片素材(同一個公開 GCS bucket)——這是示範頁,不需要另外準備
// 一組專屬縮圖,沿用已經在用的素材即可驗證「縮圖+點擊展開地圖」這個互動
// 本身。
const THUMB_BASE = 'https://storage.googleapis.com/shuttle-tripace-web-assets/landing/jiufen';

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
        <ScrollTimeline city="九份" defaultOpenTheme="九份老街">
          <ScrollTimeline.Anchor id="stop-0" thumb={`${THUMB_BASE}/n0.jpg`} label="第一站的假標題">
            <h2>第一站的假標題</h2>
            <p>這是第一段示範文案，用來測試捲動進入這個錨點時，左側時間軸會不會正確只顯示「目前點」加上它的下一點（此時還沒有上一點）。文字長度刻意拉長一些，確保捲動的距離足夠讓 IntersectionObserver 有機會觸發，而不是一進頁面就同時看到兩個錨點都在可視範圍內。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-1" thumb={`${THUMB_BASE}/n1.jpg`} label="第二站的假標題">
            <h2>第二站的假標題</h2>
            <p>捲到這一段時，時間軸應該會滑動一格：上一點（起點）退到視窗左側、目前點（這一段）置中強調、下一點先預告但淡化顯示。這段文案同樣刻意拉長，模擬真實文案一個段落的閱讀長度，確保使用者停留在這個區塊的時間足夠觀察到時間軸的變化。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-2" thumb={`${THUMB_BASE}/n2.jpg`} label="第三站的假標題">
            <h2>第三站的假標題</h2>
            <p>這是中間的段落，上下都有鄰居錨點，用來驗證 3 點視窗規則在「非頭尾」情況下是否正常運作——時間軸應該同時看到上一點、目前點、下一點三者，而更早或更晚的點都不該出現在畫面上。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-3" thumb={`${THUMB_BASE}/n3.jpg`} label="第四站的假標題">
            <h2>第四站的假標題</h2>
            <p>倒數第二段，用來驗證視窗往後滑動時，前面的點是否正確地被隱藏，而不是單純疊加上去。文案長度維持跟其他段落接近，避免因為段落長短差異太大而讓觀察錨點的時間點變得不一致。</p>
          </ScrollTimeline.Anchor>

          <ScrollTimeline.Anchor id="stop-4" thumb={`${THUMB_BASE}/n4.jpg`} label="第五站的假標題">
            <h2>第五站的假標題</h2>
            <p>最後一段，用來驗證捲到最尾端時，時間軸只剩「上一點 + 目前點」（沒有下一點），視窗不會因為缺少下一點而出錯或留白過多。</p>
          </ScrollTimeline.Anchor>
        </ScrollTimeline>
      </div>
    </div>
  );
}
