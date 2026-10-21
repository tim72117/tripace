import { Link } from 'react-router-dom';
import { AiPlanPhoneDemoScreen } from './AiPlanPhoneDemoScreen';
import styles from './AiPlanPhoneDemo.module.css';

// AiPlanPhoneDemo:自足的「AI 編排行程」展示元件——模擬 iPhone 外框內顯示
// 展示畫面,任何頁面直接 <AiPlanPhoneDemo /> 即可使用。外框造型沿用錄製
// 工具的 iPhone 外框(鈦金屬邊框、黑色 bezel、動態島、側邊按鈕)。
//
// 2026-10(方案 B,使用者明確確認「試做B我試試看效果」)改用
// AiPlanPhoneDemoScreen 直接渲染,取代原本 <iframe src="/ai-plan?embedded=1">
// 整頁嵌入的做法——背景:AIPlanTimelinePage.tsx 的地圖換成真實互動地圖
// (NativeMapBase)後,使用者希望這個小展示改回「靜態圖片地圖 + 模擬
// 元件」,但若直接嵌入 AIPlanTimelinePage 本體再用 transform:scale()
// 縮小,該頁面依賴 @media (max-width: 767px) 判斷手機版版面,media
// query 看的是瀏覽器真實視窗寬度而非縮放後的視覺尺寸,縮小後仍會在
// 桌面瀏覽器裡套用桌面版版面規則、跟手機外框形狀衝突。
// AiPlanPhoneDemoScreen 整個版面寫死成手機尺寸、不依賴任何 @media
// 判斷,專門只給這個固定 390×844 CSS 尺寸的手機外框使用,因此可以
// 直接嵌入、不需要 iframe 的獨立 viewport 保障,也省掉 iframe 本身
// 的獨立 document/網路請求開銷。
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
// DEFAULT_SCALE — /product 功能介紹卡裡的尺寸(那張卡片寬度有限)。
// 首頁的捲動展示是整個視窗的主角,會傳入較大的 scale(見 ScrollPlanDemo)。
const DEFAULT_SCALE = 0.62;

// 整支手機是一個連到 /ai-plan 的 <Link>,點擊開啟完整展示頁(onClick 供
// 呼叫端埋追蹤事件)。.screen 設 pointer-events: none(見 .module.css),
// 否則點擊會被展示畫面內部元素吃掉、不會冒泡到 Link。
export function AiPlanPhoneDemo({
  onClick,
  screenProps,
  scale = DEFAULT_SCALE,
  frameless = false,
  className,
}: {
  onClick?: () => void
  // scale——手機外框的縮放倍率。外框內部永遠以 390×844 的 CSS 尺寸排版
  // (那是 AiPlanPhoneDemoScreen 寫死的手機版面,見該元件的完整說明),
  // 只有最外層用 transform: scale() 縮放,所以放大不會改變內部版面、
  // 不會觸發任何 media query,純粹是視覺上的大小。frameless 為 true 時
  // 這個 prop 被忽略(不渲染任何 scale() 縮放,見該 prop 的完整說明)。
  scale?: number
  // frameless——2026-10(第七輪)新增,見 ScrollPlanDemo.tsx
  // PHONE_FRAMELESS_BREAKPOINT 的完整說明:true 時不渲染手機外框裝飾
  // (鈦金屬邊框/notch/側邊按鈕),也不套用 transform: scale(),只剩
  // AiPlanPhoneDemoScreen 的內容本身用 100% 寬度的自然版面撐滿呼叫端
  // 給的容器寬度。
  //
  // 背景:原本的 scale() 模式需要用 JS 算出一個精確倍率去模擬「手機
  // 畫布要多大」,這套計算在手機斷點(窄螢幕)上反覆出現新的邊界問題
  // (視窗高度變化時跳動、窄螢幕下手機貼齊外框、矮螢幕下手機疊壓到
  // 上方導覽列)——每次修正都是在同一套「用高度/寬度反推縮放倍率」
  // 的模型裡打轉。使用者最終確認的方向是從根本跳出這個模型:手機
  // 斷點本來就不需要「手機外框」這個造型語意,直接不渲染外框、也不
  // 計算任何倍率,問題類別整個消失,不是逐一修正每個邊界情況。
  //
  // 預設 false——只有 ScrollPlanDemo.tsx(首頁捲動展示)在手機斷點下
  // 會傳 true;/product 功能介紹卡(FeatureShowcase.tsx)維持原本
  // 永遠顯示外框的既有行為,不受這個新模式影響(見該元件呼叫處的既有
  // 說明,那裡是固定小卡片情境,跟首頁全螢幕展示的設計情境不同)。
  frameless?: boolean
  // screenProps——原樣透傳給 AiPlanPhoneDemoScreen,讓呼叫端換掉播放
  // 節奏(見該元件 createSource 的完整說明)。外框本身不受影響。
  screenProps?: Parameters<typeof AiPlanPhoneDemoScreen>[0]
  // className——附加在最外層 <Link>(.holder)上,讓呼叫端調整這支手機在
  // 自己版面裡的定位。.holder 預設帶 margin: 1.25rem auto 0(上下排列時
  // 用 auto 水平置中),呼叫端若把它放進 flex row,那個 auto 會吃掉所有
  // 剩餘空間、把同列的其他內容推到邊緣,需要在自己的樣式裡歸零。
  className?: string
} = {}) {
  if (frameless) {
    const framelessHolderClass = className
      ? `${styles.holder} ${styles.holderFrameless} ${className}`
      : `${styles.holder} ${styles.holderFrameless}`
    // 2026-10(第八輪,使用者明確回報「進入地圖區後，下方讓我試試的
    // 按鈕不見了」,並確認「文字仍疊在地圖上，但按鈕移到文字正下方
    // (仍疊在地圖上)」)——「試試看」按鈕不再由這個元件獨立渲染
    // (原本的 .tryItCtaOutsideFrameless 跟地圖內容同層並排,見本次
    // 修正前的版本),改成呼叫端(ScrollPlanDemo.tsx)把按鈕塞進
    // screenProps.caption 插槽裡、緊接在文字下方——caption 疊在地圖
    // 主顯示區上方(見 PhoneDemoLayout.tsx 的完整說明),這樣按鈕在
    // 整個 .sticky 置中堆疊中的位置更靠前面,不會像原本那樣跟在地圖
    // 內容「後面」,在矮螢幕下被 .sticky 的 overflow: hidden 連同地圖
    // 下緣一起裁掉看不到。
    return (
      <Link to="/ai-plan" onClick={onClick} aria-label="開啟編排行程完整展示" className={framelessHolderClass}>
        <div className={styles.screenFrameless}>
          <AiPlanPhoneDemoScreen {...screenProps} />
        </div>
      </Link>
    );
  }
  return (
    <Link
      to="/ai-plan"
      onClick={onClick}
      aria-label="開啟編排行程完整展示"
      className={className ? `${styles.holder} ${className}` : styles.holder}
      style={{ width: PHONE_WIDTH * scale, height: PHONE_HEIGHT * scale }}
    >
      <div
        className={styles.phoneFrame}
        style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT, transform: `scale(${scale})` }}
      >
        <div className={styles.buttonVolumeUp} />
        <div className={styles.buttonVolumeDown} />
        <div className={styles.buttonPower} />
        <div className={styles.bezel}>
          <div className={styles.notch} />
          <div className={styles.screen}>
            <AiPlanPhoneDemoScreen {...screenProps} />
          </div>
        </div>
      </div>
      {/* tryItCtaOutside——使用者明確要求「用跟開始探索一樣大的按鈕跟
          文字大小」,但這顆按鈕原本在 AiPlanPhoneDemoScreen.tsx 內部、
          .phoneFrame 的 scale(${scale}) 縮放範圍內,套用跟 HomePage.css
          .hero-cta 一致的真實 px 數值後,視覺上會被整個展示框的縮放
          (預設 0.62)等比例縮小,跟「一樣大」的意圖不符(見該元件移除
          .tryItCta 處的完整說明)。
          改成搬到這裡(.phoneFrame 之外、仍在同一個 <Link> 底下,不受
          scale() 影響),直接套用 hero-cta 的真實數值,不需要任何縮放
          補償計算。位置用 left/right/bottom 的 inline style 動態乘上
          scale 疊在手機螢幕底部同一個視覺位置——.holder 的尺寸就是
          縮放後的視覺尺寸(剛好等於手機螢幕範圍,見 .holder 的完整
          說明),原本 .tryItCta 在縮放前座標系是 left/right/bottom
          各 16px,換算到這個縮放後座標系要乘上 scale,才會疊在同一個
          視覺位置(不是直接照抄 16px,那是縮放前的距離,縮放後的
          視覺距離會偏大)。
          仍然是 <div> 不是 <button>——跟原本一樣,整支手機(含這顆
          按鈕)是純視覺引導,點擊靠 <Link> 本身,這顆視覺元素不需要
          自己的互動語意。aria-hidden 理由同原本 .tryItCta。 */}
      <div
        className={styles.tryItCtaOutside}
        style={{ left: 16 * scale, right: 16 * scale, bottom: 16 * scale }}
        aria-hidden="true"
      >
        試試看
      </div>
    </Link>
  );
}
