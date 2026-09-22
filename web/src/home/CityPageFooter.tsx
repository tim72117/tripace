import { Link } from 'react-router-dom'
import styles from './CityPageFooter.module.css'

// CityPageFooter:城市介紹頁(KyotoPage/JiufenPage/TainanPage)共用的頁尾
// ——原本三份檔案各自貼了一份逐字相同的品牌名/版權/法律連結/Powered by
// 區塊(僅 class 前綴不同),見 code review 報告記錄的重複問題,抽成這個
// 共用元件統一維護。內容完全通用,不需要任何 props——連結目標、文案在
// 三頁之間沒有差異。
//
// 樣式改用 CSS Modules(見 CityPageFooter.module.css),取代原本各頁各自
// 前綴命名空間(kyoto-footer-*/jiufen-footer-*/tainan-footer-*)的做法。
// hover 顏色讀 --footer-accent 這個中性 CSS 變數,而非寫死某個城市的
// 強調色變數名(京都/九份是 --vermilion,台南是 --brick,彼此不通用)
// ——呼叫端(各城市頁的 .kyoto-page/.jiufen-page/.tainan-page 作用域)
// 各自把 --footer-accent 指向自己的強調色即可,這個共用元件不需要知道
// 呼叫端實際用的變數名稱。
export function CityPageFooter() {
  return (
    <footer className={styles.footer}>
      <span className={styles.brand}>Tripace · 旅程規劃</span>
      <div className={styles.bar}>
        <span className={styles.copyright}>Copyright © 2026 Tripace</span>
        <nav className={styles.links}>
          <Link to="/">回首頁</Link>
          <Link to="/privacy">隱私權政策</Link>
          <Link to="/terms">服務條款</Link>
          <a href="#">聯絡我們</a>
        </nav>
      </div>
      <a
        className={styles.poweredby}
        href="https://onagent.shuttle.tools"
        target="_blank"
        rel="noreferrer"
      >
        Powered by onagent
      </a>
    </footer>
  )
}
