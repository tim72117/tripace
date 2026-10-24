import { Composer } from '../../components/Composer'
import styles from './Content.module.css'

// SimComposer(/ai-plan 模擬態,planning/preview/)——模擬層的輸入列(composer 插槽的內容)。
//
// 與 SimPlanLayer 一起是 /ai-plan 模擬態在第 4 層的呼叫端:Content 依 handedOver,模擬態渲染 SimPlanLayer 並把這個元件
// 當 composer 傳給 PlanOverlayLayout;推論態的輸入框則由 LivePlanLayer 內的 TripPlanPage 經 ComposerSlotContext portal
// 進同一個插槽。這個元件是展示用的假輸入膠囊(假打字動畫唯讀,排完後變「讓我試看看」按鈕),狀態由 Content 持有。
export interface SimComposerProps {
  composerCollapsed: boolean
  handedOver: boolean
  typedPrompt: string
  userPrompt: string
  setUserPrompt: (value: string) => void
  handover: () => void
}

export function SimComposer({ composerCollapsed, handedOver, typedPrompt, userPrompt, setUserPrompt, handover }: SimComposerProps) {
  return (
    // Composer——共用輸入膠囊外框(components/Composer.tsx,見該檔頭
    // 的完整背景說明)。這個展示頁的特有邏輯(假打字動畫唯讀、
    // composerCollapsed 後整個切換成「讓我試看看」CTA)留在這裡
    // 透過 props 組裝,共用元件不知道這些概念。
    //
    // presentational——2026-10 使用者明確要求:「composer 應該用
    // 一個展示態來表達,而不是單純關閉送出,展示態的時候送出樣式
    // 要正常,但是不能點送出」(見 Composer.tsx 該 prop 的完整
    // 說明)。這個展示頁從「打字動畫進行中」到「排完一站都還沒到
    // 第 5 站」整段期間,送出鈕全程都是這個狀態——輸入框是純展示
    // 用的假打字動畫(見 typedPrompt 的完整說明),不接受真的輸入、
    // 不會真的送出任何請求,但視覺上應該完全像一個「正常、能用」
    // 的輸入框,不該讓訪客一眼看出「這是灰掉的假東西」。取代先前
    // 「預設 disabled 淡化,打字中那一刻另外疊加 sendBtnActive
    // 抵銷淡化樣式」的拼湊寫法——那個寫法只覆蓋了「打字中」這一
    // 個特例,排完第一站後到第 5 站之前這段期間其實仍然是淡化的,
    // 跟「送出鈕全程該是正常樣式」的真正意圖不符,改用
    // presentational 後不再需要特例判斷,整段期間自然一致。
    //
    // 2026-10(第三輪):「讓我試看看」出現時(composerCollapsed 且
    // 尚未 handedOver)輸入框整個從 DOM 移除、按鈕置中顯示(使用者
    // 明確要求「按鈕置中,移除輸入匡」)——取代先前「輸入框收合
    // 讓位、按鈕展開動畫」的版本(見 .module.css .composerCta 的
    // 完整說明:那一版同一顆 <button> 疊加 class 做 width
    // transition,這版輸入框是條件渲染、不是 class 切換,沒有連續
    // 的寬度狀態可以 transition,改用 opacity 淡入)。交接後
    // (handedOver)輸入框恢復渲染、開放輸入,不再是 presentational
    // ——這時是正式功能,真的要能送出。(現況:這個 Composer 只渲染在
    // 播放態的 PlanLayout;交接後的輸入框改由 LivePlanLayer 內的
    // TripPlanPage 經 ComposerSlotContext portal 進 composer 插槽,
    // 這裡的 handedOver 分支只是殘留。)
    <Composer
      bare={composerCollapsed && !handedOver}
      hideInput={composerCollapsed && !handedOver}
      inputRowClassName={styles.inputRow}
      ariaLabel={handedOver ? '描述你想要的行程' : '輸入指令(僅供展示)'}
      placeholder={handedOver ? '想去哪裡玩?例如:台南兩天一夜' : undefined}
      value={handedOver ? userPrompt : typedPrompt}
      onChange={handedOver ? setUserPrompt : undefined}
      readOnly={!handedOver}
      presentational={!handedOver && !composerCollapsed}
      // composerCta——排程結束後出現的行動呼籲按鈕,文案「讓我試
      // 看看」(2026-10 從「立即使用」改,使用者明確要求),點擊要
      // 導向登入頁面(/app,對齊首頁 SiteNavCta 的「登入」按鈕同樣
      // 指向 /app——未登入時 /app 本身就會顯示登入畫面,見
      // planning/member/phone/Content.tsx 的既有行為,不需要另外一個獨立的 /login
      // 路由)。仍是同一顆送出鈕(進行中是箭頭 icon,結束後疊上
      // .composerCta 變成文字按鈕)——這顆按鈕本身的身分沒有變,
      // 只有旁邊的輸入框從「收合」改成「整個移除」(見上方完整
      // 說明)。排到第 5 站前透過 presentational 擋下 onSubmit,
      // 不需要額外判斷 composerCollapsed 才能呼叫 navigate——
      // onSubmit 只有在不是 presentational 時才會真的被呼叫。
      onSubmit={handover}
      sendButtonAriaLabel={composerCollapsed ? '讓我試看看' : '送出'}
      sendButtonClassName={composerCollapsed ? styles.composerCta : ''}
      sendButton={composerCollapsed ? '讓我試看看' : undefined}
    />
  )
}
