import { useIsDesktop } from '../hooks/useIsDesktop'
import styles from './ScrollHint.module.css'

// ScrollHint:「SCROLL」往下捲動提示——2026-09 使用者要求「scroll 移動
// 到主題的下面」,把這段提示從 MobileMapReveal.tsx 的圓形縮圖按鈕裡搬
// 出來(見該檔案檔頭的完整沿革說明),改成各城市頁在 hero 標題區塊下方
// 自行掛載的獨立元件。原因:地圖 intro 區塊已經搬到分站列表結束、結尾
// CTA 之前(不再位於頁面頂端),原本「貼在頂端縮圖上引導往下看」的提示
// 留在那裡已經不合語意,搬到 hero 下方繼續扮演「引導使用者往下捲看分站
// 內容」的角色才是正確位置。
//
// 只在手機版顯示(維持原本 MobileMapReveal 內建版本的範圍,使用者確認
// 「只手機版,不擴大到桌面版」)——桌面版是固定高度的展示卡片版面,不像
// 手機版是滿版的長文件流頁面,不需要「往下捲」這種提示。
//
// 用中性的 currentColor + 透明度(而非寫死顏色或依賴某個頁面專屬的
// --vermilion/--ink-soft token)——這是跨頁面共用元件,不能假設呼叫端
// 一定有某組特定色票變數,顏色自然跟隨外層頁面(.kyoto-page/.jiufen-page/
// .tainan-page/.tainan-chikan-page 都有設 color)才能正確運作,理由同
// MobileMapReveal.tsx 原本這段規則的說明。
export function ScrollHint() {
  const isDesktop = useIsDesktop()
  if (isDesktop) return null

  return (
    <span className={styles.scrollHint} aria-hidden="true">
      <span>SCROLL</span>
      <span className={styles.scrollHintBar} />
    </span>
  )
}
