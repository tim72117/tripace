import { SkeletonBlock, SkeletonLines, SkeletonRegion } from '../../components/Skeleton'

// LateTextSkeleton:Google 地點文字(簡介、評分)還在查詢時的站位骨架——
// PlaceInfoContent.textStatus==='pending'(見 PlacePanel.tsx 該欄位說明)
// 時,PlacePanel(桌面)與 PlanPhoneInfoSheet(手機)用這兩個元件取代
// 「這個地點還沒有簡介資料。」與空的徽章列,讓使用者知道是「還在載」而
// 不是「沒有資料」。
//
// 2026-10 改用共用零件(components/Skeleton.tsx):掃光顏色、深色模式與
// reduced-motion 都交給共用元件,這裡只決定尺寸。
//
// 外框尺寸由呼叫端決定:SummarySkeleton 的 className 傳卡片自己的
// .summaryEmpty + .summaryReserved(與真內容同一組 margin/字級/三行
// min-height),內部三行各佔一行行高(lineHeight 1.6em,em 繼承外框的
// 13px 字級 = 20.8px),合計剛好等於三行高度 62.4px,文字補上時外框不變、
// 下方內容不跳動。BadgeSkeleton 與 .badge 同高(19px)、同圓角,放在卡片
// 既有的 .metaRow 裡,列高不變。

export function SummarySkeleton({ className }: { className: string }) {
  return (
    <SkeletonRegion label="簡介載入中" className={className}>
      <SkeletonLines lines={3} lineHeight="1.6em" barHeight={10} lastLineWidth="62%" />
    </SkeletonRegion>
  )
}

export function BadgeSkeleton() {
  return <SkeletonBlock width={64} height={19} radius={10} />
}
