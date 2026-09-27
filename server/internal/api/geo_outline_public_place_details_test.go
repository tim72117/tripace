package api

// geo_outline_public_place_details_test.go 測 GET /public/geo/place-details
// (handlePublicGeoPlaceDetails)——免登入版,供主題介紹頁(如
// JiufenPage.tsx/TainanPage.tsx,見 InteractiveExploreMap.tsx 的呼叫端)
// 查詢已建檔景點的完整資料。
//
// 2026-09 重構:這支端點改成直接委派給 handleGeoPlaceDetails(登入後
// 正式規劃功能共用、內建漸進補圖決策的核心函式),不再維護一份獨立的
// 簡化實作——授權機制也從逐一手動列舉的靜態白名單改成「這個 placeID
// 必須是已建檔的 attraction 才放行」(store.GetAttractionByPlaceID 查
// 得到),見 handlePublicGeoPlaceDetails 的完整說明。這裡的測試因此都
// 先用 store.CreateAttraction 建立對應的 attraction 紀錄,模擬「已建檔
// 景點」這個授權前提成立的情境。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

// seedAttractionForPlaceID 建一筆最小可用的 attraction 紀錄,讓
// handlePublicGeoPlaceDetails 的授權檢查(store.GetAttractionByPlaceID)
// 能通過——這裡的 Name/CityName/Lat/Lng 等欄位值本身不影響測試驗證的
// 行為(那些交給下面各測試各自準備的 place_details_cache/photo_assets
// 資料),純粹是滿足 CreateAttraction 必要欄位、讓這個 placeID 被視為
// 已建檔的最小前提。
func seedAttractionForPlaceID(t *testing.T, s *Server, placeID string) {
	t.Helper()
	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "測試景點", CityName: "測試城市", Lat: 0, Lng: 0,
		Level: 1, IsTheme: true, PlaceID: &placeID,
	}); err != nil {
		t.Fatalf("seedAttractionForPlaceID: CreateAttraction failed: %v", err)
	}
}

func TestHandlePublicGeoPlaceDetails_NotAttraction_Returns403(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId=ChIJ-not-an-attraction", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for placeId not an attraction, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoPlaceDetails_EmptyPlaceID_Returns403(t *testing.T) {
	s := newTestServer(t)

	// 沒帶 placeId 查詢參數——GetAttractionByPlaceID("") 自然查無這筆
	// 紀錄,不需要另外特判空字串,但這裡明確測一次確保這個邊界情況真的
	// 落在「拒絕」分支。
	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for empty placeId, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoPlaceDetails_IsAttraction_UsesCachedTextDetails 驗證
// 已建檔為 attraction 的 placeId,文字資料(name/address/lat/lng/summary)
// 命中 place_details_cache 時直接回傳,不需要真的打 Google API——用
// 「測試環境沒有網路/API key,若真的觸發即時查詢會失敗」這個前提間接
// 證明快取命中路徑完全不依賴外部連線。
func TestHandlePublicGeoPlaceDetails_IsAttraction_UsesCachedTextDetails(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I"
	seedAttractionForPlaceID(t, s, placeID)
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
// 文字資料未命中快取時,這支端點(透過 handleGeoPlaceDetails)會嘗試即時
// 查 Google——測試環境沒有 GOOGLE_PLACES_API_KEY/網路,預期得到 502
// (而不是 200 或吞掉錯誤靜默回傳空資料),確認未命中分支真的有嘗試
// 查詢、且查詢失敗會誠實回報,不是靜默降級。
func TestHandlePublicGeoPlaceDetails_NoCacheAndNoNetwork_ReturnsBadGateway(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I"
	seedAttractionForPlaceID(t, s, placeID)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 when cache miss and no network available, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoPlaceDetails_UsesPhotoAssetsForPhotos 驗證照片一律
// 只查 photo_assets(見 applyPhotoAssetsAsSource 的完整說明,
// handleGeoPlaceDetails 與這支端點現在共用同一套邏輯)——有效期內的
// 紀錄要組成 googlePhotoUrls 多圖清單、且 photoUrl 是第一張,不回退
// google_place_photos(2026-09 已移除 Pexels 讀圖來源,回應不再有
// pexelsPhotoUrls 欄位)。
func TestHandlePublicGeoPlaceDetails_UsesPhotoAssetsForPhotos(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I"
	seedAttractionForPlaceID(t, s, placeID)
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
	// 2026-09 已移除 Pexels 讀圖來源,回應本身不再有 pexelsPhotoUrls 這個
	// JSON key——確認原始 body 不含這個欄位,而不是解碼到一個永遠不會被
	// 填的型別欄位、驗證恆真的舊寫法。
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	if _, ok := raw["pexelsPhotoUrls"]; ok {
		t.Error("expected response to NOT include a pexelsPhotoUrls field")
	}
}

// TestHandlePublicGeoPlaceDetails_NoPhotoAssets_OmitsPhotoFields 驗證
// photo_assets 查無紀錄時,回應不會帶出任何照片欄位——不回退舊機制。
func TestHandlePublicGeoPlaceDetails_NoPhotoAssets_OmitsPhotoFields(t *testing.T) {
	s := newTestServer(t)

	placeID := "ChIJB_vchdMIAWARujTEUIZlr2I"
	seedAttractionForPlaceID(t, s, placeID)
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
