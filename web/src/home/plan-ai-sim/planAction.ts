import type { AskPageCandidate } from '../../plan-core/askPageTools'

// PlanAction — 後端 GET /public/plan-sim/ws(或日後任何真正的 agent
// 推論來源)推播的訊息形狀,對應 server/internal/api/plan_sim_ws.go 的
// planAction struct(欄位一一對應,JSON key 相同)。planActionToInsert
// 是新增類訊息的唯一轉換點,remove_step 的處理則直接寫在
// usePlanSimSocket 的 ws.onmessage 裡(見該處說明)。
export interface PlanAction {
  // thinking:每一筆實際 action 送出前的「思考中」信號(見
  // plan_sim_ws.go 的完整說明),前端收到時用來觸發/延續思考動畫、
  // 不對時間軸做任何異動(見 ws.onmessage 對這個 type 的處理——提早
  // return,不呼叫 planActionToInsert)。
  //
  // 2026-10 使用者明確要求「先分離推論中跟安排中的信號」,新增
  // nextType 欄位(只有 type === 'thinking' 時才有意義)——原本骨架卡
  // (isGenerating)只要收到任何 thinking 就顯示,但劇本裡 thinking
  // 前導的下一步不一定是 add_stop(也可能是 add_message 這種純旁白
  // 訊息、或 add_note),這種情況下骨架卡顯示了卻完全沒有對應的地點
  // 卡片可以轉場,使用者看到「骨架消失但畫面沒變化」會覺得困惑。改成
  // thinking 攜帶即將送出的下一步真正是什麼 type,接收端
  // (usePlanSimSocket)只在下一步是 add_stop 時才把 isGenerating 設
  // true、顯示骨架卡——「安排中」(骨架卡)跟「推論中」(任何 thinking
  // 都代表 AI 正在運作,但不一定可見)現在是兩個分開的概念,骨架卡只
  // 對應前者。
  nextType?: PlanAction['type']
  // nextId——2026-10 新增(使用者明確要求「安排中時就加入一張卡片,只是
  // 這張卡片沒有資料時就呈現骨架卡」):即將送出的下一步 action 的 id。
  // 骨架卡原本是獨立於 stops 之外、靠 isGenerating 旗標額外渲染的一塊
  // (見 HorizontalPlanTimeline.tsx 先前版本的完整說明),selectedStopId/
  // 自動捲動邏輯因此要另外處理「骨架卡還是地點卡」這個分支,多次踩坑
  // (捲動時機慢一拍、單卡滿版被撐歪等)。改成在 thinking 階段就真的
  // 插入一筆 loading:true、沒有任何資料的 stop 節點到 PlanTimeline
  // (見 ws.onmessage 的 thinking 分支),這個節點需要使用之後 add_stop
  // 訊息會用的同一個 id,之後才能用 updateNode 原地補上真實資料(而不是
  // 插入新節點、留下一個空節點孤兒)——nextId 就是為了讓 thinking 階段
  // 能預先知道「待會兒這個 id」。add_note 等後續動作的 afterId 也引用
  // 這個固定 id(見 planSimScript.ts 既有劇本),若骨架階段用不同的
  // 暫時 id,之後還要處理 id 置換,不如一開始就用對的 id。
  nextId?: string
  // reset——把時間軸清空、回到什麼都還沒排的狀態。
  //
  // 2026-10 為捲動驅動的展示(首頁 ScrollPlanDemo)新增:使用者往回捲時
  // 要看到行程一段一段退回去。PlanSimSource 是串流模型,無法「收回」
  // 已送出的訊息,所以回退的做法是「送一則 reset 清空、再重播到目標
  // 位置」(見 planSimScrollSource.ts 的 advanceTo)。計時器版永遠不會
  // 送這則,行為完全不受影響。
  //
  // reset_day——只清掉某一天(用 day 欄位指定),其餘天數保留。
  //
  // 2026-10 使用者明確要求「首頁展示,當往回滾到前一天時,清除當天的
  // 資料」:回捲跨過日界時,不該像 reset 那樣整個清空重播——那會讓
  // 已經看過的前幾天也跟著消失、再重捲一次才長回來。只清掉「正要退出
  // 的那一天」,前面幾天維持原樣,視覺上就是「這一天的安排被收回去」。
  // 搭配來源端把播放進度倒回那一天的第一步(見 planSimScrollSource.ts
  // advanceTo 的回退分支),再往下捲時這一天會重新一站一站排出來。
  type: 'thinking' | 'reset' | 'reset_day' | 'add_stop' | 'add_transit' | 'add_note' | 'add_message' | 'remove_step' | 'open_ask_page' | 'done'
  id?: string
  time?: string
  // day——這個 stop 屬於行程的第幾天,對齊 planTimeline.ts PlanNodeData.day
  // 的完整說明(省略視為第 1 天)。使用者明確要求「排程元件加入日的
  // 概念」後新增,讓這個展示頁的固定劇本(planSimScript.ts)能表達兩天
  // 行程,不需要每站時間在整條扁平時間軸上嚴格遞增。
  day?: number
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  // placeId:有值時代表這一步「AI 用工具查真實地點資料」——見
  // planActionToInsert 對這個欄位的轉換說明。2026-09 曾經一度改名成
  // attractionId(資料庫景點區域 id),後來隨「回到 placeId」的整體重構
  // (見 attractionTools.ts 檔頭「第四/五/六次重構」的完整說明)改回
  // placeId,跟 onagent 對話路徑(attractionTools.ts 的 add_attraction)
  // 統一用同一套單段 place-details-any 查詢邏輯(見
  // resolveAttractionForStep 的完整說明),不再各自維護一份反查規則。
  placeId?: string
  lat?: number
  lng?: number
  // attractions、places、farFromNext——這一站是「主題點」或候選卡時底下包含的景點,只存 id,
  // 直接對齊 planTimeline.ts PlanNodeData.attractions/places/farFromNext 的完整說明:
  // 名稱、座標、摘要、照片不在劇本裡,執行時經資料存取層用 id 查(模擬態是 planAiFakeDataSource)。
  // planActionToInsert 原樣轉傳給 insertAttractionAfter 的 data,不做任何轉換。
  attractions?: string[]
  places?: string[]
  farFromNext?: string[]
  // candidateCards——2026-10 新增(使用者明確要求「製作多個候選點的
  // 圖卡」「可選的狀態跟地點集合是不一樣的,原本的卡片要換成是多個
  // 小格子的樣子」),直接對齊 planTimeline.ts
  // PlanNodeData.candidateCards 的完整說明——這裡同樣只是讓
  // planSimScript.ts 能在劇本層表達這個欄位,planActionToInsert 原樣
  // 轉傳,不做任何轉換(跟 attractions/places 的既有做法一致)。
  candidateCards?: boolean
  icon?: string
  mode?: string
  minutes?: number
  distance?: string
  // category——add_note 專用,備註分類字串(對齊 home/plan-ai-sim/Content.tsx
  // 的 NOTE_STYLES 表,見該常數的完整說明)。2026-09 重構前這裡是
  // color/noteIcon(視覺樣式直接由後端決定),使用者明確要求「備註寫在
  // 景點的節點上」且分類→視覺樣式的對照權收斂在前端這一層(見
  // planTimeline.ts NoteInfo 的完整說明)後,後端(plan_sim_ws.go)改成
  // 送語意層級的 category,不再送 color/noteIcon。
  category?: string
  text?: string
  removedId?: string
  // afterId:插入位置——有值時插在該 id 對應節點的「後面」,而不是固定
  // append 到時間軸尾端(既有預設行為,省略這個欄位時維持不變)。這是給
  // 「移除某個節點、緊接著插入一個新節點取代同一個時間槽」這種情境用
  // 的(見 plan-ai-sim/Content 下方 removeWumiao 測試按鈕的完整說明)。
  // add_note 訊息(見下方 ws.onmessage 的完整說明)重用這個欄位表達
  // 「要把備註寫在哪個既有節點身上」,語意上等同 attractionTools.ts
  // AttractionStepsCtx.addNote 的 anchorId 參數。
  //
  // 2026-09:找不到對應節點時的行為改成跟 onagent 路徑(add_attraction
  // 的 anchorId)完全一致——直接讓 insertAttractionAfter 回傳
  // anchor_not_found 錯誤,由呼叫端(見 usePlanSimSocket 的 ws.onmessage)
  // 拋出例外。使用者明確要求「模擬的部分也完全走這個路徑,不要有
  // 例外」:原本這裡有一套「找不到就退回 append 到最後一筆」的寬容
  // 降級邏輯,是模擬腳本(plan_sim_ws.go)專屬的特例,現在拿掉——不管
  // 資料來源是模擬腳本還是 LLM 呼叫工具,「插入位置的錨點找不到」一律
  // 是需要被看見的錯誤,不是靜默吃掉繼續執行的正常情況(模擬腳本本身
  // 若送出無效的 afterId,那是腳本自己的 bug,應該讓它在這裡明確
  // 中斷、被發現,而不是悄悄插到錯的位置)。
  afterId?: string
  // candidates——2026-10 新增(使用者明確要求「播放畫面第一個先模擬送出
  // 一個 ask」),只有 type === 'open_ask_page' 時有意義:對齊真實
  // open_ask_page 工具的 candidates 參數(見 plan-core/askPageTools.ts
  // AskPageCandidate 的完整說明),劇本(planSimScript.ts)用這個欄位
  // 表達「這一步要顯示哪些候選景點卡片」。placeId 一律用
  // attractionPool.ts 的 id(跟劇本其餘 add_stop 的 placeId 慣例一致,
  // 見 planSimScript.ts 檔頭的完整說明),查詢完整資料時透過
  // dataSource.placeDetails 精確查找,不是真的打 Google API。
  candidates?: AskPageCandidate[]
  // picks——2026-10(使用者明確要求「ask page 內的感興趣的景點詢問,
  // 可以用挖洞的方式,再撥放態置換成可以由腳本控制的原件」),只有
  // type === 'open_ask_page' 時有意義:這一步要顯示成「已選取」的候選
  // placeId。
  //
  // 播放態是自動演示、不接受真實互動(見 docs/terminology.md),所以
  // 「使用者選了什麼」這件事也該由劇本表達,而不是等真人點——劇本原本
  // 已經能說「顯示哪些候選」(candidates),現在也能說「其中哪幾個被
  // 選中」。畫面上就是那幾張卡片帶勾,停留一下後自動收起、繼續播。
  //
  // 省略時視為一張都沒選(對應真人開了選單還沒點的那一刻)。值必須是
  // candidates 裡的 placeId,劇本自己負責對齊——這裡不做驗證,對齊
  // afterId 的既有處理方式(劇本送出無效的值是劇本自己的 bug,應該
  // 在畫面上看得出來,不是靜默吃掉)。
  picks?: string[]
}
