// layerContracts:各層元件的 props 都滿足共同契約(型別層級的斷言——編譯期檢查,不是執行期)。
// 這個檔案本身只要能通過 tsc 就代表三個入口的同名元件都符合 plan-core/layerContracts.ts 的介面;
// 若有人改了某個入口的 props 讓它不再滿足契約,這裡會編譯失敗。
import { describe, it, expect } from 'vitest'
import type {
  LivePlanLayerContract,
  PlanLayoutContract,
  PlanOverlayLayoutContract,
} from './layerContracts'
import type { PlanLayoutProps as AiPlanLayoutProps } from '../home/plan-ai-sim/PlanLayout'
import type { PlanLayoutProps as PhonePlanLayoutProps } from '../phone/PlanLayout'
import type { PlanLayoutProps as DesktopPlanLayoutProps } from '../desktop/PlanLayout'
import type { PlanLayoutProps as ItinerariesPlanLayoutProps } from '../itineraries/PlanLayout'
import type { PlanOverlayLayoutProps as AiPlanPhoneOverlayLayoutProps } from '../home/plan-ai-sim/phone/PlanOverlayLayout'
import type { AiPlanOverlayLayoutProps } from '../home/plan-ai-sim/overlayLayoutProps'
import type { PlanOverlayLayoutProps as PhonePlanOverlayLayoutProps } from '../phone/PlanOverlayLayout'
import type { PlanOverlayLayoutProps as DesktopPlanOverlayLayoutProps } from '../desktop/PlanOverlayLayout'
import type { PlanOverlayLayoutProps as ItinerariesPlanOverlayLayoutProps } from '../itineraries/PlanOverlayLayout'
import type { LivePlanLayerProps as AiLivePlanLayerProps } from '../home/plan-ai-sim/LivePlanLayer'
import type { LivePlanLayerProps as PhoneLivePlanLayerProps } from '../phone/LivePlanLayer'
import type { LivePlanLayerProps as DesktopLivePlanLayerProps } from '../desktop/LivePlanLayer'
import type { UseCurrentLocation } from './currentLocationContract'
import type { useCurrentLocation as aiUseCurrentLocation } from '../home/plan-ai-sim/useCurrentLocation'
import type { useCurrentLocation as phoneUseCurrentLocation } from '../phone/useCurrentLocation'
import type { useCurrentLocation as desktopUseCurrentLocation } from '../desktop/useCurrentLocation'

// assignable<Impl, Contract>:Impl 的 props 必須可以指派給 Contract(即「滿足契約」)。
type Satisfies<Impl extends Contract, Contract> = Impl

// 第 2 層 PlanLayout
export type _L2 = [
  Satisfies<AiPlanLayoutProps, PlanLayoutContract>,
  Satisfies<PhonePlanLayoutProps, PlanLayoutContract>,
  Satisfies<DesktopPlanLayoutProps, PlanLayoutContract>,
  Satisfies<ItinerariesPlanLayoutProps, PlanLayoutContract>,
]
// 第 3 層 PlanOverlayLayout
export type _L3 = [
  Satisfies<AiPlanPhoneOverlayLayoutProps, PlanOverlayLayoutContract>,
  Satisfies<AiPlanOverlayLayoutProps, PlanOverlayLayoutContract>,
  Satisfies<PhonePlanOverlayLayoutProps, PlanOverlayLayoutContract>,
  Satisfies<DesktopPlanOverlayLayoutProps, PlanOverlayLayoutContract>,
  Satisfies<ItinerariesPlanOverlayLayoutProps, PlanOverlayLayoutContract>,
]
// 第 4 層 LivePlanLayer
export type _L4 = [
  Satisfies<AiLivePlanLayerProps, LivePlanLayerContract>,
  Satisfies<PhoneLivePlanLayerProps, LivePlanLayerContract>,
  Satisfies<DesktopLivePlanLayerProps, LivePlanLayerContract>,
]

// 目前位置：三個入口各一個同名 useCurrentLocation，介面相同（currentLocationContract.ts）
export type _CurrentLocation = [
  Satisfies<typeof aiUseCurrentLocation, UseCurrentLocation>,
  Satisfies<typeof phoneUseCurrentLocation, UseCurrentLocation>,
  Satisfies<typeof desktopUseCurrentLocation, UseCurrentLocation>,
]

describe('分層元件介面契約', () => {
  it('三個入口的 PlanLayout、PlanOverlayLayout、LivePlanLayer 都滿足 plan-core/layerContracts.ts(由編譯期檢查)', () => {
    // 實際斷言在上面的型別;能執行到這裡代表 tsc 通過。
    expect(true).toBe(true)
  })
})
