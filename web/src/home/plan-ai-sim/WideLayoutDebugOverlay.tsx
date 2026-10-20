// WideLayoutDebugOverlay——開發工具:標示 wide 模式(見 PlanOverlayPanelWide
// 的完整說明)下側欄、composer 插槽的實際範圍。2026-10 新增(使用者明確
// 要求「?debugSafeArea=1 把各區塊都顯示出來」),共用同一個 URL 參數
// 開關,跟同目錄的 SafeAreaDebugOverlay(見該檔案的完整說明)標示的是
// 不同的幾何:那個畫安全可視區(地圖扣掉側欄範圍後剩餘空間)的計算結果,
// 這個畫側欄本身與 composer 插槽的邊界,兩者互補、不是取代關係,
// AIPlanTimelinePage.tsx 的 DEBUG_SAFE_AREA 開關會同時渲染兩者。
//
// 幾何常數從 planOverlayGeometry.ts 匯入(2026-10,code review 發現:
// 這份數值原本跟 AIPlanTimelinePage.tsx 的安全區矩形各自手寫一份,同一輪
// 改動裡已經造成兩次真實漂移 bug——SIDEBAR_TOP 曾經漏改一次,COMPOSER_
// BAND_HEIGHT 的計算基準也曾經跟 .panel 的 bottom 不同步。抽成共用模組
// 後,這兩個消費者至少保證彼此一致;CSS Module(PlanOverlayPanelWide.
// module.css 的 .panel/.composerSlot)仍然要手動對照這份數值,見該模組
// 開頭的完整說明。

import { SIDEBAR_WIDTH, SIDEBAR_TOP, COMPOSER_BOTTOM, COMPOSER_HEIGHT, COMPOSER_SIDE_MARGIN, COMPOSER_BAND_HEIGHT } from './planOverlayGeometry'

export function WideLayoutDebugOverlay() {
  return (
    // pointerEvents: none——純視覺標記,不攔截任何互動,理由同
    // SafeAreaDebugOverlay 的同一個理由。inset: 0 相對 .page 定位
    // (呼叫端把這個元件放進跟 .page 範圍相同的地圖背景插槽裡)。
    // zIndex: 21——composer 插槽本身是 z-index: 20(見
    // PlanOverlayPanelWide.module.css .composerSlot 的完整說明:輸入框
    // 必須保證在時間軸內容最上層),這個疊圖要蓋在它上面才看得見框線,
    // 不然 composer 框會被真正的輸入框元件蓋住(實機確認過的現象)。 */}
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 21 }}>
      {/* 黃色網底區塊——頁面頂部刻意留白的範圍(top: 0 到 SIDEBAR_TOP,
          見 PlanOverlayPanelWide.module.css .panel top 的完整說明:
          讓漂浮導覽列的登入/切換日夜模式按鈕跟下方內容之間有分隔
          空間)。橫跨整個頁面寬度(left: 0 到 right: 0),不是只有側欄
          那 560px——漂浮導覽列(SiteNavButtons,position: fixed)本身
          橫跨整個頁面,這塊留白概念上也是整列,不是側欄局部的留白
          (2026-10,使用者明確要求「是要一整列」,訂正前一版只畫側欄
          寬度的範圍)。跟下方紫色側欄框分開標示,讓「這塊空間是刻意
          留的、不是側欄缺了一截」這件事肉眼就看得出來,不需要靠量測
          兩個框線的間距才能確認。 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: SIDEBAR_TOP,
          background: 'repeating-linear-gradient(45deg, rgba(234, 179, 8, 0.25), rgba(234, 179, 8, 0.25) 6px, rgba(234, 179, 8, 0.08) 6px, rgba(234, 179, 8, 0.08) 12px)',
          border: '2px dashed #eab308',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: SIDEBAR_TOP / 2 - 8,
          right: 12,
          padding: '2px 6px',
          borderRadius: 4,
          background: '#eab308',
          color: '#1c1815',
          font: '600 11px/1.4 ui-monospace, monospace',
          whiteSpace: 'nowrap',
        }}
      >
        留白 {SIDEBAR_TOP}px
      </div>

      {/* 紫色虛線框——側欄(PlanOverlayPanelWide 的 .panel)的實際範圍:
          貼齊右緣、固定寬度,頂部留出 SIDEBAR_TOP 空間給漂浮導覽列、
          底部留出 COMPOSER_BAND_HEIGHT 空間給 composer。2026-10(使用者
          明確指出「composer 跟上面區域重疊了」「區域還是重疊啊」後
          查出的真實疏漏):.panel 本身已經改成 bottom: 86px(見
          PlanOverlayPanelWide.module.css 的完整說明),但這個紫色框線
          的 bottom 一直停在 0,沒有同步——debug 疊圖呈現的側欄範圍跟
          真實 DOM 不一致,看起來紫色框跟底部黃色留白帶還是重疊,但那
          其實只是疊圖本身畫錯,不是真實版面的 bug(真實 .panel 早就
          正確縮減了)。 */}
      <div
        style={{
          position: 'absolute',
          top: SIDEBAR_TOP,
          right: 0,
          bottom: COMPOSER_BAND_HEIGHT,
          width: SIDEBAR_WIDTH,
          border: '2px dashed #a855f7',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: SIDEBAR_TOP + 8,
          right: 12,
          padding: '2px 6px',
          borderRadius: 4,
          background: '#a855f7',
          color: '#fff',
          font: '600 11px/1.4 ui-monospace, monospace',
          whiteSpace: 'nowrap',
        }}
      >
        側欄 {SIDEBAR_WIDTH}px
      </div>

      {/* 黃色網底區塊——頁面底部刻意留白的範圍(bottom: 0 到
          COMPOSER_BAND_HEIGHT),對齊上方頂部留白帶的做法(2026-10,
          使用者明確要求「composer 區也要一整列」「也是不要重疊」):
          composer 插槽本身只佔頁面中段 560px 寬,但底下這整條高度
          在版面上都該被保留,橫跨整個頁面寬度標示,不是只畫 composer
          本身的寬度框線。 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: COMPOSER_BAND_HEIGHT,
          background: 'repeating-linear-gradient(45deg, rgba(234, 179, 8, 0.25), rgba(234, 179, 8, 0.25) 6px, rgba(234, 179, 8, 0.08) 6px, rgba(234, 179, 8, 0.08) 12px)',
          border: '2px dashed #eab308',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: COMPOSER_BAND_HEIGHT / 2 - 8,
          left: 12,
          padding: '2px 6px',
          borderRadius: 4,
          background: '#eab308',
          color: '#1c1815',
          font: '600 11px/1.4 ui-monospace, monospace',
          whiteSpace: 'nowrap',
        }}
      >
        留白 {COMPOSER_BAND_HEIGHT}px
      </div>

      {/* 橙色虛線框——composer 插槽(.composerSlot)的範圍:貼底置中,
          寬度上限對齊 PlanOverlayPanelWide.module.css 的
          min(560px, calc(100% - 48px))——這裡簡化成固定 560 減左右
          各 COMPOSER_SIDE_MARGIN,在一般桌面寬度下跟實際計算值一致,
          純視覺核對不需要照抄 CSS 的 min() 運算。 */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: COMPOSER_BOTTOM,
          transform: 'translateX(-50%)',
          width: SIDEBAR_WIDTH - COMPOSER_SIDE_MARGIN * 2,
          height: COMPOSER_HEIGHT,
          border: '2px dashed #f97316',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: COMPOSER_BOTTOM + COMPOSER_HEIGHT + 4,
          transform: 'translateX(-50%)',
          padding: '2px 6px',
          borderRadius: 4,
          background: '#f97316',
          color: '#fff',
          font: '600 11px/1.4 ui-monospace, monospace',
          whiteSpace: 'nowrap',
        }}
      >
        composer 插槽
      </div>
    </div>
  )
}
