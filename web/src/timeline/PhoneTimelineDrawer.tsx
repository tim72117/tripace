import { useEffect, useRef, useState } from 'react'
import type { DesktopTimelineMirror } from '../chat/ChatScreen'
import type { ClientConfig } from '../api'
import { MultiTrackTimeline } from './Timeline'
import { PhoneBottomSheet, SheetHead } from '../components/PhoneBottomSheet'
import { ScrollArea } from '../components/ScrollArea'

// PhoneTimelineDrawer:手機版時間軸,由下往上彈出(bottom sheet)——使用者
// 要求「時間軸不用獨立路由」,原本是底部常駐 PhoneTabBar.tsx 的一個分頁
// (切網址到 /app/timeline、整個主顯示區換成 TimelineMainView),改成規劃
// 地圖(GeoOutlinePhoneView)專屬的入口(左下角按鈕,見該檔案的
// onOpenTimeline),疊在地圖上方顯示,不切換網址、不離開規劃地圖主畫面。
//
// 只顯示時間軸內容本身(唯讀清單),不含 ChatScreen 的對話輸入列——已與
// 使用者確認,想發訊息需要先關閉這個 sheet、回到對話畫面,不在 sheet 內
// 提供輸入功能,理由是 ChatScreen 只有一份掛載點(見 PhoneContent.tsx 的
// chatElement 說明),同時放進兩個地方的 children 會讓架構複雜化,不符合
// 「時間軸只是規劃地圖的輔助檢視」這個新定位。
//
// 外殼(backdrop/panel/dragHandle)與拖曳關閉手勢改用共用容器
// components/PhoneBottomSheet.tsx,對齊 trip/PhoneTripsDrawer.tsx 的既有
// 用法(同一套 bottom sheet 模式)。可拖曳收合到只顯示標頭(minHeightPx/
// activeSnapIndex,見下方)——當初是為了排查「對話疊加層內容區拖不動」
// 問題而加的對照組(時間軸內容區 MultiTrackTimeline 跟 ChatScreen 的
// 訊息列表一樣用 ScrollArea(前身是全域 .screen-body class),驗證同樣
// 結構在這裡能正常拖動整張卡片,藉此排除這個捲動容器本身的嫌疑,見
// PhoneContent.tsx 對話疊加層 keepMounted 的說明),驗證後使用者要求
// 保留這個收合功能。
//
// SHEET_TOP:面板頂部離定位祖先頂端的距離(px)——見
// components/PhoneBottomSheet.tsx 的說明。TODO(使用者稍後決定合理
// 數值):暫時估算。
const SHEET_TOP = 200
// SHEET_MIN_HEIGHT:收合段的固定高度(px,只顯示標頭)——理由見上方
// 元件說明。TODO(使用者稍後決定合理數值):暫時估算。
const SHEET_MIN_HEIGHT = 100
const SHEET_BOTTOM = 'calc(64px + env(safe-area-inset-bottom, 0px))'

export function PhoneTimelineDrawer({
  open,
  onClose,
  tripName,
  timelineMirror,
  // editCfg:對齊桌面版 DesktopContent panelMode === 'timeline' 分支的
  // cfg 傳遞方式——只有旅程擁有者才能編輯時間軸項目,呼叫端
  // (PhoneContent.tsx)依 activeTrip.ownerID === user.id 判斷通過才傳
  // cfg,否則傳 undefined(唯讀),這裡不重複判斷身分,直接轉傳給
  // MultiTrackTimeline。
  editCfg,
}: {
  open: boolean
  onClose: () => void
  tripName: string
  timelineMirror: DesktopTimelineMirror
  editCfg: ClientConfig | undefined
}) {
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const bodyRef = useRef<HTMLDivElement>(null)
  // snapIndex:收合/展開的吸附段落狀態——初始為展開(索引 1),每次重新
  // 開啟都重設回展開,不延續上次被拖曳收合的狀態。理由同其餘多段模式的
  // bottom sheet(GeoOutlinePhoneListDrawer.tsx/PhoneContent.tsx 對話
  // 疊加層的同名 state)。
  const [snapIndex, setSnapIndex] = useState(1)
  useEffect(() => {
    if (open) setSnapIndex(1)
  }, [open])

  useEffect(() => {
    if (open && timelineMirror.entries.length > 0 && todayRef.current && bodyRef.current) {
      const el = todayRef.current
      const body = bodyRef.current
      body.scrollTo({ top: el.offsetTop - 60, behavior: 'instant' })
    }
  }, [open, timelineMirror.entries])

  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[SHEET_TOP]}
      minHeightPx={SHEET_MIN_HEIGHT}
      activeSnapIndex={snapIndex}
      onSnapIndexChange={setSnapIndex}
      panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: SHEET_BOTTOM, zIndex: 13 }}
      showBackdrop={false}
      head={<SheetHead title={tripName} onClose={onClose} />}
    >
      {timelineMirror.entries.length === 0 ? (
        <ScrollArea>
          <div className="empty">尚無行程內容。</div>
        </ScrollArea>
      ) : (
        <ScrollArea ref={bodyRef}>
          <MultiTrackTimeline
            entries={timelineMirror.entries}
            todayRef={todayRef}
            updatingIDs={timelineMirror.updatingEntryIDs}
            taskPlaceholders={timelineMirror.taskPlaceholders}
            cfg={editCfg}
            onEntryUpdated={timelineMirror.refetchEntries}
          />
        </ScrollArea>
      )}
    </PhoneBottomSheet>
  )
}
