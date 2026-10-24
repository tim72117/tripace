// planTimelineDrafts.ts — 「多份行程草稿」管理層,2026-10 新增(使用者
// 明確要求 /ai-plan 展示頁交接後的手機版畫面能「新增一份全新的行程草稿,
// 舊的保留起來,供未來叫出清單」)。
//
// 架構決策:不改動 planTimelineStorage.ts 既有的 PlanTimelineStore 介面
// 契約(readRev/loadTimelineWithRev/saveTimeline 三個方法的行為完全不變,
// /app、desktop/Content.tsx 等既有呼叫端繼續用固定 key 的
// localStoragePlanTimelineStore,不受任何影響)——而是在它之上疊加一層
// 獨立模組:
//   1. 這裡新增一組「行程清單」的 localStorage key(DRAFTS_INDEX_KEY),
//      存每一份草稿的 id/建立時間/標題摘要,供未來「叫出舊行程清單」UI
//      讀取顯示(這一輪不做那個 UI,但清單資料本身已經在寫入路徑裡
//      維護,不是事後才要補的死路)。
//   2. 每一份草稿的實際 PlanTimeline 內容各自存在獨立的 localStorage key
//      (draftTimelineKey(id)),序列化邏輯直接重用 planTimelineStorage.ts
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

import { isTimelineEmpty, type PlanTimeline } from './planTimeline'
import { readRevForKey, loadTimelineWithRevForKey, saveTimelineForKey, type PlanTimelineStore } from './planTimelineStorage'

// DRAFTS_INDEX_KEY——行程草稿清單,沿用專案既有的 tripace.* 前綴慣例
// (見 planTimelineStorage.ts PLAN_TIMELINE_STORAGE_KEY 的同一套命名)。
export const DRAFTS_INDEX_KEY = 'tripace.planTimeline.drafts'

// DRAFT_TIMELINE_KEY_PREFIX——每一份草稿各自的時間軸內容 key 前綴,接上
// 草稿 id 組成完整 key(見 draftTimelineKey)。跟現有單一草稿的固定 key
// (PLAN_TIMELINE_STORAGE_KEY = 'tripace.planTimeline')刻意分開在不同的
// key 空間下,不會互相覆蓋或混淆——目前使用中的「單一草稿」情境
// (/app、desktop/Content.tsx)完全不會讀寫到這個前綴底下的任何 key。
const DRAFT_TIMELINE_KEY_PREFIX = 'tripace.planTimeline.draft.'

export function draftTimelineKey(draftId: string): string {
  return `${DRAFT_TIMELINE_KEY_PREFIX}${draftId}`
}

// DraftSummary——行程清單裡每一筆草稿的摘要資訊,供未來「叫出舊行程
// 清單」UI 顯示用(這一輪不做那個 UI,但資料已經在這裡維護)。
//   - id:對應 draftTimelineKey(id) 底下的實際時間軸內容。
//   - createdAt:建立時間(epoch ms),清單可以依此排序。
//   - title——選填簡短標題/摘要。目前呼叫端(LivePlanLayer.tsx)沒有
//     真正的行程標題資訊可用(/ai-plan 這個入口的草稿還沒有命名機制),
//     先留著欄位讓未來的清單 UI/呼叫端可以選擇性補上,不強制。
export interface DraftSummary {
  id: string
  createdAt: number
  title?: string
}

// DraftsIndex——實際寫進 DRAFTS_INDEX_KEY 的形狀。version 欄位理由同
// planTimelineStorage.ts STORAGE_VERSION 的既有說明:結構不相容時整份
// 丟棄,不嘗試渲染出半殘的清單。
const DRAFTS_INDEX_VERSION = 1
interface DraftsIndex {
  version: number
  drafts: DraftSummary[]
}

// readDraftsIndex——讀出目前的草稿清單,格式不符或沒存過一律回傳空清單
// (理由同 planTimelineStorage.ts parseTimeline 的既有防禦性做法)。
export function readDraftsIndex(): DraftSummary[] {
  try {
    const raw = localStorage.getItem(DRAFTS_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const idx = parsed as Partial<DraftsIndex>
    if (idx.version !== DRAFTS_INDEX_VERSION || !Array.isArray(idx.drafts)) return []
    return idx.drafts.filter(
      (d): d is DraftSummary => !!d && typeof d.id === 'string' && typeof d.createdAt === 'number',
    )
  } catch {
    return []
  }
}

function writeDraftsIndex(drafts: DraftSummary[]): void {
  try {
    const payload: DraftsIndex = { version: DRAFTS_INDEX_VERSION, drafts }
    localStorage.setItem(DRAFTS_INDEX_KEY, JSON.stringify(payload))
  } catch {
    // 見 planTimelineStorage.ts saveTimeline 的既有降級慣例:清單只是
    // 「供未來 UI 顯示」的輔助資料,寫入失敗不影響這次「新行程」動作
    // 本身是否成功(archiveDraft/startNewDraft 仍然會繼續往下執行,只是
    // 這筆清單紀錄這次沒能寫入)。
  }
}

// archiveDraft——把一筆草稿加進清單(存在就更新,不存在就新增)。不刪除
// 它的實際時間軸內容(draftTimelineKey 底下的 key 完全不動)——這正是
// 「保留舊草稿」這個需求的落地:清單只是索引,實際內容一直都在,「加進
// 清單」純粹是讓它以後可以被「叫出清單」UI 找到並開啟。
function archiveDraft(summary: DraftSummary): void {
  const drafts = readDraftsIndex()
  const next = drafts.filter((d) => d.id !== summary.id)
  next.push(summary)
  writeDraftsIndex(next)
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
    archiveDraft({ id: currentDraftId ?? LEGACY_DRAFT_ID, createdAt: Date.now() })
  }
  // 新草稿不在這裡記進清單:它還是空白的,而清單只收「有內容」的草稿
  // (見 planTimeline.ts 的 isTimelineEmpty:完全沒有節點,空的天不算內容)。等使用者在它上面排了東西、之後又按「新行程」
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
// 內部直接重用 planTimelineStorage.ts 既有的 readRevForKey/
// loadTimelineWithRevForKey/saveTimelineForKey(見該檔案的完整說明:
// 這三個函式是原本寫死 PLAN_TIMELINE_STORAGE_KEY 的 readRev/
// loadTimelineWithRev/saveTimeline 參數化後的版本,序列化格式/版本檢查/
// rev 機制完全是同一份邏輯,不是重新發明一套)——這裡只是把 key 固定
// 綁定成這份草稿自己的 draftTimelineKey(draftId),其餘行為(含失敗時
// 的降級語意)跟既有的 localStoragePlanTimelineStore 完全一致。
export function createDraftPlanTimelineStore(draftId: string): PlanTimelineStore {
  const key = draftTimelineKey(draftId)
  return {
    readRev: () => readRevForKey(key),
    loadTimelineWithRev: () => loadTimelineWithRevForKey(key),
    saveTimeline: (timeline, baseRev) => saveTimelineForKey(key, timeline, baseRev),
  }
}
