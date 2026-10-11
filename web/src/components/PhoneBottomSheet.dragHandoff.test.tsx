// PhoneBottomSheet.dragHandoff.test.tsx——2026-10 新增(使用者明確要求
// 「這些手勢拉動的邏輯，有辦法用測試測出來嗎」「先覆蓋第一層看看有沒有
// 辦法測試來」「測試拉動不同位置 head or body，往上或往下有沒有正確」)。
//
// 這是這個檔案第一份真正驗證「觸控拖曳手勢」的測試——既有的
// geo-planning/PlanPhoneListDrawer.forceCollapsed.test.tsx 刻意把
// PhoneBottomSheet/SheetBody 整組 mock 掉,明確寫著「這個測試不驗證真實
// 觸控拖曳手勢,那是 PhoneBottomSheet 自己的職責」——但翻遍專案沒有任何
// 一份測試真的去補這份職責,這份檔案補上這個缺口。
//
// jsdom 的能力邊界(寫測試前務必認清,否則會寫出看似通過、實際沒驗證到
// 任何東西的假測試):
//   - 能測:onTouchStart/onTouchMove/onTouchEnd 這些 handler 的 JS 邏輯
//     本身——給定一串 fireEvent.touchStart/touchMove/touchEnd 模擬的觸控
//     座標序列,斷言 activeSnapIndex/onSnapIndexChange/onClose 有沒有被
//     正確呼叫、呼叫時的參數對不對。這些都是 handler 函式裡的純 JS
//     邏輯,不依賴瀏覽器原生手勢引擎。
//   - 測不出來:CSS 層面「誰贏」的問題——例如 overflow-y: auto 的原生
//     捲動跟 JS 的 preventDefault() 之間真實的競態關係、touch-action
//     對瀏覽器手勢辨識器的實際影響、不同瀏覽器/WebView 對「原生
//     addEventListener + React 合成事件共存」的非標準實作差異。這些是
//     瀏覽器原生合成引擎的行為,jsdom 完全不實作(scrollTop 在 jsdom 裡
//     永遠是 0,也不會真的觸發任何捲動)。這份測試如果通過,只能排除
//     「JS 邏輯本身寫錯」這個可能性,不能排除「CSS/原生手勢競態」這類
//     只有真實瀏覽器/實機才能確診的問題(見下方個別測試案例的完整
//     說明)。
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { PhoneBottomSheet, SheetBody, SheetHead } from './PhoneBottomSheet'

// MIN_HEIGHT_PX/SNAP_POINTS——對齊實際呼叫端(geo-planning/PlanPhoneListDrawer.tsx/
// PlanPhoneInfoSheet.tsx)用的三段式數值(minHeightPx=100,
// snapPoints=[400, 80]),不是隨便湊的測試用數字——這組數值換算出的
// stops 陣列有收合段(索引 0)、中間段(索引 1)、最大展開段(索引 2)
// 三段,剛好涵蓋使用者要求的「拉動不同位置、往上或往下」完整矩陣。
const MIN_HEIGHT_PX = 100
const SNAP_POINTS = [400, 80]

// touch——建立一個最小可用的 Touch-like 物件,fireEvent.touchStart 等
// 只需要 e.touches[0].clientY/clientX 可讀,不需要完整符合 Touch 介面。
function touch(clientY: number, clientX = 0) {
  return { touches: [{ clientY, clientX, identifier: 0, target: document.body } as unknown as Touch] }
}

// Harness——受控包裝,模擬呼叫端持有 activeSnapIndex/onSnapIndexChange
// 這組 state(對齊 PlanPhoneListDrawer.tsx 等實際呼叫端的既有用法)。
// onClose/onSnapIndexChange 額外接 vi.fn() spy,供測試斷言呼叫次數與
// 參數。
function ThreeStopHarness({
  onCloseSpy,
  onSnapIndexChangeSpy,
  initialIndex = 2,
}: {
  onCloseSpy: () => void
  onSnapIndexChangeSpy: (index: number) => void
  initialIndex?: number
}) {
  const [activeSnapIndex, setActiveSnapIndex] = useState(initialIndex)
  return (
    <PhoneBottomSheet
      open
      onClose={onCloseSpy}
      snapPoints={SNAP_POINTS}
      minHeightPx={MIN_HEIGHT_PX}
      activeSnapIndex={activeSnapIndex}
      onSnapIndexChange={(i) => {
        setActiveSnapIndex(i)
        onSnapIndexChangeSpy(i)
      }}
      head={<SheetHead title="測試標頭" onClose={onCloseSpy} />}
    >
      <SheetBody>
        <div data-testid="body-content">長內容</div>
      </SheetBody>
    </PhoneBottomSheet>
  )
}

// getPanel/getBody——測試用的 DOM 節點取得函式,靠
// data-testid(phone-bottom-sheet/sheet-body)穩定定位,不依賴 CSS
// Modules 雜湊過的 class 名稱——「從標頭拖曳」這組測試(dragFromHead)
// 直接對 .panel 本身觸發事件即可(head 那組 onTouchStart/Move/End 是
// 掛在 .panel 上的 React 合成事件,不需要特別定位到 head 區塊內部的
// 子節點),不需要額外的 getHead。
function getPanel(container: HTMLElement) {
  const el = container.querySelector('[data-testid="phone-bottom-sheet"]')
  if (!el) throw new Error('找不到 .panel(data-testid="phone-bottom-sheet")')
  return el as HTMLElement
}
function getBody(container: HTMLElement) {
  const el = container.querySelector('[data-testid="sheet-body"]')
  if (!el) throw new Error('找不到 SheetBody(data-testid="sheet-body")')
  return el as HTMLElement
}

// dragFromHead——完整模擬「從標頭拖曳」一輪手勢:觸發 .panel 上的 React
// 合成事件 onTouchStart/onTouchMove/onTouchEnd(對齊
// PhoneBottomSheet.tsx 695-726 行那組「head 那組」handler,標頭/拖曳把手/
// 未使用 SheetBody 的普通內容都是透過這組事件冒泡到 .panel 處理)。這組
// handler 沒有交接判斷,單一 touchMove 就足以量到正確的最終位移,不需要
// 像 dragFromBody 那樣分成「交接步」+「量測步」兩段。
function dragFromHead(panel: HTMLElement, startY: number, endY: number) {
  fireEvent.touchStart(panel, touch(startY))
  fireEvent.touchMove(panel, touch(endY))
  fireEvent.touchEnd(panel)
}

// dragFromBody——完整模擬「從 SheetBody 內容拖曳」一輪手勢:直接對
// data-testid="sheet-body" 這個節點觸發原生 touch 事件(對齊
// SheetBody 元件內部用 addEventListener 掛的那組 handler,PhoneBottomSheet.tsx
// 197-251 行)。這裡刻意直接對 body 節點 dispatch,而非先對 .panel
// dispatch 再期待冒泡——因為 SheetBody 自己是用原生 addEventListener
// 監聽「這個節點」本身(見該元件 253-265 行的 useEffect),不是監聽
// .panel,事件冒泡到 .panel 後才輪到 head 那組 React 合成事件處理
// (如果 SheetBody 自己沒有消化掉這次手勢的話)。
//
// 分兩段模擬,不是均分成多個等距中繼點——這是這份檔案踩過兩次坑後確認
// 的正確做法:
//   第一次嘗試:只打一次 touchStart→單一 touchMove→touchEnd。失敗
//     ——第一次 touchmove(見 PhoneBottomSheet.tsx 218-235 行)只負責
//     「判斷要不要交接」,交接當下會把 startYRef 重新鎖定成那一刻的
//     座標、dragOffset 歸零並 return,不會真的套用這次位移,量到的其實
//     是「交接判斷本身」,不是拖曳後的位移量。
//   第二次嘗試:均分成 5 個等距中繼點。仍然失敗(結果系統性地少了
//     一格)——因為最後落地的位移量是「從交接那一刻(第 1 步)算起到
//     終點的距離」,只要交接不是剛好發生在 startY 那一刻,最終量到的
//     淨位移一定比 endY - startY 這個總位移短一截(短少的量等於觸發
//     交接所需的那一小步),步數越少這個誤差佔比越明顯。
// 正確做法:把「觸發交接」與「量測位移」拆成兩個完全獨立、可精確控制
// 的步驟——先用極小的一步(1px,往同方向)觸發交接判斷本身(交接成立
// 後 startYRef 會被重設到這一步的座標,dragOffset 歸零),再用一次大步
// 跳到「這一步的座標 + 真正想測的淨位移量」,讓最終送進 setDragOffset
// 的值精確等於呼叫端想測的 endY - startY,不受中繼點數量影響。
function dragFromBody(body: HTMLElement, startY: number, endY: number) {
  fireEvent.touchStart(body, touch(startY))
  const delta = endY - startY
  const handoffStep = delta > 0 ? 1 : -1
  // 第一步:只為了觸發交接判斷(若方向允許,見 PhoneBottomSheet.tsx:218
  // 的 delta > 0 條件——往上拖這裡傳入的 handoffStep 仍是負值,交接
  // 條件本來就不會成立,這一步等同沒有作用,不影響「往上拖不交接」這組
  // 案例的正確性)。
  fireEvent.touchMove(body, touch(startY + handoffStep))
  // 第二步:若已交接,startYRef 已被重設為 startY + handoffStep,這裡
  // 跳到「新基準 + 剩餘的淨位移量」,讓最終 dragOffset 精確等於
  // endY - startY(呼叫端真正想測的總位移),不受這裡用幾步模擬影響。
  fireEvent.touchMove(body, touch(startY + handoffStep + (delta - handoffStep)))
  fireEvent.touchEnd(body)
}

describe('PhoneBottomSheet 拖曳手勢：head vs body、往上 vs 往下', () => {
  // SNAP_TOLERANCE_PX 是 60(見 PhoneBottomSheet.tsx 的同名常數),測試用
  // 的位移量都刻意抓明顯超過/低於這個門檻的數值,避免剛好卡在臨界值
  // 附近導致測試對「容忍帶」這個設計意圖以外的因素敏感。

  describe('最大展開段(索引 2)：往下拖應收合到中間段(索引 1)', () => {
    it('從標頭拖曳：往下 150px，吸附到索引 1', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={2} />,
      )
      const panel = getPanel(container)
      dragFromHead(panel, 100, 250) // delta = +150，往下
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(1)
      expect(onCloseSpy).not.toHaveBeenCalled()
    })

    it('從 SheetBody 內容拖曳：往下 150px，吸附到索引 1（對應使用者實機回報的場景）', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={2} />,
      )
      const body = getBody(container)
      // 最大展開段時 jsdom 的 body.scrollTop 恆為 0(jsdom 不實作真實
      // 捲動，見檔案開頭的完整說明)，SheetBody 的交接判斷
      // `body.scrollTop <= 0` 在 jsdom 環境下永遠成立——這代表這個測試
      // 驗證的是「JS 判斷邏輯本身在『已經捲到頂』這個前提成立時的行為」，
      // 不是「jsdom 能正確模擬使用者是否真的把內容捲到頂」這件事本身。
      dragFromBody(body, 100, 250) // delta = +150，往下
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(1)
      expect(onCloseSpy).not.toHaveBeenCalled()
    })
  })

  describe('最大展開段(索引 2)：往上拖應該彈回原本的段(已經是最大展開，沒有更上層)', () => {
    it('從標頭拖曳：往上 150px，維持索引 2 不變', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={2} />,
      )
      const panel = getPanel(container)
      dragFromHead(panel, 250, 100) // delta = -150，往上
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(2)
    })

    // 注意:這裡預期值跟標頭不同——SheetBody 自己的交接判斷條件
    // (PhoneBottomSheet.tsx:218)是 `delta > 0 && scrollTop <= 0`,
    // 「往上拖」時 delta < 0,這個條件永遠不成立,SheetBody 完全不會
    // 交接給 sheet 處理,等同把這次手勢讓給原生捲動(見該行的完整
    // 說明)。這是刻意設計,不是 bug:內容已經捲到頂、使用者還想「繼續
    // 往上」沒有意義(已經在最頂,捲動也到底了),往上拖的語意應該是
    // 「讓更多內容往下露出捲動範圍」,不該觸發 sheet 收合/展開——這項
    // 職責本來就只該由標頭/拖曳把手負責,onSnapIndexChange 不會被呼叫。
    it('從 SheetBody 內容拖曳：往上拖不會交接給 sheet（這是刻意設計，不是 bug，見上方完整說明）', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={2} />,
      )
      const body = getBody(container)
      dragFromBody(body, 250, 100) // delta = -150，往上
      expect(onSnapIndexChangeSpy).not.toHaveBeenCalled()
    })
  })

  describe('中間段(索引 1)：這是使用者實機回報「完全沒反應」的核心場景', () => {
    it('從標頭拖曳：往下 150px，吸附到收合段(索引 0)', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={1} />,
      )
      const panel = getPanel(container)
      dragFromHead(panel, 100, 250) // delta = +150，往下
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(0)
    })

    it('從標頭拖曳：往上 150px，吸附到最大展開段(索引 2)', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={1} />,
      )
      const panel = getPanel(container)
      dragFromHead(panel, 250, 100) // delta = -150，往上
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(2)
    })

    // 關鍵測試——這兩個案例直接對應使用者回報的 bug。SheetBody 自己的
    // onTouchStart/onTouchMove 在非 atMaxExpansion（這裡索引 1 不是
    // stops.length-1=2，atMaxExpansion 為 false）時第一行就
    // `if (!atMaxExpansion) return`，完全不處理這次手勢、也不呼叫
    // stopPropagation/preventDefault——照設計文件，事件應該原樣冒泡給
    // .panel 上的 head 那組 React 合成事件接手（PhoneBottomSheet.tsx
    // 695-708 行），结果應該跟上面「從標頭拖曳」完全一致。如果這兩個
    // 測試失敗，代表 bug 確實是 JS 邏輯層級的問題（事件冒泡沒有如預期
    // 發生）；如果通過，代表 jsdom 範圍內的 JS 邏輯沒問題，使用者實機
    // 回報的「完全沒反應」只能是 CSS/原生手勢競態這類 jsdom 測不到的
    // 問題（見檔案開頭的完整說明），需要回到真實瀏覽器才能確診。
    it('從 SheetBody 內容拖曳：往下 150px，應該跟標頭一樣吸附到索引 0', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={1} />,
      )
      const body = getBody(container)
      dragFromBody(body, 100, 250) // delta = +150，往下
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(0)
    })

    it('從 SheetBody 內容拖曳：往上 150px，應該跟標頭一樣吸附到索引 2', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={1} />,
      )
      const body = getBody(container)
      dragFromBody(body, 250, 100) // delta = -150，往上
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(2)
    })
  })

  describe('收合段(索引 0)：往上拖應該展開到中間段', () => {
    it('從標頭拖曳：往上 150px，吸附到索引 1', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={0} />,
      )
      const panel = getPanel(container)
      dragFromHead(panel, 250, 100) // delta = -150，往上
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(1)
    })

    // 注意:這裡的預期行為跟「最大展開段往上拖」那組(見上方)不一樣,
    // 兩者看起來都是「SheetBody 不交接」,但底層原因完全不同,不能套用
    // 同一個結論:
    //   - 最大展開段(atMaxExpansion===true)時,SheetBody 自己攔截處理
    //     這次手勢(.body 是可原生捲動的 overflow-y: auto 容器),往上拖
    //     時交接條件(delta > 0,PhoneBottomSheet.tsx:218)不成立,落入
    //     `else { return }`(PhoneBottomSheet.tsx:236-238)——這個
    //     return「吃下」了這次手勢,不會再冒泡給 head 那組處理,因此
    //     onSnapIndexChange 完全不會被呼叫。
    //   - 收合段(atMaxExpansion===false)時,SheetBody 的 onTouchStart
    //     第一行就 `if (!atMaxExpansion) return`(PhoneBottomSheet.tsx:
    //     198)——這裡的 return 發生在「連 startYRef 都還沒記錄」的
    //     階段,且不呼叫 stopPropagation/preventDefault,事件原樣冒泡
    //     給 .panel 上 head 那組的 React 合成事件(onTouchStart 等,
    //     PhoneBottomSheet.tsx:703 的擋截條件 `atMaxExpansion && ...`
    //     此時也因 atMaxExpansion 為 false 而不成立)接手——這正是整個
    //     架構設計的核心精神:.body 在未到最頂段時是 overflow: hidden
    //     (瀏覽器眼裡根本不可捲動),手勢天生只可能落在 sheet 拖曳上,
    //     理當讓 head 那組處理,見 PhoneBottomSheet.tsx atMaxExpansion
    //     宣告處的完整說明。所以這裡「往上拖」預期值是索引 1(跟從標頭
    //     拖曳結果一致),不是「不交接」。
    //   （pointer-events: none 只套用在收合「段」本身的視覺上——也就是
    //   真實瀏覽器裡使用者實際上碰不到這塊區域，jsdom 不處理 CSS 這件
    //   事不影響這裡要驗證的 JS 邏輯本身。）
    it('從 SheetBody 內容拖曳：事件冒泡給 head 那組接手，結果跟從標頭拖曳一致（吸附到索引 1）', () => {
      const onCloseSpy = vi.fn()
      const onSnapIndexChangeSpy = vi.fn()
      const { container } = render(
        <ThreeStopHarness onCloseSpy={onCloseSpy} onSnapIndexChangeSpy={onSnapIndexChangeSpy} initialIndex={0} />,
      )
      const body = getBody(container)
      dragFromBody(body, 250, 100) // delta = -150，往上
      expect(onSnapIndexChangeSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('單段模式：往下拖超過門檻直接 onClose，標頭與 body 行為一致', () => {
    function SingleStopHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
      return (
        <PhoneBottomSheet open onClose={onCloseSpy} snapPoints={[200]} head={<SheetHead title="單段" onClose={onCloseSpy} />}>
          <SheetBody>
            <div data-testid="body-content">長內容</div>
          </SheetBody>
        </PhoneBottomSheet>
      )
    }

    it('從標頭拖曳：往下 150px（超過 60px 容忍帶），觸發 onClose', () => {
      const onCloseSpy = vi.fn()
      const { container } = render(<SingleStopHarness onCloseSpy={onCloseSpy} />)
      const panel = getPanel(container)
      dragFromHead(panel, 100, 250)
      expect(onCloseSpy).toHaveBeenCalledTimes(1)
    })

    it('從 SheetBody 內容拖曳：往下 150px（超過 60px 容忍帶），觸發 onClose', () => {
      const onCloseSpy = vi.fn()
      const { container } = render(<SingleStopHarness onCloseSpy={onCloseSpy} />)
      const body = getBody(container)
      dragFromBody(body, 100, 250)
      expect(onCloseSpy).toHaveBeenCalledTimes(1)
    })

    it('從標頭拖曳：往下 30px（未超過 60px 容忍帶），不觸發 onClose', () => {
      const onCloseSpy = vi.fn()
      const { container } = render(<SingleStopHarness onCloseSpy={onCloseSpy} />)
      const panel = getPanel(container)
      dragFromHead(panel, 100, 130)
      expect(onCloseSpy).not.toHaveBeenCalled()
    })
  })
})
