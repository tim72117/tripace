// 「Google 照片 target=0 核對」(GET /admin/api/photo-target-zero-check)——
// 列出 place_details_cache 裡 google_photo_target_count 恰好是 0 的全部
// 地點,供人工核對這是「已確認過、真的沒有 Google 照片」的合法值,還是
// 2026-09 修正前那個死鎖 bug(見 server/internal/api/geo_outline.go
// shouldAddGooglePlacePhoto 的完整說明)遺留的舊資料——單看這個欄位本身
// 無法分辨兩者,只能列出來讓人核對(例如去 Google Maps 實際查一次這個
// 地點是否真的沒有照片)。純唯讀查詢,不做任何修改。
package adminconsole

import (
	"net/http"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/store"
)

// photoTargetZeroCheckResponse 是這支端點的回應格式。
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
