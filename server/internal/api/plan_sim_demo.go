package api

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// plan_sim_demo.go — AI 規劃時間軸「試作原型」
// (web/src/plan-ai/AIPlanTimelinePage.tsx)專屬的模擬後端邏輯:
// handlePlanSimWS 這條「送出推論信號」的 WebSocket 服務,依一份寫死的腳本
// 模擬 AI 逐步決定要在行程裡新增什麼的即時感。這不是正式功能
// (trip-plan/TripPlanPage.tsx)依賴的任何一部分——正式功能走真實 onagent
// 對話,不經過這支端點。
//
// 需登入,但驗證方式跟其餘端點不同:這支端點沒有掛在 internalAuth 中介層
// 底下(那層只認 Authorization header),而是在 handler 內自行驗證 query
// string 帶來的 token——因為瀏覽器原生 WebSocket API 不支援自訂 header,
// 同 handleWS(/v1/trips/{id}/ws)的既有慣例。**「沒有掛 internalAuth」
// 不等於「免登入」**,只是驗證機制不同,未帶有效 token 一律回 401(見
// handlePlanSimWS 開頭的完整說明)。
//
// 2026-09:這支端點原本掛在免登入的 /public/plan-sim/ws——任何訪客都能
// 連上來消耗伺服器資源,且這個試作原型共用的那批查詢端點當時也免登入,
// 整條路徑都是對外開放的。改成需登入後,這個試作原型也一併收進登入後的
// /app 試作區(見 web/src/DesktopShared.tsx 的 DEMO_PLAN_AI_ENABLED)。
//
// action 訊息格式(見下方 planAction 型別):
//
//	{"type":"thinking"} ——每一筆實際 action 送出之前都先送這一則,前端
//	  據此顯示「AI 正在想下一步」的思考動畫(呼吸點+骨架卡,見
//	  AIPlanTimelinePage.tsx 的 tipRow/skeletonRow),停頓一段時間後才
//	  送出下面某一種實際 action——這是模擬「AI 在決定下一步要排什麼」
//	  這段思考過程本身,不是單純省略延遲直接把動作丟出來。done 訊息前
//	  不會有 thinking(腳本已經結束,沒有「即將生成什麼」這件事)。
//	{"type":"add_section","label":"上午"}
//	{"type":"add_stop","id":"stop-1","time":"08:30",...,"attractionId":"lmk_..."}
//	  ——attractionId 有值時,前端要用它呼叫 fetchPublicGeoAttractionByID
//	  (GET /public/geo/attraction/{id})查真正的地點詳情再顯示,若查到的
//	  attraction 本身帶 place_id,前端會再查 place-details-any 補強(見
//	  AIPlanTimelinePage.tsx resolveAttractionForStep 的完整說明)。這是
//	  「AI 呼叫工具、把 attraction id 傳給前端」這個核心概念的具體落地,
//	  跟 onagent 對話路徑(attractionTools.ts 的 add_attraction)共用同一套
//	  反查邏輯——2026-09 使用者明確要求「模擬的也要,現在模擬跟推論的都
//	  要用同一套」,不再是後端直接把完整資料內嵌進這則訊息裡,也不再各自
//	  維護一份反查規則。同一次修正也移除了這份腳本裡原本固定寫死的
//	  add_transit 訊息(交通方式/時間/距離)——「交通預估時間不要讓 AI
//	  推論產生,而是建立兩個點時前端自己送到後端由後端預估」這個要求
//	  同樣適用於模擬腳本:固定寫死的交通數字本質上就是另一種「推論
//	  產生」,腳本不該再自己決定交通卡的內容。add_stop 插入後若前一個
//	  節點也是有座標的 stop,前端 maybeInsertTransitBefore(見
//	  AIPlanTimelinePage.tsx 的完整說明)會自動呼叫
//	  GET /public/geo/transit-estimate 補上交通卡,不需要這份腳本再送出
//	  任何 add_transit 訊息。
//	{"type":"add_note","id":"note-1","afterId":"stop-wumiao","category":"info","text":"..."}
//	  ——afterId 指向要把這則備註寫在哪個既有節點自己身上(不是插入新
//	  節點的位置,見 planAction.AfterID 的完整說明),category 是語意
//	  層級的分類字串(前端 AIPlanTimelinePage.tsx 的 NOTE_STYLES 表決定
//	  實際顏色/圖示,見該常數的完整說明),不是這裡直接送視覺樣式。
//	{"type":"add_message","id":"msg-1","text":"..."}
//	  ——LLM/使用者的對話訊息本身(對應前端 planTimeline.ts 的獨立
//	  'message' 節點型別,見該型別的完整說明)。2026-09 這裡經歷過兩次
//	  修正:第一版做成掛在某個既有 stop 節點身上的欄位(add_agent_message,
//	  AfterID 指向哪一站),但使用者明確指出「他不是引言,是對話」——
//	  真實情境裡 LLM 常常先說一句話、使用者看完才決定要不要把某個景點
//	  加入行程,這時候根本還沒有任何 stop 節點可以依附,證明「掛在某個
//	  stop 身上」這個資料模型的前提就不成立。改成跟 add_section/add_stop
//	  同構的插入類訊息——直接 append 到時間軸尾端(省略 AfterID 時的既有
//	  預設行為,見 AfterID 欄位說明),不需要指向任何既有節點。話題推進
//	  (後面接著送出的 add_stop)時,前端會把它標記成 stale、渲染成淡化
//	  的樣子,但它仍然是時間軸上自己獨立的一個節點,不會被刪除或併入
//	  任何 stop 卡片(見 planTimeline.ts staleOtherAgentMessages 的完整
//	  說明)。
//	{"type":"remove_step","id":"stop-2"} ——示範刪除:先加入的某一站,
//	  稍後模擬「AI 想了想,決定拿掉」而移除,前端收到後從時間軸移除
//	  對應的卡片。
//	{"type":"done"} ——腳本播完,前端據此把「正在安排」狀態切換成
//	  「已完成」。
//
// 除了照本宣科播放 planSimScript,這條連線也接收前端傳來的「觸發」訊息
// (見下方 planSimTrigger/planSimTriggerActions)——AIPlanTimelinePage.tsx
// 對話框下方的測試按鈕(模擬移除/插入某一站)不會在前端自己組 action、
// 直接改本地畫面,而是送一則 {"trigger":"remove_wumiao"} 這樣的請求給
// 後端,由後端決定要不要、以及送出什麼樣的 action 訊息——所有結構變化
// 都要「經過後端」才會真的發生,前端測試按鈕只是觸發後端送出模擬信號的
// 入口,不能繞過後端自己捏造一份假訊息。播放固定腳本(playScript
// goroutine)跟接收觸發訊息(主 goroutine 的阻塞讀迴圈)併行執行,寫入
// 同一條連線的動作用 writeMu 互斥(見下方說明),避免兩者同時呼叫
// conn.Write 造成訊息交錯損毀。
func (s *Server) handlePlanSimWS(w http.ResponseWriter, r *http.Request) {
	// token 從 query string 帶,不是 Authorization header——瀏覽器原生
	// WebSocket API 不支援自訂 header(同 handleWS,見 ws.go 的說明),這也
	// 是這支端點無法掛在 internalAuth 中介層底下、必須自己驗的原因。
	//
	// 刻意用 signer.Verify 而非 userFromToken:後者驗證失敗時回傳
	// s.guestUser 而非報錯(見 auth.go),拿它的回傳值無法區分「真的登入了」
	// 與「token 無效被降級成訪客」,這道檢查會完全失效。這支端點不需要知道
	// 是「誰」(播放的是固定腳本,不含任何使用者資料),只需要確認「是持有
	// 有效 JWT 的登入使用者」,Verify 的語意正好對上。
	//
	// 驗證放在 websocket.Accept 之前:Accept 之後才驗等於 upgrade 已經完成,
	// 此時回 401 對客戶端沒有意義(HTTP 狀態碼在 upgrade 後不再有效)。
	if _, err := s.signer.Verify(r.URL.Query().Get("token")); err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "需要登入才能使用這個試作功能")
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	ctx := r.Context()

	// writeMu:playScript(固定腳本,獨立 goroutine)與下方主 goroutine
	// 的觸發訊息處理都會呼叫 conn.Write——nhooyr.io/websocket 的
	// *websocket.Conn 本身不保證併發寫入安全(官方文件:一次只能有一個
	// goroutine 呼叫 Write),不加鎖會有訊息交錯損毀或底層資料競爭的
	// 風險。
	var writeMu sync.Mutex
	writeAction := func(action planAction) error {
		b, err := json.Marshal(action)
		if err != nil {
			log.Printf("handlePlanSimWS: marshal 失敗: %v", err)
			return nil
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.Write(ctx, websocket.MessageText, b)
	}

	// randomDelay:700~1200ms 隨機延遲——理由同前端原本
	// AIPlanTimelinePage.tsx 純前端模擬時使用的同一組數值(見該檔案的
	// 完整說明),維持一致的生成節奏觀感,改由後端推播後這組數值就不需要
	// 在前端維護一份。抽成共用函式,理由是 thinking 前置延遲與實際
	// action 送出前的延遲都要用到同一組數值(見下方 sendWithThinking)。
	randomDelay := func() time.Duration {
		return 700*time.Millisecond + time.Duration(rand.Intn(500))*time.Millisecond
	}
	sleep := func(d time.Duration) bool {
		select {
		case <-time.After(d):
			return true
		case <-ctx.Done():
			return false
		}
	}

	// nextStep:2026-09 使用者明確要求「下方放入一個按鈕,下一步,讓模擬
	// 不要自動全部播放,我按下一步才送下一個」——playScript(見下方)不再
	// 送完一則就自己 sleep 接著送下一則,而是在每則訊息之間等待這個
	// channel 收到信號才繼續。緩衝區大小 1(而非無緩衝)是刻意的:使用者
	// 可能在 playScript 還在處理上一步的 thinking/延遲期間就手癢多按了
	// 一次「下一步」,這次多按的請求應該被記住、留到下一輪 <-nextStep
	// 時消費掉,而不是被丟棄或讓讀取迴圈的 conn.Write 卡住等 playScript
	// 準備好接收——讀取迴圈與 playScript 是併行的兩個 goroutine,兩者
	// 不該因為對方的處理節奏而互相阻塞。同一時間最多累積一次「多按」的
	// 意義已經足夠(使用者連續按兩次「下一步」,直覺預期是連續推進兩步,
	// 不是查看第二次點擊被忽略),故緩衝 1 已足夠,不需要更大的佇列。
	nextStep := make(chan struct{}, 1)

	// sendWithThinking:送出一則「thinking」訊號、停頓、再送出真正的
	// action——這是「後端先送推論中信號,再送結果信號」這個需求的核心
	// 落地,playScript 固定腳本與下方觸發訊息處理共用同一個函式,理由是
	// 兩者都代表「AI 決定要做某件事」,語意上沒有理由只在其中一條路徑
	// 加思考動畫。回傳 false 代表寫入失敗或連線已結束,呼叫端應該直接
	// return,不需要再嘗試送接下來的訊息。
	sendWithThinking := func(action planAction) bool {
		if err := writeAction(planAction{Type: "thinking"}); err != nil {
			return false
		}
		if !sleep(randomDelay()) {
			return false
		}
		if err := writeAction(action); err != nil {
			return false
		}
		return true
	}

	// waitForNextStep:等待前端送出 {"trigger":"next"}(見下方讀取迴圈對
	// "next" 的特殊處理)或連線結束——playScript 每送完一則實際 action
	// 就呼叫這個函式卡住,不再像改動前那樣自己 sleep 一段隨機延遲就自動
	// 繼續下一則。回傳 false 代表 context 已結束,呼叫端應該直接
	// return,不需要再嘗試送接下來的訊息。
	waitForNextStep := func() bool {
		select {
		case <-nextStep:
			return true
		case <-ctx.Done():
			return false
		}
	}

	// playScript:照原本行為在背景播放固定腳本,不阻塞下面的觸發訊息
	// 讀取迴圈——若跟讀取觸發訊息共用同一個 goroutine,腳本播放中會沒
	// 辦法即時處理使用者點擊測試按鈕送來的請求。每一輪是「thinking →
	// 延遲 → 實際 action → 等待下一步信號」,2026-09 使用者明確要求
	// 「下方放入一個按鈕,下一步,讓模擬不要自動全部播放,我按下一步才送
	// 下一個」之後,「送完直接進下一輪」這件事不再自動發生,改成卡在
	// waitForNextStep,直到前端透過下一步按鈕(見
	// AIPlanTimelinePage.tsx sendNextStep)明確請求才繼續。thinking 訊號
	// 與其後的隨機延遲(sendWithThinking 內)仍然保留——這段代表「AI 正在
	// 想下一步」的思考動畫節奏跟「使用者決定要不要看下一步」是兩件獨立
	// 的事,不因為改成手動推進就一併拿掉。done 訊息不經過
	// sendWithThinking(前面不送 thinking,見上方文件說明),也不需要等待
	// 下一步信號,直接寫入並結束這個 goroutine——腳本本身已經播完,沒有
	// 「下一步」這個概念可言。
	go func() {
		for _, action := range planSimScript {
			if action.Type == "done" {
				_ = writeAction(action)
				return
			}
			if !sendWithThinking(action) {
				// 對方斷線或寫入失敗/context 結束——不需要額外處理,下面
				// 的讀取迴圈會各自偵測到同樣的斷線並結束整個 handler。
				return
			}
			if !waitForNextStep() {
				return
			}
		}
	}()

	// 阻塞讀取前端傳來的觸發請求——這是「前端按鈕不自己組訊息,而是請
	// 後端送出」這個需求的核心,同時也是這個 handler 唯一偵測「對方主動
	// 斷線/context 結束」的地方,取代原本單純為了偵測斷線而存在、不做
	// 任何事的阻塞讀迴圈——腳本播完後這個迴圈仍會繼續跑,讓連線保持
	// 開著持續接收測試按鈕的觸發請求,對齊原本「腳本播完後保持連線開著」
	// 的既有行為。
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var trig planSimTrigger
		if err := json.Unmarshal(data, &trig); err != nil {
			log.Printf("handlePlanSimWS: 觸發訊息解析失敗: %v", err)
			continue
		}
		// "next":控制信號,不查 planSimTriggerActions(那份表是「插入/
		// 移除某一站」這種會產生實際 action 訊息的操作,見該變數的完整
		// 說明)——這裡只是把 playScript 目前卡住的 waitForNextStep 放行,
		// 不會由這個讀取迴圈自己送出任何 action。用非阻塞的 select 往
		// nextStep 送信號(而非直接 `nextStep <- struct{}{}`)——playScript
		// 若還在 sendWithThinking 的延遲期間(還沒真正呼叫到
		// waitForNextStep),這裡直接阻塞寫入會卡住整個讀取迴圈,直到
		// playScript 準備好接收為止;channel 緩衝區已經是 1(見宣告處的
		// 完整說明),default 分支只在「上一次多按的信號還沒被消費」時
		// 才會走到,直接靜默略過這次多餘的信號即可,不需要報錯。
		if trig.Trigger == "next" {
			select {
			case nextStep <- struct{}{}:
			default:
			}
			continue
		}
		action, ok := planSimTriggerActions[trig.Trigger]
		if !ok {
			log.Printf("handlePlanSimWS: 未知的觸發指令: %q", trig.Trigger)
			continue
		}
		// 觸發訊息一樣先送 thinking、停頓,再送實際 action(見
		// sendWithThinking 的完整說明)——這裡是同步呼叫,會讓這個讀取
		// 迴圈在延遲期間暫停處理下一個觸發請求,對齊這個模擬情境本來就是
		// 低頻的使用者互動(點擊測試按鈕),不需要在等待期間還能併發處理
		// 另一個觸發請求。
		if !sendWithThinking(action) {
			return
		}
	}
}

// planSimTrigger — 前端測試按鈕送來的觸發請求形狀,對應
// AIPlanTimelinePage.tsx 的 sendTrigger。Trigger 是查
// planSimTriggerActions 表用的 key,不是完整的 action 訊息本身——前端
// 只表達「我要哪一種操作」,實際的 action 內容(id/座標/文案等)完全由
// 後端決定,前端無法透過這個管道注入任意內容。
type planSimTrigger struct {
	Trigger string `json:"trigger"`
}

// planSimTriggerActions — 觸發指令對應的 action 訊息表。目前只涵蓋
// AIPlanTimelinePage.tsx 兩顆測試按鈕各自需要的一則訊息:
//   - remove_wumiao:移除祀典武廟。
//   - insert_anping_mazu:在祀典武廟原本的位置(note-1 之後)插入安平
//     天后宮,取代被移除的那一站。
//
// 兩者刻意各自獨立、不互相觸發——「點了按鈕才送替換信號」的設計是每個
// 使用者操作對應一次明確的觸發請求,插入不會因為移除被觸發就自動跟著
// 發生,必須是另一次獨立的使用者操作(另一顆按鈕)才會送出。
var planSimTriggerActions = map[string]planAction{
	"remove_wumiao": {Type: "remove_step", RemovedID: "stop-wumiao"},
	"insert_anping_mazu": {
		Type: "add_stop", ID: "stop-anping-mazu", Time: "10:00", Duration: "停留 30 分", Kind: "景點",
		Name: "安平天后宮", Desc: "開台第一座媽祖廟，主祀鎮殿媽祖神像相傳隨鄭成功來台，廟埕保留早期安平聚落的生活紋理。",
		ThumbBg: "linear-gradient(135deg, #B85C4A, #8B3A2F)", ThumbIcon: "⛩️",
		Tags: []string{"免費入場"},
		Lat:  22.9998, Lng: 120.1642,
		AfterID: "note-1",
	},
}

// planAction 對應上方文件裡列出的每種訊息形狀——用同一個 struct 涵蓋
// 全部欄位、以 omitempty 省略不相關的欄位,而非為每種 type 各自定義
// 一個型別再包一層 interface{},理由是這支端點的訊息本來就是固定寫死
// 的展示腳本(見 planSimScript),不需要為了型別安全的彈性付出額外的
// 序列化複雜度;前端收到後依 Type 分派要讀哪些欄位即可。
type planAction struct {
	Type string `json:"type"`

	// add_section
	Label string `json:"label,omitempty"`

	// add_stop
	ID        string   `json:"id,omitempty"`
	Time      string   `json:"time,omitempty"`
	Duration  string   `json:"duration,omitempty"`
	Kind      string   `json:"kind,omitempty"`
	Name      string   `json:"name,omitempty"`
	Desc      string   `json:"desc,omitempty"`
	ThumbBg   string   `json:"thumbBg,omitempty"`
	ThumbIcon string   `json:"thumbIcon,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	// PlaceID:有值時代表這一步「AI 呼叫了查地點工具」,前端要拿這個
	// Google Place ID 去呼叫 GET /public/geo/place-details-any 取得真正
	// 的地點詳情(名稱/簡介/照片)覆蓋掉這則訊息本身帶的假資料欄位——這是
	// 這支模擬服務存在的核心目的,不是每一步都會帶,沒帶時前端維持純展示
	// 假資料(漸層色塊+emoji 佔位圖、這裡的 Desc 當敘事文字)。
	//
	// 2026-09 再次修正:原本這裡是 AttractionID(資料庫景點區域 id,走
	// fetchPublicGeoAttractionByID 兩段式查詢),使用者明確要求「search_attraction
	// 不用完整資訊,LLM 選擇的時候用 placeId,送入後 place-details-any
	// 查詢的時候再查對應的 attraction,優先顯示 attraction」——onagent
	// 對話路徑(attractionTools.ts 的 add_attraction)已經改回統一用
	// placeId、單段查詢 GET /public/geo/place-details-any(該端點內部
	// 已經會優先查資料庫 attraction,查無才 fallback 查 Google,見
	// handlePublicGeoPlaceDetailsAny 的完整說明),這裡跟著改用同一套
	// 機制,不再各自維護一份反查邏輯。
	PlaceID string `json:"placeId,omitempty"`
	// Lat/Lng:固定的展示座標,供前端右上角小地圖點擊卡片時 panTo——
	// 這批景點都是台南真實地點,座標是實際位置(不是隨機假資料),即使
	// 沒有 PlaceID 的站點(此腳本目前每個 add_stop 都有兩者)也能有
	// 座標可定位。有 PlaceID 時,前端查回真實資料的 lat/lng 會覆蓋掉
	// 這裡的值(更準確的資料來源優先),這裡的值只是「查詢完成前」與
	// 「查詢失敗」時的 fallback,理由同 Desc/ThumbBg 等其餘假資料欄位
	// 的既有設計。
	Lat float64 `json:"lat,omitempty"`
	Lng float64 `json:"lng,omitempty"`

	// add_transit——2026-09 起 planSimScript(見該變數的完整說明)不再
	// 送出任何 add_transit 訊息,交通卡改由前端 maybeInsertTransitBefore
	// 呼叫 transit-estimate 端點動態產生,這幾個欄位目前沒有任何寫入端
	// 使用。保留在 struct 裡是維持 planAction 型別本身的通用性(理由見
	// 上方型別說明),不是還有隱藏的呼叫端。
	Icon     string `json:"icon,omitempty"`
	Mode     string `json:"mode,omitempty"`
	Minutes  int    `json:"minutes,omitempty"`
	Distance string `json:"distance,omitempty"`

	// add_note——2026-09:原本這裡是 Color/NoteIcon(視覺樣式直接由後端
	// 決定),使用者明確要求「備註寫在景點的節點上」且分類→視覺樣式的
	// 對照權收斂到前端(AIPlanTimelinePage.tsx 的 NOTE_STYLES,見該常數
	// 的完整說明)後,改成只送語意層級的 Category 字串,不再送視覺樣式
	// 細節。前端 AttractionStepsCtx.addNote 的 anchorId 對應這裡沿用
	// AfterID(見該欄位的完整說明)表達「要把備註寫在哪個既有節點上」。
	// Category/Text:add_note 用 Category+Text,add_message 只用 Text
	// (訊息本身的文字內容,對應前端 planTimeline.ts 'message' 節點的
	// text 欄位)——對話訊息沒有 note 那種語意分類,不需要 Category。
	Category string `json:"category,omitempty"`
	Text     string `json:"text,omitempty"`

	// remove_step:RemovedID 指向先前某個 add_section/add_stop 訊息的
	// ID,前端據此從時間軸移除對應節點——2026-09 起不會再指向
	// add_note(備註不是獨立節點,見 Category 欄位的完整說明,移除一個
	// stop 節點時它身上的備註自動一起消失,不需要另外送一則 remove_step
	// 把備註也摘除)。
	RemovedID string `json:"removedId,omitempty"`

	// AfterID:雙重用途,依 Type 而定——
	//   - add_section/add_stop/add_message:插入位置,有值時前端把這筆
	//     插在該 id 對應節點的後面,而不是固定 append 到時間軸尾端(見
	//     前端 PlanAction.afterId 的完整說明,兩邊欄位語意一致)。
	//     add_message 跟 add_section/add_stop 是同構的插入類訊息(見該
	//     type 上方的完整說明),省略時同樣預設接在時間軸尾端,不需要
	//     指向任何既有節點——這是它跟下面 add_note 用法的關鍵差異:
	//     add_note 的 AfterID 是「要把備註寫在哪個既有節點身上」(這個
	//     節點必須已存在),add_message 的 AfterID 只是「插入位置」
	//     (前面的插入位置節點可以不存在任何依附關係)。
	//   - add_note:要把這則備註寫在哪個既有節點自己身上(對應前端
	//     AttractionStepsCtx.addNote 的 anchorId,見該介面的完整說明)
	//     ——這裡沿用同一個欄位而不是另外新增一個,是因為兩者語意上都是
	//     「指向時間軸上某個既有節點的 id」,不需要為了 add_note 這個
	//     用途另外發明一個欄位名稱。
	AfterID string `json:"afterId,omitempty"`
}

// planSimScript — 固定的模擬腳本,內容對齊 web/src/plan-ai/
// AIPlanTimelinePage.tsx 原本純前端假資料版本的台南安平 Day 1 行程
// (地點名稱/敘事文案/交通/注記皆相同),差別是:
//  1. 每一個 add_stop 都帶 PlaceID(見上方欄位說明),對應
//     store.GetAttraction 既有紀錄(CLI attraction-add 建檔時取得)的
//     place_id——2026-09 使用者明確要求「模擬的景點改成用安平這組資料」
//     「整組都換成目前資料庫有的台南 attraction」,示範「AI 用工具查真實
//     地點資料」這個核心情境不再只有單一站,而是整段行程都走真實資料,
//     不再有任何純文字假資料的站點。原本腳本裡的「阿堂鹹粥」「神農街」
//     資料庫沒有對應紀錄,分別換成「金得春捲」(同樣是在地小吃、資料庫
//     已建檔)、「全美戲院」(同樣適合傍晚散策收尾、資料庫已建檔)。
//  2. 額外插入一筆會被稍後 remove_step 移除的景點(這裡選「祀典大天后
//     宮」,對應資料庫既有的 lmk_7b682941cdb3,這個示範行程沒有真的
//     排入),示範「AI 想了想又拿掉」這個動態增刪情境,不是單純逐步
//     新增到底。
var planSimScript = []planAction{
	{Type: "add_section", Label: "上午"},
	// add_message 示範:LLM 一邊想一邊跟使用者說的話(對齊前端
	// planTimeline.ts 獨立的 'message' 節點型別,見該型別的完整說明)
	// ——使用者明確要求「模擬的第一步先出現文字」「他不是引言,是對話」:
	// 真實 onagent 對話路徑裡,LLM 常常先送一句文字回覆、使用者看完才
	// 決定要不要讓它接著呼叫工具新增景點,這時候還沒有任何 stop 節點
	// 存在。這裡排在 add_stop(赤崁樓)之前,忠實對齊這個「先說話、後
	// 新增景點」的真實節奏,不是掛在某個既有節點身上的附加欄位。
	{Type: "add_message", ID: "msg-chikanlou-intro", Text: "早上先從赤崁樓開始，08:30 剛好開館可以避開排隊人潮，園區不大，安排 1 小時走逛剛剛好。"},
	{
		Type: "add_stop", ID: "stop-chikanlou", Time: "08:30", Duration: "停留 1h", Kind: "景點",
		Name: "赤崁樓", Desc: "荷蘭時期普羅民遮城遺址，紅磚拱廊與燕尾脊並存，是台南地標之一。",
		ThumbBg: "linear-gradient(135deg, #C4956A, #8B3A2F)", ThumbIcon: "🏯",
		Tags:    []string{"門票 $70", "08:30 開館"},
		PlaceID: "ChIJbYl7d2F2bjQRnFdvyMBuZfI",
		Lat:     23.0009, Lng: 120.2024,
	},
	{
		Type: "add_stop", ID: "stop-datianhou", Time: "09:15", Duration: "停留 30 分", Kind: "景點",
		Name: "祀典大天后宮", Desc: "1663年創建，原明寧靖王府邸，全台唯一官建列入祀典的媽祖廟，國定古蹟。",
		ThumbBg: "linear-gradient(135deg, #B85C4A, #8B3A2F)", ThumbIcon: "⛩️",
		Tags:    []string{"免費入場"},
		PlaceID: "ChIJje2QZmF2bjQRR6NbMsm6hTY",
		Lat:     22.9966, Lng: 120.2016,
	},
	// note-reconsider——2026-09 起備註掛在既有節點自己身上(見
	// AttractionStepsCtx.addNote 的完整說明),AfterID 指向這則備註在講
	// 哪一站,不再是插入位置。remove_step 移除 stop-datianhou 時這則備註
	// 跟著一起消失(見 planTimeline.ts NoteInfo 的完整說明:備註是節點的
	// 欄位,不是獨立節點,不需要再額外送一則 remove_step 把它也摘除)。
	{Type: "add_note", ID: "note-reconsider", AfterID: "stop-datianhou", Category: "consideration", Text: "距離赤崁樓稍遠，會壓縮到武廟的時間，考慮拿掉"},
	// 示範刪除:上面剛加的「祀典大天后宮」被拿掉。
	{Type: "remove_step", RemovedID: "stop-datianhou"},
	{
		Type: "add_stop", ID: "stop-wumiao", Time: "09:45", Duration: "停留 45 分", Kind: "景點",
		Name: "祀典武廟", Desc: "全台祀典關帝廟，國定古蹟，紅牆是「出磚入石」砌法代表案例。",
		ThumbBg: "linear-gradient(135deg, #C0604A, #8B3A2F)", ThumbIcon: "⛩️",
		Tags:    []string{"免費入場"},
		PlaceID: "ChIJ_3sZgmF2bjQRJqNT18Vuoa0",
		Lat:     22.9966, Lng: 120.2022,
	},
	// note-1——這則備註是在講祀典武廟,調整到 stop-wumiao 插入「之後」
	// 送出(原本在它之前送出,是舊架構「插入獨立節點、接在目前最後一個
	// 節點之後」的順序慣例,新架構下備註必須指向一個已經存在的節點,故
	// 需要調整順序)。
	{
		Type: "add_note", ID: "note-1", AfterID: "stop-wumiao", Category: "info",
		Text: "週二香客較多，建議 10 點前抵達祀典武廟",
	},
	{Type: "add_section", Label: "中午"},
	{
		Type: "add_stop", ID: "stop-jindechuenjuan", Time: "11:30", Duration: "停留 1h", Kind: "午餐",
		Name: "金得春捲", Desc: "永樂市場周邊70年排隊老店，潤餅現場手工包入皇帝豆等9種配料，國華街金三角之一。",
		ThumbBg: "linear-gradient(135deg, #D9A97D, #C4956A)", ThumbIcon: "🌯",
		Tags:    []string{"約 $150/人"},
		PlaceID: "ChIJCzZbxWZ2bjQR6CUWOMHz1hI",
		Lat:     22.9976, Lng: 120.1990,
	},
	{Type: "add_note", ID: "note-2", AfterID: "stop-jindechuenjuan", Category: "cost", Text: "上午累計預估花費 $310"},
	{Type: "add_section", Label: "下午"},
	{
		Type: "add_stop", ID: "stop-anping-fort", Time: "13:30", Duration: "停留 1.5h", Kind: "景點",
		Name: "安平古堡", Desc: "荷蘭時期熱蘭遮城遺址，是安平地區信仰以外、以歷史地標為核心的主題點。",
		ThumbBg: "linear-gradient(135deg, #7C6F5B, #2B2420)", ThumbIcon: "🏰",
		Tags:    []string{"門票 $70", "瞭望台"},
		PlaceID: "ChIJZ-TjeHN2bjQR8a3Jat0VHps",
		Lat:     23.0015, Lng: 120.1606,
	},
	{Type: "add_note", ID: "note-3", AfterID: "stop-anping-fort", Category: "weather", Text: "下午降雨機率 60%，已把室內行程排在後段"},
	{
		Type: "add_stop", ID: "stop-anping-treehouse", Time: "15:00", Duration: "停留 45 分", Kind: "景點・散策",
		Name: "安平樹屋", Desc: "老榕樹盤根錯節包覆舊倉庫建築，安平歷史軸線的延伸景點。",
		ThumbBg: "linear-gradient(135deg, #5C6B57, #2B2420)", ThumbIcon: "🌳",
		Tags:    []string{"與德記洋行聯票"},
		PlaceID: "ChIJlynOByF3bjQR_IzNSlgH-Ss",
		Lat:     23.0038, Lng: 120.1598,
	},
	{Type: "add_section", Label: "傍晚"},
	{
		Type: "add_stop", ID: "stop-quanmei", Time: "17:30", Duration: "停留 1h", Kind: "景點・散策",
		Name: "全美戲院", Desc: "全台僅存仍採手繪電影看板的二輪戲院，國寶畫師顏振發手繪看板近半世紀。",
		ThumbBg: "linear-gradient(135deg, #8B3A2F, #2B2420)", ThumbIcon: "🎬",
		Tags:    []string{"約 $150/人", "手繪看板"},
		PlaceID: "ChIJ2VORzmN2bjQRBTGamcfvGgg",
		Lat:     22.9952, Lng: 120.2015,
	},
	// note-4——這則備註是在講為什麼選了全美戲院,調整到 stop-quanmei
	// 插入「之後」送出(理由同 note-1 順序調整的完整說明)。
	{Type: "add_note", ID: "note-4", AfterID: "stop-quanmei", Category: "consideration", Text: "原本想排海安路，但今天週一多數店休，改到全美戲院一帶"},
	{Type: "done"},
}
