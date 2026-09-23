package api

// geo_outline_public_place_details_any_test.go 測
// GET /public/geo/place-details-any(handlePublicGeoPlaceDetailsAny)——
// 免登入版、不受 publicPlaceDetailsAllowlist 限制的地點詳情查詢,供
// /plan-ai 的 add_attraction 工具查任意 placeId 用(見該 handler 的
// 完整說明)。
//
// 複用 geo_outline_place_photo_progress_test.go 的 fakePlaceDetailsGateway/
// placeDetailsJSON——這支 handler 跟 handleGeoPlaceDetails 一樣呼叫
// client.GetPlaceDetails(對應 "places.get" endpoint),同一套假 gateway
// 機制可以直接重用,只是這裡改把 newGeoGeocodeClient(而非
// newPlaceDetailsClient)換成假 gateway,因為 handlePublicGeoPlaceDetailsAny
// 是透過前者取得 client(比照 handlePublicGeoPlaceSearch 的既有模式)。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// newTestServerWithFakePlaceDetailsGeoGeocodeClient 建一個 Server,把
// newGeoGeocodeClient(不是 newPlaceDetailsClient)換成「內部 gateway 是
// fakeGateway」的 geo.Client——handlePublicGeoPlaceDetailsAny 因此可以
// 整支被驗證,不會真的打 Google API。
func newTestServerWithFakePlaceDetailsGeoGeocodeClient(t *testing.T, fakeGateway *fakePlaceDetailsGateway) *Server {
	t.Helper()
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newGeoGeocodeClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	return s
}

func TestHandlePublicGeoPlaceDetailsAny_MissingPlaceId_Returns400(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing placeId, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoPlaceDetailsAny_NotInAllowlist_StillSucceeds 是這支
// 端點存在的核心理由:傳一個完全不在 publicPlaceDetailsAllowlist 裡的
// placeId(這裡用「不存在」是刻意的,證明這支端點根本不檢查那份白名單),
// 仍然要成功回傳結果——對比 handlePublicGeoPlaceDetails(受白名單限制的
// 舊端點)會回 403,這支新端點完全不做這個檢查。
func TestHandlePublicGeoPlaceDetailsAny_NotInAllowlist_StillSucceeds(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("河岸咖啡", 0)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	notWhitelistedPlaceID := "ChIJ_not_in_any_allowlist_xyz"
	if publicPlaceDetailsAllowlist[notWhitelistedPlaceID] {
		t.Fatalf("test setup invalid: placeId unexpectedly present in publicPlaceDetailsAllowlist")
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+notWhitelistedPlaceID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for placeId not in allowlist, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found   bool   `json:"found"`
		Name    string `json:"name"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "河岸咖啡" || body.Summary != "測試簡介" {
		t.Fatalf("unexpected response: %+v", body)
	}
}

// Google fallback 路徑(attractions 表查無這個 placeId 時)刻意不回傳
// 照片(見 handlePublicGeoPlaceDetailsAny 的完整說明,不重用漸進補圖/
// 雙來源照片機制)——確認回應本身不會意外多出任何照片相關欄位。
func TestHandlePublicGeoPlaceDetailsAny_NoPhotosField_ResponseOmitsPhotos(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("測試地點", 3)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId=ChIJtest", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

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
	if _, ok := raw["photoRefs"]; ok {
		t.Error("expected response to NOT include a photoRefs field")
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_SkipsGoogleAndReturnsStoredData
// 驗證 2026-09 新增的「優先查 attractions 表」路徑(見 handler 的完整
// 說明):attractions 表已有這個 placeId 的建檔紀錄時,直接回傳存好的
// Name/Summary/PhotoURL,完全不呼叫 fakeGateway——用「fakeGateway 沒設
// detailsBody,若真的被呼叫會回傳空 body 導致解析失敗」這個手法間接
// 證明 Google 完全沒被打到,不需要額外的呼叫次數計數器。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_SkipsGoogleAndReturnsStoredData(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_attraction_record_test"
	summary := "已建檔景點的簡介"
	photoURL := "https://example.com/photo.jpg"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_test_place_details_any",
		Name:     "已建檔景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		Summary:  &summary,
		PhotoURL: &photoURL,
		PlaceID:  &placeID,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found    bool   `json:"found"`
		Name     string `json:"name"`
		Summary  string `json:"summary"`
		PhotoURL string `json:"photoUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "已建檔景點" || body.Summary != "已建檔景點的簡介" || body.PhotoURL != photoURL {
		t.Fatalf("unexpected response: %+v", body)
	}
}
