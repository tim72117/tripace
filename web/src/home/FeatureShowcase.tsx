import { Wand2, Layers, CalendarClock } from 'lucide-react';
import { ThemePointDemo } from './ThemePointDemo';
import { TimelineDemo } from './TimelineDemo';
import { AiPlanPhoneDemo } from './AiPlanPhoneDemo';
import { trackEvent } from '../analytics';
// 樣式仍住在 ProductPage.css(.product-features / .product-feature-card
// 那組,連同三個展示元件各自的規則)——由這個共用元件自己 import,
// 呼叫端(HomePage/ProductPage)不需要知道樣式放在哪個檔案,也不會因為
// 忘了 import 而渲染出沒有樣式的裸卡片。
//
// 沒有把那段 CSS 搬成獨立檔案:class 名稱全部以 product- 開頭,搬動要
// 連帶改名才名實相符,而改名會波及 ProductPage.css 裡其餘共用這些
// 前綴的規則。留在原處、由這裡 import,是改動範圍最小的做法。
import './ProductPage.css';

// FeatureShowcase — 三個核心功能的卡片區塊,每張卡片各自帶一個小展示
// (主題點示意圖/時間軸飛入動畫/手機版 AI 規劃畫面)。
//
// 2026-10 從 ProductPage.tsx 抽出來成為共用元件:使用者明確要求「將功能
// 介紹的小展示放到首頁,開始探索與目的地中間」——首頁(HomePage)與功能
// 介紹頁(ProductPage)現在都渲染這一份,不再是兩邊各自維護一份卡片結構
// 與展示元件的接線。日後要調整卡片內容/新增一張,只需要改這裡。
//
// page prop 的存在理由:卡片內的追蹤事件要能分辨使用者是從首頁還是功能
// 介紹頁點的(landing_cta_click 的 page 欄位),兩邊的轉換率本來就該分開
// 看——首頁的訪客多半還在認識產品,功能介紹頁的則已經主動想了解細節。

const FEATURES = [
  {
    // 2026-09:「自動編排行程」改名為「AI編排行程」並移到第一個位置
    // （使用者明確要求），同時拿掉原本的「即將推出」徽章——不再是未上線
    // 的試做功能，比照另外兩張卡片的正式項目對待。icon 維持 Wand2
    // (魔杖,「自動生成/一鍵搞定」語意),避免跟「時間軸排程」的
    // CalendarClock(時鐘,強調時間刻度本身)、「主題景點」的 Layers
    // (圖層堆疊,強調空間分層)撞語意。
    icon: Wand2,
    title: 'AI編排行程',
    description: '描述你的旅行需求，AI 自動把景點排成一份完整的每日時間軸行程。',
  },
  {
    icon: Layers,
    title: '主題景點',
    description: '找景點沒有方向？點開主題點，就能看到周邊精心挑選的店家與景點。',
  },
  {
    icon: CalendarClock,
    title: '時間軸排程',
    description: '把景點排入每天的時間軸，安排順序，一眼掌握整趟旅程的節奏。',
  },
] as const;

export function FeatureShowcase({
  dark,
  page,
  title = '核心功能',
}: {
  // dark:目前是不是深色模式——兩個展示元件(ThemePointDemo/TimelineDemo)
  // 是手繪的假示意圖,配色不走 CSS 變數,需要呼叫端把主題狀態傳進來。
  dark: boolean;
  // page:追蹤事件用的頁面識別('home' | 'product'),見上方說明。
  page: string;
  // title:區塊標題。首頁放在「開始探索」與目的地清單之間,用的標題跟
  // 功能介紹頁的「核心功能」可以不同——呼叫端自己決定,預設沿用原本的。
  title?: string;
}) {
  return (
    <section className="product-features">
      <h2 className="product-section-title">{title}</h2>
      <div className="product-features-grid">
        {FEATURES.map(({ icon: Icon, title: cardTitle, description }) => (
          <div className="product-feature-card" key={cardTitle}>
            <div className="product-feature-icon">
              <Icon size={22} />
            </div>
            <h3>{cardTitle}</h3>
            <p>{description}</p>
            {/* ThemePointDemo:只在「主題景點」這張卡片內渲染(見上方
                FEATURES 陣列的 Layers icon 那筆)——文字說明「點開
                主題點,就能看到周邊精選店家」這句話本身仍是抽象敘述,
                這裡用一個假地圖示意圖具體演示:中央大圓圈是主題點,
                周圍散布的小點是精選點,純靜態展示(不含任何按鈕/
                互動)——不是接真實 Google Maps(不需要,這裡純粹示範
                「主題點揭露精選點」這個產品概念本身,跟任何真實城市/
                資料庫內容無關),見 ThemePointDemo.tsx 的完整說明。
                用 title 字串比對挑出這一張卡片,而非把 FEATURES 拆成
                「主題景點」與「其餘」兩份陣列分開處理——FEATURES 的
                渲染順序、其餘兩張卡片的結構完全不受影響,只有這一張
                卡片額外多渲染一段內容,改動範圍最小。
                TimelineDemo:同樣邏輯,只在「時間軸排程」卡片內渲染
                ——地圖上依序點選候選景點、依序飛入右側時間軸時段格
                的假動畫,見 TimelineDemo.tsx 的完整說明。
                AiPlanPhoneDemo:同樣邏輯,只在「AI編排行程」卡片內渲染
                ——模擬手機外框內顯示固定手機版面的展示畫面
                (AiPlanPhoneDemoScreen,不用 iframe),見 AiPlanPhoneDemo.tsx
                的完整說明。 */}
            {cardTitle === '主題景點' && <ThemePointDemo dark={dark} />}
            {cardTitle === '時間軸排程' && <TimelineDemo dark={dark} />}
            {/* 點整支手機連到 /ai-plan 完整展示(站內路由,故用 <Link>,見
                AiPlanPhoneDemo.tsx)。取代原本的「觀看展示」按鈕。 */}
            {cardTitle === 'AI編排行程' && (
              <AiPlanPhoneDemo
                onClick={() => trackEvent('landing_cta_click', { page, position: 'feature-ai-plan' })}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
