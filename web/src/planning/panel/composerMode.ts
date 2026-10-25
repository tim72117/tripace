import type { AskPageInput } from '../conversation/asktools'

// composerMode——下方輸入匡(Composer)依目前畫面決定的狀態:提示文字、是否鎖住、送出要走哪條路。
// 2026-10 新增(使用者要求「輸入匡的提示文字依畫面變動」,並把景點候選頁的「我要直接說明」按鈕與展開的說明面板
// 改成「直接用下方輸入匡說明」)。規則集中在這裡的純函式,TripPlanPage 與測試(useAskPageFlow.test.tsx 的 Harness)
// 用同一份,不會一邊改了另一邊沒跟上。
//
// ask——目前顯示中的詢問頁 input(TripPlanPage 傳 showAskPage ? askPageInput : null);null 代表沒有詢問頁。

export interface ComposerModeArgs {
  isThinking: boolean
  ask: AskPageInput | null
}

// COMPOSER_PLACEHOLDER_MAX_EM——提示文字長度上限(以字級 em 計:全形字 1、英數字與半形符號 0.5)。
// 推算(最窄手機 320px 寬,/app 手機版):插槽左右 padding 16×2(member/phone/PlanOverlayLayout.module.css .composerSlot)
// → 288;膠囊 border 1×2 → 286;膠囊 padding 左 20 右 10(components/Composer.module.css .composer)→ 256;
// 送出鈕 36 + 間距 10(.sendBtn/.inputRow gap)→ 210;.inputWrap 左右 padding 6×2 → 198px 可用寬度。
// 字級 16px(.input),198 ÷ 16 ≈ 12.4,取 12。Composer 的 .input 沒有 text-overflow: ellipsis,超出時瀏覽器直接裁掉,
// 所以文案一律控制在這個上限內(composerMode.test.ts 逐一斷言)。
export const COMPOSER_PLACEHOLDER_MAX_EM = 12

// placeholderWidthEm——估算文字寬度(em):ASCII 可見字元算半寬,其餘(中文、全形標點、…)算全寬。
export function placeholderWidthEm(text: string): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) < 0x80 ? 0.5 : 1
  return w
}

// 文案原則:直接說「現在可以輸入什麼」,不加多餘前綴與贅字;詢問頁用「或直接…」表示也可以不點卡片、直接打字。
export const COMPOSER_PLACEHOLDER_DEFAULT = '請輸入想去的地方'
export const COMPOSER_PLACEHOLDER_THINKING = 'AI 思考中…'
export const COMPOSER_PLACEHOLDER_COUNTRY = '或直接輸入國家'
export const COMPOSER_PLACEHOLDER_CITY = '或直接輸入城市'
export const COMPOSER_PLACEHOLDER_CANDIDATES = '或直接說明想去哪'
export const COMPOSER_PLACEHOLDER_LOADING = '景點查詢中…'
export const COMPOSER_PLACEHOLDER_TRANSPORT = '或直接說明移動方式'
// COMPOSER_PLACEHOLDER_UNAVAILABLE——對話功能無法使用(apiKeyMissing/urlMissing)時,TripPlanPage 用這句取代上面的規則。
export const COMPOSER_PLACEHOLDER_UNAVAILABLE = '對話功能調整中，請稍候'

// askPageAwaitsText——這個詢問頁是否「在等使用者」、可以改用輸入匡的文字回答:國家/城市/交通/景點候選/探查。
// 不算的:選完城市後的查詢中(candidates.loading,使用者此刻要等,不是要回答)、純文字氣泡(不是詢問,只是 AI 的回覆)。
// 探查(explore)在 AskPage 內部自己查候選,這一層看不到它是否還在查,一律視為在等使用者(使用者想直接說明也合理)。
export function askPageAwaitsText(ask: AskPageInput | null): boolean {
  if (!ask) return false
  if ('text' in ask) return false
  if ('candidates' in ask) return !ask.loading
  return true
}

// composerPlaceholderFor——提示文字(長度上限見 COMPOSER_PLACEHOLDER_MAX_EM)。
export function composerPlaceholderFor({ isThinking, ask }: ComposerModeArgs): string {
  if (ask) {
    if ('country' in ask) return COMPOSER_PLACEHOLDER_COUNTRY
    if ('city' in ask) return COMPOSER_PLACEHOLDER_CITY
    if ('transport' in ask) return COMPOSER_PLACEHOLDER_TRANSPORT
    if ('candidates' in ask && ask.loading) return COMPOSER_PLACEHOLDER_LOADING
    if ('candidates' in ask || 'explore' in ask) return COMPOSER_PLACEHOLDER_CANDIDATES
    // text(純文字氣泡):沿用一般規則。
  }
  return isThinking ? COMPOSER_PLACEHOLDER_THINKING : COMPOSER_PLACEHOLDER_DEFAULT
}

export interface ComposerMode {
  placeholder: string
  // busy——傳給 Composer 的 busy:輸入框鎖住、送出鈕換成「停止」。推論中鎖住(pendingChatRef 的 FIFO 配對依賴任何時刻
  // 最多一筆 pending,見 TripPlanPage sendPrompt 的說明),但「有等待使用者的詢問頁」時不鎖:LLM 用 open_ask_page/
  // ask_travel_* 開出詢問頁時推論仍在進行(isThinking 為 true),使用者此刻要能直接打字回答。
  busy: boolean
  // answersAskPage——送出時改走 useAskPageFlow 的 submitAskPageText(結束目前的詢問頁、推論中排隊等這一輪結束再送)。
  answersAskPage: boolean
}

export function composerModeFor(args: ComposerModeArgs): ComposerMode {
  const answersAskPage = askPageAwaitsText(args.ask)
  return {
    placeholder: composerPlaceholderFor(args),
    busy: args.isThinking && !answersAskPage,
    answersAskPage,
  }
}

// routeComposerSubmit——輸入匡送出要走哪條路:'askPage'(submitAskPageText)、'prompt'(一般 sendPrompt)、
// 'ignore'(空白,或推論中鎖住時被 Enter 觸發的 submit——跟 busy 對齊的第二道防線)。
export function routeComposerSubmit(text: string, mode: ComposerMode): 'askPage' | 'prompt' | 'ignore' {
  if (!text.trim()) return 'ignore'
  if (mode.answersAskPage) return 'askPage'
  if (mode.busy) return 'ignore'
  return 'prompt'
}
