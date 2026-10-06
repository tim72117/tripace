// 「Attraction 缺少 Google Place ID 核對」(GET /admin/api/
// attraction-missing-place-id-check)——列出 attractions 表裡
// place_id 為 NULL 或空字串的全部景點。這份清單裡的地點,主題卡實際上
// 都只會顯示 placeholder,沒有真正能顯示的圖片(2026-10 起
// attractions.photo_url 這個相容欄位已經連同資料庫欄位本身一併移除,
// 見 cmd/migrate-drop-photo-url 的完整說明,連「資料庫裡還留著一張不會
// 被使用的舊快照」這種中繼狀態都不存在了)。列出來讓後台操作者知道範圍,
// 對應的修法是替這些景點補上正確的 Google Place ID。
//
// GET 端點本身純唯讀,只負責列出範圍。POST .../refetch(見下方
// refetchAttractionPlaceID)是後續加上的「一鍵重查」動作——用景點既有的
// cityName+name 當查詢字串打一次 Google Places Text Search,自動採用
// 第一筆候選的 place_id 寫回資料庫。這不是「自動判斷哪些資料需要修」
// (那個判斷仍然由這份清單存在的理由——人工核對——涵蓋),而是加速「核對
// 完覺得該補、且信任文字比對結果」之後,原本要手動去 Google Maps 查
// place_id、再用 tripace-cli 或 curl 寫入的流程,壓縮成後台一鍵完成。
// 查到的候選是否真的是這個景點,操作者仍要自行判斷結果(見該 handler
// 回應裡帶出的 matchedName/matchedAddress),這支端點不做地址/名稱相似度
// 比對這類自動驗證。
package adminconsole

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/geo"
)

// attractionMissingPlaceIDRow 是這支端點單筆回應的形狀——只曝露後台
// 核對需要的欄位,不直接把完整的 model.Attraction 外流(理由同
// photoTargetZeroCheckResponse 一貫的 store 層慣例)。
type attractionMissingPlaceIDRow struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	CityName string `json:"cityName"`
	IsTheme  bool   `json:"isTheme"`
}

type attractionMissingPlaceIDResponse struct {
	Attractions []attractionMissingPlaceIDRow `json:"attractions"`
}

func (h *Handler) checkAttractionMissingPlaceID(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	attractions, err := h.Store.ListAllAttractions()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]attractionMissingPlaceIDRow, 0)
	for _, a := range attractions {
		if a.PlaceID != nil && *a.PlaceID != "" {
			continue
		}
		out = append(out, attractionMissingPlaceIDRow{
			ID:       a.ID,
			Name:     a.Name,
			CityName: a.CityName,
			IsTheme:  a.IsTheme,
		})
	}
	writeJSON(w, http.StatusOK, attractionMissingPlaceIDResponse{Attractions: out})
}

type refetchAttractionPlaceIDRequest struct {
	ID string `json:"id"`
}

type refetchAttractionPlaceIDResponse struct {
	ID string `json:"id"`
	// PlaceID:實際寫回資料庫的值。
	PlaceID string `json:"placeId"`
	// MatchedName/MatchedAddress:Google 回傳的第一筆候選實際名稱/地址
	// ——不是這筆景點原本在資料庫裡的 Name/CityName。操作者仍需自行核對
	// 這是否真的是同一個地點(見本檔案開頭的完整說明:這支端點不做名稱/
	// 地址相似度比對這類自動驗證),核對依據就是這兩個欄位。
	MatchedName    string `json:"matchedName"`
	MatchedAddress string `json:"matchedAddress"`
}

// refetchAttractionPlaceID:用這筆景點既有的 cityName+name 當查詢字串
// (跟 tripace-cli 的 attraction-set-place-id -place 選項共用同一套
// geo.Client.Search 查詢邏輯,見該 CLI 子命令的完整說明——這裡是它在
// admin 網頁上的對應動作,免去操作者另外開終端機、記憶地標 ID 手動執行
// CLI 指令的步驟),取第一筆候選的 place_id 直接寫回。查無候選、或候選
// 沒有 place_id 時回錯誤,不靜默略過或清空既有值——這是操作者主動觸發
// 的單筆操作,需要明確知道這次到底有沒有真的補到。
func (h *Handler) refetchAttractionPlaceID(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	var req refetchAttractionPlaceIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.ID == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	attraction, err := h.Store.GetAttraction(req.ID)
	if err != nil {
		http.Error(w, "找不到景點 "+req.ID, http.StatusNotFound)
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "refetchAttractionPlaceID")
	ctx = geo.WithPath(ctx, r.URL.Path)

	query := attraction.CityName + " " + attraction.Name
	places, err := client.Search(ctx, query, &geo.SearchOptions{MaxResults: 1})
	if err != nil {
		if err == geo.ErrNotFound {
			http.Error(w, "查無「"+query+"」相關地點", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if len(places) == 0 || places[0].PlaceID == "" {
		http.Error(w, "「"+query+"」查到的候選地點沒有 place_id", http.StatusNotFound)
		return
	}
	match := places[0]

	if err := h.Store.UpdateAttractionPlaceID(req.ID, match.PlaceID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, refetchAttractionPlaceIDResponse{
		ID:             req.ID,
		PlaceID:        match.PlaceID,
		MatchedName:    match.Name,
		MatchedAddress: match.Address,
	})
}
