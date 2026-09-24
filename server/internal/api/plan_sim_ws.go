package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/geo"
	"gorm.io/gorm"
	"nhooyr.io/websocket"
)

// plan_sim_ws.go — /plan-ai(AIPlanTimelinePage.tsx)專屬的模擬/展示用
// 後端邏輯,涵蓋兩類東西:
//  1. handlePlanSimWS 這條「送出推論信號」的 WebSocket 服務(見該函式
//     的完整說明)——模擬 AI 逐步決定要在行程裡新增什麼的即時感。
//  2. 檔案下半段(見 handlePublicGeoPlaceSearch 起)的免登入公開查詢
//     端點,供 search_attraction/add_attraction 工具與
//     insertAttractionAfter 的背景反查/交通預估使用。
//
// 2026-09:使用者明確要求「模擬的後端路由跟其他正式的分開檔案」「你把
// 推論信號跟路程推估的放在同一個檔案」——這個檔案因此收斂成 /plan-ai
// 這個展示原型專屬的所有後端邏輯的單一入口,跟登入後正式規劃功能
// (handleGeoPlaceDetails 等,見 geo_outline.go)、主題介紹頁公開端點
// (handlePublicGeoPlaceDetails 等,同樣在 geo_outline.go)分開,不容易
// 一眼看出哪些是服務這個展示原型的。
//
// 不屬於這裡的:
//   - handlePublicGeoPlaceDetails/handlePublicGeoAttractions(主題介紹頁
//     用)——服務對象是正式展示頁,不是 /plan-ai,維持在 geo_outline.go。
//   - handleGeoPlaceDetails 等登入後正式規劃功能——維持在 geo_outline.go。
//
// handlePlanSimWS — GET /public/plan-sim/ws:模擬「AI 安排行程」推論過程
// 逐步吐出動作的 WebSocket 服務,供 web/src/planning-demo/AIPlanTimelinePage.tsx
// 展示原型使用。這不是真正的 AI/LLM 推論,是後端照一份寫死的腳本
// (planSimScript,見下方)依序、帶隨機間隔地推播 action 訊息,模擬「AI
// 逐步決定要在行程裡新增一個景點/一段交通/一條注記」的即時感——前端收到
// 每則訊息後直接把它 dispatch 進自己的行程時間軸 state,達成「後端推播
// 動作、前端即時反應畫面」的效果,而非像先前那版純靠前端 setTimeout
// 自己排時序。
//
// 免登入、不掛 internalAuth——這支端點不含任何真實使用者資料,純粹是
// 固定的展示腳本,任何人都能連上去看同一份模擬序列,風險同其餘
// /public/geo/* 端點(見 publicAttractionsCityAllowlist 的完整說明)。
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
	Category string `json:"category,omitempty"`
	Text     string `json:"text,omitempty"`

	// remove_step:RemovedID 指向先前某個 add_section/add_stop 訊息的
	// ID,前端據此從時間軸移除對應節點——2026-09 起不會再指向
	// add_note(備註不是獨立節點,見 Category 欄位的完整說明,移除一個
	// stop 節點時它身上的備註自動一起消失,不需要另外送一則 remove_step
	// 把備註也摘除)。
	RemovedID string `json:"removedId,omitempty"`

	// AfterID:雙重用途,依 Type 而定——
	//   - add_section/add_stop:插入位置,有值時前端把這筆插在該 id 對應
	//     節點的後面,而不是固定 append 到時間軸尾端(見前端
	//     PlanAction.afterId 的完整說明,兩邊欄位語意一致)。用於「移除
	//     某一站、緊接著在原位置插入另一站取代」這種情境,例如
	//     planSimTriggerActions 的 insert_anping_mazu。
	//   - add_note:要把這則備註寫在哪個既有節點自己身上(對應前端
	//     AttractionStepsCtx.addNote 的 anchorId,見該介面的完整說明)
	//     ——這裡沿用同一個欄位而不是另外新增一個,是因為兩者語意上都是
	//     「指向時間軸上某個既有節點的 id」,不需要為了 add_note 這個
	//     用途另外發明一個欄位名稱。
	AfterID string `json:"afterId,omitempty"`
}

// planSimScript — 固定的模擬腳本,內容對齊 web/src/planning-demo/
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
		Type: "add_stop", ID: "stop-anping-treehouse", Time: "15:00", Duration: "停留 45 分", Kind: "景點",
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

// publicPlaceSearchEndpoint 是 Server.publicPlaceSearchLimiter 用的
// RateLimiter key(見該欄位在 api.go Server struct 上的完整說明)——這裡
// 不沿用 geo 套件內部 "places.searchText" 那個字串,是因為這個 key 保護
// 的是「這支公開端點本身」的呼叫頻率,不是 Google API 那個 endpoint 分類
// 概念,兩者刻意分開,即使實務上一次成功呼叫最終仍會觸發一次
// "places.searchText" 的 Google API 呼叫。
const publicPlaceSearchEndpoint = "public.placeSearch"

// GET /public/geo/place-search?query={文字}
//
// 免登入版的通用地名文字查詢——供 /plan-ai(AIPlanTimelinePage.tsx 的
// search_attraction 工具,見 attractionTools.ts 的完整說明)這類公開
// 展示頁查詢任意地名取得座標,不限於資料庫裡已人工建檔的固定景點池。
// 跟 handlePublicGeoAttractions(查整個城市清單)是互補而非取代的關係:
// 那支端點只能查白名單城市裡已建檔的固定資料,這支端點能查任意地名,
// 但只回傳最相關的第一筆結果(不像 handleGeoGeocode 那樣可能回傳多筆
// 候選讓使用者手動挑選)——「查地名取得座標、再依座標算鄰近」這個流程
// 只需要一個確定的錨點座標,不需要候選列表 UI。
//
// 刻意不重用 handleGeoGeocode(那支端點的 bias/restrict 兩階段判斷邏輯
// 是為了登入後正式規劃地圖的搜尋框設計的,行為遠比這裡需要的複雜),
// 改直接呼叫 geo.Client.Search 最簡單的單次查詢模式,固定 MaxResults:1
// (只要最相關的一筆,不需要 Search 其餘 opts 如 LocationBias/
// LocationRestriction)。
//
// 沒有掛 internalAuth,任何人都能呼叫——這支端點最終會觸發真實計費的
// Google Text Search API 呼叫,故套用 publicPlaceSearchLimiter 做全域
// 拒絕型限流(見該欄位的完整說明),把關順序是「先檢查限流,通過才真的
// 呼叫 Google API」,被拒絕的請求完全不會產生任何外部 API 呼叫或費用。
func (s *Server) handlePublicGeoPlaceSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if query == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 query 查詢參數")
		return
	}

	if !s.publicPlaceSearchLimiter.Allow(publicPlaceSearchEndpoint) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newGeoGeocodeClient(apiKey)
	client.SetCache(s.photoCache)

	// 逾時對齊 handleGeoGeocode 的單階段查詢成本(這裡只有一次 Search
	// 呼叫,不像該 handler 的 bias 模式可能兩階段查詢,5 秒已足夠寬裕)。
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handlePublicGeoPlaceSearch")
	ctx = geo.WithPath(ctx, r.URL.Path)

	// geo.Client.Search 查無結果時回傳 geo.ErrNotFound(不是空陣列+nil
	// error,見該錯誤的定義處)——這是正常的「查無此地」情境,不是查詢
	// 失敗,回應 200 + found:false 讓前端能區分「查詢本身出錯」(502)
	// 與「查詢成功但沒有這個地方」(200,found:false)兩種不同語意,呼叫端
	// (attractionTools.ts 的 search_attraction)才能據此決定接下來的行為
	// (例如查無結果時提示使用者換個關鍵字,而非當成系統錯誤處理)。
	// Region 固定 "tw"——這支端點目前唯一的呼叫端(AIPlanTimelinePage.tsx
	// 的 search_attraction 工具)只服務台南行程情境,不帶任何地理偏向時
	// 純文字查詢完全依賴 Google 對伺服器來源的地理判斷,實測發現查「安平
	// 古堡」這類全台可能有同名或近似字號店家的查詢會命中完全不相關地區
	// 的結果(例如台北的店家)——加上 regionCode 讓 Google 明確偏向台灣
	// 地區的結果,是最低成本的修正,不需要額外引入 LocationBias 座標
	// 偏向(那需要一個參考座標,這支端點的呼叫情境目前沒有「使用者已經
	// 看著哪張地圖」這種既有上下文可以取用,見 handleGeoGeocode 的
	// LocationBias 用法對比)。
	places, err := client.Search(ctx, query, &geo.SearchOptions{MaxResults: 1, Region: "tw"})
	if errors.Is(err, geo.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadGateway, "search_failed", err.Error())
		return
	}
	if len(places) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	p := places[0]
	writeJSON(w, http.StatusOK, map[string]any{
		"found":   true,
		"name":    p.Name,
		"address": p.Address,
		"lat":     p.Lat,
		"lng":     p.Lng,
		"placeId": p.PlaceID,
	})
}

// nearbyAttractionSearchEndpoint 是 Server.nearbyAttractionSearchLimiter
// 用的 RateLimiter key——這支端點會在資料庫候選不足時觸發 Google Nearby
// Search(計費呼叫),理由與獨立限流的完整說明見 api.go Server struct 上
// 對應欄位的註解,對稱 publicPlaceSearchEndpoint 的既有模式。
const nearbyAttractionSearchEndpoint = "public.nearbyAttractionSearch"

// minNearbyAttractionResults 是「資料庫候選數量少於這個門檻時,才觸發
// Google Nearby Search 補點」的判斷基準——使用者明確要求「如果搜尋的
// attraction 少於 10 個,則用 google search nearby 補上不重複的點」。
// 資料庫候選已經達到或超過這個數量時,完全不打 Google API,維持零成本
// (理由同 handleGeoAttractionsByCity 對零成本路徑的既有堅持)。
const minNearbyAttractionResults = 10

// GET /public/geo/attraction-search?lat={緯度}&lng={經度}
//
// 免登入版的鄰近景點候選查詢——供 /plan-ai 的 search_attraction 工具
// (見 attractionTools.ts 的完整說明)取得「這個座標附近有哪些可以推薦
// 給使用者的景點」。查詢策略分兩層:
//
//  1. 優先查 store.ListAttractionsNearby——人工建檔的正式資料,免費、
//     資料品質有人工把關(名稱/簡介/分類)。
//  2. 若第一層查到的候選數量少於 minNearbyAttractionResults(10),
//     額外呼叫 geo.Client.SearchNearby(Google Nearby Search)補上
//     資料庫沒有的地點,直到湊滿(或 Google 端本身也沒那麼多結果)。
//     這裡刻意不管資料庫候選是 0 筆還是 9 筆都補到同一個門檻,而非
//     「資料庫完全沒有才查 Google」——使用者明確要求的判斷基準就是
//     「少於 10 個」這個數量門檻本身,不是「有沒有」這個二元判斷。
//
// 去重:比對 place_id——資料庫候選裡已經出現過的 place_id,Google
// Nearby Search 若再查到同一筆(常見,尤其資料庫收錄的多半也是該地區
// 知名地標),不重複加入。資料庫候選裡沒有 place_id 的紀錄(人工建檔
// 時可能沒填)不參與去重比對,但仍正常回傳(只是無法被拿來排除 Google
// 端的重複結果)。
//
// Google 補上的候選一律用同一種回應形狀(attractionResponse)回傳,
// 不含 ID(這批候選沒有資料庫紀錄,理由見下方完整說明)——使用者明確
// 要求「LLM 選擇的時候用 placeId」:不管候選來自資料庫還是 Google,
// 前端/LLM 只需要認得同一個 placeId 欄位當識別碼,不需要知道兩種來源
// 的差異,也不需要為 Google 補的候選另外發明一種臨時 id 機制——這是
// 回顧「用 id 讓 LLM 傳、不用完整資料」這個既有設計的核心精神後確認的
// 方向(見 attractionTools.ts 開頭「2026-09 第三次重構」的完整說明:
// id 應該是給後端統一查詢用的引用,不該讓前端/LLM 自己解析或另外維護
// 一套對應關係)。之後 add_attraction 收到這個 placeId,呼叫
// GET /public/geo/place-details-any 查詢時,該端點內部本來就會先查一次
// store.GetAttractionByPlaceID(見 handlePublicGeoPlaceDetailsAny 的
// 完整說明)——查得到就優先用資料庫資料,查不到才 fallback 查 Google,
// 不需要這裡另外記住「這個 placeId 是從 Google 查來的」這件事。
//
// 沒有掛 internalAuth,任何人都能呼叫——這支端點在資料庫候選不足時會
// 觸發真實計費的 Google Nearby Search API 呼叫,故套用獨立的
// nearbyAttractionSearchLimiter 做全域拒絕型限流(見該欄位的完整
// 說明),把關順序是「先檢查限流,通過才真的呼叫 Google API」。
func (s *Server) handlePublicGeoAttractionSearch(w http.ResponseWriter, r *http.Request) {
	lat, latErr := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, lngErr := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if latErr != nil || lngErr != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少或不合法的 lat/lng 查詢參數")
		return
	}

	landmarks, err := s.store.ListAttractionsNearby(lat, lng, 3000)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	attractions := make([]attractionResponse, 0, len(landmarks))
	knownPlaceIDs := make(map[string]bool, len(landmarks))
	for _, landmark := range landmarks {
		ar := attractionResponse{
			ID:      landmark.ID,
			Name:    landmark.Name,
			Lat:     landmark.Lat,
			Lng:     landmark.Lng,
			IsTheme: landmark.IsTheme,
		}
		if landmark.Summary != nil {
			ar.Summary = *landmark.Summary
		}
		if landmark.PlaceID != nil {
			ar.PlaceID = *landmark.PlaceID
			knownPlaceIDs[*landmark.PlaceID] = true
		}
		if landmark.Category != nil {
			ar.Category = *landmark.Category
		}
		attractions = append(attractions, ar)
	}

	if len(attractions) < minNearbyAttractionResults {
		if !s.nearbyAttractionSearchLimiter.Allow(nearbyAttractionSearchEndpoint) {
			// 限流拒絕不當作錯誤回應——維持已經查到的資料庫候選,只是
			// 這次沒能用 Google 補滿,理由同 handleGeoPlaceDetails 對
			// apigateway.ErrRateLimited 的既有降級慣例:呼叫端拿到的仍是
			// 格式正常、可用的候選清單,只是筆數可能不到 10 筆。
			writeJSON(w, http.StatusOK, map[string]any{"attractions": attractions})
			return
		}

		apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
		client := s.newGeoGeocodeClient(apiKey)
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		ctx = geo.WithCaller(ctx, "handlePublicGeoAttractionSearch")
		ctx = geo.WithPath(ctx, r.URL.Path)

		nearby, nErr := client.SearchNearby(ctx, lat, lng, &geo.NearbyOptions{
			RadiusMeters: 3000,
			MaxResults:   minNearbyAttractionResults,
		})
		cancel()
		// 查詢失敗不影響已經查到的資料庫候選——這是加值補強,不是這支
		// 端點的核心價值,失敗就維持資料庫候選的既有結果回傳,理由同
		// search_attraction 工具本身對鄰近候選查詢失敗的既有降級慣例。
		if nErr == nil {
			for _, p := range nearby {
				if len(attractions) >= minNearbyAttractionResults {
					break
				}
				if p.PlaceID == "" || knownPlaceIDs[p.PlaceID] {
					continue
				}
				knownPlaceIDs[p.PlaceID] = true
				attractions = append(attractions, attractionResponse{
					Name:    p.Name,
					Lat:     p.Lat,
					Lng:     p.Lng,
					PlaceID: p.PlaceID,
				})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"attractions": attractions})
}

// GET /public/geo/attraction/{id}
//
// 免登入版、用資料庫 id 查單筆已建檔景點(store.GetAttraction)——供
// /plan-ai 的 search_attraction/add_attraction 工具使用(見
// attractionTools.ts 的完整說明):2026-09 使用者明確要求
// 「search_attraction 不用完整資訊,LLM 只送 attraction id 就好,前端會
// 用 attraction id 走點選附近景點那樣的流程」,對齊散策羅盤「點選附近
// 景點」(useThemeAttractionSelection.ts 的 fetchPoiContent)的兩段式
// 查詢:先用 attraction 本身資料(這支端點回傳的 name/summary)當底,
// 呼叫端(AIPlanTimelinePage.tsx 的 insertAttractionAfter)再視這筆資料
// 是否帶 placeId 決定要不要另外呼叫 GET /public/geo/place-details-any
// 查 Google 補強——不是這支端點自己做這個補強,職責分開:這支端點只
// 單純查表,不含任何外部 API 呼叫,不受任何限流保護,因為查表不需要。
//
// photoUrl 是例外:雖然這支端點整體是「單純查表」,但這裡查的是
// photo_assets(而非 attractions.PhotoURL),理由見下方 photoUrl 組裝處
// 的完整說明——使用者明確要求前端不該再取用 attraction 人工建檔時可能
// 帶入的 Pexels 示意圖網址。
//
// id 不存在時回傳 404(不是 200+found:false)——跟 place-details-any 的
// found:false 語意不同:那支端點查的是「這個 placeId 在 Google 那邊存不
// 存在」,查無此地是正常的外部世界狀態;這支端點查的是「呼叫端傳來的 id
// 有沒有對應到我們自己資料庫裡的一筆紀錄」,查無紀錄代表呼叫端傳了一個
// 過期或錯誤的 id,是呼叫端該處理的錯誤情境,用標準 HTTP 404 語意更清楚。
func (s *Server) handlePublicGeoAttractionByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 id")
		return
	}

	a, err := s.store.GetAttraction(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "查無這個景點")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", "查詢景點資料失敗")
		return
	}

	resp := map[string]any{
		"id":   a.ID,
		"name": a.Name,
		"lat":  a.Lat,
		"lng":  a.Lng,
	}
	if a.Summary != nil {
		resp["summary"] = *a.Summary
	}
	// 2026-09:photoUrl 改成只查 photo_assets(見
	// store.GetFreshPhotoAssetURL/photoAssetRow 的完整說明,理由同
	// handlePublicGeoPlaceDetailsAny 的同一次修正)——不再回傳
	// a.PhotoURL,那個欄位可能只是建檔當下沒指定 -photo-url 時自動補的
	// Pexels 示意圖(見 model.Attraction.PhotoURL 的完整說明),使用者
	// 明確要求前端不該再取用這種示意圖網址。a.PlaceID 有值時才查得到
	// (photo_assets 用 place_id 當識別鍵),沒有 place_id 的 attraction
	// (例如未曾對應到 Google 地點的人工建檔資料)一律不帶 photoUrl。
	if a.PlaceID != nil {
		if gcsURL, pOk, pErr := s.store.GetFreshPhotoAssetURL(*a.PlaceID); pErr == nil && pOk {
			resp["photoUrl"] = gcsURL
		}
	}
	if a.PlaceID != nil {
		resp["placeId"] = *a.PlaceID
	}
	writeJSON(w, http.StatusOK, resp)
}

// transitWalkMetersPerMinute/transitDriveMetersPerMinute/
// transitTransitMetersPerMinute 是模擬預估用的粗略速度換算表,單位公尺/
// 分鐘——2026-09 使用者明確要求「交通預估時間不要讓 AI 推論產生,而是
// 建立兩個點時,前端自己將兩點送到後端,由後端預估時間,先建立模擬
// 預估時間的後端,用假資料」,這幾個常數就是那個「假資料」的具體來源:
// 步行速度比照前端既有的 geoDistance.ts walkMinutesEstimate(日本不動產
// 業界慣例「1 分鐘 = 80 公尺」),開車/大眾運輸是市區平均車速的粗略
// 估計,不是任何真實路網 API 的結果。之後要接上真實的 Google Directions/
// Routes API 時,只需要替換 estimateTransitMinutes 內部的計算方式,不
// 影響這支端點對外的請求/回應形狀。
const (
	transitWalkMetersPerMinute    = 80.0
	transitDriveMetersPerMinute   = 400.0 // 約時速 24km,市區含號誌等候的保守估計
	transitTransitMetersPerMinute = 300.0 // 約時速 18km,含候車/轉乘時間的保守估計
)

// transitEarthRadiusMeters 與前端 geoDistance.ts 的 EARTH_RADIUS_METERS
// 取同一個值,確保兩邊算出來的直線距離一致,不會因為地球半徑常數不同而
// 產生無意義的微小落差。
const transitEarthRadiusMeters = 6371000.0

// haversineMeters 是 geoDistance.ts haversineMeters 的 Go 版本,算法與
// 常數完全對齊(見該檔案的完整說明)——兩點間球面距離,單位公尺。
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	rLat1 := toRad(lat1)
	rLat2 := toRad(lat2)
	sinDLat := math.Sin(dLat / 2)
	sinDLng := math.Sin(dLng / 2)
	h := sinDLat*sinDLat + math.Cos(rLat1)*math.Cos(rLat2)*sinDLng*sinDLng
	return 2 * transitEarthRadiusMeters * math.Asin(math.Sqrt(h))
}

// estimateTransitMode 依直線距離挑一個看起來合理的預設交通方式,供呼叫端
// 沒有明確指定 mode 查詢參數時使用——不是精確判斷,只是讓模擬資料的
// mode 不會太離譜(例如兩點相距 5 公尺卻顯示「開車」)。對應的 icon 交給
// iconForTransitMode 依這裡選出的 mode 統一決定,不在這裡重複維護一份
// icon 對照表。
func estimateTransitMode(meters float64) (mode string) {
	switch {
	case meters <= 1200:
		return "步行"
	case meters <= 5000:
		return "公車"
	default:
		return "開車"
	}
}

// metersPerMinuteFor 依交通方式回傳對應的模擬速度換算——未知/空字串的
// mode 一律當步行處理(最保守的估計,不會低估交通時間)。
func metersPerMinuteFor(mode string) float64 {
	switch mode {
	case "開車":
		return transitDriveMetersPerMinute
	case "公車", "捷運", "大眾運輸":
		return transitTransitMetersPerMinute
	default:
		return transitWalkMetersPerMinute
	}
}

// iconForTransitMode 回傳交通方式對應的既有 emoji 圖示(對齊
// plan_sim_ws.go 固定腳本用過的同一組圖示)——跟 estimateTransitMode
// 挑選 mode 用的是同一份對照表,只是這裡反過來:呼叫端已經指定 mode 時,
// icon 要跟著這個 mode 走,不能用「依距離猜的 mode」去配 icon,否則會
// 出現「呼叫端指定開車、卻顯示步行 icon」這種不一致。
func iconForTransitMode(mode string) string {
	switch mode {
	case "開車":
		return "🚗"
	case "公車":
		return "🚌"
	case "捷運":
		return "🚇"
	case "大眾運輸":
		return "🚌"
	default:
		return "🚶"
	}
}

// transitEstimateResponse 是 GET /public/geo/transit-estimate 的回應
// 形狀——對齊前端 PlanNodeData 的 transit 節點既有欄位(icon/mode/
// minutes/distance,見 planTimeline.ts 的完整說明),呼叫端可以直接把
// 這支端點的回應塞進 transit 節點的資料,不需要額外轉換欄位名稱。
type transitEstimateResponse struct {
	Mode     string `json:"mode"`
	Icon     string `json:"icon"`
	Minutes  int    `json:"minutes"`
	Distance string `json:"distance"`
}

// formatTransitDistance 把公尺數轉成跟前端既有模擬腳本(plan_sim_ws.go)
// 一致的顯示格式——小於 1 公里顯示整數公尺(如「650m」),否則顯示到小數
// 點後一位公里數(如「6.2km」)。
func formatTransitDistance(meters float64) string {
	if meters < 1000 {
		return strconv.Itoa(int(math.Round(meters))) + "m"
	}
	return strconv.FormatFloat(meters/1000, 'f', 1, 64) + "km"
}

// transitEstimateMinDelay/transitEstimateMaxDelay:2026-09 使用者明確
// 要求「路程推估的後端做一點延遲」——目前這支端點是純本地計算(見下方
// 完整說明),回應幾乎是瞬間完成,兩張卡片(新站點本身、緊接著補上的
// 交通卡)在畫面上幾乎同時出現,體感上不像真的在查詢外部資料。加上
// 隨機延遲,模擬真實 API 呼叫的網路往返時間,讓交通卡片的出現節奏更
// 接近之後真的接上 Google Directions/Routes API 時的體驗。原本是
// 300~600ms,使用者後續要求「延遲時間再加長」,改成 800~1500ms——
// 讓查詢正在發生這件事更明顯可感,但不至於讓使用者覺得卡住。
const (
	transitEstimateMinDelay = 800 * time.Millisecond
	transitEstimateMaxDelay = 1500 * time.Millisecond
)

// GET /public/geo/transit-estimate?fromLat=&fromLng=&toLat=&toLng=&mode=
//
// 免登入版、兩點間交通方式/時間/距離的模擬預估——2026-09 使用者明確
// 要求「交通預估時間不要讓 AI 推論產生,而是建立兩個點時,前端自己將
// 兩點送到後端,由後端預估時間,先建立模擬預估時間的後端,用假資料,
// 移除後端 llm 產生的預估時間信號」:LLM/推論路徑完全不會、也不應該
// 知道這支端點的存在或自己算出交通時間,交通卡片的時間資訊 100% 由
// 前端在插入第二個站點後主動呼叫這裡取得(見 AIPlanTimelinePage.tsx
// insertAttractionAfter 的完整說明——插入 stop 節點且前面已有另一個
// stop 節點時,前端自動呼叫這支端點補上一張 transit 卡片)。
//
// mode 為選填查詢參數——未提供或提供無法辨識的值時,依 estimateTransitMode
// 依直線距離自動挑一個看起來合理的預設值,不會回錯誤(呼叫端不需要
// 保證一定要送對交通方式才能拿到結果)。
//
// 核心計算是純本地(haversine 直線距離 + 固定速度換算表,見上方幾個
// 常數的完整說明),不含任何外部 API 呼叫,故不需要任何限流保護——這是
// 刻意的過渡態:先把「前端建立站點後自動查交通時間」這條資料流打通、
// 驗證行為正確,之後要接上真實的路網 API(Google Directions/Routes 等)
// 時,只需要替換這支函式內部的計算方式,呼叫端的請求/回應形狀不需要
// 跟著改動。故意加的 transitEstimateMinDelay~transitEstimateMaxDelay
// 隨機延遲(見上方常數的完整說明)只影響回應節奏,不影響計算結果本身。
func (s *Server) handlePublicGeoTransitEstimate(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	fromLat, err := strconv.ParseFloat(q.Get("fromLat"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "fromLat 查詢參數缺失或格式錯誤")
		return
	}
	fromLng, err := strconv.ParseFloat(q.Get("fromLng"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "fromLng 查詢參數缺失或格式錯誤")
		return
	}
	toLat, err := strconv.ParseFloat(q.Get("toLat"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "toLat 查詢參數缺失或格式錯誤")
		return
	}
	toLng, err := strconv.ParseFloat(q.Get("toLng"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "toLng 查詢參數缺失或格式錯誤")
		return
	}

	// 延遲放在參數驗證通過之後——無效請求應該立即回錯誤,不需要陪著
	// 使用者等一段沒有意義的延遲。用 select 而非單純 time.Sleep,讓
	// 使用者提早關閉頁面/取消請求時(r.Context() 被取消)能立刻中止,
	// 不會讓這個 goroutine 白白占著資源等完整個延遲時間。
	delay := transitEstimateMinDelay + time.Duration(rand.Int63n(int64(transitEstimateMaxDelay-transitEstimateMinDelay)))
	select {
	case <-time.After(delay):
	case <-r.Context().Done():
		return
	}

	meters := haversineMeters(fromLat, fromLng, toLat, toLng)
	mode := q.Get("mode")
	if mode == "" {
		mode = estimateTransitMode(meters)
	}
	icon := iconForTransitMode(mode)
	minutes := int(math.Round(meters / metersPerMinuteFor(mode)))
	if minutes < 1 {
		minutes = 1
	}

	writeJSON(w, http.StatusOK, transitEstimateResponse{
		Mode:     mode,
		Icon:     icon,
		Minutes:  minutes,
		Distance: formatTransitDistance(meters),
	})
}

// GET /public/geo/place-details-any?placeId={Google Place ID}
//
// 免登入版的地點詳情查詢——不受 publicPlaceDetailsAllowlist 限制(見該
// 白名單的完整說明:那份清單是為固定展示頁(散策羅盤等)已知的一批
// placeID 設計的),供 /plan-ai(AIPlanTimelinePage.tsx 的 add_attraction
// 工具,見 attractionTools.ts 的完整說明)查詢任意 placeID 的名稱/地址/
// 座標/簡介——因為 search_attraction 現在可以查任意地名(見
// handlePublicGeoPlaceSearch),對應的 add_attraction 自然也需要能查
// 任意 placeID,不能被限制在一份固定清單內。
//
// 使用者明確要求「add_attraction 不用送太多資訊,placeId 跟時間就可以,
// 其他資訊由前端再做查詢」——這支端點就是那個「前端再做查詢」的後端
// 支撐:LLM 只需要記住 search_attraction 回傳過的 placeId,不需要把
// name/lat/lng/summary 這些欄位原封不動複製貼回 add_attraction 呼叫,
// 避免座標抄錯或摘要被截斷這類資料重複導致的錯誤(見這次修正前的真實
// log:同一批資料在兩次工具呼叫之間被完整複製一次)。
//
// 2026-09:優先查 attractions 表(見 store.GetAttractionByPlaceID 的完整
// 說明)——已經人工建檔過的地點(place_id 命中,例如赤崁樓這類固定示範
// 點)直接回傳既有的 Name/Summary/PhotoURL,完全不打 Google,不消耗
// Google Places 配額、也不受 defaultRateLimiter 的全域限流影響。查無
// 建檔紀錄時才 fallback 到真的呼叫 client.GetPlaceDetails(對應既有的
// "places.get" Google API endpoint)——這是 search_attraction 可以查
// 任意地名的必然結果,不可能所有使用者臨時提到的地點都事先建檔,這條
// fallback 路徑因此自然受惠於既有的 defaultRateLimiter(見
// geo.RateLimitConfig 的完整說明,cmd/server/main.go 預設 10 秒視窗內
// 最多 1 次),不需要像 publicPlaceSearchLimiter 那樣另外建立一個獨立
// RateLimiter 實例——這裡刻意跟正式登入使用者點地圖 POI
// (handleGeoPlaceDetails)共用同一份全域限流額度,是經過評估的簡化
// 取捨:/plan-ai 目前只是展示頁、流量規模小,共用額度的實務影響有限,
// 不需要為了完全隔離兩者的呼叫來源而增加一個新的限流維度,日後若流量
// 真的變大導致互相排擠,再評估是否要比照 publicPlaceSearchLimiter
// 獨立出一份。
//
// 兩條路徑回應形狀刻意對齊(found/name/address/lat/lng/summary/
// photoUrl)——attractions 表命中時額外帶上 photoUrl(建檔時存的真實
// 照片,見 model.Attraction.PhotoURL 的完整說明)。
//
// 2026-09:Google fallback 路徑額外讀 google_place_photos 表(見
// store.ListGooglePlacePhotos 的完整說明)補上 photoUrl——這張表是
// handleGeoPlaceDetails 一般模式(登入後正式查詢路徑)漸進補圖機制的
// 既有累積結果,這裡純粹「讀」,不觸發任何下載或寫入,也不呼叫
// IncrementPlaceClickCount/decidePlacePhotoAction 這套依點擊次數決定
// 要不要多抓照片的決策——不重用 handleGeoPlaceDetails 一般模式本身
// (那支函式為登入後完整規劃體驗設計,牽動點擊計數/多張照片累積等
// 複雜度,這裡的卡片只需要一張圖),只借用它已經存在的快取表當唯讀
// 資料源:剛好有其他呼叫端查過這個 placeId、留下快取,就撿現成的用;
// 完全沒有快取(從來沒人正式查過這個地點)時,回應就不含 photoUrl,
// 前端 resolvePlaceForStep 維持純色縮圖佔位,不會為了補這張圖另外
// 觸發一次即時 Google Photo Media 呼叫。
func (s *Server) handlePublicGeoPlaceDetailsAny(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if placeID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 placeId 查詢參數")
		return
	}

	if a, err := s.store.GetAttractionByPlaceID(placeID); err == nil {
		resp := map[string]any{
			"found":   true,
			"name":    a.Name,
			"address": a.CityName,
			"lat":     a.Lat,
			"lng":     a.Lng,
			// attractionId:2026-09 使用者明確要求「place-details-any
			// 查詢如果有 attraction 時要一併附上 attraction」——命中
			// 資料庫 attraction 記錄時額外帶上它的資料庫 id,讓呼叫端
			// 知道這個 placeId 對應到哪一筆已建檔景點(例如之後需要
			// 額外顯示分類/主題點狀態等 attraction 專屬資訊時,不需要
			// 再另外用 placeId 反查一次)。Google fallback 路徑(下方)
			// 沒有對應的資料庫紀錄,不帶這個欄位。
			"attractionId": a.ID,
		}
		if a.Summary != nil {
			resp["summary"] = *a.Summary
		}
		// 2026-09:改成只查 photo_assets(見 store.GetFreshPhotoAssetURL/
		// photoAssetRow 的完整說明)——這是目前唯一的正式照片來源,存的是
		// 已落地到 GCS 的真實 Google 照片。使用者明確要求「不用回退」:
		// 查無仍在有效期內的紀錄就不帶 photoUrl,不再退回
		// google_place_photos(base64 存 DB,將隨遷移完成逐步清空)或
		// attraction.PhotoURL(CLI 建檔時可能只是 Pexels 示意圖)——這兩條
		// 舊路徑是過渡期的權宜,終局狀態是資料庫完全不留存圖片內容,只有
		// GCS 物件 + 這裡的參照 URL,不該讓程式邏輯繼續依賴它們。
		if gcsURL, pOk, pErr := s.store.GetFreshPhotoAssetURL(placeID); pErr == nil && pOk {
			resp["photoUrl"] = gcsURL
		}
		writeJSON(w, http.StatusOK, resp)
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		writeErr(w, http.StatusInternalServerError, "internal_error", "查詢景點資料失敗")
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newGeoGeocodeClient(apiKey)
	client.SetCache(s.photoCache)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handlePublicGeoPlaceDetailsAny")
	ctx = geo.WithPath(ctx, r.URL.Path)

	details, err := client.GetPlaceDetails(ctx, placeID)
	if errors.Is(err, geo.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}
	if errors.Is(err, apigateway.ErrRateLimited) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadGateway, "place_details_failed", err.Error())
		return
	}

	resp := map[string]any{
		"found":   true,
		"name":    details.Name,
		"address": details.Address,
		"lat":     details.Lat,
		"lng":     details.Lng,
		"summary": details.Summary,
	}
	// 2026-09 使用者明確要求「在任何地方不要再使用 google_place_photos/
	// place_pexels_photos 圖像,回退也不要」——理由與寫法對稱上方
	// attraction 命中路徑同一處已經改用 photo_assets 的修正(見該處的
	// 完整說明):原本這裡直接讀 google_place_photos 的第一筆當 photoUrl,
	// 現在改成只信任 photo_assets(GetFreshPhotoAssetURL),查無仍在有效
	// 期內的紀錄就不帶 photoUrl,不再退回這張舊表。
	if gcsURL, pOk, pErr := s.store.GetFreshPhotoAssetURL(placeID); pErr == nil && pOk {
		resp["photoUrl"] = gcsURL
	}
	writeJSON(w, http.StatusOK, resp)
}
