import { Link } from 'react-router-dom';
import styles from './AiPlanPhoneDemo.module.css';

// AiPlanPhoneDemo:自足的「AI 編排行程」展示元件——模擬 iPhone 外框內嵌入
// /ai-plan?embedded=1,任何頁面直接 <AiPlanPhoneDemo /> 即可使用。外框造型
// 沿用錄製工具的 iPhone 外框(鈦金屬邊框、黑色 bezel、動態島、側邊按鈕)。
//
// 用 <iframe>:展示頁的手機版斷點是 @media (max-width: 767px),iframe 有
// 獨立 viewport,外框內才會吃到跟手機上開 /ai-plan 完全一致的版面。
// 手機本體固定 390×844 CSS 尺寸,縮小只用 transform: scale(),iframe 內部
// 的版面寬度因此維持真實手機寬度。
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
const SCALE = 0.62;

// 整支手機是一個連到 /ai-plan 的 <Link>,點擊開啟完整展示頁(onClick 供
// 呼叫端埋追蹤事件)。iframe 設 pointer-events: none,否則點擊會被 iframe
// 吃掉、不會冒泡到 Link。
export function AiPlanPhoneDemo({ onClick }: { onClick?: () => void } = {}) {
  return (
    <Link
      to="/ai-plan"
      onClick={onClick}
      aria-label="開啟 AI 編排行程完整展示"
      className={styles.holder}
      style={{ width: PHONE_WIDTH * SCALE, height: PHONE_HEIGHT * SCALE }}
    >
      <div
        className={styles.phoneFrame}
        style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT, transform: `scale(${SCALE})` }}
      >
        <div className={styles.buttonVolumeUp} />
        <div className={styles.buttonVolumeDown} />
        <div className={styles.buttonPower} />
        <div className={styles.bezel}>
          <div className={styles.notch} />
          <iframe
            className={styles.screen}
            src="/ai-plan?embedded=1"
            title="AI 編排行程展示"
            loading="lazy"
          />
        </div>
      </div>
    </Link>
  );
}
