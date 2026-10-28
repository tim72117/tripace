import { useState, type ReactNode } from 'react'
import { Check, MapPin } from 'lucide-react'
import styles from './AskPage.module.css'

// CandidateCard.tsx — 景點照片卡(候選景點詢問頁的一張卡),正式的 AskPage
// (CandidatesPanel)與播放態的 ScriptedAskPage 共用。兩邊先前是複製貼上的
// 同一份 DOM,差異只在「播放態多了被程式點擊的特效」與「播放態不是真的
// 按鈕」。
//
// 擴充點選 className + children,不用 renderOverlay:特效就是「多一個 class
// 加在卡片上」(.scriptedPicking)與「卡片尾端多一個子節點」(.scriptedRipple),
// 這兩件事用最普通的 props 就表達得出來,不需要 render function。children 渲染在
// 勾號之後(與播放態原本漣漪的位置一致)。
//
// as:正式版是 <button>(可聚焦、aria-pressed、點擊切換);播放態沒有任何真的
// 點擊行為,原本刻意用 <div>(避免進入鍵盤導覽、被輔助技術報成控制項),所以
// 提供 as="div"。as="div" 時不輸出 aria-pressed、type,也不綁 onClick。
// as="div" 同時加 .directionCardStatic:不可點的卡不該有 pointer 游標與 hover 藍框/上浮(見 AskPage.module.css)。
// 樣式沿用 AskPage.module.css 的 .directionCard 系列。
//
// 照片載入失敗(Google 照片網址會過期):onError 記下失敗的網址,當作「沒有照片」渲染——stacked 補同尺寸佔位、
// 橫向卡只剩卡片底色,與原本沒有照片時的外觀完全一致(視覺差異最小),不顯示破圖。換成別的網址會重新嘗試。

export interface CandidateCardProps {
  // name——顯示的標題文字,呼叫端先決定好(通常是 detail?.name ?? candidate.name)。
  // 空值時顯示「未命名地點」。
  name?: string
  // loading——為 true 時標題顯示「查詢中…」。
  loading?: boolean
  photoUrl?: string
  checked: boolean
  stacked?: boolean
  // onToggle——點擊時呼叫。as="div" 時忽略。
  onToggle?: () => void
  // badge——左上角的小標記文字(例如「已在行程」)。
  badge?: string
  as?: 'button' | 'div'
  // className——額外附加在卡片根節點的 class(播放態特效用)。
  className?: string
  // children——渲染在勾號之後(播放態漣漪用)。
  children?: ReactNode
}

export function CandidateCard({
  name,
  loading,
  photoUrl,
  checked,
  stacked,
  onToggle,
  badge,
  as = 'button',
  className,
  children,
}: CandidateCardProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showPhoto = !!photoUrl && photoUrl !== failedUrl
  const cls = [
    styles.directionCard,
    as === 'div' ? styles.directionCardStatic : '',
    stacked ? styles.directionCardStacked : '',
    checked ? styles.directionCardChecked : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      {showPhoto ? (
        <img
          src={photoUrl}
          alt=""
          onError={() => setFailedUrl(photoUrl ?? null)}
          className={[styles.directionPhoto, stacked ? styles.directionPhotoStacked : ''].filter(Boolean).join(' ')}
        />
      ) : (
        // stacked 模式沒有 <img> 時補同尺寸佔位色塊維持圖文對齊;橫向捲動模式
        // 卡片本身是固定尺寸方塊,不需要(完整理由見 git 歷史中 AskPage.tsx 該處註解)。
        stacked && (
          <span className={styles.directionPhotoPlaceholder} aria-hidden="true">
            <MapPin size={20} strokeWidth={2} />
          </span>
        )
      )}
      <span className={[styles.directionLabel, stacked ? styles.directionLabelStacked : ''].filter(Boolean).join(' ')}>
        {loading ? '查詢中…' : (name ?? '未命名地點')}
      </span>
      {badge && <span className={styles.directionBadge}>{badge}</span>}
      {checked && <Check size={14} strokeWidth={3} className={styles.directionCheck} />}
      {children}
    </>
  )

  if (as === 'div') return <div className={cls}>{inner}</div>
  return (
    <button type="button" aria-pressed={checked} className={cls} onClick={onToggle}>
      {inner}
    </button>
  )
}
