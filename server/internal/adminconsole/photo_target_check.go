// 「Google 照片 target=0 核對」(GET /admin/api/photo-target-zero-check)——
// 列出 place_details_cache 裡 google_photo_target_count 恰好是 0 的全部
// 地點,供人工核對這是「已確認過、真的沒有 Google 照片」的合法值,還是
// 2026-09 修正前那個死鎖 bug(見 server/internal/api/geo_outline.go
// shouldAddGooglePlacePhoto 的完整說明)遺留的舊資料——單看這個欄位本身
// 無法分辨兩者,只能列出來讓人核對(例如去 Google Maps 實際查一次這個
// 地點是否真的沒有照片)。
//
// POST /admin/api/photo-target-zero-check/reset 讓管理員核對完某一列
// 確實是卡住的舊資料後,把它重置回 sentinel -1(見 shouldAddGooglePlacePhoto
// 的完整說明:-1 代表「尚未確認過」,下次這個 placeId 被查詢時會無條件
// 觸發重新跟 Google 確認 target)——這是本頁唯一提供的寫入動作,刻意
// 不提供「自動判斷哪些是舊資料」的功能:分辨兩種情況本身需要人工判斷
// (例如去 Google Maps 實際查一次),不安全自動化。
package adminconsole

import (
	"encoding/json"
	"net/http"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/store"
)

// photoTargetZeroCheckResponse 是 GET 這支端點的回應格式。
type photoTargetZeroCheckResponse struct {
	Places []store.PlaceDetailsZeroPhotoTarget `json:"places"`
}

func (h *Handler) checkPhotoTargetZero(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	places, err := h.Store.ListPlaceDetailsWithZeroPhotoTarget()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if places == nil {
		places = []store.PlaceDetailsZeroPhotoTarget{}
	}
	writeJSON(w, http.StatusOK, photoTargetZeroCheckResponse{Places: places})
}

// resetPhotoTargetRequest 是 POST /admin/api/photo-target-zero-check/reset
// 的請求 body。
type resetPhotoTargetRequest struct {
	PlaceID string `json:"placeId"`
}

// resetPhotoTarget 把指定 placeId 的 google_photo_target_count 重置回
// sentinel -1、new_photo_count 一併歸零(語意對齊
// resetPhotoProgressOnTargetChange 觸發時的既有重置行為,見該函式與
// UpdatePlacePhotoProgress 的完整說明:target 改變時 newPhotoCount 也要
// 一併歸零,不能只改 target 留著舊的 newPhotoCount,否則會出現「target
// 已經是 -1(尚未確認)但 newPhotoCount 卻是非零」這種不一致的中間態)。
// fetched_at 一併更新(touchFetchedAt=true)——理由同 handleGeoPlaceDetails
// 其餘觸發重新確認的既有慣例,反映「這一列剛被人為動過」的事實。
func (h *Handler) resetPhotoTarget(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	var req resetPhotoTargetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.PlaceID == "" {
		http.Error(w, "placeId is required", http.StatusBadRequest)
		return
	}
	// UpdatePlacePhotoProgress 對找不到對應列的 placeID 不會回傳
	// error——WHERE 條件比對不到任何列,GORM 的 Updates 仍視為成功(這
	// 個共用函式的其餘呼叫端,如背景補圖流程,本來就不需要、也不該因為
	// race 到列被刪除而報錯)。這裡是唯一需要區分「打錯字/從未快取過的
	// placeId」與「真的重置成功」的呼叫端,故在呼叫前先明確檢查存在性,
	// 而不是修改共用函式本身的行為。
	exists, err := h.Store.PlaceDetailsCacheRowExists(req.PlaceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "no cached place_details row for this placeId", http.StatusNotFound)
		return
	}
	if err := h.Store.UpdatePlacePhotoProgress(req.PlaceID, 0, -1, true); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
