import { Link } from 'react-router-dom'
import styles from './ShowcaseDemoIndex.module.css'

// ShowcaseDemoIndex:docs/brainstorm/2026-10-product-direction-brainstorm.md
// 六項產品構想的雛形試做入口頁——使用者要求「開始試做雛形，有可以延續的
// 就延續製作」「直接試做」「你全權處理試做，不用問細節」,這裡是統一的
// 導覽入口,不對外公開(不在首頁/導覽列任何地方連結),只能直接輸入網址
// /showcase-demo 進入,純供內部查看雛形用。
//
// 每個構想對應一個子路由,各自是獨立元件、互不依賴——這裡只負責列出
// 清單跟簡短說明,實際雛形內容在各自的檔案裡。
const ITEMS: {
  path: string
  title: string
  status: 'ready' | 'draft'
  desc: string
}[] = [
  {
    path: '/itinerary-showcase',
    title: '構想一：AI 排過的主題行程展示',
    status: 'ready',
    desc: '卡片牆 + 分類篩選 + 唯讀時間軸預覽彈窗，純前端假資料。',
  },
  {
    path: '/component-conventions',
    title: '構想二：手機版介面優化（元件庫文件化）',
    status: 'ready',
    desc: '這次 session 已完成 bottom sheet 體系重構，這裡整理成一份內部設計規範速覽。',
  },
  {
    path: '/planning-modes',
    title: '構想三：依地點特性分化規劃模式',
    status: 'ready',
    desc: '九份型（亮點地圖）vs 赤崁型（時間軸列表）兩種呈現方式並排對照，同一份假資料套用兩種模式。',
  },
  {
    path: '/itinerary-checkup',
    title: '構想四：行程健檢',
    status: 'ready',
    desc: '假時間軸資料跑過健檢規則（時間衝突/交通銜接/營業時間/餐期），列出警示卡片。',
  },
  {
    path: '/post-composer',
    title: '構想五：發文工具（圖片處理 + AI 產文）',
    status: 'ready',
    desc: '上傳照片假流程 → 比對行程資料 → AI 產文初稿預覽，純前端模擬。',
  },
  {
    path: '/ad-system',
    title: '構想六：廣告投放系統',
    status: 'ready',
    desc: '贊助卡片在三個候選版位（城市頁/文章頁/範例行程列表）的視覺示意 + 關鍵決策摘要。',
  },
  {
    path: '/ad-admin-demo',
    title: '構想六附錄：投放設定介面範例',
    status: 'ready',
    desc: '模擬 web/admin 風格的廣告主/活動/素材管理後台（Advertisers/Campaigns/Stats 三分頁），純前端假資料。',
  },
]

export function ShowcaseDemoIndex() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.heading}>產品方向雛形試做</h1>
        <p className={styles.subheading}>
          對應 docs/brainstorm/2026-10-product-direction-brainstorm.md 的七項構想。
          這些頁面純供內部查看，不對外公開連結，資料皆為前端假資料，沒有真實後端串接。
        </p>
        <ul className={styles.list}>
          {ITEMS.map((item) => (
            <li key={item.path}>
              <Link to={item.path} className={styles.item}>
                <div className={styles.itemTitle}>
                  {item.title}
                  <span
                    className={`${styles.itemStatus}${item.status === 'ready' ? ` ${styles.itemStatusReady}` : ''}`}
                  >
                    {item.status === 'ready' ? '雛形完成' : '草稿'}
                  </span>
                </div>
                <p className={styles.itemDesc}>{item.desc}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
