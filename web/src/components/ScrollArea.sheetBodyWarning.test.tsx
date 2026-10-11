// ScrollArea.sheetBodyWarning.test.tsx——2026-10 新增(使用者明確要求
// 「業界會在元件內規範上層元件要有什麼規範才能正確運作的這種規範模式
// 嗎」「目前有哪些元件適合這種規範」「好」,對齊 Radix UI 等函式庫「元件
// 掛載時主動檢查自己期待的環境條件是否成立,不成立就警告」的做法)。
//
// 驗證 ScrollArea.tsx 用 useIsInsideSheetBody()(PhoneBottomSheet.tsx
// 匯出)偵測自己是否被渲染在 SheetBody 管轄的子樹裡,偵測到就在開發模式
// 丟出明確警告——這份測試用的正是目前真實存在的誤用案例
// (user/SettingsScreen.tsx:StandaloneSheet 的 SheetBody 裡又包一層
// ScrollArea)當作測試情境,不是虛構的假設。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { PhoneBottomSheet, SheetBody, SheetHead } from './PhoneBottomSheet'
import { ScrollArea } from './ScrollArea'

describe('ScrollArea 偵測「被塞進 SheetBody 子樹」並警告', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('單獨使用 ScrollArea（不在任何 SheetBody 裡）：不警告', () => {
    render(
      <ScrollArea>
        <div>一般內容</div>
      </ScrollArea>,
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ScrollArea 包在 SheetBody 內部（對齊 SettingsScreen.tsx 的真實誤用案例）：警告', () => {
    render(
      <PhoneBottomSheet
        open
        onClose={() => {}}
        snapPoints={[60]}
        head={<SheetHead title="設定" onClose={() => {}} />}
      >
        <SheetBody>
          <ScrollArea>
            <div>設定頁內容</div>
          </ScrollArea>
        </SheetBody>
      </PhoneBottomSheet>,
    )
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('[ScrollArea]')
    expect(warnSpy.mock.calls[0][0]).toContain('SheetBody')
  })

  it('ScrollArea 直接放在 PhoneBottomSheet 的 children（沒有用 SheetBody 包）：仍然警告', () => {
    // 2026-10 修正(第一版測試誤判):SheetBodyContext.Provider 實際上
    // 永遠包住整個 renderedChildren(見 PhoneBottomSheet.tsx 980-996
    // 行),不管呼叫端有沒有用 <SheetBody> 標籤——這代表
    // useIsInsideSheetBody() 回答的其實是「我在不在任何
    // PhoneBottomSheet/StandaloneSheet/StackedSheet/PersistentSheet 的
    // children 範圍內」,不是侷限在「有沒有被 <SheetBody> 標籤包住」。
    // 這其實是更安全、更正確的偵測範圍——即使呼叫端沒有用 SheetBody
    // 包,ScrollArea 自己的 touch-action: pan-y 仍然可能跟外層 head 那組
    // 的拖曳手勢搶事件,一樣是風險情境,不該被排除在警告範圍之外。原本
    // 這個測試案例預期「不警告」是誤判,已修正。
    render(
      <PhoneBottomSheet
        open
        onClose={() => {}}
        snapPoints={[60]}
        head={<SheetHead title="設定" onClose={() => {}} />}
      >
        <ScrollArea>
          <div>設定頁內容</div>
        </ScrollArea>
      </PhoneBottomSheet>,
    )
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
