package api

import "github.com/tim72117/tripace/internal/model"

// geo_types.go — 景點系統跨端點共用的基礎資料結構。
//
// 這裡只放「被多個 handler 檔案共同依賴、不屬於任何單一端點」的型別。
// 2026-09 從 geo_outline.go 分離出來:attractionResponse 同時被三個檔案
// 使用(見下方型別說明列出的四個端點),留在 geo_outline.go 會讓它看起來
// 像那個檔案的私有型別,但實際上 geo_outline_public.go(主題介紹頁的免
// 登入端點)與 geo_plan_ai.go(plan-ai 查詢端點)都直接建構它——把它放在
// 中性的位置,「這是共用語言、不是某個端點的私產」這件事從檔案歸屬就看
// 得出來。
//
// 刻意不搬過來的:
//   - toAttractionResponses(geo.District → attractionResponse 的轉換)
//     ——那是即時查 Google Places 路徑專屬的轉換邏輯,只有 geo_outline.go
//     一個呼叫端,不是共用的基礎結構。
//   - hotelResponse/placeDetailsResponse 等其餘回應型別——目前各自只有
//     單一檔案使用,沒有共用需求,搬過來只會讓這個檔案變成無主型別的
//     雜物間。等到真的出現第二個使用端再搬。

// attractionResponse 是 GET /internal/geo/attractions 回應裡單筆景點區域
// 的統一格式——不論資料來自 store.ListAttractionsByCity(人工建檔,見
// model.Attraction)或 geo.SearchCityAttractions(即時查 Google Places 的
// 後備資料),前端拿到的形狀一致,不需要依來源分別處理。Level 只有走
// 資料庫路徑才會有值(1~5,見 model.Attraction 的完整說明);走 Google
// Places 路徑的結果一律不帶 level(前端據此判斷全部顯示,不受縮放層級
// 篩選——這批資料目前沒有分級資訊可用)。
type attractionResponse struct {
	// ID:只有走 store.ListAttractionsByCity/ListAttractionsNearby 這條
	// 人工建檔資料路徑才會有值——即時查 Google Places 的 toAttractionResponses
	// 路徑(geo.District 沒有這個欄位)固定不帶,同 PlaceID/Category 的既有
	// 慣例。供 plan-ai 的 attraction-search 使用:LLM 只需要記住這個
	// attractions 表的主鍵,之後用 attraction/{id} 端點重新查詢完整資料,
	// 不需要在兩次工具呼叫之間原封不動複製貼上 name/lat/lng/summary。
	ID           string  `json:"id,omitempty"`
	Name         string  `json:"name"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	PlaceCount   int     `json:"placeCount,omitempty"`
	LandmarkName string  `json:"landmarkName,omitempty"`
	RadiusMeters int     `json:"radiusMeters,omitempty"`
	Summary      string  `json:"summary,omitempty"`
	Level        int     `json:"level,omitempty"`
	// IsTheme:見 model.Attraction.IsTheme 的完整說明。跟 Level 一樣只有
	// 走資料庫路徑才有意義,故沒有用 omitempty——false 是合法值(代表
	// 「這是精選點」),omitempty 會讓前端收到的 JSON 完全沒有這個欄位,
	// 跟「這筆資料來自沒有主題概念的 Google Places 後備路徑」混淆不清。
	IsTheme bool `json:"isTheme"`
	// PlaceID:只有走 store.ListAttractionsByCity/ListAttractionsNearby
	// 這條人工建檔資料路徑、且該筆 model.Attraction.PlaceID 有值時才會有
	// 值——即時查 Google Places 的 toAttractionResponses 路徑(geo.District
	// 沒有這個欄位)固定不帶。有值時前端(useAttractionOverlays.ts/
	// AttractionInfoPanel.tsx)才會改打 GET /internal/geo/place-details
	// 查詢 photo_assets 的實際照片,見 model.Attraction.PlaceID 的完整
	// 說明。
	PlaceID string `json:"placeId,omitempty"`
	// Category:見 model.Attraction.Category 的完整說明。跟 PlaceID 一樣
	// 只有走資料庫路徑、且該筆有設定值時才會有值,即時查 Google Places 的
	// 後備路徑沒有分類概念,固定不帶。
	Category string `json:"category,omitempty"`
}

// toAttractionResponse 把 model.Attraction(資料庫路徑的人工建檔紀錄)轉
// 成統一的 attractionResponse 回應格式——2026-09 抽出來取代原本分散在
// geo_outline.go(handleGeoAttractions/handleGeoAttractionsNearby/
// handleGeoAttractionsOnlyNearby 三處)與 geo_plan_ai.go
// (handlePublicGeoAttractionSearch)各自手刻的同一段欄位對應邏輯。
//
// 四個呼叫端手刻時欄位選取不完全一致(有的漏 ID、有的漏
// RadiusMeters/Level),這裡刻意把 model.Attraction 有的欄位全部帶上
// ——這是「資料庫紀錄轉成對外格式」這個轉換本身該有的完整行為,要不要
// 用哪些欄位是呼叫端的事(attractionResponse 的對應 json tag 多半有
// omitempty,呼叫端不讀的欄位在回應裡不會造成問題),不該讓轉換函式
// 自己替呼叫端決定「這個情境應該省略哪些欄位」而漏東漏西——那正是
// 這次要修的問題本身:手刻對應容易在新增呼叫端時忘記帶上某個欄位
// (search_attraction 這條路徑就曾經因此漏掉 IsTheme 過濾,見
// handlePublicGeoAttractionSearch 呼叫端自己的完整說明)。
//
// 不處理 toAttractionResponses(geo.District → attractionResponse)那條
// 即時查 Google Places 的路徑——那批來源資料本來就沒有 ID/RadiusMeters/
// Level/PlaceID/Category 這些只有資料庫紀錄才有的欄位,兩者轉換邏輯的
// 出發點不同,硬併成同一個函式反而要塞一堆「這個來源沒有這個欄位」的
// 條件判斷,不是真正的重複。
func toAttractionResponse(a model.Attraction) attractionResponse {
	ar := attractionResponse{
		ID:           a.ID,
		Name:         a.Name,
		Lat:          a.Lat,
		Lng:          a.Lng,
		RadiusMeters: a.RadiusMeters,
		Level:        a.Level,
		IsTheme:      a.IsTheme,
	}
	if a.Summary != nil {
		ar.Summary = *a.Summary
	}
	if a.PlaceID != nil {
		ar.PlaceID = *a.PlaceID
	}
	if a.Category != nil {
		ar.Category = *a.Category
	}
	return ar
}
