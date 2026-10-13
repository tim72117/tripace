import { Link } from 'react-router-dom'
import styles from './ComponentConventionsPage.module.css'

// ComponentConventionsPage:構想二(手機版介面優化)裡「元件庫文件化」
// 延伸方案的雛形——brainstorm 文件寫的是「統一元件後，順手整理一份
// 內部的『手勢型元件使用規範』」。這次 session 已經把 bottom sheet
// 體系做完具名工廠元件 + z-index 常數管理(components/PhoneBottomSheet.tsx
// 的 StandaloneSheet/StackedSheet/PersistentSheet/SheetBody、
// components/zLayers.ts)，這個頁面把那次重構的設計規範整理成一份
// 內部速覽文件，而非只留在程式碼註解裡——不是重新設計新規範，是把
// 已經做完的規範「文件化」，對應文件裡「避免未來又長出第三種、第四種
// 各自獨立實作」的訴求。
export function ComponentConventionsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>手機版手勢型元件使用規範</h1>
        <p className={styles.subheading}>
          2026-10 bottom sheet 體系重構後的內部速覽——實際程式碼見{' '}
          <code className={styles.code}>components/PhoneBottomSheet.tsx</code>，
          這裡只整理「新增一個 bottom sheet 時該怎麼選」。
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>該用哪個具名工廠元件？</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>情境</th>
                <th>元件</th>
                <th>範例</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>獨立開關，不屬於任何堆疊</td>
                <td>
                  <code className={styles.code}>StandaloneSheet</code>
                </td>
                <td>設定頁、配速表、時間軸、旅程清單</td>
              </tr>
              <tr>
                <td>useSheetStack 多層堆疊的一員（可能被壓在下層）</td>
                <td>
                  <code className={styles.code}>StackedSheet</code>
                </td>
                <td>地點清單、日期選單、日曆</td>
              </tr>
              <tr>
                <td>children 需要永遠留在 React 樹上（例如要維持 WebSocket 連線）</td>
                <td>
                  <code className={styles.code}>PersistentSheet</code>
                </td>
                <td>對話小匡（TripPlanPage）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>內容要不要用 SheetBody 包？</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>內容特性</th>
                <th>要不要用 SheetBody</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>內容可能超出可視高度，需要捲動；捲到頂要能繼續往下拖收合</td>
                <td>要——包一層 &lt;SheetBody&gt;</td>
              </tr>
              <tr>
                <td>內容本身固定高度，不需要捲動（例如簡短表單）</td>
                <td>不用——children 直接放普通內容</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>z-index 該用哪個常數？</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>層級</th>
                <th>常數</th>
                <th>語意</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>蓋過底部功能列</td>
                <td>
                  <code className={styles.code}>Z_LAYERS.ABOVE_TAB_BAR</code>
                </td>
                <td>設定頁/對話/配速/行程清單——各自獨立開關，無嚴格疊放順序</td>
              </tr>
              <tr>
                <td>被功能列蓋住（甘願被蓋）</td>
                <td>
                  <code className={styles.code}>Z_LAYERS.BELOW_TAB_BAR_1</code> /{' '}
                  <code className={styles.code}>BELOW_TAB_BAR_2</code>
                </td>
                <td>旅程清單 / 時間軸，兩者有明確相對順序</td>
              </tr>
              <tr>
                <td>地點清單→資訊卡→日期選單→日曆 固定堆疊順序</td>
                <td>
                  <code className={styles.code}>PLAN_SHEET_STACK.*</code>
                </td>
                <td>依種類固定深度，不是動態 push 順序決定</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>手勢方向鎖定（水平 vs 垂直衝突）</h2>
          <p className={styles.subheading} style={{ marginBottom: 10 }}>
            元件內有水平滑動手勢（例如照片輪播），又被放進 bottom sheet
            （垂直拖曳）裡時，用 <code className={styles.code}>hooks/useSwipeDirectionLock.ts</code>
            ，不要自己重寫一份方向判斷邏輯。
          </p>
          <table className={styles.table}>
            <tbody>
              <tr>
                <td style={{ width: '40%' }}>範例呼叫</td>
                <td>
                  <code className={styles.code}>useSwipeDirectionLock('horizontal')</code>
                </td>
              </tr>
              <tr>
                <td>既有呼叫端</td>
                <td>geo-planning/PhotoCarousel.tsx（手機版照片橫滑）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>無障礙補強待辦清單</h2>
          <p className={styles.subheading} style={{ marginBottom: 10 }}>
            對齊文件「可及性一併補齊」——Fable review 指出多處缺少
            :focus-visible、鍵盤導航、Esc 關閉，統一元件後應該一次補進共用
            元件，而非逐一補丁。目前狀態：
          </p>
          <ul className={styles.checklist}>
            <li className={styles.checklistItem}>
              <span className={styles.checklistTodo}>○</span>
              SheetHead 關閉鈕本身是 &lt;button&gt;，有基礎鍵盤可達性，但 :focus-visible 樣式尚未確認
            </li>
            <li className={styles.checklistItem}>
              <span className={styles.checklistTodo}>○</span>
              拖曳手把（dragHandle）純裝飾用 div，無法鍵盤操作、無螢幕閱讀器替代方案
            </li>
            <li className={styles.checklistItem}>
              <span className={styles.checklistTodo}>○</span>
              Esc 鍵關閉 bottom sheet 尚未實作（目前只能點 backdrop 或關閉鈕）
            </li>
            <li className={styles.checklistItem}>
              <span className={styles.checklistTodo}>○</span>
              多段 snapPoints 之間的切換沒有非手勢等效操作
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
