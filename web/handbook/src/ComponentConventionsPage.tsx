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
        <Link to="/category/prototypes" className={styles.back}>
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
                <td>planning/place/PhotoCarousel.tsx（手機版照片橫滑）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>載入佔位該用哪個？</h2>
          <p className={styles.subheading} style={{ marginBottom: 10 }}>
            2026-10 起全站載入站位統一為淡色掃光，零件在{' '}
            <code className={styles.code}>components/Skeleton.tsx</code> 與{' '}
            <code className={styles.code}>components/FramedImage.tsx</code>
            ，不要再自己寫一份漸層、深色覆寫或 reduced-motion 處理。
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>情境</th>
                <th>元件</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>一塊色塊（縮圖、徽章、按鈕位置）</td>
                <td>
                  <code className={styles.code}>SkeletonBlock</code>
                </td>
                <td>
                  width／height／aspectRatio／radius 可調；預設 aria-hidden，「載入中」交給外層宣告。
                  animation='none' 是靜態底色，用在「沒有資料、不是還在載」的佔位
                </td>
              </tr>
              <tr>
                <td>N 行文字</td>
                <td>
                  <code className={styles.code}>SkeletonLines</code>
                </td>
                <td>行寬用固定比例（不隨機）；lineHeight 設成真文字的行高，載入前後高度不跳</td>
              </tr>
              <tr>
                <td>一組骨架要對讀屏宣告一次「載入中」</td>
                <td>
                  <code className={styles.code}>SkeletonRegion</code>
                </td>
                <td>
                  label 必填；內層 display:contents，外框 className 的 flex／grid 直接作用在子骨架上
                </td>
              </tr>
              <tr>
                <td>直接渲染真卡片，載入中把內容遮成骨架</td>
                <td>
                  <code className={styles.code}>SkeletonMask</code>
                </td>
                <td>
                  只改顏色、背景、可見度，不碰盒模型，載入前後外框必然一樣大；遮罩中要維持可見的元素加{' '}
                  <code className={styles.code}>skeleton-keep</code> class（
                  <code className={styles.code}>SKELETON_KEEP_CLASS</code>）或{' '}
                  <code className={styles.code}>data-skeleton-keep</code>，整個子樹保留原樣
                </td>
              </tr>
              <tr>
                <td>圖片（固定外框＋佔位＋淡入＋失敗佔位）</td>
                <td>
                  <code className={styles.code}>FramedImage</code>
                </td>
                <td>
                  外框尺寸在 src 載入前就決定，四種狀態外框不變，狀態寫在 data-status。尺寸與圓角要完全交給
                  className 時用 unstyled
                </td>
              </tr>
            </tbody>
          </table>
          <table className={styles.table} style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td style={{ width: '40%' }}>覆寫骨架顏色</td>
                <td>
                  在任一祖先覆寫 <code className={styles.code}>--skeleton-base</code>（底色）與{' '}
                  <code className={styles.code}>--skeleton-highlight</code>（高光）。兩者都只能是單一顏色：
                  掃光層把它們當漸層的 color stop 與 background-color 用，塞漸層進去整個失效（底色透明、沒有掃光）。
                  FramedImage 的靜態佔位底要放漸層或 transparent 時，改用{' '}
                  <code className={styles.code}>--framed-image-placeholder-bg</code>
                </td>
              </tr>
              <tr>
                <td>FramedImage 的 pending 與 idle</td>
                <td>
                  沒有 src 時：pending=true（還在查 src）顯示掃光；pending=false 是 idle（確定沒有圖或不查），
                  顯示靜態佔位加中性圖示、不掃光。有 src 時 pending 被忽略，以下載狀態為準；下載失敗也是靜態佔位，
                  表示「已經停了、不是還在載」
                </td>
              </tr>
              <tr>
                <td>減少動態（prefers-reduced-motion）</td>
                <td>掃光一律退成靜態底色（拿掉漸層，不只停動畫）；FramedImage 載入完成不淡入。使用端不必另外處理</td>
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
