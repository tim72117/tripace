// model.ts(planning/timeline)— 時間軸的領域層,純函式、不依賴 React。
//
// 「領域層」而不是「資料層」:這個模組不持有任何資料,也不存取外部儲存——它只定義「行程時間軸」這個領域的型別與規則
// (怎麼插入一站、刪掉一天後怎麼接、改天怎麼放)。實際那一份 PlanTimeline 活在呼叫端的 useSyncedState 裡,持久化則是
// storage.ts 的事。
//
// 結構(2026-10-24 由鏈結串列改成依天分組的陣列):PlanTimeline = { days: PlanDay[] },days[0] 是 Day 1,每一天有穩定 id
// 與自己的 nodes 陣列。順序就是陣列位置,天數就是節點所在的那一天——不再有 prevId/nextId,也不再有「day 欄位與位置不一致」
// 的狀態。節點仍有穩定的 id:畫面選取、地圖圓點、AI 工具(anchorId)與非同步補資料都靠 id 對應,不能靠 index。
// 背景:原本 add_attraction 一律 append 到陣列尾端,先加下午的站、後補早上的站時畫面時間忽前忽後;insertAfter 統一驗證
// 時間順序(只在同一天內)並決定插入位置。
//
// 讀取請用 getNode/hasNode/listNodes/prevStopOf/nextStopOf,不要自己走訪 days(視圖是例外:PlanTimelineView/HorizontalPlanTimeline 直接吃 PlanTimeline,依 days 畫「Day N」標題與節點)。
//
import type { NodeStatus } from './status'

// stopLookupFailed——這個 stop 的地點資料「沒拿到」。
//
// 2026-10 抽到領域層(review 發現)：這個判準原本各處自己寫,而
// 「要不要顯示錯誤」(兩個時間軸元件)與「要不要重查」
// (TripPlanPage 的掛載重試)必須用同一個判準——不一致會出現
// 「畫面說失敗但不會自動重試」或反之。
//
// 執行狀態(loading/failed)不在節點上,在獨立的狀態表(status.ts,不持久化),所以第二個參數是
// 這個節點目前的狀態(沒有狀態表的呼叫端不傳,等同沒有任何狀態)。判準:
//   1. status.loading → false:那是「正在查」,不是「沒拿到」;
//   2. status.failed → true;
//   3. 否則看資料本身:有 placeId 但座標沒落地 → true。
// 第 3 點同時是「重整後」的判準:狀態表不存檔,重整後 failed/loading 都沒了,
// 這種「有 placeId 卻沒座標」的節點(上次查詢失敗、被限流、或頁面關閉時還沒查完)必須仍被視為沒拿到,
// 才有錯誤標示與重試入口(掛載時的自動重試也靠它找出要重查的站)。
//
// 用座標當判準而不是 name:name 在插入當下就有佔位字串(見
// planning/conversation/tools.ts),分不出「查到了」或「還沒查」;座標只有查詢
// 成功才寫入。
export function stopLookupFailed(node: PlanNode, status?: NodeStatus): boolean {
  if (node.type !== 'stop') return false
  if (status?.loading) return false
  if (status?.failed) return true
  return !!node.placeId && node.lat == null
}

// insertAfter 是這裡唯一的寫入路徑,由「行程安排元件」(呼叫端
// planning/preview/Content.tsx)提供給 planning/conversation/tools.ts 的 add_attraction
// 工具呼叫——工具本身不再自己組陣列 append,必須指定一個錨點(anchorId,
// null 代表插在最前面)並帶新節點的 time,由這裡統一驗證時間是否落在
// 合理範圍、決定實際插入位置、回傳明確的成功或錯誤結果。

// PlanNodeType — 對齊 planning/preview/Content.tsx 既有的 PlanStepType,
// 這裡不 import 那邊的型別(避免循環依賴,理由同 conversation/tools.ts
// 對 PlanStepLike 的說明——該型別已被 conversation/tools.ts 的 NewStopInput 取代),改宣告一個結構相容的版本。
//
// 2026-09 重構:'note' 不再是獨立節點型別——比照 TransitInfo 併入
// stop 節點(見該介面的完整說明)的同一個理由,備註改成掛在它所屬的
// 節點自己身上的 note 欄位(見 NoteInfo 的完整說明),不再是時間軸裡
// 跟 stop 平等的獨立節點。
//
// 現在節點型別只有 'stop'。保留 PlanNodeType 這個型別名稱,是因為各處以 type 判斷節點
// (將來若再有第二種節點不需要改所有簽名)。過去出現過的其他型別:
//   'message'  曾經(2026-09~10)是跟 stop 平行的對話訊息節點;2026-10-24 起對話獨立成 PlanConversation
//              (planning/conversation/messages.ts),時間軸不再有 message 節點:行程草稿只存行程,
//              訊息只依發生順序、不記錄在哪一天或哪個站點之後,也不持久化。
//   'section'  已移除的「分段標題」型別,只會在讀舊草稿時遇到:storage.ts 載入時用 isLegacySection
//              以字串比對丟掉(版本 2 格式與版本 1 鏈結串列遷移 migrateV1 兩條路徑都會丟)。
export type PlanNodeType = 'stop'

// TransitInfo — 掛在 stop 節點自己身上的「這一站跟前一站之間的交通
// 資訊」,取代原本獨立的 'transit' 節點型別。
//
// 2026-09 重構動機:原本 transit 是(當時的)鏈結串列裡跟 stop 平等的獨立節點,
// 靠「鏈結位置上緊接在某個 stop 前面」這個隱含關係表達「這張交通卡屬於
// 哪兩站」。使用者實際操作(移除中間站)會暴露這個設計的缺陷:removeNode
// 只做「前後節點互相銜接」的純鏈結摘除,完全不知道「transit 節點」這種
// 語意,移除 站A→交通卡AB→站B→交通卡BC→站C 中的站B後,會變成
// 站A→交通卡AB→交通卡BC→站C——兩張交通卡黏在一起,且都是基於已經
// 不存在的站B算出來的舊資料,沒有一張代表「站A→站C」。
//
// 改成資料直接掛在「到達站」(即後面那個 stop)身上後:
//   - 移除一個 stop 節點時,交通資料跟著它一起消失,不會有「兩張交通卡
//     黏在一起」這種不合法狀態——removeNode 完全不需要知道交通卡的存在。
//   - 「這張交通卡屬於哪兩站」變成顯式的:就是這個 stop 節點與同一天
//     nodes 陣列裡緊接在它前面的那一站(prevStopOf),不再需要靠位置猜測、
//     也不會有第三種節點類型混在 stop 之間。
//   - 任何造成「這個 stop 的前一站」改變的操作(插入新站、移除站、前一站
//     座標更新)都對應到明確的「這個 stop 的 transitFromPrev 需要重新
//     計算」時機,見 planning/timeline/transit.ts 的 refreshTransitForStop。
export interface TransitInfo {
  loading?: boolean
  icon?: string
  mode?: string
  minutes?: number
  distance?: string
  // note——這段交通的文字備註(例如班次、轉乘、末班車提醒),選填。
  // 精選行程(itineraries)這種靜態資料沒有「查詢出來的分鐘/距離」,
  // 交通資訊靠人工撰寫的備註表達,所以 minutes/distance 都可以缺:
  // 膠囊只顯示有值的部分,備註另外在膠囊下方獨立一列顯示(版型同
  // 站點備註 NoteInfo)。由 Routes 查詢產生的交通資訊不會帶這個欄位。
  note?: string
}

// NoteInfo — 掛在某個節點(目前只有 stop 會用到)自己身上的一則備註,
// 說明「為什麼這樣安排」這類考量或建議。
//
// 2026-09 重構動機:原本 note 是(當時的)鏈結串列裡跟 stop 平等的獨立節點,靠
// 「鏈結位置緊接在某個 stop 旁邊」這個隱含關係表達「這則備註是在講
// 哪一站」——但這個關係從未被顯式驗證或維護過,使用者明確要求「備註寫
// 在景點的節點上」,改成資料直接掛在該景點節點身上後:
//   - 備註跟它所描述的景點是同一筆資料的一部分,不會有「這則備註原本
//     在講哪一站」需要靠鏈結位置猜測的問題(對稱 TransitInfo 從獨立
//     'transit' 節點併入 stop.transitFromPrev 的同一個理由,見該介面的
//     完整說明)。
//   - 移除一個 stop 節點時,它的備註跟著一起消失,不會有「備註留在時間軸
//     裡但已經沒有對應的景點卡片」這種孤兒資料——removeNode 完全不需要
//     知道備註的存在,理由同 TransitInfo 的完整說明。
//   - 一個節點目前只掛一則備註(不是陣列)——使用者明確要求單則,若同一
//     景點需要不同時間點各自留一句話,那是之後才需要考慮的情境,目前
//     不先做那層彈性。
export interface NoteInfo {
  text: string
  category?: string
}


// PlanNodeData — 節點的「行程資料」:要存檔、要給 AI 讀、要交給地圖的內容(名稱、時間、座標、placeId、備註…)。
//
// 2026-10 起只放行程資料。原本混在這裡的執行狀態——loading(查詢中)、failed(查詢失敗)、removing(淡出中)——
// 與向資料存取層查來的 googlePhotoUrls,都搬出節點:
//   loading/failed/removing  獨立的狀態表(planning/timeline/status.ts,hook 是 usePlanNodeStatus,不持久化);
//   照片                      以 placeId 為 key 的執行時解析結果(ResolvedNodeRefs:解析在 planning/data/store.ts,
//                            React 端經 PlanDataProvider.tsx 的 useResolvedRefs 取得;與主題點底下的
//                            attractions/places、旅館 placeId 同一張表)。
// 這樣存檔不必特地剝欄位,也不會再有「存檔不存照片、卻靠節點帶照片」造成重整後站點沒照片的洞。
// 舊草稿裡仍可能有這些欄位,載入時一律丟掉(見 storage.ts 的 dropLegacyRuntimeFields)。
//
// 不同節點型別各自只用到欄位的子集,不需要為了分層另外拆泛型,那樣只會讓 insertAfter/updateNode/
// listNodes 都要重新宣告泛型參數,徒增複雜度卻沒有實質收益。
export interface PlanNodeData {
  type: PlanNodeType
  // stop
  time?: string
  // day——這個 stop 屬於行程的第幾天,1-based。它是衍生值/輸入參數,不是存在時間軸裡的欄位:
  //   - 時間軸本身(PlanTimeline.days[])依天分組,節點屬於哪一天由它所在的 PlanDay 決定,
  //     存進 days[].nodes 的節點不帶 day(insertAfter 等寫入路徑會 stripDay);
  //   - 讀取時 getNode/listNodes 依所在位置補上(withDay);
  //   - insertAfter 的 data.day 是「要放進第幾天」的輸入,省略時視為第 1 天(單日行程的呼叫端不必補 day: 1);
  //   - 測試與舊格式轉換用「帶 day 的扁平節點陣列」描述行程(fixtures.ts、storage.ts 的 migrateV1)。
  // 所以不會有「day 欄位與實際位置不一致」的狀態,也不必擔心同一天的節點不相鄰。
  // 為什麼需要「天」:2026-09 以前只有一條扁平時間軸,time 是唯一的排序依據、整條嚴格遞增,第二天只能從
  // 「比前一天最後一站更晚」的時刻接續(前一天到 23:00,第二天只能從 23:01 起跳);使用者要求「排程元件加入
  // 日的概念」,時間驗證(nearestTimedStop)因此只在同一天內找邊界、比較 time 先後,不同天之間不比較時間值,
  // 讓每天都能各自用合理的一天時刻表(例如都從早上開始)。
  day?: number
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  // placeId:Google Place ID——search_attraction/add_attraction 這條路徑
  // (見 planning/conversation/tools.ts 檔頭「第四/五/六次重構」的完整說明)只知道
  // 這個 id 時會有值,用來在插入節點之後背景觸發
  // 資料存取層的 placeDetails 單段查詢真實地點資料(name/summary/
  // googlePhotoUrls/lat/lng),見 planning/timeline/resolveAttractionForStep.ts
  // 的完整說明。該端點內部會優先查一次資料庫
  // attraction(查得到就優先用資料庫資料,查不到才 fallback 查
  // Google),故不需要這個檔案自己判斷「資料庫 vs Google」兩種來源、也
  // 不需要為 Google 補的候選另外發明一種臨時 id 機制——不論候選來自
  // 資料庫還是 Google,一律用同一個 placeId 當識別碼。模擬 WS 腳本路徑
  // (planning/preview/planAction.ts 的 planActionToInsert)也用同一個欄位承接模擬 WS 腳本
  // 送出的 placeId,兩條路徑共用同一套查詢邏輯。
  // 查詢結果裡的名稱、說明、座標寫回節點(它們是行程資料);照片不寫回——站點卡片的照片執行時用 placeId
  // 向 useResolvedRefs(planning/data/PlanDataProvider.tsx)解析出的表取(resolvedRefs.get(placeId)?.googlePhotoUrls)。
  placeId?: string
  // lat/lng:右上角固定小地圖用——點擊這張卡片時 panTo 到這個座標。
  lat?: number
  lng?: number
  // transitFromPrev:這個 stop 跟同一天裡前一站(prevStopOf)之間的交通資訊
  // (見 TransitInfo 的完整說明)——只有 stop 節點會用到,沒有前一站
  // (當天第一站)或前一站沒有座標時維持 undefined,不渲染
  // 任何交通卡。
  transitFromPrev?: TransitInfo
  // note:這個節點自己的備註(見 NoteInfo 的完整說明)——undefined 代表
  // 沒有備註,不是空字串這種「有欄位但沒內容」的表達方式。
  note?: NoteInfo
  // attractions、places——2026-10 新增(取代原本內嵌子景點資料的 children):
  // 這個 stop 是「主題點」或「候選卡」時,底下包含的鄰近景點。使用者明確要求
  // 「鄰近的景點不用每個都安排時間點,而是集合的概念」,後來又定案「節點只存 id,
  // 不存名稱、座標、摘要、圖片這些顯示資料」:
  //   attractions  自家資料庫的景點區域 id(lmk_…),執行時經資料存取層 attractionByID 查詢
  //   places       Google placeId(模擬資料裡是 attr-… 這類假 placeId),執行時經 placeDetails 查詢
  // 兩者合起來就是這個節點底下的集合(顯示順序:attractions 在前、places 在後)。
  // 它們不是時間軸裡獨立的節點,不參與 insertAfter/removeNode 的任何運算,也不佔用時間軸時間點。
  // 沒有這兩個欄位(或皆為空陣列)代表普通的單一地點站,向下相容。
  //
  // 為什麼只存 id:名稱、座標、照片會隨資料庫與 Google 的內容變動(尤其照片網址有時效,
  // 見 PlanThemeChild.googlePhotoUrls),內嵌進節點等於把一份會過期的拷貝寫進 localStorage 與行程資料。
  // 查詢結果只活在執行時(planning/data/store.ts 的共用 store,經 useResolvedRefs 取用),型別是 PlanThemeChild。
  attractions?: string[]
  places?: string[]
  // farFromNext——只有 candidateCards 節點用得到:attractions/places 裡哪些 id「距離下一站較遠」
  // (見 candidateCards 的說明與下方 PlanThemeChild.farFromNext)。原本這個旗標掛在內嵌的子景點物件上,
  // 子景點改成純 id 之後放不下,所以改成節點上的 id 清單;解析時(resolveNodeRefChildren)再把它蓋回
  // 對應子景點的 farFromNext。仍是劇本手動標註,不是前端算距離。省略視為沒有任何一個較遠。
  farFromNext?: string[]
  // candidateCards——2026-10 新增(使用者明確要求「製作多個候選點的
  // 圖卡,原本的一個圖卡裡面,放入多個小格,讓使用者選要去哪裡」「可以
  // 都去,讓使用者選」「可選的狀態跟地點集合是不一樣的,原本的卡片要
  // 換成是多個小格子的樣子」):跟主題點共用 attractions/places 這組 id,
  // 但渲染方式完全不同——主題點是一張正常外觀的卡片(時間/名稱/描述齊全),
  // 底下額外列出一排子景點 chip 讓使用者個別瀏覽/點擊;candidateCards 為 true 時,
  // 整張卡片完全不顯示這個節點本身的 time/name/desc,改成整張卡片的內容就是
  // 並列的候選格子本身(見 HorizontalPlanTimeline.tsx candidateCards 渲染分支的完整說明)——
  // 沒有「主卡片+底下展開區」這層結構,每個候選彼此平等並列。
  // candidateCards 只是切換卡片外觀的旗標,不是另外一份資料結構。省略(undefined)
  // 或 false 時維持主題點的渲染方式,向下相容既有呼叫端。
  candidateCards?: boolean
}

// PlanThemeChild——主題點/候選卡底下的子景點「執行時解析結果」(view 型別),**不是節點資料**。
// 節點只存 id(PlanNodeData.attractions/places),名稱、座標、摘要、照片經資料存取層
// (PlanAiDataSource)用 id 查回來後才有這個形狀,由 planning/timeline/resolved.ts 的 resolveNodeRefChildren
// 從 planning/data/store.ts 解析出的表組出來,
// 只存在記憶體,不寫進節點、不寫進 localStorage。查詢中或失敗時只有 id(其餘欄位皆為 undefined),
// 畫面要能用最小項目顯示(例如名稱退回 id)。
// 欄位刻意只取「卡片展示一個地點基本資訊」需要的子集,不含 time/duration/transitFromPrev/note
// 這些時間軸欄位——子景點不佔用時間軸時間點。
export interface PlanThemeChild {
  id: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  // id 同時是查詢用的 key:attractions 的 id 是景點區域 id(lmk_…),places 的 id 是 placeId。
  // 為了讓下游照舊用 placeId 判斷「這是個 Google 地點」,places 解析出來的項目 placeId 等於 id;
  // 景點區域則帶 attractionId。
  placeId?: string
  attractionId?: string
  lat?: number
  lng?: number
  googlePhotoUrls?: string[]
  // farFromNext——由節點上的 farFromNext id 清單蓋上來(見 PlanNodeData.farFromNext)。原說明:2026-10 新增(使用者明確要求「出現選擇時,有比較遠的
  // 行程時,要有一個標誌讓使用者知道,可能需要調整後續時間」「兩者都要
  // 考量」:前一站/下一站是「這個候選所屬的候選卡」在時間軸上的前後
  // 鄰居,不是候選彼此之間互相比較)。選了這個候選點,相對於候選卡前後
  // 鄰接的站點(上一站/下一站)距離明顯較遠,可能壓縮或推遲後續行程的
  // 時間安排。這裡刻意手動標註(不是前端自動算距離)——候選卡的候選
  // 點目前都是劇本固定資料,編寫劇本的人本來就知道實際地理位置關係,
  // 手動標註比引入一套距離公式+閾值判斷更直接,也不需要處理「閾值
  // 抓多少才算遠」這種容易爭論、因地點密度而異的判斷標準。省略視為
  // false(沒有這個提示)。
  farFromNext?: boolean
}

// PlanNode——時間軸上的一個節點:PlanNodeData 加穩定的 id。節點不帶前後指標,順序就是它在所屬那一天 nodes 陣列裡的位置。
// day 是衍生值:存進時間軸的節點沒有 day(它屬於哪一天由所在的 PlanDay 決定),getNode/listNodes 回傳時
// 才依所在天補上(從 1 起算);insertAfter 的 data.day 只是「要放進第幾天」的輸入。這樣不會有「day 欄位與位置不一致」的狀態。
export interface PlanNode extends PlanNodeData {
  id: string
}

// PlanDay——一天:穩定 id(顯示的「Day N」用它在 days 裡的位置算,不是 id)加這一天的節點(依順序)。
export interface PlanDay {
  id: string
  nodes: PlanNode[]
}

// PlanTimeline——依天分組的陣列,days[0] 是 Day 1。天可以是空的(addDay 加進來還沒排站點的一天)。
//
// lodgings——住宿(2026-10-24 從「某一天裡 kind 為住宿的 stop」拆出來,改成獨立的一份資料):結構反過來,是 N 筆旅館、
// 每筆自己記錄停留的是哪幾天(PlanLodging.dayIds)。住宿不是要去的景點,沒有時間點、不參與路線/交通膠囊/時間順序檢查,
// 硬塞成天裡的節點會讓每個視圖與驗證都要特判 kind;獨立之後 removeNode/insertAfter 等站點操作完全不影響它。
// 選填:沒有住宿的時間軸不用帶這個欄位,讀取請用 lodgingsOf(timeline)(沒有時回傳 [])。
export interface PlanTimeline {
  days: PlanDay[]
  lodgings?: PlanLodging[]
}

// PlanLodging——一筆住宿(旅館)與它停留的天。
// 旅館的名稱、座標、照片不存快照:placeId 在執行時經資料存取層查(planning/data/store.ts,React 端是 PlanDataProvider.tsx 的 useResolvedRefs),理由同
// PlanNodeData.attractions/places(照片網址有時效、名稱座標會變動)。name 是作者/使用者寫的顯示名稱,
// 只在沒有 placeId 或查不到時當備用,與站點的 name 同性質。
//
// dayIds 用「天的 id」(PlanDay.id)而不是第幾天:addDay/moveDay/removeDay 時旅館不會對錯天(天的 id 穩定,
// 顯示的「Day N」由位置推算,見 lodgingSpanLabel)。含入住日與退房日(沿用過去 Day N–M 含頭含尾的語意),可以不連續。
// 一天可以有多筆旅館(例如換旅館的那天),一筆旅館也可以跨很多天。
export interface PlanLodging {
  id: string
  placeId?: string
  name?: string
  dayIds: string[]
  note?: NoteInfo
}

export function createEmptyTimeline(): PlanTimeline {
  return { days: [] }
}

// lodgingsOf——讀取住宿的統一入口(lodgings 是選填欄位,沒有時回傳 [])。固定回傳同一個空陣列參照,
// 讓 React 依賴陣列與 useMemo 在沒有住宿時不會每次 render 都變。
const NO_LODGINGS: PlanLodging[] = []
export function lodgingsOf(timeline: PlanTimeline): PlanLodging[] {
  return timeline.lodgings ?? NO_LODGINGS
}

// 新的一天的 id。純函式需要新 id 時才呼叫;測試可以經參數傳入固定值。
function newDayId(): string {
  return `d_${crypto.randomUUID().slice(0, 8)}`
}

// withDay——回傳節點的複本並補上它所在的天。
export function withDay(node: PlanNode, day: number): PlanNode {
  return { ...node, day }
}

// 存進時間軸的節點不帶 day(見 PlanNode 的說明)。
function stripDay(data: PlanNodeData): PlanNodeData {
  if (data.day === undefined) return data
  const { day: _day, ...rest } = data
  void _day
  return rest
}

// locate——節點在哪一天、第幾個。找不到回 null。
function locate(timeline: PlanTimeline, id: string): { dayIdx: number; idx: number } | null {
  for (let dayIdx = 0; dayIdx < timeline.days.length; dayIdx++) {
    const idx = timeline.days[dayIdx].nodes.findIndex((n) => n.id === id)
    if (idx >= 0) return { dayIdx, idx }
  }
  return null
}

// getNode/hasNode/listNodes/countNodes——讀取節點的統一入口(呼叫端不要自己走訪 days)。getNode/listNodes 回傳的 stop 帶上衍生的 day。
export function getNode(timeline: PlanTimeline, id: string): PlanNode | undefined {
  const loc = locate(timeline, id)
  return loc ? withDay(timeline.days[loc.dayIdx].nodes[loc.idx], loc.dayIdx + 1) : undefined
}

export function hasNode(timeline: PlanTimeline, id: string): boolean {
  return locate(timeline, id) !== null
}

// listNodes——依順序列出全部真實節點。
export function listNodes(timeline: PlanTimeline): PlanNode[] {
  return timeline.days.flatMap((d, i) => d.nodes.map((n) => withDay(n, i + 1)))
}

export function countNodes(timeline: PlanTimeline): number {
  return timeline.days.reduce((sum, d) => sum + d.nodes.length, 0)
}

// isTimelineEmpty——完全沒有節點(空的天不算內容)。
export function isTimelineEmpty(timeline: PlanTimeline): boolean {
  return countNodes(timeline) === 0
}

// prevStopOf/nextStopOf——同一天裡、指定節點前一個/後一個 stop(不跨天:每天各自從頭開始,第一站沒有「上一站」)。
// 交通膠囊(transitFromPrev)描述的就是這一對。
export function prevStopOf(timeline: PlanTimeline, id: string): PlanNode | undefined {
  const loc = locate(timeline, id)
  if (!loc) return undefined
  const nodes = timeline.days[loc.dayIdx].nodes
  for (let i = loc.idx - 1; i >= 0; i--) if (nodes[i].type === 'stop') return withDay(nodes[i], loc.dayIdx + 1)
  return undefined
}

export function nextStopOf(timeline: PlanTimeline, id: string): PlanNode | undefined {
  const loc = locate(timeline, id)
  if (!loc) return undefined
  const nodes = timeline.days[loc.dayIdx].nodes
  for (let i = loc.idx + 1; i < nodes.length; i++) if (nodes[i].type === 'stop') return withDay(nodes[i], loc.dayIdx + 1)
  return undefined
}

// lastAppendTarget——「接在整條時間軸最後面」的錨點:最後一天最後一個節點的 id 與那一天(從 1 起算)。
// 最後一天是空的就 anchorId 為 null、帶那一天(insertAfter 的 null 錨點代表放在該天最前面,空的天正好就是最後面);
// 完全沒有天時回傳 { anchorId: null, day: 1 }。呼叫端要把新站接在最後面時用它,不要自己拿攤平清單的最後一個元素當錨點。
export function lastAppendTarget(timeline: PlanTimeline): { anchorId: string | null; day: number } {
  const dayCount = timeline.days.length
  if (dayCount === 0) return { anchorId: null, day: 1 }
  const last = timeline.days[dayCount - 1]
  return { anchorId: last.nodes.length > 0 ? last.nodes[last.nodes.length - 1].id : null, day: dayCount }
}

const PLAN_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function isValidTimeFormat(time: string): boolean {
  return PLAN_TIME_PATTERN.test(time)
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export type InsertAfterErrorCode =
  | 'anchor_not_found'
  | 'invalid_time_format'
  | 'time_out_of_range'
  // invalid_day——day/toDay 不是 1 以上的整數(NaN、小數、0、負數、Infinity)。領域層一律回結構化錯誤,不丟例外,
  // 也不默默用 Math.max/Math.min 補成某個「看起來合理」的值(那會把 LLM 的錯誤參數悄悄變成一個意外的位置)。
  | 'invalid_day'

export interface InsertAfterError {
  code: InsertAfterErrorCode
  message: string
}

export type InsertAfterResult =
  | { ok: true; timeline: PlanTimeline; insertedId: string }
  | { ok: false; error: InsertAfterError }

// isValidDayNumber——合法的「第幾天」:從 1 起算的有限整數(NaN/Infinity/小數/0/負數都不合法)。
export function isValidDayNumber(day: unknown): day is number {
  return typeof day === 'number' && Number.isInteger(day) && day >= 1
}

function invalidDayError(day: unknown, label: string): { ok: false; error: InsertAfterError } {
  return {
    ok: false,
    error: { code: 'invalid_day', message: `${label} 不合法(收到 ${String(day)}),天數必須是從 1 起算的整數(第幾天)。` },
  }
}

// 一天內、某個位置前後最近的「有合法時間的 stop」——時間順序只在同一天內檢查,每天各自從清晨重新開始。
function nearestTimedStop(nodes: PlanNode[], from: number, step: -1 | 1): PlanNode | null {
  for (let i = from; i >= 0 && i < nodes.length; i += step) {
    const n = nodes[i]
    if (n.type === 'stop' && n.time && isValidTimeFormat(n.time)) return n
  }
  return null
}

function buildOutOfRangeMessage(
  anchorId: string | null,
  attemptedTime: string,
  direction: 'early' | 'late',
  lowerNode: PlanNode | null,
  upperNode: PlanNode | null,
): string {
  const parts: string[] = []
  if (direction === 'early') {
    parts.push(
      `時間 "${attemptedTime}" 早於錨點前一站「${lowerNode!.name ?? lowerNode!.id}」(id: "${lowerNode!.id}")的時間 "${lowerNode!.time}",不能插在這個位置。`,
    )
  } else {
    parts.push(
      `時間 "${attemptedTime}" 晚於錨點後一站「${upperNode!.name ?? upperNode!.id}」(id: "${upperNode!.id}")的時間 "${upperNode!.time}",不能插在這個位置。`,
    )
  }
  const lowerText = lowerNode ? `"${lowerNode.time}"(${lowerNode.name ?? lowerNode.id})` : '不限'
  const upperText = upperNode ? `"${upperNode.time}"(${upperNode.name ?? upperNode.id})` : '不限'
  parts.push(`這個位置允許的時間範圍是 ${lowerText} 到 ${upperText} 之間。`)

  if (anchorId === null && direction === 'late' && upperNode) {
    parts.push(
      `目前 anchorId 是 null(插在這一天最前面),不是「接在最後面」的意思——若想讓這一站排在「${upperNode.name ?? upperNode.id}」之後,請改帶 anchorId: "${upperNode.id}"。`,
    )
  } else {
    parts.push('請改用符合這個時間範圍的錨點(anchorId),或調整這個時間。')
  }

  return parts.join('')
}

function buildAnchorNotFoundMessage(timeline: PlanTimeline, anchorId: string): string {
  const parts: string[] = [`找不到 id 為 "${anchorId}" 的節點,無法插入在它後面。`]

  const stops = listNodes(timeline).filter((node) => node.type === 'stop')
  if (countNodes(timeline) === 0) {
    parts.push('目前行程時間軸是空的,還沒有任何節點可以當 anchorId——若這是第一站,請省略 anchorId 或傳 null。')
  } else {
    const list = stops.map((node) => `"${node.id}"(${node.name ?? '未命名'}）`).join('、')
    parts.push(
      `目前時間軸上可以當 anchorId 的節點 id 有:${list || '(無 stop 節點)'}。` +
        ' anchorId 必須是這個清單裡的其中一個 id(某次 add_attraction 呼叫成功後回傳的 id),' +
        ' 不是 search_attraction 回傳的 attractionId(attraction 候選 id),兩者是不同種類的 id,不能互相替代。',
    )
  }

  return parts.join('')
}

export interface TimeDragBounds {
  minMinutes: number | null
  maxMinutes: number | null
}

// getTimeDragBounds——拖拉某個 stop 的時間時,這一天內它前後最近有時間的 stop 給出可拖的範圍(null 代表那一端不限)。
export function getTimeDragBounds(timeline: PlanTimeline, stopId: string): TimeDragBounds {
  const loc = locate(timeline, stopId)
  if (!loc) return { minMinutes: null, maxMinutes: null }
  const nodes = timeline.days[loc.dayIdx].nodes
  if (nodes[loc.idx].type !== 'stop') return { minMinutes: null, maxMinutes: null }
  const lowerNode = nearestTimedStop(nodes, loc.idx - 1, -1)
  const upperNode = nearestTimedStop(nodes, loc.idx + 1, 1)
  return {
    minMinutes: lowerNode ? timeToMinutes(lowerNode.time!) : null,
    maxMinutes: upperNode ? timeToMinutes(upperNode.time!) : null,
  }
}

// 補足天數:days 不夠長時在尾端補空的天(每天有自己的新 id)。
function ensureDays(days: PlanDay[], count: number): PlanDay[] {
  if (days.length >= count) return days
  const next = [...days]
  while (next.length < count) next.push({ id: newDayId(), nodes: [] })
  return next
}

// insertAt——把節點放進第 dayIdx 天的 idx 位置,檢查時間順序(同一天內),成功回傳新時間軸。
// 插入的節點若是 stop,緊接在它後面的 stop 的 transitFromPrev 作廢(它的上一站變了)。
function insertAt(
  timeline: PlanTimeline,
  dayIdx: number,
  idx: number,
  node: PlanNode,
  anchorId: string | null,
): InsertAfterResult {
  const base = ensureDays(timeline.days, dayIdx + 1)
  const dayNodes = base[dayIdx].nodes

  if (node.type === 'stop' && node.time) {
    if (!isValidTimeFormat(node.time)) {
      return { ok: false, error: { code: 'invalid_time_format', message: `時間 "${node.time}" 格式不正確,必須是 "HH:MM"(24 小時制)。` } }
    }
    const newMinutes = timeToMinutes(node.time)
    const lowerNode = nearestTimedStop(dayNodes, idx - 1, -1)
    const upperNode = nearestTimedStop(dayNodes, idx, 1)
    if (lowerNode !== null && newMinutes < timeToMinutes(lowerNode.time!)) {
      return {
        ok: false,
        error: { code: 'time_out_of_range', message: buildOutOfRangeMessage(anchorId, node.time, 'early', lowerNode, upperNode) },
      }
    }
    if (upperNode !== null && newMinutes > timeToMinutes(upperNode.time!)) {
      return {
        ok: false,
        error: { code: 'time_out_of_range', message: buildOutOfRangeMessage(anchorId, node.time, 'late', lowerNode, upperNode) },
      }
    }
  }

  const nextNodes = [...dayNodes]
  nextNodes.splice(idx, 0, node)
  const after = nextNodes[idx + 1]
  if (node.type === 'stop' && after && after.type === 'stop' && after.transitFromPrev !== undefined) {
    nextNodes[idx + 1] = { ...after, transitFromPrev: undefined }
  }
  const days = base.map((d, i) => (i === dayIdx ? { ...d, nodes: nextNodes } : d))
  return { ok: true, timeline: { ...timeline, days }, insertedId: node.id }
}

// insertAfter — 唯一的新增節點路徑(add_attraction 工具經呼叫端接進來)。anchorId 是「插在它後面」的節點 id,null 代表插在這一天最前面。
//
// 要放進第幾天:data.day(從 1 起算)優先,沒給就是錨點所在的那天(沒有錨點是第 1 天);天數不夠會補空的天。
//   - 目標天就是錨點所在的天:放在錨點後面。
//   - 目標天在錨點之後(例如接在第 1 天最後一站後面,放進第 2 天):放在那一天的最前面。
//   - 目標天在錨點之前:放在那一天的最後面。
// 時間檢查只在目標天內:stop 的 time 不能早於前面最近一個有時間的 stop、不能晚於後面最近一個,否則回傳 time_out_of_range
// (訊息列出上下界的 id 與時間,讓呼叫端直接照著修正)。
export function insertAfter(
  timeline: PlanTimeline,
  anchorId: string | null,
  data: PlanNodeData,
  newId: string,
): InsertAfterResult {
  if (data.day != null && !isValidDayNumber(data.day)) return invalidDayError(data.day, 'day')
  const anchor = anchorId === null ? null : locate(timeline, anchorId)
  if (anchorId !== null && !anchor) {
    return { ok: false, error: { code: 'anchor_not_found', message: buildAnchorNotFoundMessage(timeline, anchorId) } }
  }
  const targetDayIdx = data.day != null ? data.day - 1 : (anchor?.dayIdx ?? 0)
  let idx = 0
  if (anchor) {
    if (targetDayIdx === anchor.dayIdx) idx = anchor.idx + 1
    else if (targetDayIdx < anchor.dayIdx) idx = timeline.days[targetDayIdx]?.nodes.length ?? 0
  }
  const node: PlanNode = { ...stripDay(data), id: newId }
  return insertAt(timeline, targetDayIdx, idx, node, anchorId)
}

export type RemoveNodeErrorCode = 'anchor_not_found'

export interface RemoveNodeError {
  code: RemoveNodeErrorCode
  message: string
}

export type RemoveNodeResult =
  | { ok: true; timeline: PlanTimeline }
  | { ok: false; error: RemoveNodeError }

// 取出節點(不做驗證、不修剪天):移除或移動共用。被取出節點後面的 stop,若前一個節點也是 stop 且隔著被取出的 stop,
// 它的上一站變了,transitFromPrev 作廢。
function takeOut(timeline: PlanTimeline, loc: { dayIdx: number; idx: number }): PlanTimeline {
  const dayNodes = timeline.days[loc.dayIdx].nodes
  const removed = dayNodes[loc.idx]
  const nextNodes = dayNodes.filter((_, i) => i !== loc.idx)
  const after = nextNodes[loc.idx]
  if (removed.type === 'stop' && after && after.type === 'stop' && after.transitFromPrev !== undefined) {
    nextNodes[loc.idx] = { ...after, transitFromPrev: undefined }
  }
  return { ...timeline, days: timeline.days.map((d, i) => (i === loc.dayIdx ? { ...d, nodes: nextNodes } : d)) }
}

// removeNode — 移除一個節點。找不到 id 回 anchor_not_found。
// 「是否已在淡出動畫中、不要重複移除」不是領域層的事:淡出狀態(removing)在節點狀態表(status.ts),
// 由呼叫端(TripPlanPage/usePlanSimSocket 的 removeStop,即 usePlanTimelineCore.removeStop)先查狀態表擋下重複移除、動畫結束後才呼叫這個函式真正摘除。
// 若這次移除讓最後一天變空,把那個空的最後一天一併去掉(別留下沒內容的「Day N」標題);事先就空著的天(addDay 加的)不受影響。
export function removeNode(timeline: PlanTimeline, id: string): RemoveNodeResult {
  const loc = locate(timeline, id)
  if (!loc) {
    return { ok: false, error: { code: 'anchor_not_found', message: `找不到 id 為 "${id}" 的節點,無法移除。` } }
  }
  let next = takeOut(timeline, loc)
  const lastIdx = next.days.length - 1
  // 最後一天若還有旅館停留(dayIds 指著它),就不能去掉:去掉會讓旅館指到不存在的天。
  const lastDayId = next.days[lastIdx].id
  const lodgedOnLast = lodgingsOf(next).some((l) => l.dayIds.includes(lastDayId))
  if (loc.dayIdx === lastIdx && next.days[lastIdx].nodes.length === 0 && !lodgedOnLast) {
    next = { ...next, days: next.days.slice(0, lastIdx) }
  }
  return { ok: true, timeline: next }
}

// removeDay — 移除第 day 天(從 1 起算)與裡面所有節點。之後的天依序往前補位(原本的第 3 天變第 2 天);
// 沒有這一天就原樣回傳。
export function removeDay(timeline: PlanTimeline, day: number): PlanTimeline {
  const idx = day - 1
  if (!Number.isInteger(day) || idx < 0 || idx >= timeline.days.length) return timeline
  const removedId = timeline.days[idx].id
  const days = timeline.days.filter((_, i) => i !== idx)
  if (!timeline.lodgings) return { ...timeline, days }
  // 旅館停留的天被刪掉:把這天的 id 從所有旅館的 dayIds 移除,dayIds 變空的旅館整筆移除(沒有停留日的旅館沒有意義)。
  const lodgings = timeline.lodgings
    .map((l) => (l.dayIds.includes(removedId) ? { ...l, dayIds: l.dayIds.filter((id) => id !== removedId) } : l))
    .filter((l) => l.dayIds.length > 0)
  return { ...timeline, days, lodgings }
}

// AddDayResult——addDay 的結果:成功時帶「實際插入的位置」(day:從 1 起算,dayId:新的一天的 id),呼叫端不必自己再算一次
// (過去 TripPlanPage 的 addDayToTimeline(現為 usePlanTimelineCore.addDay)自己重算 clamp,與這裡的規則是兩份複製,改一邊會悄悄分歧)。
export type AddDayResult =
  | { ok: true; timeline: PlanTimeline; day: number; dayId: string }
  | { ok: false; error: InsertAfterError }

// addDay — 新增一個空的天。atDay(從 1 起算)是新的一天要成為第幾天,原本那天與之後的天往後順延;省略就加在最後面。
// atDay 超過「目前天數 + 1」時視為加在最後面(不會補出中間的空天),回傳的 day 是實際插入的位置。
// atDay 有給但不是 1 以上的整數(NaN/小數/0/負數)回 invalid_day,不默默補成別的位置。dayId 選填,測試或呼叫端要固定 id 時用。
export function addDay(timeline: PlanTimeline, atDay?: number, dayId?: string): AddDayResult {
  if (atDay != null && !isValidDayNumber(atDay)) return invalidDayError(atDay, 'atDay')
  const at = atDay == null ? timeline.days.length : Math.min(atDay - 1, timeline.days.length)
  const id = dayId ?? newDayId()
  const days = [...timeline.days]
  days.splice(at, 0, { id, nodes: [] })
  return { ok: true, timeline: { ...timeline, days }, day: at + 1, dayId: id }
}

export type MoveDayResult =
  | { ok: true; timeline: PlanTimeline }
  | { ok: false; error: { message: string } }

// moveDay — 調整天的順序:把第 fromDay 天(從 1 起算)整天(含裡面所有節點)移到第 toDay 天的位置,中間的天依序順延一格。
// 天自己的 id 與內容不變(顏色、選取等靠 id 對應的東西不會跑掉),只是順序變了,所以「Day N」標題與每個站的 day 都跟著重算。
// fromDay 或 toDay 超出目前的天數回傳錯誤(訊息列出目前有幾天);fromDay 等於 toDay 原樣回傳同一個物件參照。
export function moveDay(timeline: PlanTimeline, fromDay: number, toDay: number): MoveDayResult {
  const count = timeline.days.length
  const valid = (d: number) => Number.isInteger(d) && d >= 1 && d <= count
  if (!valid(fromDay) || !valid(toDay)) {
    return {
      ok: false,
      error: {
        message:
          count === 0
            ? '目前時間軸還沒有任何一天,無法移動。'
            : `fromDay=${fromDay}、toDay=${toDay} 超出範圍,目前時間軸有 ${count} 天,天數必須是 1 到 ${count} 的整數。`,
      },
    }
  }
  if (fromDay === toDay) return { ok: true, timeline }
  const days = [...timeline.days]
  const [moved] = days.splice(fromDay - 1, 1)
  days.splice(toDay - 1, 0, moved)
  return { ok: true, timeline: { ...timeline, days } }
}

// updateNode — 更新節點欄位。patch.day 會被忽略(天由節點所在的那一天決定,不能靠改欄位換天);沒有這個節點就原樣回傳。
export function updateNode(timeline: PlanTimeline, id: string, patch: Partial<PlanNodeData>): PlanTimeline {
  const loc = locate(timeline, id)
  if (!loc) return timeline
  const cleaned = stripDay(patch as PlanNodeData) as Partial<PlanNodeData>
  const dayNodes = timeline.days[loc.dayIdx].nodes
  const nextNodes = dayNodes.map((n, i) => (i === loc.idx ? { ...n, ...cleaned } : n))
  return { ...timeline, days: timeline.days.map((d, i) => (i === loc.dayIdx ? { ...d, nodes: nextNodes } : d)) }
}

// ───────────── 住宿(lodgings)─────────────
// 全部是純函式,風格同 insertAfter:會失敗的回 { ok, error },成功回新時間軸。lodgings 與 days 互相獨立,
// 這裡的函式不動 days,days 相關函式(removeDay)負責維持 dayIds 的有效性。

export type LodgingErrorCode = 'lodging_not_found' | 'day_not_found' | 'empty_days' | 'invalid_day'

export interface LodgingError {
  code: LodgingErrorCode
  message: string
}

export type LodgingResult =
  | { ok: true; timeline: PlanTimeline; lodgingId: string }
  | { ok: false; error: LodgingError }

function newLodgingId(): string {
  return `l_${crypto.randomUUID().slice(0, 8)}`
}

// 驗證 dayIds:不可為空、每個都必須存在於 days、去除重複(保留第一次出現的順序,之後顯示依天的位置排序)。
function validateDayIds(timeline: PlanTimeline, dayIds: string[]): { ok: true; dayIds: string[] } | { ok: false; error: LodgingError } {
  if (dayIds.length === 0) {
    return { ok: false, error: { code: 'empty_days', message: '住宿至少要有一個停留的天(dayIds 不可為空);要移除住宿請用 removeLodging。' } }
  }
  const known = new Set(timeline.days.map((d) => d.id))
  const missing = dayIds.filter((id) => !known.has(id))
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'day_not_found',
        message: `找不到 id 為 ${missing.map((m) => `"${m}"`).join('、')} 的天,住宿停留的天必須存在於時間軸(目前有 ${timeline.days.length} 天)。`,
      },
    }
  }
  return { ok: true, dayIds: [...new Set(dayIds)] }
}

function lodgingNotFound(id: string, action: string): LodgingResult {
  return { ok: false, error: { code: 'lodging_not_found', message: `找不到 id 為 "${id}" 的住宿,無法${action}。` } }
}

// addLodging——新增一筆住宿。id 選填(測試或呼叫端要固定 id 時用);dayIds 必須存在於 days 且不可為空。
export function addLodging(
  timeline: PlanTimeline,
  data: { placeId?: string; name?: string; dayIds: string[]; note?: NoteInfo },
  id?: string,
): LodgingResult {
  const checked = validateDayIds(timeline, data.dayIds)
  if (!checked.ok) return checked
  const lodging: PlanLodging = { ...data, id: id ?? newLodgingId(), dayIds: checked.dayIds }
  return { ok: true, timeline: { ...timeline, lodgings: [...lodgingsOf(timeline), lodging] }, lodgingId: lodging.id }
}

// updateLodging——更新住宿的欄位(placeId/name/note,patch 的 undefined 值代表清掉該欄位);要改停留的天請用 setLodgingDays。
// patch.id 與 patch.dayIds 會被忽略(id 穩定、天要經過驗證)。
export function updateLodging(
  timeline: PlanTimeline,
  lodgingId: string,
  patch: Partial<Pick<PlanLodging, 'placeId' | 'name' | 'note'>>,
): LodgingResult {
  const lodgings = lodgingsOf(timeline)
  if (!lodgings.some((l) => l.id === lodgingId)) return lodgingNotFound(lodgingId, '更新')
  const { placeId, name, note } = patch
  const cleaned: Partial<PlanLodging> = {}
  if ('placeId' in patch) cleaned.placeId = placeId
  if ('name' in patch) cleaned.name = name
  if ('note' in patch) cleaned.note = note
  return {
    ok: true,
    timeline: { ...timeline, lodgings: lodgings.map((l) => (l.id === lodgingId ? { ...l, ...cleaned } : l)) },
    lodgingId,
  }
}

// removeLodging——移除一筆住宿。
export function removeLodging(timeline: PlanTimeline, lodgingId: string): LodgingResult {
  const lodgings = lodgingsOf(timeline)
  if (!lodgings.some((l) => l.id === lodgingId)) return lodgingNotFound(lodgingId, '移除')
  return { ok: true, timeline: { ...timeline, lodgings: lodgings.filter((l) => l.id !== lodgingId) }, lodgingId }
}

// setLodgingDays——整組換掉住宿停留的天。dayIds 必須存在於 days 且不可為空(要整筆移除請用 removeLodging)。
export function setLodgingDays(timeline: PlanTimeline, lodgingId: string, dayIds: string[]): LodgingResult {
  const lodgings = lodgingsOf(timeline)
  if (!lodgings.some((l) => l.id === lodgingId)) return lodgingNotFound(lodgingId, '改停留的天')
  const checked = validateDayIds(timeline, dayIds)
  if (!checked.ok) return checked
  return {
    ok: true,
    timeline: { ...timeline, lodgings: lodgings.map((l) => (l.id === lodgingId ? { ...l, dayIds: checked.dayIds } : l)) },
    lodgingId,
  }
}

// 旅館停留的天,依在 days 裡的位置排序成「第幾天」(從 1 起算);已不存在的天 id 略過。
export function lodgingDayNumbers(timeline: PlanTimeline, lodging: PlanLodging): number[] {
  const nums: number[] = []
  timeline.days.forEach((d, i) => {
    if (lodging.dayIds.includes(d.id)) nums.push(i + 1)
  })
  return nums
}

// lodgingStartsOnDay——這一天是不是這筆旅館的第一個停留日(畫面只在這天顯示橫幅,連住的後續天不重複)。
// 「第一個」依天在時間軸的位置算,不是 dayIds 陣列裡的順序。
export function lodgingStartsOnDay(timeline: PlanTimeline, lodging: PlanLodging, dayId: string): boolean {
  const first = timeline.days.find((d) => lodging.dayIds.includes(d.id))
  return first?.id === dayId
}

// lodgingsStartingOnDay——在這一天入住(第一個停留日是這天)的旅館:視圖在這天最上面畫橫幅用。
export function lodgingsStartingOnDay(timeline: PlanTimeline, dayId: string): PlanLodging[] {
  return lodgingsOf(timeline).filter((l) => lodgingStartsOnDay(timeline, l, dayId))
}

// formatDayNumbers——把第幾天的清單轉成顯示文字:連續的天合併成區間,不連續用逗號分開。
// [2,3,4] → "Day 2–4";[2,5] → "Day 2, 5";[2,3,5] → "Day 2–3, 5";[3] → "Day 3"。
export function formatDayNumbers(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  const flush = () => parts.push(start === prev ? `${start}` : `${start}–${prev}`)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i]
      continue
    }
    flush()
    start = prev = sorted[i]
  }
  flush()
  return `Day ${parts.join(', ')}`
}

// lodgingSpanLabel——旅館停留區間的顯示文字(由天的位置推算,addDay/moveDay 後自動跟著變)。
export function lodgingSpanLabel(timeline: PlanTimeline, lodging: PlanLodging): string {
  return formatDayNumbers(lodgingDayNumbers(timeline, lodging))
}

// upsertLodging——AI 工具 set_lodging 的底層:同一個旅館(依 lodgingId,沒給就依 placeId)已有記錄時更新它(placeId/name 與停留的天),
// 沒有就新增。AI 想的是「同一間旅館住哪幾天」,不該因為重複呼叫而長出兩筆同一間旅館。
// lodgingId 有給但找不到回 lodging_not_found(不會偷偷新增一筆,避免 LLM 拿錯 id 卻以為更新成功)。
// created 標示這次是新增還是更新。
export function upsertLodging(
  timeline: PlanTimeline,
  data: { placeId?: string; name?: string; dayIds: string[]; lodgingId?: string },
  newId?: string,
): (LodgingResult & { ok: true; created: boolean }) | (LodgingResult & { ok: false }) {
  const lodgings = lodgingsOf(timeline)
  const existing = data.lodgingId
    ? lodgings.find((l) => l.id === data.lodgingId)
    : data.placeId
      ? lodgings.find((l) => l.placeId === data.placeId)
      : undefined
  if (data.lodgingId && !existing) return lodgingNotFound(data.lodgingId, '更新') as LodgingResult & { ok: false }
  if (!existing) {
    const added = addLodging(timeline, { placeId: data.placeId, name: data.name, dayIds: data.dayIds }, newId)
    return added.ok ? { ...added, created: true } : (added as LodgingResult & { ok: false })
  }
  const checked = validateDayIds(timeline, data.dayIds)
  if (!checked.ok) return checked
  const patch: Partial<Pick<PlanLodging, 'placeId' | 'name'>> = {}
  if (data.placeId !== undefined) patch.placeId = data.placeId
  if (data.name !== undefined) patch.name = data.name
  const updated = updateLodging(timeline, existing.id, patch)
  if (!updated.ok) return updated
  const days = setLodgingDays(updated.timeline, existing.id, checked.dayIds)
  return days.ok ? { ...days, created: false } : days
}

export type SetLodgingByDaysResult =
  | { ok: true; timeline: PlanTimeline; lodgingId: string; created: boolean; removed: boolean; days: number[]; dayCount: number }
  | { ok: false; error: { message: string; code?: LodgingErrorCode } }

// setLodgingByDays——AI 工具 set_lodging 的底層:AI 想的是「第幾天」(從 1 起算,含入住日與退房日,可以不連續),這裡轉成天的 id 再 upsert。
// days 傳空陣列代表移除這筆旅館(依 lodgingId,沒給就依 placeId;找不到回錯誤)。lodgingId 有給但找不到回錯誤(列出目前的住宿 id)。
// 天數超出範圍回錯誤並說明目前有幾天(同 moveDay 的風格)。放在領域層而不是工具層:ctx 在「行動前先確認目前行程」把關之後,
// 要拿「當下最新」的時間軸算天 id,不能用 list_itinerary 讀到的舊快照。
export function setLodgingByDays(
  timeline: PlanTimeline,
  data: { placeId: string; days: number[]; name?: string; lodgingId?: string },
  newId?: string,
): SetLodgingByDaysResult {
  const lodgings = lodgingsOf(timeline)
  const dayCount = timeline.days.length
  const existing = data.lodgingId ? lodgings.find((l) => l.id === data.lodgingId) : lodgings.find((l) => l.placeId === data.placeId)
  if (data.lodgingId && !existing) {
    const list = lodgings.map((l) => `"${l.id}"(${l.name ?? l.placeId ?? '未命名'})`).join('、')
    return { ok: false, error: { message: `找不到 id 為 "${data.lodgingId}" 的住宿。目前的住宿 id 有:${list || '(目前沒有任何住宿)'}。` } }
  }
  if (data.days.length === 0) {
    if (!existing) return { ok: false, error: { message: `目前沒有 placeId 為 "${data.placeId}" 的住宿,不需要移除。` } }
    const removed = removeLodging(timeline, existing.id)
    if (!removed.ok) return { ok: false, error: removed.error }
    return { ok: true, timeline: removed.timeline, lodgingId: existing.id, created: false, removed: true, days: [], dayCount }
  }
  // 先分出「根本不是正整數」(NaN/小數/0/負數,code invalid_day)與「超出現有天數」兩種,訊息才說得準。
  const notDayNumbers = data.days.filter((d) => !isValidDayNumber(d))
  if (notDayNumbers.length > 0) {
    return {
      ok: false,
      error: { code: 'invalid_day', message: `days 包含不合法的天數 ${notDayNumbers.map(String).join('、')},天數必須是從 1 起算的整數(第幾天)。` },
    }
  }
  const outOfRange = data.days.filter((d) => d > dayCount)
  if (outOfRange.length > 0) {
    return {
      ok: false,
      error: {
        code: 'day_not_found',
        message:
          dayCount === 0
            ? '目前時間軸還沒有任何一天,無法設定住宿。請先用 add_day 或 add_attraction 建立天數。'
            : `days 包含超出範圍的天數 ${outOfRange.join('、')},目前時間軸有 ${dayCount} 天,天數必須是 1 到 ${dayCount} 的整數。`,
      },
    }
  }
  const days = [...new Set(data.days)].sort((a, b) => a - b)
  const result = upsertLodging(
    timeline,
    { placeId: data.placeId, name: data.name, dayIds: days.map((d) => timeline.days[d - 1].id), lodgingId: existing?.id },
    newId,
  )
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, timeline: result.timeline, lodgingId: result.lodgingId, created: result.created, removed: false, days, dayCount }
}
