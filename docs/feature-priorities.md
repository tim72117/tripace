# 實作優先序:10 個項目的落地順序

> 產生方式:2026-07-20,以 [feature-brainstorm.md](feature-brainstorm.md) 統整出的 10 個項目為對象,對照目前程式碼實況排出實作順序。
> 排序原則:**(1) 建立在現有基礎上的先做**(缺口小、風險低)、**(2) 信任基礎建設優先於華麗功能**(diff 預覽/undo 沒做好,AI 改壞一次行程使用者就走了)、**(3) 共用基礎建設要一次到位**(候選池、路線資料被多個項目依賴)、**(4) 獲客功能等產品核心穩了再放大**。

## 現況盤點(排序的依據)

已有的能力:

| 能力 | 狀態 |
|---|---|
| LLM 對話操作旅程清單(`trip_entry_add`/`trip_entry_update`/`trip_entry_list`/`trip_list_batches`、ask_user/ask_choice、entry_query) | ✅ 正式功能——已改走 clienttools 機制(見下一列的說明) |
| 附近景點推薦(recommend_nearby,Places Nearby/Text Search,含照片) | ✅ 正式功能 |
| Entry 資料模型含 Location/Lat/Lng 欄位、Kind 分類、Detail 結構化欄位 | ⚠️ 欄位在 Postgres `model.Entry` 上都還在,但 AI 對話這條主力寫入路徑已不再經過它:`server/internal/wanttools/entry_add.go` 等直寫 Postgres 的工具已刪除,現行 LLM 寫入改呼叫 `trip_entry_add`(`server/tools/clienttools.yaml`、`web/src/clienttools/tools/tripEntryAdd.ts`),經 clienttools 機制轉發到瀏覽器分頁,寫進裝置端的旅程清單(`web/src/deviceDB.ts`),欄位只有 `title/date/time/note`,連 location 都不是輸入欄位,更談不上 lat/lng——資料洞不只「沒落地座標」,而是整條路徑已經沒有座標概念。座標欄位目前只服務另外兩條獨立路徑:(1) `tripsvc.Record`(`POST /internal/trips/{id}/entries`、`POST /v1/trips/{id}/entries` 等)寫入 Postgres entry 時可帶座標,(2) `POST /internal/entries/{id}/geocode`(`server/internal/api/entry_geocode.go`、`server/internal/geo/geocode.go`)可事後補座標,以及地圖上手動拖曳選點校正座標(`web/src/PaceRouteMap.tsx`)。詳見 itinerary-ux-design.md 6.2(該節已更新反映 clienttools 現況) |
| WebSocket 即時推送(entries_updated、entry_updating、recommended_places…) | ✅ 正式功能 |
| 行程公開分享(/public/{token}) | ✅ 正式功能 |
| 多人成員與編輯者權限 | ✅ 正式功能 |
| 手動編輯 | ✅ 正式功能——後端 `PATCH /v1/entries/{id}` 與前端編輯表單皆已完成(`web/src/Timeline.tsx` 的 `EditEntrySheet` 涵蓋 title/start/startTime/end/endTime/location/note,呼叫 `web/src/api.ts` 的 `updateEntry`);另有 trip-scoped 的新增/修改/刪除端點(見「共用基礎建設」說明) |
| 地圖(Maps JS API 極簡風格) | ✅ 正式功能——「路徑」是常駐導覽項目,不受 `?demo` 限制:桌面版 rail(`web/src/DesktopRail.tsx`,`panelMode === 'pace'` 那顆按鈕在 `isDemo &&` 條件之外)、手機版右側工具列(`web/src/PhoneSideTools.tsx`)皆常駐 |
| Entry 的 place_id | ❌ 未儲存(營業時間查詢的前提) |
| 點對點交通時間(Routes/Distance Matrix) | ✅ 已接 Routes API——`server/internal/api/pace_route.go` 直接呼叫 `routes.googleapis.com/directions/v2:computeRoutes`,`server/internal/api/entry_geocode.go` 的 `handleComputeRouteFromEntries`(`POST /internal/entries/compute-route`)以 entry 座標組 origin/intermediates/destination;前端 `web/src/PaceRouteMap.tsx` 有 localStorage 路線快取(cache key 含座標,座標一改自動失效) |
| mock LLM e2e 測試框架 | ✅ 已建立(所有改動的安全網) |

## 優先序

### 第 1 位:行程健檢——第一階段「營業時間哨兵」
**為什麼第一**:Places Details 的營業時間是現成資料、Tripace 已接 Places API,是十個項目裡缺口最小的;而它建立的是整個產品最稀缺的資產——信任(「這個 app 會幫我盯著」)。AI 行程工具最常被罵的就是排出踩休館日的行程,先把這件事做到不出錯。
**要補的缺口**:Entry 儲存 place_id(建立行程項目時由 Places 比對回填);排程檢查(或儲存時觸發)比對「排定時段 vs 營業時間」;時間軸卡片的警示標紅 UI。
**工程量**:小~中。**依賴**:無。

### 第 2 位:diff 預覽 + undo(AI 批次操作的信任基礎建設)
**為什麼第二**:它本身不是使用者看得到的「功能」,但它是第 3、5、7、8 位所有 AI 批次改動的前提。現況 LLM 改行程是直接生效,單筆還好;一旦做「整段重排」,沒有預覽與還原,AI 一次改壞就是信任崩潰。先把「AI 提案 → 人審核 → 套用/還原」的機制做成所有工具共用的管線。
**要補的缺口**:後端批次操作的暫存/提案模型(或操作日誌逆向還原);前端 diff 呈現(哪些新增/修改/刪除)與確認/還原 UI;LLM 工具層把多個編輯包成一個提案。
**工程量**:中。**依賴**:無(但被 3、5、7、8 依賴)。

### 第 3 位:對話式重排(一句話鬆行程 + 連鎖順延)
**為什麼第三**:現有 LLM 工具管線直接可用,是「已有技術優勢的直接變現」——對手抄不走的體驗。第 2 位完成後,這項幾乎只是 prompt 與工具組合的工作。
**要補的缺口**:重排情境的 prompt 設計;刪除/移動時觸發「要不要順延後面?」的互動;與 diff 預覽整合。
**工程量**:小(建立在第 2 位之上)。**依賴**:第 2 位。

### 第 4 位:接駁自動補齊(交通資料基礎建設)
**為什麼第四**:Routes/Distance Matrix API 的接入是一次性基建,同時解鎖三件事——行程健檢第二階段(「趕不到」警示)、時間軸相鄰點的移動時間呈現(地理理解的核心,見 itinerary-ux-design.md)、後續今天模式的重排依據。放在健檢第一階段之後是因為它有 API 成本,需要先設計好快取策略(只算相鄰段、行程變動才重算)。
**要補的缺口**:Routes API 接入與快取層;時間軸「兩點之間」的移動時間 UI;銜接不可能的警示併入健檢。
**工程量**:中→小~中(可下修)。核心前提「Routes API 接入」其實已經在線上——`server/internal/api/pace_route.go` 的 `computeRoutes` 呼叫、`POST /internal/entries/compute-route` 以 entry 座標算路線、`PaceRouteMap.tsx` 的 localStorage 路線快取(cache key 含座標,座標變動即失效)都已運作。剩下的是把既有能力**接到時間軸**:相鄰段的移動時間 UI、快取層從前端 localStorage 升級為後端共用快取(多人共用、跨裝置),以及銜接不可能的警示。**依賴**:Entry 座標(已有,但 AI 對話路徑仍需靠 geocode 端點或手動拖曳補齊)。

### 第 5 位:空檔雷達(時間感知推薦)
**為什麼第五**:是現有 recommend_nearby 的直接升級——同樣的 Places API、同樣的推薦 UI,差別在查詢條件從「目前位置」變成「未來時刻的位置 + 當時營業 + 前後脈絡」。第 4 位的交通資料到位後,「順路」判斷才有依據。
**要補的缺口**:空檔偵測邏輯;推薦查詢帶入時間脈絡(營業時間過濾);低打擾的建議卡 UI。
**工程量**:小~中。**依賴**:第 1 位(place_id/營業時間)、第 4 位(順路判斷)。

### 第 6 位:靈感收件匣(貼上即成行程)——第一階段純文字
**為什麼第六**:三視角同時命中的最強需求,但完整版(截圖 OCR、反爬)工程大。切成兩階段:先做「貼文字/連結 → LLM 抽地點 → Places 比對 → 候選池」,已能覆蓋部落格與朋友訊息的場景;截圖辨識後補。放在中段是因為候選池是新的資料模型,設計時要同時滿足第 7 位共用。
**要補的缺口**:候選池資料表與 UI(待排清單);LLM 抽取地點的工具;Places 比對與使用者確認流程。
**工程量**:中(第一階段)。**依賴**:無硬依賴,候選池與第 7 位共用。

### 第 7 位:旅伴共決(候選池 + 投票 + AI 折衷)
**為什麼第七**:成員/權限/WebSocket 全部現成,候選池由第 6 位建立,剩下投票機制(純前後端 CRUD)與 AI 折衷(對話框架延伸)。多人場景是留住「團體旅行」使用者的關鍵,但單人場景先跑順才有團可揪。
**要補的缺口**:投票資料模型與即時同步;滑卡片表態 UI;AI 彙整衝突的 prompt。
**工程量**:中。**依賴**:第 6 位(候選池)。

### 第 8 位:一鍵複製 + AI 改編
**為什麼第八**:「幾乎白拿」——分享機制已有,複製是後端資料拷貝,AI 改編是一個預設 prompt。放在中後段唯一的原因是:它是獲客功能,前提是被複製的行程本身值得複製(核心體驗先好)。做完 1~5 之後這項的價值會自動放大。
**要補的缺口**:複製 API(行程與項目的深拷貝);公開頁的「複製成我的」入口;改編引導流程。
**工程量**:小。**依賴**:核心體驗(1~5)成熟。

### 第 9 位:旅費分帳
**為什麼第九**:雙視角命中、需求已被 Splitwise 驗證,且技術獨立(純 CRUD + 匯率 API)隨時可插隊。放後段是因為它服務「旅途中與旅途後」,而目前產品的主戰場還在「規劃期」;等規劃期體驗完整,分帳是拆掉試算表的最後一擊。
**要補的缺口**:帳目資料模型(綁 Entry)、拆分與結清演算法、快速記帳 UI(LLM 語音/拍收據可後補)。
**工程量**:中。**依賴**:無。

### 第 10 位:訂單轉寄收件匣
**為什麼第十**:價值很高(TripIt 的護城河)但基建最重——inbound mail 服務、每行程專屬信箱、多格式郵件解析、PDF 附件、隱私設計,全部是新領域。適合作為一個獨立的專案階段,在核心體驗與留存數據證明產品方向後投入。
**要補的缺口**:收信基建(SES/Mailgun)、LLM 郵件解析管線、解析結果的確認 UI、隱私政策。
**工程量**:大。**依賴**:無技術依賴,但投入大需要產品信心。

### 「今天模式 + 現場救援」的位置說明
腦力激盪第 8 項(今天模式)不在上面 1~10 的獨立位置,因為它實質是**行動端的視圖 + 第 3 位重排能力 + 第 4 位交通資料**在旅途中的組合應用。建議:等 3、4 完成後,把它作為 iOS 端的主打功能立項(離線快取、定位、鎖定標記是 iOS 專屬工程),屆時它的後端依賴已全部就緒。

## 共用基礎建設總表(跨項目依賴,設計時一次到位)

| 基礎建設 | 被哪些項目依賴 | 現況 |
|---|---|---|
| Entry 的 place_id 欄位 | 健檢、空檔雷達、接駁 | ❌ 需新增(座標已有) |
| diff 預覽 + undo 管線 | 對話式重排、靈感收件匣、複製改編、今天模式 | ❌ 需新增 |
| Routes API + 快取層 | 健檢二階段、接駁、空檔雷達、今天模式 | ⚠️ 已部分存在:Routes API 呼叫已完成(`pace_route.go`、`entry_geocode.go` 的 `handleComputeRouteFromEntries`),快取目前只在前端 localStorage(`PaceRouteMap.tsx`)。待補的是後端共用快取層與時間軸的相鄰段查詢介面 |
| 候選池(待排清單) | 靈感收件匣、旅伴共決、空檔雷達(建議去向) | ❌ 需新增 |
| 項目鎖定標記(訂位不可動) | 對話式重排、今天模式 | ❌ 需新增(小) |

## 建議的第一批動工(一句話版)

先做 1(營業時間哨兵)與 2(diff+undo)——一個對外建立「這 app 靠得住」的信任,一個對內建立「AI 改動可控」的地基;兩者都不依賴任何未接入的外部服務,完成後 3、4、5 會像骨牌一樣順下去。
