// drafts.ts(planning/timeline)— 「多份行程草稿」管理層,2026-10 新增(使用者
// 明確要求 /ai-plan 展示頁交接後的手機版畫面能「新增一份全新的行程草稿,
// 舊的保留起來,供未來叫出清單」)。
//
// 架構決策:不改動 storage.ts 既有的 PlanTimelineStore 介面
// 契約(readRev/loadTimelineWithRev/saveTimeline 三個方法的行為完全不變,
// /app、planning/member/desktop/Content.tsx 等既有呼叫端繼續用固定 key 的
// localStoragePlanTimelineStore,不受任何影響)——而是在它之上疊加一層
// 獨立模組:
//   1. 這裡新增一組「行程清單」的 localStorage key(DRAFTS_INDEX_KEY),
//      存每一份草稿的 id/建立時間/標題摘要,供未來「叫出舊行程清單」UI
//      讀取顯示(這一輪不做那個 UI,但清單資料本身已經在寫入路徑裡
//      維護,不是事後才要補的死路)。
//   2. 每一份草稿的實際 PlanTimeline 內容各自存在獨立的 localStorage key
//      (draftTimelineKey(id)),序列化邏輯直接重用 storage.ts
//      既有的 saveTimeline/loadTimelineWithRev/readRev(見
//      createDraftPlanTimelineStore 的完整說明:不是重新發明一套存檔
//      格式,只是把原本寫死的單一 PLAN_TIMELINE_STORAGE_KEY 參數化成
//      可以指定任意 key)。
//   3. createDraftPlanTimelineStore(key) 回傳一個完整符合
//      PlanTimelineStore 介面的實例,呼叫端(LivePlanLayer.tsx)把它當
//      TripPlanPage 的 store prop 傳入即可——TripPlanPage/
//      usePlanTimelineCore 完全不需要知道「多份草稿」這件事存在,它們
//      看到的永遠只是「一個 store」,跟現有單一草稿的使用方式一模一樣。
//
// 「新行程」動作(startNewDraft)本身只做兩件事:(a) 把目前這份草稿的
// id(若有內容)記進清單——不刪除它的 localStorage 內容,只是不再是
// 目前使用中的那一份;(b) 產生一個新的草稿 id 回傳給呼叫端(新草稿是
// 空白的,不會先進清單,等它有內容後才由下一次「新行程」歸檔)。
// 呼叫端(LivePlanLayer.tsx)拿到新 id 後,透過 React key 讓 TripPlanPage
// 整個重新掛載,改用指向新 id 的 store——不需要 usePlanTimelineCore 內部
// 支援「執行中途切換 store」這種複雜狀態轉移。
//
// 2026-10 第二輪(使用者明確要求「/ai-plan 中的前端持久存放,加入 trip
// 的概念」):第一輪的 DraftSummary 只有 id/createdAt,清單裡每一筆
// 看起來都是一串沒有意義的 UUID,無法跟使用者溝通「這是哪一趟行程」。
// 這一輪補上兩件事,讓草稿真正像一筆「trip」而不只是一個儲存 key:
//   1. 標題(title,見 deriveDraftTitle)——從時間軸內容自動推導,不
//      要求使用者額外輸入;
//   2. 最後編輯時間(updatedAt,見 touchDraft)——每次存檔都更新,不是
//      只有切換草稿那一刻的舊快照,「叫出舊行程清單」UI(尚未實作)
//      未來可以直接依這個欄位排序顯示「最近使用」。
// 仍然不接後端、不碰真正的 /v1/trips 資料模型——這是刻意縮小的範圍
// (比較前端草稿結構化 vs. 接上正式 Trip 資料模型兩個方向後,先做
// 前者),好處是訪客(未登入)也能用,不需要先解決身分/後端 API 串接。

import { isTimelineEmpty, listNodes, type PlanTimeline } from './model'
import { readRevForKey, loadTimelineWithRevForKey, saveTimelineForKey, type PlanTimelineStore } from './storage'

// DRAFTS_INDEX_KEY——行程草稿清單,沿用專案既有的 tripace.* 前綴慣例
// (見 storage.ts PLAN_TIMELINE_STORAGE_KEY 的同一套命名)。
export const DRAFTS_INDEX_KEY = 'tripace.planTimeline.drafts'

// DRAFT_TIMELINE_KEY_PREFIX——每一份草稿各自的時間軸內容 key 前綴,接上
// 草稿 id 組成完整 key(見 draftTimelineKey)。跟現有單一草稿的固定 key
// (PLAN_TIMELINE_STORAGE_KEY = 'tripace.planTimeline')刻意分開在不同的
// key 空間下,不會互相覆蓋或混淆——目前使用中的「單一草稿」情境
// (/app、planning/member/desktop/Content.tsx)完全不會讀寫到這個前綴底下的任何 key。
const DRAFT_TIMELINE_KEY_PREFIX = 'tripace.planTimeline.draft.'

export function draftTimelineKey(draftId: string): string {
  return `${DRAFT_TIMELINE_KEY_PREFIX}${draftId}`
}

// DraftSummary——行程清單裡每一筆草稿的摘要資訊,供「叫出舊行程清單」
// UI 顯示用(2026-10 第二輪,使用者明確要求「/ai-plan 中的前端持久
// 存放,加入 trip 的概念」:讓每一份草稿有可辨識的名稱跟最後編輯時間,
// 不再只是一個無意義的 UUID)。
//   - id:對應 draftTimelineKey(id) 底下的實際時間軸內容。
//   - createdAt:建立時間(epoch ms),第一次有內容被記錄進清單的時刻。
//   - updatedAt(2026-10 新增)——最後一次成功存檔的時間(epoch ms)。
//     跟 createdAt 分開是因為「哪份行程最近在編輯」比「哪份最早建立」
//     更適合當清單預設排序依據(對齊使用者熟悉的「最近使用」慣例,例如
//     檔案總管/筆記軟體的既有清單排序方式),見 sortDraftsByRecent。
//   - title(2026-10 第二輪,從選填改必填)——簡短標題,見 deriveDraftTitle
//     的完整說明:不要求使用者手動命名,從時間軸內容自動推導,保持
//     「免輸入就能用」的既有體驗(對齊這個入口原本就是訪客免登入展示頁
//     的定位)。
export interface DraftSummary {
  id: string
  createdAt: number
  updatedAt: number
  title: string
}

// FALLBACK_DRAFT_TITLE——時間軸完全沒有站點時的預設標題(理論上不會
// 發生:touchDraft 只在存檔時呼叫,而存檔前置條件通常是已經有內容;
// 但防禦性地處理,避免清單出現空字串標題這種看起來像資料損壞的情況)。
const FALLBACK_DRAFT_TITLE = '新行程'

// deriveDraftTitle——從時間軸內容推導一個簡短標題,不需要使用者手動
// 命名。規則:取前兩個有名稱的站點,用「、」接起來(例如「九份老街、
// 阿妹茶樓」),超過兩站時加「⋯等」結尾表示還有更多站點——不窮舉全部
// 站名,那會讓標題過長、在清單裡難以快速辨識。沒有任何站點有名稱時
// (例如還在查詢中、佔位字串尚未被真實資料覆蓋)退回 FALLBACK_DRAFT_TITLE,
// 不顯示空字串或 undefined 字樣。
export function deriveDraftTitle(timeline: PlanTimeline): string {
  const names = listNodes(timeline)
    .map((n) => n.name)
    .filter((n): n is string => !!n && n.trim() !== '')
  if (names.length === 0) return FALLBACK_DRAFT_TITLE
  const shown = names.slice(0, 2).join('、')
  return names.length > 2 ? `${shown}⋯等` : shown
}

// sortDraftsByRecent——清單預設排序:最近編輯的排最前面。純函式,不
// 修改傳入的陣列(回傳新陣列),理由同專案既有的 sortByNewest 等純函式
// 慣例,方便測試與避免呼叫端意外依賴到原陣列已被排序這件事。
export function sortDraftsByRecent(drafts: DraftSummary[]): DraftSummary[] {
  return [...drafts].sort((a, b) => b.updatedAt - a.updatedAt)
}

// DraftsIndex——實際寫進 DRAFTS_INDEX_KEY 的形狀。version 欄位理由同
// storage.ts STORAGE_VERSION 的既有說明:結構不相容時整份
// 丟棄,不嘗試渲染出半殘的清單。
//
// drafts 這裡刻意宣告成 unknown[] 而非 DraftSummary[]——這份介面描述的
// 是「序列化寫入時」的目標形狀(writeDraftsIndex 永遠寫出完整的
// DraftSummary),但讀取時(readDraftsIndex)runtime 資料可能來自舊版本
// (缺 updatedAt/title),若宣告成 DraftSummary[] 會讓下方的欄位補值邏輯
// 在型別層面顯得「多此一舉」,實際上防禦的正是這個型別宣告保證不了的
// 落差。
const DRAFTS_INDEX_VERSION = 1
interface DraftsIndex {
  version: number
  drafts: unknown[]
}

// readDraftsIndex——讀出目前的草稿清單,格式不符或沒存過一律回傳空清單
// (理由同 storage.ts parseTimeline 的既有防禦性做法)。
//
// updatedAt/title 容錯(2026-10 第二輪新增這兩個欄位後):舊版寫入的
// 項目(第一輪上線期間產生的清單資料)沒有這兩個欄位,不是「格式不符」
// 整筆丟棄——那樣會讓既有使用者既有的草稿清單無預警消失。改成補上
// 合理的預設值(updatedAt 退回 createdAt,title 用 FALLBACK_DRAFT_TITLE)
// 讀進來,下一次 touchDraft 存檔時會自然補上正確值,不需要一次性遷移
// 腳本。
export function readDraftsIndex(): DraftSummary[] {
  try {
    const raw = localStorage.getItem(DRAFTS_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const idx = parsed as Partial<DraftsIndex>
    if (idx.version !== DRAFTS_INDEX_VERSION || !Array.isArray(idx.drafts)) return []
    return idx.drafts
      .map((d) => (d && typeof d === 'object' ? (d as Partial<DraftSummary>) : null))
      .filter(
        (d): d is Partial<DraftSummary> & { id: string; createdAt: number } =>
          !!d && typeof d.id === 'string' && typeof d.createdAt === 'number',
      )
      .map((d) => ({
        id: d.id,
        createdAt: d.createdAt,
        updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : d.createdAt,
        title: typeof d.title === 'string' && d.title.trim() !== '' ? d.title : FALLBACK_DRAFT_TITLE,
      }))
  } catch {
    return []
  }
}

function writeDraftsIndex(drafts: DraftSummary[]): void {
  try {
    const payload: DraftsIndex = { version: DRAFTS_INDEX_VERSION, drafts }
    localStorage.setItem(DRAFTS_INDEX_KEY, JSON.stringify(payload))
  } catch {
    // 見 storage.ts saveTimeline 的既有降級慣例:清單只是
    // 「供未來 UI 顯示」的輔助資料,寫入失敗不影響這次「新行程」動作
    // 本身是否成功(archiveDraft/startNewDraft 仍然會繼續往下執行,只是
    // 這筆清單紀錄這次沒能寫入)。
  }
}

// upsertDraft——把一筆草稿加進清單(存在就更新,不存在就新增)。不刪除
// 它的實際時間軸內容(draftTimelineKey 底下的 key 完全不動)——這正是
// 「保留舊草稿」這個需求的落地:清單只是索引,實際內容一直都在,「加進
// 清單」純粹是讓它以後可以被「叫出清單」UI 找到並開啟。
//
// 若這筆 id 已經在清單裡,保留它原本的 createdAt(建立時間不該因為
// 之後再次存檔而改變),只更新 updatedAt/title——這是 archiveDraft(見
// startNewDraft)跟 touchDraft 共用的底層邏輯,2026-10 第二輪合併成
// 一個函式,避免兩處各自維護一份幾乎一樣的 upsert 寫法而悄悄不同步。
function upsertDraft(id: string, title: string, timestamp: number): void {
  const drafts = readDraftsIndex()
  const existing = drafts.find((d) => d.id === id)
  const next = drafts.filter((d) => d.id !== id)
  next.push({ id, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, title })
  writeDraftsIndex(next)
}

// touchDraft——每次這份草稿成功存檔時呼叫(見 createDraftPlanTimelineStore
// 的 saveTimeline 包裝),把它的最新標題/最後編輯時間同步進清單——不等
// 使用者按下一次「新行程」才記錄,讓「叫出舊行程清單」UI 隨時都能看到
// 正確的最新狀態,而不是只有切換草稿那一刻的舊快照。
//
// 空白時間軸(isTimelineEmpty)不寫入清單,理由同 startNewDraft 既有的
// 防呆說明:連按「新行程」或剛建立還沒排任何站點的草稿,不該在清單裡
// 留下一筆看起來像「有行程但其實空白」的項目。
export function touchDraft(draftId: string, timeline: PlanTimeline): void {
  if (isTimelineEmpty(timeline)) return
  upsertDraft(draftId, deriveDraftTitle(timeline), Date.now())
}


// startNewDraft——「新行程」按鈕的核心邏輯。
//
// currentDraftId/currentTimeline——目前使用中的草稿 id 與它的時間軸內容
// (呼叫端自己從目前的 store 讀出來傳進來,這個函式不負責讀取,保持純
// 函式/易測試)。currentDraftId 為 null 代表目前還沒有任何「草稿 id」
// 概念在用(例如交接當下第一次呼叫,還在用舊的固定 PLAN_TIMELINE_STORAGE_KEY
// 那份內容,見 LivePlanLayer.tsx 的完整說明)——這種情況下如果目前內容
// 非空,仍然值得保留,用舊的固定 key 本身當作這筆歸檔的 id(讀寫邏輯見
// draftTimelineKey 與舊 key 本來就是兩個不同的 key 空間,不會互相干擾,
// 歸檔只是在清單裡記一筆指向舊 key 內容「邏輯上」存在過,未來叫出清單
// UI 需要另外支援「舊 key」這個特例——這裡先把 id 設計成固定字串
// 'legacy',呼叫端/未來的清單 UI 可以據此判斷要去讀哪個 key)。
//
// 回傳新草稿的 id——呼叫端據此建構新的 store(見
// createDraftPlanTimelineStore)並讓 TripPlanPage 以新 key 重新掛載。
export const LEGACY_DRAFT_ID = 'legacy'

export function startNewDraft(currentDraftId: string | null, currentTimeline: PlanTimeline): string {
  if (!isTimelineEmpty(currentTimeline)) {
    upsertDraft(currentDraftId ?? LEGACY_DRAFT_ID, deriveDraftTitle(currentTimeline), Date.now())
  }
  // 新草稿不在這裡記進清單:它還是空白的,而清單只收「有內容」的草稿
  // (見 model.ts 的 isTimelineEmpty:完全沒有節點,空的天不算內容)。等使用者在它上面排了東西、之後又按「新行程」
  // 時,上面的歸檔分支會以這個 id 把它加進去。
  //
  // 曾經在這裡先寫入一筆(想讓「目前使用中」也可追溯),但那筆空白項目
  // 沒有任何路徑會被移除——使用者連按「新行程」時,每次都會留下上一輪
  // 的空白草稿,清單被空白項目灌爆,正是 isTimelineEmpty 想避免的事。
  const newId = crypto.randomUUID()
  return newId
}

// createDraftPlanTimelineStore——幫某一份草稿 id 建立一個完整符合
// PlanTimelineStore 介面的 store 實例,供 LivePlanLayer.tsx 當
// TripPlanPage 的 store prop 傳入。
//
// 內部直接重用 storage.ts 既有的 readRevForKey/
// loadTimelineWithRevForKey/saveTimelineForKey(見該檔案的完整說明:
// 這三個函式是原本寫死 PLAN_TIMELINE_STORAGE_KEY 的 readRev/
// loadTimelineWithRev/saveTimeline 參數化後的版本,序列化格式/版本檢查/
// rev 機制完全是同一份邏輯,不是重新發明一套)——這裡只是把 key 固定
// 綁定成這份草稿自己的 draftTimelineKey(draftId),其餘行為(含失敗時
// 的降級語意)跟既有的 localStoragePlanTimelineStore 完全一致。
//
// saveTimeline 額外呼叫 touchDraft(2026-10 第二輪新增)——每次這份
// 草稿的內容被存檔,順便把清單裡對應那一筆的標題/最後編輯時間同步
// 更新,不需要呼叫端(TripPlanPage/usePlanTimelineCore)知道「清單」
// 這件事存在,它們看到的仍然只是一個符合 PlanTimelineStore 介面的
// store,saveTimeline 回傳值/行為跟原本完全一致,touchDraft 只是
// 存檔成功後的額外副作用。只在 saveTimelineForKey 真的成功(回傳非
// null)時才 touch——樂觀鎖衝突失敗時不該誤更新清單的最後編輯時間。
export function createDraftPlanTimelineStore(draftId: string): PlanTimelineStore {
  const key = draftTimelineKey(draftId)
  return {
    readRev: () => readRevForKey(key),
    loadTimelineWithRev: () => loadTimelineWithRevForKey(key),
    saveTimeline: (timeline, baseRev) => {
      const newRev = saveTimelineForKey(key, timeline, baseRev)
      if (newRev !== null) touchDraft(draftId, timeline)
      return newRev
    },
  }
}
