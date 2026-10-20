// integrationServerCheck.ts — *.integration.test.ts(x) 共用的「本機
// server 是否真的在跑」探測邏輯,從 api.plan-ai-guest.integration.
// test.ts 最初的 serverUp/maybeIt 寫法抽出來(2026-10,新增第二份整合
// 測試 AskPage.candidates.integration.test.tsx 時發現兩份檔案需要同一
// 套邏輯,不應該各自複製一份、日後容易漂移走樣)。
//
// 設計理由(沿用原本寫在 api.plan-ai-guest.integration.test.ts 的既有
// 說明):
//   - 用 top-level await 在模組載入階段(呼叫任何 it() 之前)就同步探測
//     完成,而不是 beforeAll——vitest 的 it()/it.skip() 是在「定義期」
//     (describe 區塊同步執行那一刻)決定要不要註冊這個案例,beforeAll
//     的 callback 要到所有案例都定義完之後、真正執行前才會跑,這個
//     時間點已經來不及回頭把某個 it 改成 it.skip。
//   - server 探測不到時每個案例改用 it.skip 註冊(vitest 報表上明確
//     標示為「跳過」),不是在 it() 內部 `if (!serverUp) return`——後者
//     的案例仍然會被判定「通過」,容易讓人誤以為真的測到了東西。
//   - 每個呼叫 checkIntegrationServerUp() 的測試檔案各自觸發一次
//     /health 探測(不做跨檔案快取)——vitest 預設每個測試檔案在獨立的
//     worker/模組環境執行,跨檔案共用一個模組層級變數不保證可靠,寧可
//     每個檔案各自探測一次(/health 本身極輕量),也不要依賴不保證成立
//     的跨檔案共用狀態。
import { describe, it } from 'vitest'

const BASE_URL = 'http://localhost:8080'

export async function checkIntegrationServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}

// ItLike——maybeDescribe 的 callback 參數型別:serverUp 為 true 時是
// vitest 的 it 本身,false 時是 it.skip,呼叫端(各整合測試檔案)不需要
// 知道背後是哪一個,只需要照平常寫 it(name, fn, timeout) 的方式呼叫。
// 刻意只描述「呼叫端實際會用到的那個簽名」,不是 typeof it 整個型別——
// it 跟 it.skip 在 vitest 的型別上是同一個 TestAPI 底下不同屬性,各自
// 完整型別(含 .each/.for 等子方法)不完全互通,直接用 typeof it 會讓
// TypeScript 認為 it.skip 不能指派給它;這裡只需要兩者共同具備的
// 「(name, fn, timeout?) => void」這個呼叫形狀,縮小型別範圍即可相容。
export type ItLike = (name: string, fn: () => void | Promise<void>, timeout?: number) => void

// maybeDescribe——包一層 describe,內部先探測 server、印出明確提示,
// 再把對應的 it/it.skip 交給呼叫端的 callback 使用。呼叫端用
// `await maybeDescribe(...)`(top-level await,見上方完整說明)。
export async function maybeDescribe(name: string, defineTests: (it: ItLike) => void): Promise<void> {
  const serverUp = await checkIntegrationServerUp()
  if (!serverUp) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${name}] 偵測不到 ${BASE_URL} 在跑,這份整合測試需要本機 server 真的啟動(含 PostgreSQL、GOOGLE_PLACES_API_KEY)才能執行,以下案例會全部跳過。`,
    )
  }
  describe(name, () => {
    defineTests(serverUp ? it : it.skip)
  })
}
