package api

import (
	"net/http"
)

// geo_outline_public.go — 主題介紹頁(web/src/home/InteractiveExploreMap.tsx,
// 被 JiufenPage/KyotoPage/TainanPage/TainanChikanPage/HokkaidoJozankeiPage
// 等頁面嵌入)與訪客分享頁專用的**免登入**公開端點。
//
// 這三支端點都是薄包裝層:先做授權檢查(城市白名單 / 「這個 placeId 必須
// 已建檔成 attraction」),通過後直接委派給 geo_outline.go 裡登入版的核心
// 邏輯(handleGeoPlaceDetails/handleGeoPlacePhotoAssets),不重寫第二份會
// 跟登入版漸漸失去同步的簡化實作。
//
// 2026-09 從 geo_outline.go(2187 行、34 個函式)分離出來——那個檔案同時
// 放著登入後正式規劃地圖功能與這批公開端點,難以一眼分辨哪些路徑是訪客
// 可達的。獨立成檔之後,「哪些東西沒有身份驗證把關」這件事從檔案邊界就
// 看得出來,新增/修改公開端點時也不需要在大檔案裡尋找散落的位置。
//
// 與 geo_plan_ai.go 的區別(很重要,不要混淆):那個檔案的端點名字裡雖然
// 也有 Public(handlePublicGeoPlaceSearch 等,歷史命名),但已經全部搬到
// 需登入的 /internal/geo/plan-ai/* 底下;**這個檔案裡的三支才是真正免登入
// 的公開端點**。
//
// 刻意留在 geo_outline.go 的(三方共用,搬過來會造成循環或誤導):
//   - attractionResponse 型別與 toAttractionResponses——登入版
//     /internal/geo/attractions、這裡的公開版、以及 geo_plan_ai.go 的
//     attraction-search 都在用。
//   - handleGeoPlaceDetails/handleGeoPlacePhotoAssets——登入版核心邏輯,
//     本身是 /internal/geo/* 的 handler,只是同時被這裡委派。

// publicAttractionsCityAllowlist:GET /public/geo/attractions 只允許查詢
// 這份白名單裡的城市——這支端點刻意不掛 internalAuth,供登入前的公開展示
// 頁(見上方檔頭列出的那幾個主題介紹頁)查詢周邊精選點的名稱/座標/分類等
// 基本資料,取代原本寫死在前端 fixture 的固定假資料。這裡的白名單是城市
// 層級(不是像 place-details 那樣逐一列出 placeID)——因為
// handleGeoAttractionsByCity 本身只走 store.ListAttractionsByCity(純資料庫
// 查詢,見該函式的完整說明,刻意不像 handleGeoAttractions 那樣有 Google
// Places 即時查詢的 fallback 分支),不會觸發任何計費的外部 API 呼叫,
// 城市層級的白名單已經足夠防止這支端點被當成任意查詢資料庫全部城市內容的
// 公開清單端點濫用,不需要逐筆列舉 attraction ID 這麼細的授權粒度。
// 之後若展示頁新增其他城市的固定示範資料,需要同步在這裡補上,不會自動生效。
var publicAttractionsCityAllowlist = map[string]bool{
	"京都":  true,
	"九份":  true, // JiufenPage.tsx 開頭嵌入 KiyomizuDemoPage(參數化為 city prop)
	"台南":  true, // TainanPage.tsx 開頭嵌入 InteractiveExploreMap(參數化為 city prop)
	"定山溪": true, // 北海道定山溪賞楓試做頁(見 docs/research-hokkaido-jozankei-autumn-theme-2026-09.md),同樣是 InteractiveExploreMap 嵌入
}

// handleGeoAttractionsByCity 是 GET /public/geo/attractions 的核心邏輯,
// 獨立成函式是為了讓白名單檢查與實際查詢邏輯分開(目前唯一呼叫端就是
// 下面的 handlePublicGeoAttractions)——刻意不重用 handleGeoAttractions
// (那支有 Google Places SearchCityAttractions 的即時查詢 fallback,見該
// 函式的完整說明:沒有登入驗證的公開端點若間接觸發計費的外部 API 呼叫,
// 等同把這支端點變成任何人都能觸發真實花費的入口,即使城市白名單只收錄
// 幾個城市,只要 store.ListAttractionsByCity 查無資料就會落到 fallback,
// 仍然是不可接受的風險),只走 store.ListAttractionsByCity 這一層人工建檔
// 的正式資料,查無資料就回空陣列,不嘗試任何其他資料來源。
func (s *Server) handleGeoAttractionsByCity(city string) ([]attractionResponse, error) {
	landmarks, err := s.store.ListAttractionsByCity(city)
	if err != nil {
		return nil, err
	}
	// 2026-09:不再查/帶出 landmarkPhotoUrl,理由同 handleGeoAttractions
	// 同一次修正的完整說明——前端已確認完全不讀這個欄位,連同批次查詢
	// photo_assets 這段邏輯一併移除。
	attractions := make([]attractionResponse, 0, len(landmarks))
	for _, landmark := range landmarks {
		ar := attractionResponse{
			Name:         landmark.Name,
			Lat:          landmark.Lat,
			Lng:          landmark.Lng,
			RadiusMeters: landmark.RadiusMeters,
			Level:        landmark.Level,
			IsTheme:      landmark.IsTheme,
		}
		if landmark.Summary != nil {
			ar.Summary = *landmark.Summary
		}
		if landmark.PlaceID != nil {
			ar.PlaceID = *landmark.PlaceID
		}
		if landmark.Category != nil {
			ar.Category = *landmark.Category
		}
		attractions = append(attractions, ar)
	}
	return attractions, nil
}

// GET /public/geo/attractions?city={城市名稱}
//
// 免登入版的景點區域清單查詢——供登入前的公開展示頁(見
// publicAttractionsCityAllowlist 的完整說明)查詢固定示範城市裡人工
// 建檔的全部景點區域(含主題點與精選點,前端自行依 isTheme 分流),
// 取代原本寫死在前端 fixture 的固定假資料——資料庫內容更新(改名/補圖/
// 新增精選點/補分類)後,展示頁會自動反映,不需要再手動同步一份重複資料。
// 回應格式與 GET /internal/geo/attractions 一致(共用 attractionResponse),
// 差別只在這支端點只查資料庫、不含 Google Places 即時查詢 fallback
// (見 handleGeoAttractionsByCity 的完整說明)。
func (s *Server) handlePublicGeoAttractions(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	if !publicAttractionsCityAllowlist[city] {
		writeErr(w, http.StatusForbidden, "city_not_allowed", "這個城市不在公開查詢白名單內")
		return
	}
	attractions, err := s.handleGeoAttractionsByCity(city)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attractions": attractions})
}

// GET /public/geo/place-details?placeId={Google Place ID}
//
// 免登入版、供登入前的公開展示頁(主題介紹頁,見 InteractiveExploreMap.tsx
// 的呼叫端)查詢固定示範景點的完整資料——只放行已建檔為 attraction 的
// placeId(見下方授權機制說明,取代舊版 publicPlaceDetailsAllowlist 這份
// 逐一手動維護的靜態白名單)。
//
// 2026-09 重構:直接委派給 handleGeoPlaceDetails(登入後正式規劃功能用
// 的核心邏輯),不再維護一份獨立、跟它漸漸失去同步的簡化實作(使用者
// 明確要求「直接使用 /internal/geo/place-details 的流程元件」)。舊版
// 曾經刻意寫成獨立簡化版,理由是「這支端點只需要一張圖,不需要
// handleGeoPlaceDetails 內建的漸進補圖決策(點擊節奏/7 天時間觸發)這種
// 服務正式規劃體驗的複雜度」——但這個取捨的代價是兩份邏輯各自演進,
// 公開版永遠無法受益於登入版之後任何補圖機制的修正/優化(例如 7 天
// 重新確認 target 等),且兩者都各自查同一張 photo_assets 表卻各寫一份
// 幾乎相同的程式碼。改成直接呼叫同一個 handler 後,公開版與登入版的
// 行為完全一致(含漸進補圖節奏等),差別只在授權層——這裡先做授權檢查,
// 通過才放行呼叫。
//
// 授權機制:2026-09 從固定白名單(publicPlaceDetailsAllowlist,逐一手動
// 列舉允許查詢的 placeID)改成「這個 placeID 必須是已建檔的 attraction
// 才放行」(store.GetAttractionByPlaceID 查得到),不是拿掉授權改成任何
// 人都能查任意 placeId。理由:固定白名單需要每新增一個展示用地點就手動
// 加一行程式碼才會生效,而這支端點原本服務的場景(主題介紹頁的地圖圖示/
// 詳情卡)本來就只會查已經人工建檔、掛在地圖上的 attraction——用資料庫
// 裡「這筆有沒有建檔」本身當授權依據,取代維護一份逐筆列舉、容易忘記
// 同步更新的靜態清單,新增景點只需要建檔(CLI attraction-add),不需要
// 額外再手動維護這裡的白名單。查無 attraction 紀錄時視為不通過授權,
// 回 403(維持跟舊版白名單未命中時相同的錯誤語意,不是 404——404 是
// 「查了但地點不存在」,403 是「這個查詢請求不被允許」,這裡屬於後者:
// 即使 Google Places 上真的有這個地點,只要沒有建檔就不放行)。
// handleGeoPlaceDetails 本身不含任何授權判斷(授權原本就是外層
// /internal/ mux 掛載時套用的 internalAuth middleware 負責的,見 api.go
// 路由註冊處的說明,handler 函式本體從未依賴呼叫者是否通過 JWT 驗證),
// 故可以在這裡做完授權檢查後直接呼叫它,不會意外繞過或重複套用任何
// 授權邏輯。
//
// 點擊次數/漸進補圖節奏會被公開端點觸發(跟登入版共用同一份
// place_details_cache 點擊計數),這是刻意接受的行為改變——理由同上述
// 「不再維護兩份邏輯」的取捨,「必須是已建檔 attraction」這個授權條件
// 已經限制了能被觸發的 placeId 範圍,不會被濫用成任意觸發計費查詢的
// 入口。
func (s *Server) handlePublicGeoPlaceDetails(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if _, err := s.store.GetAttractionByPlaceID(placeID); err != nil {
		writeErr(w, http.StatusForbidden, "place_not_allowed", "這個 placeId 不是已建檔的景點,不允許公開查詢")
		return
	}
	s.handleGeoPlaceDetails(w, r)
}

// GET /public/geo/place-photo-assets?placeId={Google Place ID}
//
// handleGeoPlacePhotoAssets 的免登入版——授權機制對齊
// handlePublicGeoPlaceDetails(必須是已建檔的 attraction 才放行,見該
// 函式的完整說明),通過後直接委派給同一個 handler,不重寫第二份純讀
// 邏輯。
func (s *Server) handlePublicGeoPlacePhotoAssets(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if _, err := s.store.GetAttractionByPlaceID(placeID); err != nil {
		writeErr(w, http.StatusForbidden, "place_not_allowed", "這個 placeId 不是已建檔的景點,不允許公開查詢")
		return
	}
	s.handleGeoPlacePhotoAssets(w, r)
}
