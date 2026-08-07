import { FolderPlus, Plus, X } from 'lucide-react'
import type { GeoCandidate } from './GeoCandidateSidebar'
import styles from './GeoInfoPanel.module.css'

// GeoInfoPanel:一張浮動卡片,絕對定位疊在地圖上方,貼齊主顯示區右緣
// (即 GeoHotelSidebar 左側),與主顯示區同高、四周留出間距,不像
// GeoHotelSidebar/GeoCandidateSidebar 那樣佔用一份平行的 flex 版面
// 空間。故渲染位置放在 .desktop-main(見 DesktopLayout.tsx,該容器已有
// position: relative)底下、跟 GeoOutlinePanel 同層,而非跟
// GeoHotelSidebar 同層。
//
// 有兩個觸發來源,呼叫端(DesktopLayout.tsx)統一轉成 GeoInfoContent 後
// 才傳進來,這個元件不需要知道資料原始來自哪裡:
//  1. 地點清單(GeoHotelSidebar「地點」分頁)點擊項目本體——刻意不移動
//     地圖(不再 setGeoPanTarget),理由:原本點擊會讓地圖平移過去,但
//     那個互動假設「使用者想看這個地點在地圖上的位置」,這次要的是
//     「先看介紹內容」,不需要地圖跟著動,尤其地圖目前顯示的範圍可能就是
//     使用者刻意瀏覽的範圍,點清單項目把它搬走反而打斷瀏覽。地圖上直接
//     點自訂地標圖示(GeoOutlineMap.tsx 的 handleDistrictClick)維持
//     原本「放大到該範圍+查附近推薦」的行為不變——那是使用者已經在
//     地圖上、明確想放大看這個地點的意圖,跟清單點擊是兩種不同情境。
//  2. 點擊底圖上 Google 原生繪製的 POI 圖標(見 GeoOutlineMap.tsx 攔截
//     IconMouseEvent、event.stop() 停用預設 InfoWindow 後改查
//     fetchGeoPlaceDetails)——這種來源沒有知名度分級/景點數量/範圍
//     半徑這些只有自建 district 資料才有的欄位,改顯示 Google 評分。
export interface GeoInfoContent {
  name: string
  photoUrl?: string
  subtitle?: string
  summary?: string
  badges: string[]
  // candidate:這張卡片對應的候選籃項目——由呼叫端(DesktopLayout.tsx)
  // 在兩個觸發來源(側欄「地點」清單點擊/點擊地圖上 Google 原生 POI
  // 圖標)各自組好傳入,這個元件不需要知道資料原始形狀差異,只負責在
  // 有值時顯示「加入候選」按鈕、按下時原封不動往上回報。undefined 代表
  // 這個來源目前組不出候選籃需要的形狀(理論上不該發生,兩個觸發來源
  // 都有對應資料可組),但保留 optional 避免未來新增第三種觸發來源時
  // 忘記處理就直接編譯錯誤擋下來。
  candidate?: GeoCandidate
}

export function GeoInfoPanel({
  content,
  onClose,
  onAddCandidate,
  onAddToNewTrip,
  tripName,
}: {
  content: GeoInfoContent | null
  onClose: () => void
  // onAddCandidate:「加入候選」按鈕觸發,理由同 GeoHotelSidebar 卡片上
  // 既有的同名 callback——這裡刻意不做「已在候選籃裡就不顯示按鈕」的
  // 判斷,重複加入由呼叫端的候選籃 state 用內容比對去重(見
  // DesktopLayout.tsx 的 onAddCandidate 說明),這個元件不需要知道候選籃
  // 目前的完整內容。按下直接加入候選籃(純前端,不寫入後端)——刻意不像
  // GeoHotelSidebar.tsx 的 AddCandidateButton 那樣展開日期選擇,使用者
  // 明確要求「地點介紹」的加入候選維持單純的一鍵加入,日期改到已排入
  // 行程分組的「從候選加入」入口(見 GeoCandidateSidebar.tsx)再指定。
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onAddToNewTrip:複合按鈕右半邊(只有 FolderPlus icon)觸發,「加入
  // 候選」的變化版——把這個地點直接加到一個新行程,而不是目前選取的
  // activeTrip。實際「建立新行程」的邏輯留在呼叫端(DesktopLayout.tsx)
  // 之後再接,這個元件只負責原封不動往上回報使用者按了這顆按鈕。
  onAddToNewTrip?: (candidate: GeoCandidate) => void
  // tripName:左半邊按鈕文字「加入 {tripName}」要顯示的行程名稱,由呼叫端
  // (DesktopLayout.tsx)傳入 activeTrip?.name——這個元件不猜行程名稱從
  // 哪來,呼叫端已經有 activeTrip 可用,由它決定 fallback 文字。
  tripName: string
}) {
  if (!content) return null

  const candidate = content.candidate

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>地點介紹</span>
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.body}>
        {content.photoUrl ? (
          <img className={styles.photo} src={content.photoUrl} alt={content.name} />
        ) : (
          <div className={styles.photoPlaceholder} />
        )}
        <div className={styles.content}>
          <h2 className={styles.name}>{content.name}</h2>
          {content.subtitle && <span className={styles.landmarkName}>{content.subtitle}</span>}
          {content.badges.length > 0 && (
            <div className={styles.metaRow}>
              {content.badges.map((b) => (
                <span key={b} className={styles.badge}>{b}</span>
              ))}
            </div>
          )}
          {content.summary ? (
            <p className={styles.summary}>{content.summary}</p>
          ) : (
            <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
          )}
          {candidate && (
            <div className={styles.addCandidateGroup}>
              <button
                type="button"
                className={styles.addCandidateBtn}
                onClick={() => onAddCandidate?.(candidate)}
              >
                <Plus size={14} strokeWidth={2} />
                加入 {tripName}
              </button>
              <button
                type="button"
                className={styles.addToNewTripBtn}
                onClick={() => onAddToNewTrip?.(candidate)}
                title="加入到新行程"
                aria-label="加入到新行程"
              >
                <FolderPlus size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
