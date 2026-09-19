import { describe, expect, it } from 'vitest'
import {
  DESKTOP_INFO_CARD_BASE_RIGHT_PX,
  DESKTOP_INFO_CARD_STACK_GAP_PX,
  DESKTOP_INFO_CARD_WIDTH_PX,
  stackedInfoCardRightPx,
} from './DesktopInfoCard'

// DesktopInfoCard.test.ts——驗證 stackedInfoCardRightPx 這個順位陣列
// 定位公式的行為,取代原本 DesktopLayout.tsx 的
// nearbyInfoPanelRightPx = attractionPanelRightPx + 340 + 12 這條假設
// 主題卡一定已開的固定公式(見 DesktopInfoCard.tsx 的完整說明)。重點
// 驗證「缺席的卡片後面的卡片會自動往右滑補位」這個行為,這正是改用
// 順位陣列取代固定公式的核心目的。
const SLOT_WIDTH = DESKTOP_INFO_CARD_WIDTH_PX + DESKTOP_INFO_CARD_STACK_GAP_PX

describe('stackedInfoCardRightPx', () => {
  it('順位 0 的卡片不論其他順位是否存在,永遠貼齊基準 right', () => {
    expect(stackedInfoCardRightPx(0, new Set([0]))).toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX)
    expect(stackedInfoCardRightPx(0, new Set([0, 1]))).toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX)
  })

  it('順位 1 的卡片在順位 0 也存在時,往左推一個卡片寬度+間距', () => {
    expect(stackedInfoCardRightPx(1, new Set([0, 1])))
      .toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX + SLOT_WIDTH)
  })

  it('順位 0 缺席時,順位 1 的卡片自動往右滑補位到基準 right——不是停在假設順位 0 存在的位置', () => {
    expect(stackedInfoCardRightPx(1, new Set([1]))).toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX)
  })

  it('順位 2(假設的第三類卡片)在前兩個順位都存在時,往左推兩個卡片寬度+間距', () => {
    expect(stackedInfoCardRightPx(2, new Set([0, 1, 2])))
      .toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX + 2 * SLOT_WIDTH)
  })

  it('順位 2 只有順位 0 存在(順位 1 缺席)時,只往左推一個卡片寬度+間距,不是兩個', () => {
    expect(stackedInfoCardRightPx(2, new Set([0, 2])))
      .toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX + SLOT_WIDTH)
  })

  it('presentOrders 只包含比自己大的順位(自己尚未算入)時,結果等同沒有任何卡片排在前面', () => {
    expect(stackedInfoCardRightPx(0, new Set([0, 1, 2]))).toBe(DESKTOP_INFO_CARD_BASE_RIGHT_PX)
  })

  it('baseRightPx 可由呼叫端覆寫(例如飯店側欄/對話小匡佔用右緣時的起始值)', () => {
    expect(stackedInfoCardRightPx(1, new Set([0, 1]), 368)).toBe(368 + SLOT_WIDTH)
  })
})
