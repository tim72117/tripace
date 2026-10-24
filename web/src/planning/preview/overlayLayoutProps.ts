import type { ReactNode } from 'react'
import type { PlanOverlayLayoutContract } from '../shared/layerContracts'

// AiPlanOverlayLayoutProps——/ai-plan 三個 PlanOverlayLayout 實體(phone/、desktop/、wide/ 各一份,同名同介面)共同的 props。
// Content 依 isDesktop、isWide 擇一渲染其中一個,傳同一組 props;各實體只用得到的部分:
//   - mapBackground、safeAreaRef、passThrough:共同契約(safeAreaRef 必填,Content 一律傳;桌面疊加版面沒有安全區節點,收下但不渲染它;
//     passThrough 手機、桌面疊加版面支援,wide 側欄不支援);
//   - composer:輸入列插槽的內容(模擬層的假輸入框;真實層的輸入框走 ComposerSlotContext)。
export interface AiPlanOverlayLayoutProps extends PlanOverlayLayoutContract {
  composer?: ReactNode
}
