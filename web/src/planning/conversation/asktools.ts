// asktools.ts —/plan-ai 對話窗給 onagent 用的 UI 控制工具:
// open_ask_page(打開詢問頁,讓使用者從候選景點卡片裡選出想安排的地點)、
// ask_travel_region(選旅遊區域)、ask_transport_mode(選交通方式)。
// 沿用專案既有的 sdk-proposals/defineTool 模式(見 tools.ts
// 的既有寫法與完整設計說明),不是另起一套。
//
// 2026-10(第五輪,使用者明確要求「使用相同的 ask page 外殼,但是內部的
// 詢問元件可以搭配不同的工具顯示不同的項目」):詢問頁外殼(AskPage.tsx
// 的 .wrap/.bubble/.question/.actions,見該檔案的完整說明)原本只服務
// open_ask_page 一支工具,現在同一個外殼要能依工具種類切換內部渲染的
// 選項元件。這個檔案裡每支工具各自定義自己的 Option/Ctx 參數型別,
// AskPage.tsx 的 input prop 是三者的聯集(見該檔案的完整說明),依
// 'candidates'/'explore'/'region'/'transport'/'text' 哪個 key 存在分派
// 到對應的內部元件——不是讓一個元件用大量條件分支塞所有邏輯。
//
// 三支工具的選擇模式不同,刻意不統一成同一套:open_ask_page(景點)
// 可複選(一次行程通常會加好幾個景點);ask_travel_region/
// ask_transport_mode 都是單選(一次只會在一個區域活動、一段行程通常
// 只用一種交通方式),見各自 Ctx 方法與 defineTool 實作處的完整說明。
//
// 2026-10 新增(使用者明確要求「這個詢問頁的內容跟啟動,要可以透過
// 程式自己啟動,也要讓 AI 的工具來啟動」):詢問頁(AskPage.tsx,見該
// 檔案的完整說明)的顯示狀態(showAskPage)原本是
// HorizontalPlanTimeline.tsx 內部自己管理的 state,為了讓 AI 工具也能
// 觸發同一個狀態,呼叫端(TripPlanPage.tsx)把它提升上去,這個檔案的
// 工具透過下方 AskPageCtx 讀寫同一份狀態。
//
// 2026-10(第二輪,使用者明確要求「目前要可以輸出 attraction id 與
// place id,前端拿到後用對應的 UI 呈現」):這個工具一度改成「打開畫面
// + 等待使用者在畫面上選完 + 把選擇結果回傳給 LLM」(handle 回傳一個
// Promise,在使用者按下確認前保持 pending)。
//
// 2026-10(第三輪,使用者明確要求「LLM 不用等待,目前實作都是一步接
// 一步,使用者選完會再觸發下一次推論」、「先不要接新推論,發出景點
// 工具後就先停下來」):改回「打開畫面就結束」。
//
// 為什麼放棄等待模式:它讓一輪推論的生命週期綁在使用者的操作節奏上
// ——使用者可能看一眼就去做別的事,那一輪推論就一直掛著。改成不等待
// 之後,每一輪推論都是有限的:LLM 發出「請開啟選單」這個動作,動作
// 送出即完成。使用者選完之後要不要觸發下一輪,是前端的決定
// (目前刻意先不接,見 handle 內部的完整說明)。
//
// kind 維持 query(見 open_ask_page.yaml):回傳值 { opened: true } 仍然
// 需要讓 LLM 看到——它要知道選單已經開了,才不會重複呼叫或改口再問
// 一次。
//
// candidates 參數(LLM 傳入,見 OpenAskPageArgs):呼叫端(LLM)必須先用
// search_attraction 查到候選景點的 placeId,再把這些候選當參數傳給
// open_ask_page——這個工具本身不查詢任何景點資料,只負責「顯示 LLM
// 提供的候選」(不等待、不回報選擇結果,見上方第三輪的完整說明),
// 對齊 add_attraction 只收
// placeId、不是完整地點資料的既有設計(見該工具的完整說明:LLM 只需要
// 記住一個輕量識別碼,完整資料由前端這一層背景查詢補上)。
//
// 跟 tools.ts 的關係:刻意獨立成自己的檔案與自己的 ctx 型別
// (AskPageCtx),不是把這些讀寫塞進 AttractionStepsCtx 裡混在一起——
// AttractionStepsCtx 是「時間軸資料操作」專用介面(插入景點/寫備註/
// 移除節點/讀取現況),這裡是「UI 顯示狀態控制 + 等待使用者輸入」,
// 兩者職責不同。呼叫端用兩次 toAgentBridgeTools(各自搭配各自的 ctx)
// 產生的 Record<string, ToolHandler> 合併成同一份 tools 物件交給
// AgentBridge(見 TripPlanPage.tsx 組裝 tools 處的完整說明),這兩種
// 工具在 LLM 眼中完全無法區分、可以在同一次對話裡混用,只是前端這一層
// 的程式碼組織各自獨立。
//
// 對應的 onagent 平台工具定義:web/tools/plan-ai/open_ask_page.yaml
// (推送方式見該檔案開頭說明)。

import type { PooledPlace } from './attractionPoolStore'
import type { PlanUiState } from './uiStateStore'
import { defineTool } from '../../sdk-proposals/defineTool'
import type { ClientTool } from '../../sdk-proposals/arrayTools'

// AskPageCandidate——LLM 透過 open_ask_page 的 candidates 參數傳入的一筆
// 候選景點,只帶 placeId 必要識別碼(對齊 add_attraction 的既有設計)。
// name/summary 選填,純粹給詢問頁在背景查詢完整資料(AskPage.tsx 呼叫
// fetchPlanAiPlaceDetailsAny)補齊前,先顯示一個有意義的暫時標題,避免
// 卡片一開始完全空白。
export interface AskPageCandidate {
  placeId: string
  name?: string
  summary?: string
  // lat/lng——選填:候選自帶的座標(前端查附近景點時一併帶上),用來在地圖上畫候選點(見 askMapView.ts);
  // 沒帶時由候選頁背景查完整資料(placeDetails)後補上。
  lat?: number
  lng?: number
}

// AskPageExplore——2026-10 新增(使用者明確要求「open_ask_page 輸入
// 支援一個模式,探查模式,參數有三個類別 目的地（文字）地圖中心 使用者
// 位置,會自動用這些資訊送入 search_attraction 取得清單後顯示」)。跟
// candidates(LLM 自己先查好、直接給候選清單)是互斥的另一種輸入方式
// ——LLM 不需要自己先呼叫 search_attraction,只要給「要以什麼為依據
// 查」這個最小資訊,查詢本身交給前端(AskPage.tsx 透過
// PlanAiDataSource.searchNearby 執行,見該方法的完整說明)。
//
// 三個類別三選一(見 OpenAskPageArgs/parseOpenAskPageArgs 的完整說明:
// 同時出現多個時的優先序):
//   - destination:目的地文字(地名),對齊 search_attraction 的 query
//     參數語意——先查這個地名的座標,再查附近候選。
//   - mapCenter:地圖中心座標,直接以此為錨點查附近候選,跳過地名查詢
//     那一步。
//   - userLocation:使用者目前位置座標,語意與 mapCenter 相同(都是
//     「直接给座標查」),只是座標的意義不同(地圖視野中心 vs 使用者
//     實際所在位置)——這裡刻意分成兩個獨立欄位而非合併成一個通用的
//     coords 欄位,是因為 LLM 呼叫時「要用地圖中心還是使用者位置」是
//     一個有意義的決策(例如使用者說「我這附近有什麼」該用
//     userLocation,說「這一帶」指著地圖畫面時該用 mapCenter),把
//     這個決策留在參數名稱上讓語意明確,比合併成一個欄位、另外用
//     文字說明「這裡放地圖中心或使用者位置都可以」更不容易用錯。
export interface AskPageExplore {
  destination?: string
  mapCenter?: { lat: number; lng: number }
  userLocation?: { lat: number; lng: number }
}

// AskPageSelection——使用者在詢問頁上選完後,open_ask_page 回傳給 LLM
// 的單筆結果。attractionId 選填——只有該 placeId 對應到資料庫已建檔
// 的景點時才會有值(見 fetchPlanAiPlaceDetailsAny/
// GeoPlanAiPlaceDetailsAnyResult.attractionId 的完整說明),Google
// fallback 查到的地點沒有對應的資料庫紀錄,固定不帶這個欄位——LLM 不該
// 假設每筆選擇都一定有 attractionId。
export interface AskPageSelection {
  placeId: string
  attractionId?: string
}

// UserSelectionRecord——使用者在詢問頁完成的「最近一次」選擇。
//
// 2026-10 新增(使用者明確要求「選好的景點,多一個工具讓 LLM 存取,選完
// 送出時,送出使用者已經選擇,使用查詢工具取得」):三個詢問頁工具改成
// 不等待之後(見下方各 handle 的完整說明),使用者選了什麼不再透過工具
// 回傳值回到 LLM 手上。改成前端把結果存起來,使用者選完時送一則訊息
// 通知 LLM,LLM 再呼叫 get_user_selection 查。
//
// 為什麼不直接把結果寫進那則通知訊息:訊息是對話歷史的一部分,每一輪
// 都會被重送;選擇結果可能有好幾個地點、各自帶名稱與摘要,塞進訊息會
// 讓對話歷史快速膨脹。做成工具的話,LLM 只在真的需要時查一次。
//
// 目前只存最新一次(使用者明確要求「先做存最新的一次」):新的選擇直接
// 覆蓋舊的。累積歷史要處理「查詢時要回傳哪幾次」「什麼時候該清掉」這
// 些問題,等真的需要時再說。
//
// kind 記錄這次選擇來自哪一種詢問頁——LLM 要據此判斷該做什麼(選了
// 城市通常接著排行程,選了景點通常接著 add_attraction),光看 items
// 分不出來。
export interface UserSelectionRecord {
  kind: 'attractions' | 'region' | 'transport'
  // items——選中的項目。name 是給 LLM 讀的(placeId 這種識別碼它看不懂,
  // 也無法用來跟使用者溝通),placeId/attractionId 則是它後續呼叫
  // add_attraction 時要帶的值。
  items: { placeId?: string; attractionId?: string; name?: string; value?: string }[]
  // selectedAt——選擇發生的時間(ISO 字串)。LLM 可以用它判斷這次查到的
  // 是不是剛剛那次選擇,而不是更早之前殘留的。
  selectedAt: string
}

// AskPageRegionOption——ask_travel_country/ask_travel_city 畫面上實際
// 顯示的一張選項卡(國家或城市皆用這個形狀,只是來源不同)。
export interface AskPageRegionOption {
  id: string
  name: string
}

// AskPageCountryInput/AskPageCityInput——2026-10(第十輪,使用者明確
// 要求「將國家與地區的工具分開,並做自動串接」)原本的 ask_travel_region
// 單一工具用 level 參數在「選國家」「選城市」兩層之間切換,拆成
// ask_travel_country/ask_travel_city 兩支完全獨立的工具——理由同
// AskPageRegionNext 這批舊設計被整個移除的理由(見下方說明):「一支
// 工具內部切層」這個設計,跟後來把三個詢問頁工具都改成「開啟就回傳、
// 不等待」(見 askPageOpenedResult 的完整說明)的架構疊在一起時,開始
// 顯得不必要地複雜——LLM 不需要知道「國家」「城市」是同一支工具的兩種
// 模式,它只需要在對應的時機呼叫對應的獨立工具,語意更直接。
//
// countryIds/cityIds 篩選語意不變(見下方 parse 函式的完整說明);
// ask_travel_city 的 countryId 仍是必填——沒有城市清單可以「跨國家」
// 顯示。
export interface AskPageCountryInput {
  countryIds?: string[]
  reason?: string
}

// back——2026-10(第十輪,使用者明確要求「CityPanel 記住上一次
// country input 的 countryIds,原樣重現」)只在「前端自動從國家層串接
// 到城市層」時由 TripPlanPage.tsx 的 handleAskPageDone 填入(見該函式
// 的完整說明),不是 LLM 呼叫 ask_travel_city 時會帶的參數——LLM 直接
// 問城市(使用者已經說出國家名稱,跳過國家層)的情境下沒有「上一層」可
// 言,這個欄位維持 undefined,AskPage.tsx 的 CityPanel 據此判斷要不要
// 顯示「返回上一層」按鈕。
//
// 包成一個物件(而不是直接用 countryIds?: string[])是刻意的:
// countryIds 本身在 AskPageCountryInput 裡 undefined 代表「不篩選、
// 顯示全部國家」,是合法的業務值,不能拿同一個欄位的「有沒有值」去
// 判斷「有沒有上一層可以返回」——國家層本來就常常是 undefined(LLM
// 很少帶 countryIds 篩選),若 back 直接是 countryIds?: string[],
// 這種最常見的情況下 back 會是 undefined,CityPanel 就會誤判成
// 「沒有上一層」。back 物件本身的存在與否(undefined vs 一個物件,
// 即使物件內的 countryIds 本身是 undefined)才是「能不能返回」的
// 判斷依據。
//
// 點擊「返回上一層」時,前端用 back.countryIds 重新呼叫
// openAskPage({ country: { countryIds: back.countryIds } }),原樣重現
// 選國家當時的篩選結果,不是固定顯示全部國家——如果 LLM 當初用
// countryIds 篩選過(例如只給了兩三個候選國家),返回上一層也該看到
// 同樣篩選過的那幾個,不是跳回完整的 24 國清單。
export interface AskPageCityInput {
  countryId: string
  cityIds?: string[]
  back?: { countryIds?: string[] }
  reason?: string
}

// 2026-10(第十輪)移除死碼:AskPageRegionNext/DEFAULT_ASK_TRAVEL_REGION_NEXT/
// AskTravelRegionResult/AskPageRegionInput 原本是「等待模式」下的串接
// 設計——ctx.askTravelRegion 要 await 使用者選完城市,再依 next 決定
// 要不要自動接著查景點,最後把景點結果包進回傳值給 LLM。三個詢問頁
// 工具改成「開啟就回傳、不等待」之後(見 askPageOpenedResult 的完整
// 說明),ctx.askTravelRegion 已經不再 await 任何東西、固定回傳
// { selectedCity: null }(見 TripPlanPage.tsx 舊版 wrapper),next 參數
// 形同虛設——串接邏輯整個搬到 handleAskPageDone(使用者真正點選卡片
// 的那一刻,在 TripPlanPage.tsx 裡),不再需要這批型別表達「等待後的
// 結果」。拆成兩支工具時一併清掉,避免讓下一個讀這份程式碼的人以為
// 這套「等待 + next 旗標」機制還在運作。

// TransportMode——ask_transport_mode 的選項值,後端固定列舉(使用者
// 明確要求「交通方式的選項要固定列舉,但是提供參數可以讓 llm 控制排列
// 優先序及過濾」)——前端 TransportPanel(見 AskPage.tsx)對每個值配一組
// 固定的圖示與中文標籤,LLM 只需要傳值本身,不需要也不能自訂顯示文字,
// 避免每次呼叫顯示字樣不一致。
export type TransportMode = 'walk' | 'scooter' | 'car' | 'transit' | 'bike'

// ALL_TRANSPORT_MODES——預設顯示順序,ask_transport_mode 的 modes 參數
// 省略時使用全部五種、依這個順序顯示。
export const ALL_TRANSPORT_MODES: TransportMode[] = ['walk', 'scooter', 'car', 'transit', 'bike']

// AskPageCtx——openAskPage/askTravelRegion/askTransportMode 呼叫
// ctx 對應方法把候選清單/探查依據/區域選項/交通方式選項交給
// TripPlanPage.tsx 顯示,並拿回一個會在使用者完成選擇時 resolve 的
// Promise。這些 ctx 方法本身就是非同步的,不是像舊版那樣只有一個同步
// setter——呼叫端(TripPlanPage.tsx)需要把「顯示內容」跟「等待使用者
// 選擇」這兩件事串成一個 Promise,內部用一個 resolve 函式(存在 ref
// 裡)在 AskPage 的 onDone 回呼觸發時完成這個 Promise,見該檔案
// askPageCtx 組裝處的完整說明。
//
// 三個方法共用同一個底層的 openAskPage(input)(TripPlanPage.tsx 傳入
// 的那個函式,見該處完整說明:本質上都是「切到詢問頁顯示某個 input」,
// 只是 input 的形狀不同)——這裡刻意不讓 ctx 直接暴露那個共用函式,而是
// 包成三個各自命名、各自型別化的方法,理由是這個 ctx 介面是三支工具各自
// 的 handle 函式看到的型別,各自只應該看到自己需要呼叫的那一個方法,不
// 需要知道底層共用實作、也不該被允許傳錯 input 形狀給錯的方法。
export interface AskPageCtx {
  openAskPage: (
    input: { candidates: AskPageCandidate[]; reason?: string } | { explore: AskPageExplore; reason?: string },
  ) => Promise<AskPageSelection[]>
  // askTravelCountry/askTravelCity——2026-10(第十輪,使用者明確要求
  // 「將國家與地區的工具分開,並做自動串接」)取代原本單一的
  // askTravelRegion(見 AskPageCountryInput/AskPageCityInput 的完整
  // 說明:為什麼拆成兩個獨立方法,以及為什麼不再回傳
  // AskTravelRegionResult 那種「等待後的結果」——現在跟
  // openAskPage/askTransportMode 一樣,呼叫端(TripPlanPage.tsx)不等待
  // 這個 Promise、固定回傳 null,實際顯示由這個方法本身觸發)。
  askTravelCountry: (input: AskPageCountryInput) => Promise<string | null>
  askTravelCity: (input: AskPageCityInput) => Promise<string | null>
  askTransportMode: (modes: TransportMode[], reason?: string) => Promise<TransportMode | null>
  // getUserSelection——讀取使用者最近一次的選擇(見 UserSelectionRecord
  // 的完整說明)。還沒有任何選擇時回傳 null。
  getUserSelection: () => UserSelectionRecord | null
  // getAttractionPool——這次對話中出現過的景點(見
  // planning/conversation/attractionPoolStore.ts 的完整說明)。LLM 用它把
  // get_user_selection 拿到的 placeId 對照成名稱與摘要,不需要重新
  // 呼叫 search_attraction。
  getAttractionPool: () => PooledPlace[]
  // getUiState——使用者目前在哪一個畫面、選了哪些項目(見
  // planning/conversation/uiStateStore.ts 的完整說明)。供 get_ui_state 工具讀取。
  getUiState: () => PlanUiState
  // ensureFreshRead——選填:行動前先確認目前行程的把關(見 tools.ts structureSignature)。詢問工具(open_ask_page/ask_*)
  // 執行前先同步呼叫它,行程在上次 list_itinerary 之後有變動(或沒讀過)就 throw,讓工具回錯誤給 LLM。必須在工具這一層同步檢查:
  // ask_travel_* 與 ask_transport_mode 是 fire-and-forget(`void ctx.askXxx(...)` 後立刻回成功),放在 ctx 方法內 throw 只會變成沒人接的
  // rejected Promise,工具仍回「已成功執行」(實際發生過)。
  ensureFreshRead?: () => void
}

// AskPageInput——AskPage.tsx 的 input prop 型別,TripPlanPage.tsx/
// planning/preview/Content.tsx 呼叫 useAskPageBridge<AskPageInput> 時共用
// 同一份定義,不是各自重複宣告這個聯集(先前只有 candidates/explore/text
// 三種時兩邊各自宣告一份還可接受,新增 region/transport 兩種後繼續各自
// 重複宣告容易漏改其中一處)。六種成員對應 AskPage.tsx 內部元件
// (見該檔案的完整說明):
//   - candidates/explore——感興趣地點(CandidatesPanel),可複選。
//   - country——旅遊國家(CountryPanel),單選。
//   - city——旅遊城市(CityPanel),單選。2026-10(第十輪)從單一的
//     region(內部用 level 切層)拆成 country/city 兩個獨立成員,見
//     AskPageCountryInput/AskPageCityInput 的完整說明。
//   - transport——交通方式(TransportPanel),單選。
//   - text——純文字對話氣泡,見該欄位原本「第四輪」的完整說明。
//
// reason——2026-10(第九輪,使用者明確要求「工具輸出參數加上文字敘述」
// 「多一個欄位,讓 AI 說明意圖」「要顯示在 AskPage 畫面上」)詢問頁工具
// 共同新增的選填欄位——LLM 呼叫時用一句話說明這次詢問的意圖/脈絡
// (例如「這幾個都是台南必訪的古蹟」「這段路程比較遠,選個交通方式
// 吧」),AskPage.tsx 的對應面板拿它取代原本寫死的標題(「要安排這些
// 地點嗎?」「要去哪個國家?」等),沒有帶時才 fallback 回那些預設文字
// ——不是額外加一行文字,是直接取代標題本身,讓畫面上的詢問文案真的
// 反映 LLM 當下的意圖,而不是工具共用的固定樣板。explore/transport
// 沒有各自獨立宣告 reason(候選數量太少不需要另開欄位),直接掛在
// candidates/country/city/transport 這幾個 input 成員上(text 模式是
// 純文字氣泡本身沒有「標題」概念,不需要 reason)。
//
// loading——2026-10 新增,只由前端自己設(parseOpenAskPageArgs 不會產生):選完城市後、景點還在查的「查詢中」畫面
// (見 planning/panel/useAskPageFlow.ts)。candidates 此時是空陣列,AskPage 顯示查詢中的外殼(同 explore 查詢中),
// 查完由呼叫端原地換成真正的候選——放在 candidates 成員上而不是另開一種 input,讓查詢中與候選是同一個步驟
// (轉場層級相同、同一個 CandidatesPanel,換成候選時標題與氣泡不重新滑入,只有卡片與按鈕出現)。
//
// back——2026-10 新增(使用者要求「選擇感興趣地點也要可以往前一頁」),與 loading 一樣只由前端自己設
// (parseOpenAskPageArgs 不會產生):選完城市後開出的查詢中/景點候選帶上「當時的城市頁 input」,AskPage 據此在左上角
// 顯示「返回上一層」,useAskPageFlow 的 handleAskPageBack 用 replaceAskPage 原樣換回那個城市頁(countryId、cityIds 篩選、
// 城市頁自己的 back 都一併重現,所以回到城市頁後仍可再返回國家頁)。做法對齊 AskPageCityInput.back:物件存在與否才是
// 「能不能返回」的判斷依據。LLM 直接 open_ask_page 開的候選與 explore 沒有 back。
export interface AskPageCandidatesBack {
  city: AskPageCityInput
}
export type AskPageInput =
  | { candidates: AskPageCandidate[]; reason?: string; loading?: boolean; back?: AskPageCandidatesBack }
  | { explore: AskPageExplore; reason?: string }
  | { country: AskPageCountryInput }
  | { city: AskPageCityInput }
  | { transport: TransportMode[]; reason?: string }
  | { text: string; stale?: boolean }

// OpenAskPageArgs/parseOpenAskPageArgs——open_ask_page 的 args 型別與
// runtime 驗證,對齊 open_ask_page.yaml 的參數(candidates/destination/
// mapCenter/userLocation 皆選填,但至少要有其中之一)。
//
// 防禦性寫法同專案其餘 parseXxxArgs(例如 tools.ts 的
// parseSearchAttractionArgs):raw 是 WS 傳進來的 unknown,逐層檢查型別
// 再組成型別化的 Args,不信任呼叫端(LLM)一定會送出格式正確的參數
// ——缺漏 placeId 的候選直接過濾掉,不是整個請求失敗,讓詢問頁至少能
// 顯示格式正確的那幾筆,比因為其中一筆壞掉就讓整個工具呼叫報錯更穩健。
//
// candidates 與探查模式(destination/mapCenter/userLocation)互斥——
// LLM 要嘛自己先查好候選給 candidates,要嘛用探查模式讓前端自己查,
// 不會兩種同時使用。這裡的優先序(見 openAskPage 的完整說明):
// candidates 非空時優先採用,其餘三個探查欄位即使同時出現也忽略
// ——理由是 candidates 代表 LLM 已經做過更精準的篩選(可能是跨多次
// search_attraction 查詢後人工挑選的結果),比單純「以某個點為中心
// 查附近」更貼近使用者需求,不該因為呼叫端不小心同時帶了探查欄位就
// 被忽略掉。candidates 為空時,destination/mapCenter/userLocation 三者
// 依這個順序取第一個有值的使用(文字地名通常比座標更能精準表達使用者
// 想探查的區域,地圖中心次之,使用者位置最後——地圖中心代表使用者
// 當下正在看的區域,比使用者實際所在位置更可能是這次想問的範圍)。
export interface OpenAskPageArgs {
  candidates: AskPageCandidate[]
  explore?: AskPageExplore
  reason?: string
}

function parseOpenAskPageArgs(raw: unknown): OpenAskPageArgs {
  const obj = raw as Record<string, unknown> | null | undefined
  const rawCandidates = Array.isArray(obj?.candidates) ? obj.candidates : []
  const candidates: AskPageCandidate[] = rawCandidates
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter((c) => typeof c.placeId === 'string' && c.placeId.length > 0)
    .map((c) => ({
      placeId: c.placeId as string,
      name: typeof c.name === 'string' ? c.name : undefined,
      summary: typeof c.summary === 'string' ? c.summary : undefined,
    }))

  function parseCoords(v: unknown): { lat: number; lng: number } | undefined {
    const c = v as Record<string, unknown> | null | undefined
    if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return undefined
    return { lat: c.lat, lng: c.lng }
  }
  const destination = typeof obj?.destination === 'string' && obj.destination.length > 0 ? obj.destination : undefined
  const mapCenter = parseCoords(obj?.mapCenter)
  const userLocation = parseCoords(obj?.userLocation)
  const explore: AskPageExplore | undefined =
    destination || mapCenter || userLocation ? { destination, mapCenter, userLocation } : undefined
  const reason = typeof obj?.reason === 'string' && obj.reason.length > 0 ? obj.reason : undefined

  return { candidates, explore, reason }
}

// open_ask_page——打開詢問頁,顯示候選景點卡片,等待使用者選擇,回傳
// 選擇結果(每筆候選的 placeId,已建檔景點另外帶 attractionId)給 LLM。
// 候選來源二選一(見 OpenAskPageArgs 的完整說明與優先序):
//   - candidates 非空:直接用 LLM 給的候選清單。
//   - candidates 為空但 explore 有值(探查模式):把 explore 原樣轉交
//     給 ctx.openAskPage,由 AskPage.tsx 自己查詢候選(見
//     PlanAiDataSource.searchNearby 的完整說明)。
// 兩者都沒有時直接 throw——這代表呼叫端既沒有先查好候選、也沒有給
// 任何探查依據,是使用方式錯誤(理由同 add_attraction 對缺漏 placeId
// 的既有處理),讓錯誤透過 defineTool 既有的錯誤處理路徑往上拋,回報給
// LLM 知道需要先查詢或提供探查依據。
// askPageOpenedResult——三個「開啟詢問頁」工具共用的回傳訊息。
//
// 2026-10(第四輪,使用者實機回報「重複觸發」):第三輪改成不等待時
// 回傳 { opened: true },結果 LLM 照樣用完全相同的參數連打八次。原因是
// 那個值對 LLM 沒有資訊量——它呼叫這個工具的目的是「讓使用者選一個
// 城市」,拿到 opened: true 之後那個目的仍然沒達成,於是再試一次。
//
// 工具結果必須回答 LLM 心裡的下一個問題:「那我現在該做什麼?」所以
// 除了狀態之外,明確寫出三件事:
//   1. 選單已經顯示給使用者了(done,不是等待中)
//   2. 選擇結果不會透過這次呼叫回來
//   3. 因此不要重複呼叫、也不要等待,這一輪到此為止
//
// 2026-10(第五輪,review 發現):第四輪的文案寫「系統會在使用者選完之
// 後,以新的訊息把選擇結果告知你」——那是一個做不到的承諾。
// handleAskPageDone(TripPlanPage.tsx)刻意不觸發新一輪推論(使用者明確
// 要求「先不要接新推論」),所以沒有任何程式碼會送那則訊息。LLM 據此
// 等待一則永遠不會到來的訊息,比單純回 { opened: true } 更糟:它以為
// 流程還在進行中。
// 改成據實描述:這一輪結束、不會自動接續、要查選擇結果得主動呼叫
// get_user_selection。
//
// 用一句完整的話而不是拆成 status/note 兩個欄位(使用者明確要求「你用
// 完整的語意回覆 llm」):拆開的話 LLM 要自己把 'shown' 跟說明兜起來
// 理解,而 'shown' 這種單字本身沒有說清楚「結果不會回來」這件最關鍵的
// 事。
//
// 用系統的角度陳述,不是對 LLM 下指令(使用者明確要求「工具回復的訊息
// 是用系統的角度回復,要說明系統已經提供選單讓使用者選擇,等待使用者
// 選擇後再繼續」):工具結果的本質是「系統回報剛才發生了什麼」,不是
// 「系統命令 LLM 接下來該做什麼」。
//
// 前一版寫成「請不要重複呼叫這個工具、在這裡結束本輪回應」那種祈使句,
// 把該放進 thought 的行為規範塞進了工具結果裡——行為規範是跨所有情境
// 的通則,屬於 thought;工具結果只該描述這一次呼叫的事實。描述清楚
// 「選單已經出去了、正在等使用者」,LLM 自然推得出「那我現在沒事可做」,
// 不需要被命令。
//
// 沒有任何前端程式碼會解析這個回傳值(工具是 fire-and-forget,見各
// handle 的完整說明),所以不需要為了程式好判斷而保留結構化欄位。
// 帶上工具名稱並明說「已成功執行」(使用者明確要求「ask_travel_region
// 工具要回復 ask_travel_region 已經成功執行」):只說「選單已顯示」時,
// LLM 仍可能把這次呼叫的狀態讀成模糊——它要的是一個明確的「這次呼叫
// 成功了」訊號,才會停止重試。訊息開頭就指名工具,也避免同一輪呼叫了
// 多個工具時搞混是哪一個回來了。
function askPageOpenedResult(toolName: string): string {
  return (
    `${toolName} 已經成功執行,系統已經把選單顯示在使用者的畫面上,` +
    '目前正在等待使用者點選。使用者的選擇不會透過這次工具呼叫回傳,' +
    '也不會自動觸發你的下一輪推論——這一輪到此結束,不要重複呼叫,' +
    '也不要用文字追問使用者選了什麼。使用者選完之後若需要你繼續安排,' +
    '會由他自己發訊息給你;屆時可用 get_user_selection 查詢他最近一次' +
    '的選擇內容。'
  )
}

export const openAskPage: ClientTool<AskPageCtx> = defineTool(
  'open_ask_page',
  parseOpenAskPageArgs,
  async (args, ctx) => {
    ctx.ensureFreshRead?.()
    // 2026-10 改成「開啟選單就回傳」,不等使用者選完(使用者明確要求
    // 「LLM 不用等待,目前實作都是一步接一步,使用者選完會再觸發下一次
    // 推論」、「先不要接新推論,發出景點工具後就先停下來」)。
    //
    // 原本是 `const selected = await ctx.openAskPage(...)`,Promise 要等
    // 使用者在畫面上按下確認才 resolve,LLM 這一輪推論跟著卡住。改成
    // 不 await:工具呼叫本身就是「請頁面開啟選單」這個動作,動作送出
    // 即完成,這一輪推論到此結束。
    //
    // 使用者選完之後目前不做任何事(刻意,使用者明確要求「先不要接新
    // 推論」)——之後要接的話,是由前端在 handleAskPageDone 裡把選擇
    // 結果當成新一輪的輸入送出,不是 resolve 這裡的 Promise。
    //
    // 回傳 { opened: true } 而不是 { selected: [] }:後者會讓 LLM 以為
    // 「使用者看過選單、但什麼都沒選」,可能據此改口或重問;前者誠實
    // 表達「選單已開啟,結果之後才會有」。
    if (args.candidates.length > 0) {
      void ctx.openAskPage({ candidates: args.candidates, reason: args.reason })
      return askPageOpenedResult('open_ask_page')
    }
    if (args.explore) {
      void ctx.openAskPage({ explore: args.explore, reason: args.reason })
      return askPageOpenedResult('open_ask_page')
    }
    throw new Error('candidates 不可為空,請先用 search_attraction 查詢候選景點,或改用 destination/mapCenter/userLocation 其中之一啟用探查模式。')
  },
)

// parseAskTravelCountryArgs——ask_travel_country 的 args 型別與 runtime
// 驗證。countryIds 選填,非陣列或陣列內有非字串/空字串元素時過濾掉
// 不合法的部分,不是整個請求失敗(對齊其餘 parseXxxArgs 的既有防禦性
// 寫法)。沒有「缺漏必填欄位」這種情況——這支工具沒有必填參數。
function parseAskTravelCountryArgs(raw: unknown): AskPageCountryInput {
  const obj = raw as Record<string, unknown> | null | undefined
  const rawIds = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const ids = v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    return ids.length > 0 ? ids : undefined
  }
  const reason = typeof obj?.reason === 'string' && obj.reason.length > 0 ? obj.reason : undefined
  return { countryIds: rawIds(obj?.countryIds), reason }
}

// ask_travel_country——打開詢問頁,顯示國家清單讓使用者單選一個。
// 2026-10(第十輪,使用者明確要求「將國家與地區的工具分開,並做自動
// 串接」)從原本的 ask_travel_region(level: 'country')拆出來的獨立
// 工具——選定國家後,前端(TripPlanPage.tsx 的 handleAskPageDone)自動
// 接著顯示該國的城市清單,不需要你再呼叫 ask_travel_city 問城市。
export const askTravelCountry: ClientTool<AskPageCtx> = defineTool(
  'ask_travel_country',
  parseAskTravelCountryArgs,
  async (args, ctx) => {
    ctx.ensureFreshRead?.()
    void ctx.askTravelCountry(args)
    return askPageOpenedResult('ask_travel_country')
  },
)

// parseAskTravelCityArgs——ask_travel_city 的 args 型別與 runtime
// 驗證。countryId 必填且必須是非空字串——沒有它無法知道要顯示哪個
// 國家底下的城市,缺漏或型別不對時回傳 null,交給 handle 的 throw
// 分支處理(理由同 open_ask_page 對缺漏 candidates/explore 的既有
// 處理)。cityIds 選填,過濾規則同 parseAskTravelCountryArgs 的
// countryIds。
function parseAskTravelCityArgs(raw: unknown): AskPageCityInput | null {
  const obj = raw as Record<string, unknown> | null | undefined
  const countryId = typeof obj?.countryId === 'string' && obj.countryId.length > 0 ? obj.countryId : undefined
  if (!countryId) return null
  const rawIds = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const ids = v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    return ids.length > 0 ? ids : undefined
  }
  const reason = typeof obj?.reason === 'string' && obj.reason.length > 0 ? obj.reason : undefined
  return { countryId, cityIds: rawIds(obj?.cityIds), reason }
}

// ask_travel_city——打開詢問頁,顯示某個國家底下的城市清單讓使用者
// 單選一個。2026-10(第十輪)從原本的 ask_travel_region(level: 'city')
// 拆出來的獨立工具,適合使用者已經明確說出想去的國家、只需要問城市的
// 情境(不需要再呼叫 ask_travel_country 顯示整份國家清單)。選定城市
// 後,前端自動接著查附近景點、顯示候選卡片(見 TripPlanPage.tsx
// handleAskPageDone 的完整說明),不需要你自己再呼叫
// search_attraction。countryId 缺漏時直接 throw——這代表呼叫端沒有
// 說清楚要顯示哪個國家的城市,是使用方式錯誤。
export const askTravelCity: ClientTool<AskPageCtx> = defineTool(
  'ask_travel_city',
  parseAskTravelCityArgs,
  async (args, ctx) => {
    ctx.ensureFreshRead?.()
    if (!args) {
      throw new Error('countryId 為必填,請先用 ask_travel_country 確認國家,或直接帶上已知的 countryId。')
    }
    void ctx.askTravelCity(args)
    return askPageOpenedResult('ask_travel_city')
  },
)

// AskTransportModeArgs/parseAskTransportModeArgs——ask_transport_mode
// 的 args 型別與 runtime 驗證。modes 選填:省略或整理後為空時回退成
// ALL_TRANSPORT_MODES(預設全部、預設順序,見該常數的完整說明),不是
// 當成錯誤——這支工具最常見的呼叫方式就是「不特別篩選,顯示全部交通
// 方式」。不合法的值(不在 TransportMode 列舉內的字串)直接過濾掉,
// 理由同其餘 parseXxxArgs 的既有防禦性寫法。
export interface AskTransportModeArgs {
  modes: TransportMode[]
  reason?: string
}

function parseAskTransportModeArgs(raw: unknown): AskTransportModeArgs {
  const obj = raw as Record<string, unknown> | null | undefined
  const rawModes = Array.isArray(obj?.modes) ? obj.modes : []
  const modes = rawModes.filter((m): m is TransportMode => ALL_TRANSPORT_MODES.includes(m as TransportMode))
  const reason = typeof obj?.reason === 'string' && obj.reason.length > 0 ? obj.reason : undefined
  return { modes: modes.length > 0 ? modes : ALL_TRANSPORT_MODES, reason }
}

// ask_transport_mode——打開詢問頁,顯示交通方式選項讓使用者單選一個,
// 回傳選中的值給 LLM;使用者按「不用了」回傳 null。modes 用來控制
// 顯示哪些、依什麼順序(見 AskTransportModeArgs 的完整說明),不是像
// ask_travel_region 那樣由 LLM 自訂選項內容本身。
export const askTransportMode: ClientTool<AskPageCtx> = defineTool(
  'ask_transport_mode',
  parseAskTransportModeArgs,
  async (args, ctx) => {
    ctx.ensureFreshRead?.()
    // 同 ask_travel_region:不等待、回 { opened: true },避免 LLM 把
    // null 讀成「使用者沒選」而重問(見該工具的完整說明)。
    void ctx.askTransportMode(args.modes, args.reason)
    return askPageOpenedResult('ask_transport_mode')
  },
)

// get_user_selection——讓 LLM 查詢使用者最近一次在詢問頁的選擇
// (2026-10 新增,見 UserSelectionRecord 的完整說明)。
//
// 沒有參數:只有「最近一次」這一種查詢,不需要條件。args 的驗證函式
// 直接回傳一個空物件,對齊 defineTool 的既有簽名(它要求每個工具都有
// parse 步驟,即使沒有參數要驗)。
//
// 查不到時回傳一句話而不是 null:LLM 拿到 null 會不確定是「系統壞了」
// 還是「真的沒有」,一句話把情況說清楚——這跟三個詢問頁工具回傳完整
// 句子的理由相同(見 askPageOpenedResult 的完整說明)。
export const getUserSelection: ClientTool<AskPageCtx> = defineTool(
  'get_user_selection',
  () => ({}),
  async (_args, ctx) => {
    const record = ctx.getUserSelection()
    if (!record) {
      return '目前沒有任何使用者選擇的記錄——使用者還沒有在選單上完成選擇,或是這次對話還沒有開過選單。'
    }
    return record
  },
)

// get_attraction_pool——讓 LLM 查閱這次對話出現過的所有景點
// (2026-10 新增,見 planning/conversation/attractionPoolStore.ts 的完整說明)。
//
// 跟 search_attraction 的分工:search_attraction 是「去查新的」,會打
// Google Places、消耗配額、回來的候選順序不保證跟上次一樣;這支是
// 「看看已經查過什麼」,純讀記憶體、沒有成本。要把一個 placeId 對照成
// 名稱時用這支,不要為此重新搜尋一次。
//
// 無參數:一次回傳整池。池子是幾十筆的量級(一次對話查過的候選),
// 不需要分頁或篩選——LLM 自己在回傳結果裡找它要的那幾筆就好。
export const getAttractionPool: ClientTool<AskPageCtx> = defineTool(
  'get_attraction_pool',
  () => ({}),
  async (_args, ctx) => {
    const pool = ctx.getAttractionPool()
    if (pool.length === 0) {
      return '景點池目前是空的——這次對話還沒有查詢過任何景點。需要候選的話請先呼叫 search_attraction。'
    }
    return { places: pool }
  },
)

// get_ui_state——讓 LLM 查閱使用者「現在」正在看什麼畫面、畫面上有哪些
// 選項、已經選到哪裡(2026-10 新增,使用者明確要求「在前端維護一個使用者
// 目前在哪一個畫面,選了那些項目的資訊,提供一個新的工具讓 AI 讀取」,
// 見 planning/conversation/uiStateStore.ts 的完整說明,含與其餘兩支查詢工具的分工)。
//
// 為什麼需要這支:open_ask_page 這批工具都是「開啟就回傳、不等待」
// (見 askPageOpenedResult 的完整說明),所以 LLM 開完選單那一輪就結束
// 了。下一輪被叫起來時,它無從得知使用者卡在哪一步——還沒選?選到一半?
// 早就選完了?沒有這份資訊它只能猜,或重複呼叫同一個開選單的工具
// (實機踩過的迴圈)。
//
// 無參數:一次回傳完整的當下畫面狀態,沒有「要查哪個部分」的語意。
export const getUiState: ClientTool<AskPageCtx> = defineTool(
  'get_ui_state',
  () => ({}),
  async (_args, ctx) => ctx.getUiState(),
)

// createAskPageToolsList——對齊 tools.ts 的
// createAttractionToolsList 既有慣例,讓呼叫端一次拿到這個檔案定義的
// 所有工具。
export function createAskPageToolsList(): ClientTool<AskPageCtx>[] {
  return [openAskPage, askTravelCountry, askTravelCity, askTransportMode,
    getUserSelection,
    getAttractionPool,
    getUiState,
  ]
}
