// Command agentbench 的 mock 工具:完整複製 server/internal/wanttools 底下
// 各工具「給 LLM 看」的 Declaration(Name/Description/Parameters 一字不改),
// 但 Call 一律是空實作——不寫資料庫、不打外部 API、不碰任何 tripace 業務邏輯,
// 只回傳一個「已收到」的成功結果讓對話能自然接續下去。
//
// 為什麼 mock 化(而非直接 import server/internal/wanttools 複用):
// wanttools 裡的 entry_add/entry_query/entry_update/entry_delete 依賴
// entryStore(BindStore 注入的真實 DB 連線),task_plan 依賴 per-channel 的
// 記憶體任務清單,geocode/recommend_nearby 會打真正的 Google Places API——
// 這些全是 agentbench 明確要避免牽扯進來的「tripace 正式業務邏輯」。
// agentbench 的目的是測試「LLM 決策邏輯本身」(有沒有呼叫對工具、參數對不對),
// 不是測試工具執行的業務正確性,所以每個工具的 Call 都只捕捉「被呼叫了、
// 參數是什麼」(由 orchestrator 的 agent.inference 事件流已經提供,見
// capture.go),不需要真的執行任何副作用。
//
// 這裡刻意不 import github.com/tim72117/tripace/internal/wanttools:
// 一來避免 types.RegisterTool 對同一個 Name(如 "entry_add")重複註冊到
// 同一個全域 types.GlobalRegistry 造成 Factories 互相覆蓋的疑慮,
// 二來讓 agentbench 完全獨立於 wanttools 目前的實作細節(DB/API 相依),
// 之後 wanttools 的 Declaration 若調整,兩邊也不會意外互相牽連。
package main

import (
	"fmt"

	"github.com/tim72117/want/types"
)

// mockToolNames 是本檔註冊的所有工具名稱,供 session.go 驗證使用者在
// POST /sessions 的 tools 欄位裡指定的名稱是否存在(避免打字錯誤的工具名
// 悄悄被忽略、卻讓使用者誤以為已經開放給 LLM)。
var mockToolNames = []string{
	"entry_add",
	"entry_query",
	"entry_update",
	"entry_delete",
	"entry_present",
	"geocode",
	"recommend_nearby",
	"ask_user",
	"task_plan",
}

// mockTool 是所有 mock 工具共用的 Call 邏輯:什麼副作用都不做,
// 只回一句話讓 LLM 知道「工具已執行成功」,可以繼續進行下一步推論。
// summary 由各工具自訂,方便從對話紀錄理解「這次呼叫大概做了什麼」。
type mockTool struct {
	types.BaseToolConfig
	summary func(args types.ToolArguments) string
}

func (t *mockTool) ValidateInput(_ types.ToolArguments, _ types.ToolContext) error { return nil }

func (t *mockTool) Call(args types.ToolArguments, ctx types.ToolContext) ([]types.ResultContentBlock, error) {
	msg := t.summary(args)
	ctx.EmitToolResult(map[string]interface{}{"message": msg})
	return []types.ResultContentBlock{types.TextBlock(msg)}, nil
}

func (t *mockTool) RenderToolUse(args types.ToolArguments) string { return t.summary(args) }

func (t *mockTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("mock tool error: %v", err)
}

func (t *mockTool) RenderToolResult(data map[string]interface{}) string {
	if msg, ok := data["message"].(string); ok {
		return msg
	}
	return "mock tool result"
}

// entryAddDeclaration 複製自 wanttools.RecordEntryDeclaration(entry_add.go)。
var entryAddDeclaration = types.ToolDeclaration{
	Name: "entry_add",
	Description: "將一則項目記錄成帶有日期時間的條目並保存。" +
		"當使用者想把訊息存成待辦、行程、備忘或日誌條目時使用。每呼叫一次新增一筆。" +
		"請從訊息解析出事件的時間,可以是單一時間點、時間範圍或全日事件。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"title": map[string]interface{}{
				"type":        "STRING",
				"description": "要記錄的事項內容(去掉時間後的描述),例如:'開會討論 Q3 預算'",
			},
			"start": map[string]interface{}{
				"type": "STRING",
				"description": "事件【日期】,用英文自然語言語詞表達(只給日期,不含時刻),系統自動換算。" +
					"例如:'next Monday'、'tomorrow'、'this Friday'、'in 3 days'、'June 30'。" +
					"不要自己算日期。沒提到日期就留空字串。",
			},
			"startTime": map[string]interface{}{
				"type": "STRING",
				"description": "事件開始的時刻,24 小時制 'HH:MM'(如 '10:00'、'15:30')。" +
					"從使用者訊息直接取時刻,不要換算。沒提到時刻(全日事件)就留空字串。",
			},
			"end": map[string]interface{}{
				"type": "STRING",
				"description": "事件結束【日期】,格式同 start(英文日期語詞)。" +
					"只有表達日期範圍(如「6/30 到 7/2」)時才填,否則留空字串。",
			},
			"endTime": map[string]interface{}{
				"type": "STRING",
				"description": "事件結束的時刻,24 小時制 'HH:MM'。" +
					"只有表達時刻範圍(如「三點到五點」)時才填,否則留空字串。",
			},
			"kind": map[string]interface{}{
				"type": "STRING",
				"description": "條目類型(可留空)。目前支援:'stay'(住宿)。" +
					"選 'stay' 時必須同時提供 start(入住日)與 end(退房日);" +
					"未給時刻時系統自動補 check-in 15:00 / check-out 11:00。",
			},
			"taskID": map[string]interface{}{
				"type": "INTEGER",
				"description": "若這筆記錄是在完成 task_plan 規劃的某個步驟時新增的," +
					"帶上該步驟的任務序號(id),讓前端把對應的「新增中」佔位卡換成正式條目卡。" +
					"與 task_plan 無關的一般記錄留空。",
			},
		},
		"required": []string{"title"},
	},
}

// entryQueryDeclaration 複製自 wanttools.QueryEntriesDeclaration(entry_query.go)。
var entryQueryDeclaration = types.ToolDeclaration{
	Name: "entry_query",
	Description: "查詢頻道中已記錄的條目(待辦、行程、會議等)。" +
		"當使用者在提問、想知道某段時間有什麼安排時呼叫。可用 from / to 限定時間範圍。" +
		"回傳符合的條目清單,據此回答使用者。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"from": map[string]interface{}{
				"type": "STRING",
				"description": "範圍起點,用【英文】自然語言時間語詞表達(系統自動換算)。" +
					"把時間範圍拆成起點與終點兩個時間點,例如「上週」→ from='last Monday'、to='last Sunday';" +
					"「下個月」→ from='next month' 的起訖兩日。可用 'last Monday'、'tomorrow'、'June 1' 等。" +
					"不限定起點就留空字串。",
			},
			"to": map[string]interface{}{
				"type": "STRING",
				"description": "範圍終點(含),格式同 from(英文時間語詞)。" +
					"查單一天時 from 與 to 填同一個英文語詞即可。不限定終點就留空字串。",
			},
		},
	},
}

// entryUpdateDeclaration 複製自 wanttools.UpdateEntryDeclaration(entry_update.go)。
var entryUpdateDeclaration = types.ToolDeclaration{
	Name: "entry_update",
	Description: "更新一筆已記錄條目的欄位（事項名稱、時間、地點、種類等）。" +
		"只需傳入要修改的欄位，未傳入的欄位保持原值不變。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"entryID": map[string]interface{}{
				"type":        "STRING",
				"description": "要更新的條目 ID（如 'ent_xxxx'）。",
			},
			"title": map[string]interface{}{
				"type":        "STRING",
				"description": "新的事項描述，留空字串表示不修改。",
			},
			"start": map[string]interface{}{
				"type":        "STRING",
				"description": "新的開始日期，英文自然語言語詞（如 'June 30'、'tomorrow'）或絕對格式 'YYYY-MM-DD'。留空字串表示不修改。",
			},
			"startTime": map[string]interface{}{
				"type":        "STRING",
				"description": "新的開始時刻，24 小時制 'HH:MM'（如 '09:00'）。留空字串表示不修改時刻。",
			},
			"end": map[string]interface{}{
				"type":        "STRING",
				"description": "新的結束日期，格式同 start。留空字串表示不修改。",
			},
			"endTime": map[string]interface{}{
				"type":        "STRING",
				"description": "新的結束時刻，24 小時制 'HH:MM'。留空字串表示不修改。",
			},
			"location": map[string]interface{}{
				"type":        "STRING",
				"description": "新的地點，留空字串表示不修改。",
			},
			"kind": map[string]interface{}{
				"type":        "STRING",
				"description": "條目種類：flight（飛行）、stay（住宿）、car（租車）、activity（活動）、food（餐飲）、transport（交通）、other（其他）。留空字串表示不修改。",
			},
		},
		"required": []string{"entryID"},
	},
}

// entryDeleteDeclaration 複製自 wanttools.DeleteEntryDeclaration(entry_delete.go)。
var entryDeleteDeclaration = types.ToolDeclaration{
	Name: "entry_delete",
	Description: "刪除已記錄的條目。刪除前請先用 entry_query 確認 ID,並向使用者確認後再執行。" +
		"要刪除多筆(如「刪除全部」)時,用 entryIDs 一次帶入所有 ID,**不要**分成多次呼叫。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"entryIDs": map[string]interface{}{
				"type":        "ARRAY",
				"items":       map[string]interface{}{"type": "STRING"},
				"description": "要刪除的條目 ID 陣列(如 ['ent_a','ent_b'])。刪除多筆時用此欄位一次帶入全部,一次呼叫刪完。",
			},
			"entryID": map[string]interface{}{
				"type":        "STRING",
				"description": "要刪除的單一條目 ID(如 'ent_xxxx')。只刪一筆時用此欄位;刪多筆請改用 entryIDs。",
			},
		},
	},
}

// entryPresentDeclaration 複製自 wanttools.PresentEntriesDeclaration(entry_present.go)。
var entryPresentDeclaration = types.ToolDeclaration{
	Name: "entry_present",
	Description: "把一筆要展示給使用者的條目加入展示清單。" +
		"回答查詢、列出安排/待辦/行程時,每一筆條目呼叫一次此工具(有幾筆就呼叫幾次)," +
		"前端會把這些條目用卡片列表顯示,比純文字更清楚。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"title": map[string]interface{}{
				"type":        "STRING",
				"description": "事項描述,例如 '開會討論 Q3 預算'。",
			},
			"start": map[string]interface{}{
				"type":        "STRING",
				"description": "開始日期 'YYYY-MM-DD'。直接用查到的條目值。",
			},
			"startTime": map[string]interface{}{
				"type":        "STRING",
				"description": "開始時刻 'HH:MM'。全日事件留空字串。",
			},
			"end": map[string]interface{}{
				"type":        "STRING",
				"description": "結束日期 'YYYY-MM-DD';無則留空字串。",
			},
			"endTime": map[string]interface{}{
				"type":        "STRING",
				"description": "結束時刻 'HH:MM';無則留空字串。",
			},
		},
		"required": []string{"title"},
	},
}

// geocodeDeclaration 複製自 wanttools.GeocodeDeclaration(geocode.go)。
var geocodeDeclaration = types.ToolDeclaration{
	Name:        "geocode",
	Description: "查詢地點名稱的經緯度座標。查詢字串應包含城市名以提高準確度（如「宮古島希爾頓酒店」而非僅「希爾頓酒店」）。回傳第一筆最相符的結果。",
	Type:        "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"place": map[string]interface{}{
				"type":        "STRING",
				"description": "地點查詢字串，應包含城市或地區名稱以限制搜尋範圍，例如「宮古島東急飯店」、「東京新宿希爾頓」。",
			},
		},
		"required": []string{"place"},
	},
}

// recommendNearbyDeclaration 複製自 wanttools.RecommendNearbyDeclaration(recommend_nearby.go),
// 含 placeCategoryList(官方 Places API 類別清單)。
var recommendNearbyDeclaration = types.ToolDeclaration{
	Name: "recommend_nearby",
	Description: "依地點名稱查詢附近的推薦景點/餐廳/住宿等,依評分與評論數排序。" +
		"規劃行程需要湊景點時呼叫。" +
		"place 應包含城市名以提高定位準確度(如「京都清水寺」而非僅「清水寺」)。" +
		"回傳候選清單(名稱、地址、評分、評論數),由你判斷哪些適合寫入行程。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"place": map[string]interface{}{
				"type":        "STRING",
				"description": "查詢中心點的地點名稱,應包含城市或地區名稱,例如「京都車站」、「宮古島市」。",
			},
			"category": map[string]interface{}{
				"type": "STRING",
				"description": "想找的類型,填 Google Places API 官方類別 key(英文,小寫底線),從下面清單挑" +
					"最貼切使用者描述的一個(例如使用者說「拉麵」就填 ramen_restaurant 而非泛用的 " +
					"restaurant,說「日式旅館」就填 japanese_inn 而非泛用的 lodging;找不到夠精確的" +
					"對應詞才退回較泛用的類別如 restaurant/tourist_attraction)。留空表示不限類型," +
					"回傳綜合推薦。可用類別:\n" + placeCategoryList,
			},
			"radius_meters": map[string]interface{}{
				"type":        "INTEGER",
				"description": "搜尋半徑(公尺),預設 1500,最大 50000。步行範圍建議 1000~2000,市區範圍可用 5000~10000。",
			},
		},
		"required": []string{"place"},
	},
}

// placeCategoryList 複製自 wanttools.placeCategoryList(recommend_nearby.go)。
const placeCategoryList = `景點/文化: tourist_attraction, museum, art_gallery, art_museum, historical_place, historical_landmark, cultural_landmark, monument, castle, sculpture, observation_deck, botanical_garden, zoo, aquarium, amusement_park, water_park, national_park, state_park, city_park, garden, hiking_area, wildlife_park, planetarium, opera_house, concert_hall, performing_arts_theater, movie_theater, amphitheatre, plaza, marina, visitor_center
餐飲: restaurant, cafe, bar, bakery, buffet_restaurant, fine_dining_restaurant, fast_food_restaurant, food_court, sushi_restaurant, ramen_restaurant, japanese_restaurant, japanese_izakaya_restaurant, chinese_restaurant, korean_restaurant, taiwanese_restaurant, thai_restaurant, vietnamese_restaurant, italian_restaurant, french_restaurant, seafood_restaurant, steak_house, hamburger_restaurant, pizza_restaurant, korean_barbecue_restaurant, hot_pot_restaurant, dessert_shop, ice_cream_shop, coffee_shop, tea_house, brewery, wine_bar, cocktail_bar
住宿: lodging, hotel, resort_hotel, hostel, motel, inn, bed_and_breakfast, japanese_inn, guest_house, campground, rv_park
購物: shopping_mall, supermarket, convenience_store, department_store, market, farmers_market, book_store, gift_shop, jewelry_store, clothing_store
休閒娛樂: spa, public_bath, sauna, gym, fitness_center, golf_course, ski_resort, bowling_alley, karaoke, night_club, casino, movie_theater, amusement_center, water_park, swimming_pool
交通地標: train_station, subway_station, bus_station, airport, ferry_terminal`

// askUserDeclaration 複製自 wanttools.AskUserDeclaration(ask_user.go)。
var askUserDeclaration = types.ToolDeclaration{
	Name: "ask_user",
	Description: "當缺少記錄所需的必要資訊(如住宿的退房日期)時,呼叫此工具請使用者透過 UI 補上。" +
		"不要憑猜測填缺失的值。呼叫後本輪對話結束,使用者補上資訊後會再次觸發你,屆時再完成記錄。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"askType": map[string]interface{}{
				"type":        "STRING",
				"description": "要請使用者提供的資訊類型。目前支援:'date'(讓使用者選一個日期,如退房日)。",
			},
			"prompt": map[string]interface{}{
				"type":        "STRING",
				"description": "顯示給使用者的提示文字,說明要提供什麼,例如「請選擇希爾頓的退房日期」。",
			},
		},
		"required": []string{"askType", "prompt"},
	},
}

// taskPlanDeclaration 複製自 wanttools.TaskPlanDeclaration(task_plan.go)。
var taskPlanDeclaration = types.ToolDeclaration{
	Name: "task_plan",
	Description: "規劃並追蹤多步驟任務(待辦清單,存於本頻道記憶體)。處理需要多步驟的複雜請求時," +
		"先用 create 列出計畫,完成一步就 complete 標記,全部完成後用 clear 清除。以 action 指定操作。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"action": map[string]interface{}{
				"type": "STRING",
				"description": "操作類型:" +
					"'create'(新增任務;用 items 一次列出整個計畫,或 text 加單筆)| " +
					"'list'(列出全部任務)| " +
					"'update'(改任務欄位,需 id,text/date/kind 擇一或多個要改的欄位)| " +
					"'complete'(標記完成,需 id)| " +
					"'delete'(刪除一筆,需 id)| " +
					"'clear'(清空全部任務)。",
			},
			"items": map[string]interface{}{
				"type": "ARRAY",
				"items": map[string]interface{}{
					"type": "OBJECT",
					"properties": map[string]interface{}{
						"text": map[string]interface{}{
							"type":        "STRING",
							"description": "任務描述。",
						},
						"date": map[string]interface{}{
							"type":        "STRING",
							"description": "任務日期'YYYY-MM-DD',不指定就留空字串。",
						},
						"kind": map[string]interface{}{
							"type":        "STRING",
							"description": "分類:'add'(這步是新增)| 'update'(這步是更新)| 留空字串表示不分類。",
						},
						"parentID": map[string]interface{}{
							"type":        "INTEGER",
							"description": "所屬第一層條目的 id;這批是某條目底下的施作步驟時填,第一層條目本身不填(或填 0)。",
						},
					},
					"required": []string{"text"},
				},
				"description": "多筆任務(action=create 時一次寫入),每筆是 {text, date, kind, parentID} 物件。" +
					"第一層條目留空 parentID,如 [{text:'訂希爾頓', date:'2026-06-29', kind:'add'}];" +
					"某條目底下的施作步驟則整批帶同一 parentID,如 [{text:'查是否已存在', parentID:1}, {text:'查 geo 座標', parentID:1}]。",
			},
			"text": map[string]interface{}{
				"type":        "STRING",
				"description": "單筆任務描述(action=create 加單筆、或 action=update 時使用)。",
			},
			"date": map[string]interface{}{
				"type":        "STRING",
				"description": "單筆任務日期'YYYY-MM-DD'(action=create 加單筆、或 action=update 時使用)。",
			},
			"kind": map[string]interface{}{
				"type":        "STRING",
				"description": "單筆任務分類:'add' | 'update'(action=create 加單筆、或 action=update 時使用)。",
			},
			"parentID": map[string]interface{}{
				"type":        "INTEGER",
				"description": "單筆 create 時,若這是某第一層條目底下的施作步驟,填該條目的 id;第一層條目本身不填。",
			},
			"id": map[string]interface{}{
				"type":        "INTEGER",
				"description": "任務序號(action=update/complete/delete 時需要;由 create/list 回傳)。",
			},
		},
		"required": []string{"action"},
	},
}

// registerMockTool 用共用的 mockTool 邏輯註冊一個工具,summary 決定
// RenderToolUse 與 Call 成功訊息的文字內容。
func registerMockTool(decl types.ToolDeclaration, summary func(args types.ToolArguments) string) {
	types.RegisterTool(decl, func() types.ToolInterface {
		return &mockTool{summary: summary}
	})
}

func init() {
	registerMockTool(entryAddDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Recorded entry: %s", a.GetString("title"))
	})
	registerMockTool(entryQueryDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Queried entries from=%q to=%q: (no data, mock 環境未接真實 store)", a.GetString("from"), a.GetString("to"))
	})
	registerMockTool(entryUpdateDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Updated entry %s", a.GetString("entryID"))
	})
	registerMockTool(entryDeleteDeclaration, func(a types.ToolArguments) string {
		if ids := a.GetStringArray("entryIDs"); len(ids) > 0 {
			return fmt.Sprintf("[mock] Deleted entries %v", ids)
		}
		return fmt.Sprintf("[mock] Deleted entry %s", a.GetString("entryID"))
	})
	registerMockTool(entryPresentDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Presented entry: %s", a.GetString("title"))
	})
	registerMockTool(geocodeDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Geocoded %q: lat=25.000000, lng=121.000000 (假座標,mock 環境未接真實地圖 API)", a.GetString("place"))
	})
	registerMockTool(recommendNearbyDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Nearby recommendations for %q: (no data, mock 環境未接真實地圖 API)", a.GetString("place"))
	})
	registerMockTool(askUserDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] Asked user (%s): %s", a.GetString("askType"), a.GetString("prompt"))
	})
	registerMockTool(taskPlanDeclaration, func(a types.ToolArguments) string {
		return fmt.Sprintf("[mock] task_plan action=%s", a.GetString("action"))
	})
}
