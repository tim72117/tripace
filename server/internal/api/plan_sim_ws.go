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
//	{"type":"add_stop","id":"stop-1","time":"08:30",...,"placeId":"ChIJ..."}
//	  ——placeId 有值時,前端要用它呼叫 fetchPublicGeoPlaceDetails
//	  (GET /public/geo/place-details?placeId=...)查真正的地點詳情再
//	  顯示,這是「AI 呼叫工具、把 place_id 傳給前端」這個核心概念的
//	  具體落地,不是後端直接把完整資料內嵌進這則訊息裡。
//	{"type":"add_transit","id":"transit-1",...}
//	{"type":"add_note","id":"note-1",...}
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

	// playScript:照原本行為在背景播放固定腳本,不阻塞下面的觸發訊息
	// 讀取迴圈——腳本本身有逐步間隔(見 sendWithThinking 內的延遲),若跟
	// 讀取觸發訊息共用同一個 goroutine,腳本播放中會沒辦法即時處理使用者
	// 點擊測試按鈕送來的請求。每一輪就是「thinking → 延遲 → 實際
	// action」,送完直接進下一輪(下一則 thinking),不再額外疊加第二段
	// 延遲——維持跟改動前同樣的整體節奏(平均每筆實際 action 之間約
	// 700~1200ms),差別只是這段延遲現在夾在 thinking 訊號與實際內容
	// 之間,而不是單純的静默等待。done 訊息不經過 sendWithThinking
	// (前面不送 thinking,見上方文件說明),直接寫入並結束這個
	// goroutine。
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
		}
	}()

	// 阻塞讀取前端傳來的觸發請求,依 planSimTriggerActions 查表組出對應
	// 的 action 訊息並推播——這是「前端按鈕不自己組訊息,而是請後端送出」
	// 這個需求的核心。同時也是這個 handler 唯一偵測「對方主動斷線/
	// context 結束」的地方,取代原本單純為了偵測斷線而存在、不做任何事的
	// 阻塞讀迴圈——腳本播完後這個迴圈仍會繼續跑,讓連線保持開著持續接收
	// 測試按鈕的觸發請求,對齊原本「腳本播完後保持連線開著」的既有行為。
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
	// place_id 去呼叫 GET /public/geo/place-details 取得真正的地點
	// 詳情(名稱/簡介/照片)覆蓋掉這則訊息本身帶的假資料欄位——這是這支
	// 模擬服務存在的核心目的,不是每一步都會帶,沒帶時前端維持純展示
	// 假資料(漸層色塊+emoji 佔位圖、這裡的 Desc 當敘事文字)。
	PlaceID string `json:"placeId,omitempty"`
	// Lat/Lng:固定的展示座標,供前端右上角小地圖點擊卡片時 panTo——
	// 這批景點都是台南真實地點,座標是實際位置(不是隨機假資料),即使
	// 沒有 PlaceID 的站點(此腳本目前每個 add_stop 都有兩者)也能有座標
	// 可定位。有 PlaceID 時,前端查回真實的 GeoPlaceDetails.lat/lng 會
	// 覆蓋掉這裡的值(更準確的資料來源優先),這裡的值只是「查詢完成前」
	// 與「查詢失敗/白名單外」時的 fallback,理由同 Desc/ThumbBg 等其餘
	// 假資料欄位的既有設計。
	Lat float64 `json:"lat,omitempty"`
	Lng float64 `json:"lng,omitempty"`

	// add_transit
	Icon     string `json:"icon,omitempty"`
	Mode     string `json:"mode,omitempty"`
	Minutes  int    `json:"minutes,omitempty"`
	Distance string `json:"distance,omitempty"`

	// add_note
	Color    string `json:"color,omitempty"`
	NoteIcon string `json:"noteIcon,omitempty"`
	Text     string `json:"text,omitempty"`

	// remove_step:RemovedID 指向先前某個 add_stop/add_transit/add_note
	// 訊息的 ID,前端據此從 state 陣列移除對應項目。
	RemovedID string `json:"removedId,omitempty"`

	// AfterID:插入位置——有值時前端會把這筆插在該 id 對應節點的後面,
	// 而不是固定 append 到時間軸尾端(見前端 PlanAction.afterId 的完整
	// 說明,兩邊欄位語意一致)。用於「移除某一站、緊接著在原位置插入
	// 另一站取代」這種情境,例如 planSimTriggerActions 的
	// insert_anping_mazu。
	AfterID string `json:"afterId,omitempty"`
}

// planSimScript — 固定的模擬腳本,內容對齊 web/src/planning-demo/
// AIPlanTimelinePage.tsx 原本純前端假資料版本的台南安平 Day 1 行程
// (地點名稱/敘事文案/交通/注記皆相同),差別是:
//  1. 赤崁樓這一步帶 PlaceID(見上方欄位說明),示範「AI 用工具查真實
//     地點資料」這個核心情境。
//  2. 額外插入一筆會被稍後 remove_step 移除的景點(這裡選「大天后宮」,
//     台南確實存在但這個示範行程沒有真的排入),示範「AI 想了想又拿掉」
//     這個動態增刪情境,不是單純逐步新增到底。
var planSimScript = []planAction{
	{Type: "add_section", Label: "上午"},
	{
		Type: "add_stop", ID: "stop-chikanlou", Time: "08:30", Duration: "停留 1h", Kind: "景點",
		Name: "赤崁樓", Desc: "荷蘭時期普羅民遮城遺址，紅磚拱廊與燕尾脊並存，是台南地標之一。",
		ThumbBg: "linear-gradient(135deg, #C4956A, #8B3A2F)", ThumbIcon: "🏯",
		Tags: []string{"門票 $70", "08:30 開館"},
		// 赤崁樓的 Google Place ID——已加進 publicPlaceDetailsAllowlist
		// (見該常數的完整說明),前端可以合法查詢。
		PlaceID: "ChIJbYl7d2F2bjQRnFdvyMBuZfI",
		Lat:     23.0009, Lng: 120.2024,
	},
	{Type: "add_transit", ID: "transit-1", Icon: "🚶", Mode: "步行", Minutes: 8, Distance: "650m"},
	{
		Type: "add_stop", ID: "stop-datianhou", Time: "09:15", Duration: "停留 30 分", Kind: "景點",
		Name: "大天后宮", Desc: "全台第一座官建媽祖廟，見證明清政權交替下的信仰政策轉變。",
		ThumbBg: "linear-gradient(135deg, #B85C4A, #8B3A2F)", ThumbIcon: "⛩️",
		Tags: []string{"免費入場"},
		Lat:  23.0006, Lng: 120.1998,
	},
	{Type: "add_note", ID: "note-reconsider", Color: "var(--ios-gray)", NoteIcon: "✦", Text: "距離赤崁樓稍遠，會壓縮到武廟的時間，考慮拿掉"},
	// 示範刪除:上面剛加的「大天后宮」被拿掉,連帶把接在它前面的那段
	// 交通(這裡示範腳本沒有另外插入,故只移除景點本身跟那條注記)。
	{Type: "remove_step", RemovedID: "stop-datianhou"},
	{Type: "remove_step", RemovedID: "note-reconsider"},
	{
		Type: "add_note", ID: "note-1", Color: "var(--ios-sand)", NoteIcon: "ⓘ",
		Text: "週二香客較多，建議 10 點前抵達祀典武廟",
	},
	{
		Type: "add_stop", ID: "stop-wumiao", Time: "09:45", Duration: "停留 45 分", Kind: "景點",
		Name: "祀典武廟", Desc: "全台祀典中地位最高的關帝廟，山牆丹壁是台南著名的紅牆意象。",
		ThumbBg: "linear-gradient(135deg, #C0604A, #8B3A2F)", ThumbIcon: "⛩️",
		Tags: []string{"免費入場"},
		Lat:  23.0006, Lng: 120.2024,
	},
	{Type: "add_transit", ID: "transit-2", Icon: "🚶", Mode: "步行", Minutes: 12, Distance: "900m"},
	{Type: "add_section", Label: "中午"},
	{
		Type: "add_stop", ID: "stop-atang", Time: "11:30", Duration: "停留 1h", Kind: "午餐",
		Name: "阿堂鹹粥", Desc: "虱目魚粥與土魠魚羹的在地經典早午餐店，用餐時間常需排隊。",
		ThumbBg: "linear-gradient(135deg, #D9A97D, #C4956A)", ThumbIcon: "🍚",
		Tags: []string{"約 $150/人"},
		Lat:  22.9976, Lng: 120.1975,
	},
	{Type: "add_note", ID: "note-2", Color: "var(--ios-green)", NoteIcon: "💰", Text: "上午累計預估花費 $310"},
	{Type: "add_transit", ID: "transit-3", Icon: "🚗", Mode: "開車", Minutes: 18, Distance: "6.2km"},
	{Type: "add_section", Label: "下午"},
	{
		Type: "add_stop", ID: "stop-anping-fort", Time: "13:30", Duration: "停留 1.5h", Kind: "景點",
		Name: "安平古堡", Desc: "1624 年荷蘭東印度公司築城據點，台江內海潟湖地形提供了天然良港。",
		ThumbBg: "linear-gradient(135deg, #7C6F5B, #2B2420)", ThumbIcon: "🏰",
		Tags: []string{"門票 $70", "瞭望台"},
		Lat:  23.0016, Lng: 120.1616,
	},
	{Type: "add_note", ID: "note-3", Color: "var(--ios-blue)", NoteIcon: "☁︎", Text: "下午降雨機率 60%，已把室內行程排在後段"},
	{Type: "add_transit", ID: "transit-4", Icon: "🚶", Mode: "步行", Minutes: 6, Distance: "450m"},
	{
		Type: "add_stop", ID: "stop-anping-treehouse", Time: "15:00", Duration: "停留 45 分", Kind: "景點",
		Name: "安平樹屋", Desc: "老榕樹盤根錯節包覆廢棄倉庫，港口機能外移後被自然重新接管的見證。",
		ThumbBg: "linear-gradient(135deg, #5C6B57, #2B2420)", ThumbIcon: "🌳",
		Tags: []string{"與德記洋行聯票"},
		Lat:  23.0037, Lng: 120.1626,
	},
	{Type: "add_transit", ID: "transit-5", Icon: "🚌", Mode: "公車", Minutes: 25, Distance: "8.1km"},
	{Type: "add_section", Label: "傍晚"},
	{Type: "add_note", ID: "note-4", Color: "var(--ios-gray)", NoteIcon: "✦", Text: "原本想排海安路，但今天週一多數店休，改到神農街"},
	{
		Type: "add_stop", ID: "stop-shennong", Time: "17:30", Duration: "停留 2h", Kind: "晚餐・散策",
		Name: "神農街", Desc: "老屋改建的文創街區，木造街屋與燈籠交錯，適合晚餐後散步收尾。",
		ThumbBg: "linear-gradient(135deg, #8B3A2F, #2B2420)", ThumbIcon: "🏮",
		Tags: []string{"約 $300/人", "夜間點燈"},
		Lat:  22.9987, Lng: 120.1971,
	},
	{Type: "done"},
}
