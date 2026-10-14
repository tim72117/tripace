import { Link } from 'react-router-dom'
import { AD_AFFILIATE_COMPARE_HTML } from './AdAffiliateCompareData'
import styles from './AdAffiliateComparePage.module.css'

// AdAffiliateComparePage:構想八(廣告與聯盟行銷方案比較)——2026-10 使用者
// 明確確認「構想六是自建投放系統,這份是用外部(平台)」,兩者路線不同,
// 不是同一個構想的延伸或替代,獨立成構想八。
//
// 內容比較 Google AdSense 跟四家旅遊聯盟行銷平台(KKday/Klook/
// Booking.com/Agoda)在外觀彈性、整合複雜度、收益等面向的差異,原始
// 內容是使用者透過另一個 Claude 對話產生的完整靜態頁面(含自己的
// <style>/字體/配色 token),見 AdAffiliateCompareData.ts 的完整說明。
//
// 用 <iframe srcDoc> 嵌入而非轉寫成 React 元件——這份內容本身是自帶
// 樣式系統的完整靜態頁(300+ 行 CSS、巢狀卡片結構),逐行轉寫成拆分的
// React 元件 + CSS Modules 容易在過程中遺漏視覺細節或引入 class 命名
// 衝突,iframe 讓這份內容的樣式完全隔離在自己的文件裡,不會跟這個
// React 專案全域樣式互相干擾,也保留原始內容的精確呈現。
//
// height 用固定夠高的值而非動態量測——這份內容是純展示用的靜態頁,
// 不需要互動,量測 iframe 內容高度需要額外的 postMessage/ResizeObserver
// 機制,對這個單純用途不划算,改用足夠寬裕的固定高度 + iframe 自己的
// 內部捲動(見 .module.css 的完整說明)。
export function AdAffiliateComparePage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>廣告與聯盟行銷方案比較</h1>
        <p className={styles.subheading}>
          構想六是自建的站內贊助版位系統（原生卡片，見「構想六：廣告投放系統」）；這份比較的是接入外部平台——Google
          AdSense、KKday、Klook、Booking.com、Agoda 五種方案在外觀彈性、整合複雜度、收益上的差異，純前端假資料/示意素材。
        </p>
        <iframe
          title="廣告與聯盟行銷方案比較"
          srcDoc={AD_AFFILIATE_COMPARE_HTML}
          className={styles.frame}
        />
      </div>
    </div>
  )
}
