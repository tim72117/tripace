package api

// geo_outline_public_place_details_test.go 測 GET /public/geo/place-details
// (handlePublicGeoPlaceDetails)——免登入版,供主題介紹頁(如
// JiufenPage.tsx/TainanPage.tsx,見 InteractiveExploreMap.tsx 的呼叫端)
// 查詢白名單內固定示範景點的完整資料。
//
// 2026-09:使用者明確要求「主題介紹應該有自己的路由,用簡化版的跟
// plan-ai 用一樣的模式」——這支端點不再轉呼叫 handleGeoPlaceDetails
// (正式登入功能共用、內建漸進補圖決策的核心函式),改成獨立的簡化
// 實作:文字查 place_details_cache 快取(未命中才即時查一次 Google
// 補文字),照片一律只查 photo_assets(不回退 google_place_photos/
// pexels,見 handlePublicGeoPlaceDetails 的完整說明)。這裡測的範圍
// 因此對齊 geo_outline_public_place_details_any_test.go 的既有模式
// (白名單、快取命中、photo_assets 優先序),不再測「轉呼叫」行為。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

func TestHandlePublicGeoPlaceDetails_NotInAllowlist_Returns403(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId=ChIJ-not-in-allowlist", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for placeId not in allowlist, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoPlaceDetails_EmptyPlaceID_Returns403(t *testing.T) {
	s := newTestServer(t)

	// 沒帶 placeId 查詢參數——publicPlaceDetailsAllowlist[""] 查無此鍵,
	// map 的零值判斷自然回傳 false,不需要另外特判空字串,但這裡明確測一次
	// 確保這個邊界情況真的落在「拒絕」分支。
	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for empty placeId, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoPlaceDetails_InAllowlist_UsesCachedTextDetails 驗證
// 白名單內的 placeId,文字資料(name/address/lat/lng/summary)命中
// place_details_cache 時直接回傳,不需要真的打 Google API——用「測試
// 環境沒有網路/API key,若真的觸發即時查詢會失敗」這個前提間接證明
// 快取命中路徑完全不依賴外部連線。
func TestHandlePublicGeoPlaceDetails_InAllowlist_UsesCachedTextDetails(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I" // 清水寺,在白名單內
	summary := "測試簡介"
	if err := s.store.SetCachedPlaceDetails(placeID, "清水寺", "京都府京都市", 34.9948, 135.785, 4.5, &summary); err != nil {
		t.Fatalf("failed to seed place_details_cache: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Name    string `json:"name"`
		Address string `json:"address"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.Name != "清水寺" || body.Address != "京都府京都市" || body.Summary != summary {
		t.Fatalf("unexpected response: %+v", body)
	}
}

// TestHandlePublicGeoPlaceDetails_NoCacheAndNoNetwork_ReturnsBadGateway 驗證
// 文字資料未命中快取時,這支端點會嘗試即時查 Google——測試環境沒有
// GOOGLE_PLACES_API_KEY/網路,預期得到 502(而不是 200 或吞掉錯誤靜默
// 回傳空資料),確認未命中分支真的有嘗試查詢、且查詢失敗會誠實回報,
// 不是靜默降級。
func TestHandlePublicGeoPlaceDetails_NoCacheAndNoNetwork_ReturnsBadGateway(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId=ChIJB_vchdMIAWARujTEUIZlr2I", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 when cache miss and no network available, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoPlaceDetails_UsesPhotoAssetsForPhotos 驗證照片一律
// 只查 photo_assets(見 handlePublicGeoPlaceDetails 的完整說明)——有
// 效期內的紀錄要組成 googlePhotoUrls 多圖清單、且 photoUrl 是第一張,
// 不回退 google_place_photos/pexels。
func TestHandlePublicGeoPlaceDetails_UsesPhotoAssetsForPhotos(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I"
	if err := s.store.SetCachedPlaceDetails(placeID, "清水寺", "京都府京都市", 34.9948, 135.785, 4.5, nil); err != nil {
		t.Fatalf("failed to seed place_details_cache: %v", err)
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	for i, url := range []string{
		"https://storage.googleapis.com/test-bucket/photo-0.jpg",
		"https://storage.googleapis.com/test-bucket/photo-1.jpg",
	} {
		if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
			PlaceID: placeID, PhotoIndex: i, Usage: "full", Source: "google",
			GCSURL: url, FetchedAt: time.Now(), ExpiresAt: &expiresAt,
		}); err != nil {
			t.Fatalf("failed to seed photo asset %d: %v", i, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		PhotoURL        string   `json:"photoUrl"`
		GooglePhotoURLs []string `json:"googlePhotoUrls"`
		PexelsPhotoURLs []string `json:"pexelsPhotoUrls"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.PhotoURL != "https://storage.googleapis.com/test-bucket/photo-0.jpg" {
		t.Fatalf("expected first photo_assets url as photoUrl, got %q", body.PhotoURL)
	}
	if len(body.GooglePhotoURLs) != 2 {
		t.Fatalf("expected 2 googlePhotoUrls, got %+v", body.GooglePhotoURLs)
	}
	if len(body.PexelsPhotoURLs) != 0 {
		t.Fatalf("expected no pexelsPhotoUrls, got %+v", body.PexelsPhotoURLs)
	}
}

// TestHandlePublicGeoPlaceDetails_NoPhotoAssets_OmitsPhotoFields 驗證
// photo_assets 查無紀錄時,回應不會帶出任何照片欄位——不回退舊機制。
func TestHandlePublicGeoPlaceDetails_NoPhotoAssets_OmitsPhotoFields(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I"
	if err := s.store.SetCachedPlaceDetails(placeID, "清水寺", "京都府京都市", 34.9948, 135.785, 4.5, nil); err != nil {
		t.Fatalf("failed to seed place_details_cache: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	if _, ok := raw["photoUrl"]; ok {
		t.Error("expected response to NOT include a photoUrl field")
	}
	if _, ok := raw["googlePhotoUrls"]; ok {
		t.Error("expected response to NOT include a googlePhotoUrls field")
	}
}
