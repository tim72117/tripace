import { useEffect, useRef, useState } from 'react'
import type { DesktopTimelineMirror } from '../chat/ChatScreen'
import type { ClientConfig } from '../api'
import { MultiTrackTimeline } from './Timeline'
import { StandaloneSheet, SheetBody, SheetHead } from '../components/PhoneBottomSheet'
import { Z_LAYERS } from '../components/zLayers'

// PhoneTimelineDrawer:手機版時間軸,由下往上彈出(bottom sheet)——使用者
// 要求「時間軸不用獨立路由」,原本是底部常駐 phone/Nav.tsx 的一個分頁
// (切網址到 /app/timeline、整個主顯示區換成 TimelineMainView),改成規劃
// 地圖(planning/map/phone/PlanPhoneView.tsx)專屬的入口(左下角按鈕,見該檔案的
// onOpenTimeline),疊在地圖上方顯示,不切換網址、不離開規劃地圖主畫面。
//
// 只顯示時間軸內容本身(唯讀清單),不含 ChatScreen 的對話輸入列——已與
// 使用者確認,想發訊息需要先關閉這個 sheet、回到對話畫面,不在 sheet 內
// 提供輸入功能,理由是 ChatScreen 只有一份掛載點(見 planning/member/phone/Content.tsx 的
// chatElement 說明),同時放進兩個地方的 children 會讓架構複雜化,不符合
// 「時間軸只是規劃地圖的輔助檢視」這個新定位。
//
// 外殼(backdrop/panel/dragHandle)與拖曳關閉手勢改用共用容器
// components/PhoneBottomSheet.tsx,對齊 trip/phone/TripList.tsx 的既有
// 用法(同一套 bottom sheet 模式)。可拖曳收合到只顯示標頭(minHeightPx/
// activeSnapIndex,見下方)——當初是為了排查「對話疊加層內容區拖不動」
// 問題而加的對照組(時間軸內容區 MultiTrackTimeline 跟 ChatScreen 的
// 訊息列表一樣用 ScrollArea(前身是全域 .screen-body class),驗證同樣
// 結構在這裡能正常拖動整張卡片,藉此排除這個捲動容器本身的嫌疑,見
// planning/member/phone/Content.tsx 對話疊加層 keepMounted 的說明),驗證後使用者要求
// 保留這個收合功能。
//
// SHEET_TOP:面板頂部離定位祖先頂端的距離(px)——見
// components/PhoneBottomSheet.tsx 的說明。這個檔案是兩段模式(收合/
// 展開),展開段本身不是貼頂的最大展開,語意上是「中間」位置——2026-10
// 使用者明確要求「只有兩段的、位置在中間的也算」,從原本的 200 改成
// 320,跟地點清單/地點資訊卡/「規劃」小匡的中段統一(見
// planning/member/phone/Content.tsx CHAT_SHEET_SNAP_POINTS 的完整說明)。
const SHEET_TOP = 320
// SHEET_MIN_HEIGHT:收合段的固定高度(px,只顯示標頭)——理由見上方
// 元件說明。TODO(使用者稍後決定合理數值):暫時估算。
const SHEET_MIN_HEIGHT = 100
// SHEET_BOTTOM:2026-10 改用 var(--tab-bar-height),理由見
// trip/phone/TripList.tsx 同名常數的完整說明(取代原本寫死的
// 64px,改讀 planning/member/phone/Content.tsx 用 ResizeObserver 即時量出的真實
// phone/Nav.tsx 高度)——不疊加 env(safe-area-inset-bottom),理由同樣
// 見該檔案的完整說明:tabBarHeight 量到的是 .bar 完整外框高度,本身已經
// 內含 safe-area,重複疊加過一次會讓收合段可視高度被壓成負值,造成
// 標頭被裁切的回歸。
const SHEET_BOTTOM = 'var(--tab-bar-height)'
// CONTENT_PADDING_STYLE——見下方 SheetBody 呼叫處的完整說明,補上原本
// ScrollArea 提供的內距(對齊 base-ui.css .screen-body 的既有數值,
// 左右 12px、底部 16px、頂部 0)。
const CONTENT_PADDING_STYLE = { padding: '0 12px 16px' }

export function PhoneTimelineDrawer({
  open,
  onClose,
  tripName,
  timelineMirror,
  // editCfg:對齊桌面版 planning/member/desktop/Content panelMode === 'timeline' 分支的
  // cfg 傳遞方式——只有旅程擁有者才能編輯時間軸項目,呼叫端
  // (planning/member/phone/Content.tsx)依 activeTrip.ownerID === user.id 判斷通過才傳
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
  // bottom sheet(planning/place/phone/ResultList.tsx、planning/member/phone/Content.tsx 對話
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
    <StandaloneSheet
      open={open}
      onClose={onClose}
      snapPoints={[SHEET_TOP]}
      minHeightPx={SHEET_MIN_HEIGHT}
      activeSnapIndex={snapIndex}
      onSnapIndexChange={setSnapIndex}
      // zIndex 改引用 Z_LAYERS.BELOW_TAB_BAR_2(2026-10,見 zLayers.ts
      // 的完整說明,取代原本寫死的 13)——被 BELOW_TAB_BAR_1(旅程清單,
      // trip/phone/TripList.tsx)跟功能列本身都蓋住。
      panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: SHEET_BOTTOM, zIndex: Z_LAYERS.BELOW_TAB_BAR_2 }}
      showBackdrop={false}
      head={<SheetHead title={tripName} onClose={onClose} />}
    >
      {/* SheetBody 取代原本的 ScrollArea——理由見該元件 forwardRef 的
          完整說明:ScrollArea 固定 overflow-y:auto,跟 SheetBody 內部
          「未到頂段 overflow:hidden、到頂才 auto」的拖拉交接切換邏輯
          衝突,改成 SheetBody 自己當捲動容器,原本掛在 ScrollArea 上的
          bodyRef(供下方 useEffect 自動捲到「今天」那一列)直接轉掛到
          這裡。
          CONTENT_PADDING_STYLE——ScrollArea 原本帶 padding: 0 12px 16px
          (見該元件 module.css 的完整說明),SheetBody/.bodyScrollable
          本身不提供 padding(對齊 planning/place/phone/ResultList.tsx
          等既有呼叫端的慣例:「捲動改由外層 .body 統一負責,內容自己的
          padding 留在內容層」,見該檔案 .list 的說明),這裡用 inline
          style 補上同樣的內距,避免拿掉 ScrollArea 後內容貼齊螢幕邊緣的
          視覺回歸——這個檔案沒有自己的 CSS Module,inline style 是目前
          侵入最小的做法。 */}
      {timelineMirror.entries.length === 0 ? (
        <SheetBody>
          <div className="empty" style={CONTENT_PADDING_STYLE}>尚無行程內容。</div>
        </SheetBody>
      ) : (
        <SheetBody ref={bodyRef}>
          <div style={CONTENT_PADDING_STYLE}>
            <MultiTrackTimeline
              entries={timelineMirror.entries}
              todayRef={todayRef}
              updatingIDs={timelineMirror.updatingEntryIDs}
              taskPlaceholders={timelineMirror.taskPlaceholders}
              cfg={editCfg}
              onEntryUpdated={timelineMirror.refetchEntries}
            />
          </div>
        </SheetBody>
      )}
    </StandaloneSheet>
  )
}
