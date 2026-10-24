import { Building2, Camera, MapPin, ShoppingBag, UtensilsCrossed } from 'lucide-react'
import type { PlanNode } from '../planning/timeline/model'

// ICON_BY_KIND——2026-10 新增,使用者明確要求「在時間軸的元件放進對應
// 地點的 icon」(軸線上的小圓點,見 planning/timeline/PlanTimelineView.tsx
// renderAnchorIcon prop 的完整說明)。對應 SampleStop.kind 的常見值
// (景點/美食/展館/購物/住宿,見 types.ts SampleStop.kind 的完整說明),
// 不是窮舉所有可能字串——kind 本身是自由文字(不是寫死的 union 型別,
// 理由見 types.ts 開頭說明,允許行程資料自行擴充新分類),查無對應項
// 一律退回通用的 MapPin 圖示,不是拋錯或留白。
const ICON_BY_KIND: Record<string, typeof MapPin> = {
  景點: Camera,
  美食: UtensilsCrossed,
  展館: Building2,
  購物: ShoppingBag,
  住宿: Building2,
}

// renderAnchorIcon——傳給 PlanTimelineView 的 renderAnchorIcon 插槽(見
// 該 prop 的完整說明)。只有 type==='stop' 的節點才畫 icon,舊的 section
// 節點(轉場分隔線)沒有對應的地點類型,回傳 null
// 讓圓點維持空心樣式——這兩種節點本來就不會真的出現在這個插槽的呼叫
// 路徑上(anchorDot 只存在於 stop 節點的渲染分支),但型別上
// PlanNode 仍是聯集型別,保守判斷。icon 尺寸固定 11px(見
// PlanTimelineView.module.css .anchorDotWithIcon 的 font-size),跟
// anchorDotSize prop 配合使用,呼叫端必須同時傳兩者才會有視覺效果。
export function renderAnchorIcon(step: PlanNode) {
  if (step.type !== 'stop') return null
  const Icon = ICON_BY_KIND[step.kind ?? ''] ?? MapPin
  return <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
}
