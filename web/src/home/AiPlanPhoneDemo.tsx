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
  className,
}: {
  onClick?: () => void
  // scale——手機外框的縮放倍率。外框內部永遠以 390×844 的 CSS 尺寸排版
  // (那是 AiPlanPhoneDemoScreen 寫死的手機版面,見該元件的完整說明),
  // 只有最外層用 transform: scale() 縮放,所以放大不會改變內部版面、
  // 不會觸發任何 media query,純粹是視覺上的大小。
  scale?: number
  // screenProps——原樣透傳給 AiPlanPhoneDemoScreen,讓呼叫端換掉播放
  // 節奏(見該元件 createSource 的完整說明)。外框本身不受影響。
  screenProps?: Parameters<typeof AiPlanPhoneDemoScreen>[0]
  // className——附加在最外層 <Link>(.holder)上,讓呼叫端調整這支手機在
  // 自己版面裡的定位。.holder 預設帶 margin: 1.25rem auto 0(上下排列時
  // 用 auto 水平置中),呼叫端若把它放進 flex row,那個 auto 會吃掉所有
  // 剩餘空間、把同列的其他內容推到邊緣,需要在自己的樣式裡歸零。
  className?: string
} = {}) {
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
    </Link>
  );
}
