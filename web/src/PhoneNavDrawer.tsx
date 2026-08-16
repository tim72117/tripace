import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { Share2, Users } from 'lucide-react'
import type { Trip } from './trip/types'
import type { User } from './user/types'
import { Avatar } from './AppCommon'
import { TripMenu } from './trip/TripMenu'
import { MembersScreen } from './trip/MembersScreen'
import type { ClientConfig } from './api'
import styles from './PhoneNavDrawer.module.css'

// PhoneNavDrawer:手機版精簡版操作抽屜——分享/成員/使用者頭像,不再含
// 分頁列。原本的分頁列(時間軸/路徑/規劃/demo-* 等)已改為
// PhoneTabBar.tsx(底部常駐:行程/時間軸/規劃)+ PhoneSideTools.tsx
// (右側小圖示:路徑+demo-*),不需要先開這個抽屜才看得到分頁——見
// PhoneContent.tsx 的說明。這個抽屜現在只負責「分享/成員/頭像」這組
// 跟目前選取行程(activeTrip)相關的操作,跟主顯示區在看哪個分頁無關。
//
// 分享/成員點擊後在 .body 整塊換成 ShareModal/MembersScreen(取代原本
// 分頁內容),關閉後恢復,寫法比照 ChatScreen.tsx 桌面版仍在用的同一套
// showShare/showMembers 全螢幕切換模式。
//
// 滑入手勢仿照 PacePhoneSwipe.tsx 的抽屜模式(左側滑入,拖曳關閉),只是這裡
// 疊在整個 PhoneContent 之上(相對於 .web-app 定位),不像 PacePhoneSwipe
// 只疊在配速表地圖上面。

const DRAWER_WIDTH_PERCENT = 82

export function PhoneNavDrawer({
  open,
  cfg,
  activeTrip,
  user,
  onOpenSettings,
  onOpenShare,
  onClose,
}: {
  // open:面板一律掛載(不像先前的版本靠條件渲染整個元件),只用這個 boolean
  // 切換 translateX——理由同 PacePhoneSwipe.tsx 的 .panel:唯有元件全程留在
  // DOM 上,CSS transition 才能在「開/關」切換的當下播放滑入/滑出動畫;
  // 條件掛載/卸載沒有「前一刻」可以從那裡動畫過來,只會瞬間出現/消失。
  open: boolean
  cfg: ClientConfig
  activeTrip: Trip | null
  user: User
  // onOpenSettings:點擊右上角使用者頭像時直接開設定(不再先進選單),見
  // PhoneContent.tsx 的 SettingsScreen 疊層。
  onOpenSettings: () => void
  // onOpenShare:點擊分享按鈕時,開啟從底部滑出的分享面板(見
  // PhoneContent.tsx 的 sharePanel)——跟使用者設定同一種呈現方式,不是
  // 這個抽屜自己 .body 內的分頁切換,理由是分享/設定都是「離開目前操作
  // 情境的獨立任務」,滿版由下往上滑入比較符合這種語意,不像分享/成員
  // 按鈕過去那樣就地取代分頁內容。
  onOpenShare: () => void
  onClose: () => void
}) {
  // showMembers:成員按鈕點擊後,.body 整塊換成 MembersScreen(取代原本
  // 分頁內容)——分享已經改成獨立的滑出面板(見上方 onOpenShare),只有
  // 成員維持這個抽屜自己的行內切換。
  const [showMembers, setShowMembers] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  // 拖曳關閉手勢:跟 PacePhoneSwipe.tsx 同一套寫法——開啟時只能往左拖(關閉
  // 方向,delta 為負),超過門檻放開手指直接關閉;面板收合時位在螢幕外,
  // 手指本來就摸不到它,不需要另外擋掉這組 handler。
  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    const delta = Math.min(0, e.touches[0].clientX - startXRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset < -threshold) onClose()
    setDragOffset(0)
    startXRef.current = null
  }

  const translate = open ? `${dragOffset}px` : `calc(-100% + ${dragOffset}px)`

  return (
    <>
      {open && (
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      )}
      <div
        className={styles.panel}
        style={{
          width: `${DRAWER_WIDTH_PERCENT}%`,
          transform: `translateX(${translate})`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* 操作群組:分享/成員(操作目前選取的行程,永遠顯示)+ 使用者頭像
            (開設定)——見檔案開頭的說明。margin-left: auto 把這一群推到
            最右側。 */}
        <div className={styles.tabs}>
          <div className={styles.headerActions}>
            {activeTrip && (
              <>
                <TripMenu tripID={activeTrip.id} />
                {activeTrip.ownerID === user.id && (
                  <button type="button" className={styles.tab} onClick={onOpenShare} title="分享">
                    <Share2 size={18} strokeWidth={1.8} />
                  </button>
                )}
                <button type="button" className={styles.tab} onClick={() => setShowMembers(true)} title="成員">
                  <Users size={18} strokeWidth={1.8} />
                </button>
              </>
            )}
            <button type="button" className={styles.avatarBtn} onClick={onOpenSettings} title="設定">
              <Avatar user={user} />
            </button>
          </div>
        </div>
        <div className={styles.body}>
          {showMembers && activeTrip && (
            <MembersScreen
              cfg={cfg}
              trip={activeTrip}
              isOwner={activeTrip.ownerID === user.id}
              onBack={() => setShowMembers(false)}
            />
          )}
        </div>
      </div>
    </>
  )
}
