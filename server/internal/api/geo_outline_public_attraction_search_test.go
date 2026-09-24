package api

// geo_outline_public_attraction_search_test.go 測
// GET /public/geo/attraction-search(handlePublicGeoAttractionSearch)——
// 資料庫候選少於 minNearbyAttractionResults(10)時,額外用 Google
// Nearby Search 補上不重複的點,統一以 placeId 當識別碼回傳。
import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// fakeNearbySearchGateway 滿足 geo 套件內部未匯出的 requestDoer 介面
// (見 geo_outline_geocode_test.go 的 fakeSearchTextGateway 說明,同一種
// 隱式介面滿足模式),只支援 "places.searchNearby" 這個 endpoint。
type fakeNearbySearchGateway struct {
	response string
	calls    int
}

func (g *fakeNearbySearchGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	if endpoint != "places.searchNearby" {
		panic("fakeNearbySearchGateway 只支援 places.searchNearby,收到: " + endpoint)
	}
	g.calls++
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader([]byte(g.response))),
	}, nil
}

// nearbyPlacesJSON 組一份 Nearby Search 回應 body,每個 (name, placeID)
// 對應一筆假候選地點。
func nearbyPlacesJSON(entries ...[2]string) string {
	type place struct {
		Id          string `json:"id"`
		DisplayName struct {
			Text string `json:"text"`
		} `json:"displayName"`
		FormattedAddress string `json:"formattedAddress"`
		Location         struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"location"`
	}
	places := make([]place, len(entries))
	for i, e := range entries {
		places[i].Id = e[1]
		places[i].DisplayName.Text = e[0]
		places[i].FormattedAddress = "測試地址"
		places[i].Location.Latitude = 23.0
		places[i].Location.Longitude = 120.2
	}
	b, err := json.Marshal(map[string]any{"places": places})
	if err != nil {
		panic(err)
	}
	return string(b)
}

// newAttractionSearchFixture 建一個 Server,把 newGeoGeocodeClient 換成
// 回傳「內部 gateway 是 fakeGateway」的 geo.Client(理由同
// newTestServerWithFakeGeoGateway 的完整說明)。這支端點不掛
// internalAuth(見 handlePublicGeoAttractionSearch 的完整說明),測試
// 不需要登入 token。
func newAttractionSearchFixture(t *testing.T, fakeGateway *fakeNearbySearchGateway) (*Server, http.Handler) {
	t.Helper()
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newGeoGeocodeClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	return s, s.Routes()
}

func getAttractionSearch(t *testing.T, routes http.Handler, lat, lng float64) (*http.Response, map[string]any) {
	t.Helper()
	url := fmt.Sprintf("/public/geo/attraction-search?lat=%g&lng=%g", lat, lng)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var body map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&body)
	}
	return resp, body
}

// TestHandlePublicGeoAttractionSearch_MissingLatLng_Returns400 對應缺少
// 必要查詢參數的防呆——不嘗試查資料庫或打任何外部 API。
func TestHandlePublicGeoAttractionSearch_MissingLatLng_Returns400(t *testing.T) {
	fakeGateway := &fakeNearbySearchGateway{}
	_, routes := newAttractionSearchFixture(t, fakeGateway)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attraction-search", nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("狀態碼 = %d,期待 400", rec.Code)
	}
	if fakeGateway.calls != 0 {
		t.Errorf("缺少 lat/lng 時不該呼叫任何 Google API,實際呼叫了 %d 次", fakeGateway.calls)
	}
}

// TestHandlePublicGeoAttractionSearch_EnoughDBResults_SkipsGoogleCall
// 對應資料庫候選已經達到 minNearbyAttractionResults(10)門檻的情境——
// 完全不該打 Google Nearby Search,維持零成本。
func TestHandlePublicGeoAttractionSearch_EnoughDBResults_SkipsGoogleCall(t *testing.T) {
	fakeGateway := &fakeNearbySearchGateway{}
	s, routes := newAttractionSearchFixture(t, fakeGateway)

	for i := 0; i < minNearbyAttractionResults; i++ {
		placeID := "place_db_" + string(rune('a'+i))
		if _, err := s.store.CreateAttraction(model.Attraction{
			Name: "資料庫景點", CityName: "台南", Lat: 23.0 + float64(i)*0.001, Lng: 120.2, PlaceID: &placeID,
		}); err != nil {
			t.Fatalf("CreateAttraction failed: %v", err)
		}
	}

	resp, body := getAttractionSearch(t, routes, 23.0, 120.2)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if fakeGateway.calls != 0 {
		t.Errorf("資料庫候選已滿 %d 筆時不該呼叫 Google Nearby Search,實際呼叫了 %d 次", minNearbyAttractionResults, fakeGateway.calls)
	}
	attractions, _ := body["attractions"].([]any)
	if len(attractions) != minNearbyAttractionResults {
		t.Errorf("attractions 應該有 %d 筆,實際 = %d", minNearbyAttractionResults, len(attractions))
	}
}

// TestHandlePublicGeoAttractionSearch_FewDBResults_FillsWithGoogleNearby
// 對應資料庫候選不足 10 筆的核心情境——用 Google Nearby Search 補上
// 不重複的點,統一以 placeId 當識別碼回傳(不含 id)。
func TestHandlePublicGeoAttractionSearch_FewDBResults_FillsWithGoogleNearby(t *testing.T) {
	dbPlaceID := "place_db_1"
	fakeGateway := &fakeNearbySearchGateway{
		response: nearbyPlacesJSON(
			[2]string{"資料庫景點", dbPlaceID}, // 跟資料庫候選同一個 place_id,應被去重排除
			[2]string{"Google補上的景點A", "place_google_a"},
			[2]string{"Google補上的景點B", "place_google_b"},
		),
	}
	s, routes := newAttractionSearchFixture(t, fakeGateway)

	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "資料庫景點", CityName: "台南", Lat: 23.0, Lng: 120.2, PlaceID: &dbPlaceID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	resp, body := getAttractionSearch(t, routes, 23.0, 120.2)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if fakeGateway.calls != 1 {
		t.Fatalf("資料庫候選只有 1 筆(< 10)時應該呼叫一次 Google Nearby Search,實際呼叫了 %d 次", fakeGateway.calls)
	}

	attractions, ok := body["attractions"].([]any)
	if !ok || len(attractions) != 3 {
		t.Fatalf("attractions 應該有 3 筆(1 筆資料庫 + 2 筆 Google 補上、去重掉重複的 1 筆),實際 = %v", body["attractions"])
	}

	placeIDs := make(map[string]bool, len(attractions))
	for _, a := range attractions {
		m := a.(map[string]any)
		placeID, _ := m["placeId"].(string)
		if placeID == "" {
			t.Errorf("每一筆候選都應該帶 placeId,實際 = %v", m)
		}
		placeIDs[placeID] = true
	}
	if !placeIDs[dbPlaceID] || !placeIDs["place_google_a"] || !placeIDs["place_google_b"] {
		t.Errorf("應該包含資料庫候選 + 2 筆 Google 補上的候選,實際 placeIDs = %v", placeIDs)
	}
}

// TestHandlePublicGeoAttractionSearch_GoogleCallFails_KeepsDBResults 對應
// Google Nearby Search 查詢失敗的降級情境——維持已經查到的資料庫候選,
// 不讓整支端點失敗。
func TestHandlePublicGeoAttractionSearch_GoogleCallFails_KeepsDBResults(t *testing.T) {
	// GOOGLE_PLACES_API_KEY 故意留空字串(不呼叫 t.Setenv)——
	// geo.Client.SearchNearby 在 apiKey 為空時直接回 geo.ErrNoKey,不會
	// 真的呼叫 gateway.Do,模擬查詢失敗的情境。
	dbPlaceID := "place_db_1"
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	routes := s.Routes()

	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "資料庫景點", CityName: "台南", Lat: 23.0, Lng: 120.2, PlaceID: &dbPlaceID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	resp, body := getAttractionSearch(t, routes, 23.0, 120.2)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	attractions, ok := body["attractions"].([]any)
	if !ok || len(attractions) != 1 {
		t.Fatalf("Google 查詢失敗時應該維持已查到的 1 筆資料庫候選,實際 = %v", body["attractions"])
	}
}

// TestHandlePublicGeoAttractionSearch_RateLimited_KeepsDBResults 對應
// nearbyAttractionSearchLimiter(見 Server struct 上該欄位的完整說明)
// 拒絕這次 Google Nearby Search 呼叫的情境——連續呼叫兩次,第二次應該
// 被限流擋下,但仍正常回傳 200 + 已查到的資料庫候選,不讓整支端點失敗,
// 也不會真的打出第二次 Google API 呼叫。同時驗證這支端點的限流跟
// publicPlaceSearchLimiter(保護另一支端點)是獨立的兩個實例,不互相
// 共用視窗計數(使用者明確要求「這個端點加入獨立的請求數量限制」)。
func TestHandlePublicGeoAttractionSearch_RateLimited_KeepsDBResults(t *testing.T) {
	dbPlaceID := "place_db_1"
	fakeGateway := &fakeNearbySearchGateway{
		response: nearbyPlacesJSON([2]string{"Google補上的景點", "place_google_a"}),
	}
	s, routes := newAttractionSearchFixture(t, fakeGateway)

	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "資料庫景點", CityName: "台南", Lat: 23.0, Lng: 120.2, PlaceID: &dbPlaceID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	// 第一次呼叫:限流視窗內的第一次,應該正常觸發 Google Nearby Search。
	resp1, body1 := getAttractionSearch(t, routes, 23.0, 120.2)
	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("第一次呼叫狀態碼 = %d,期待 200;body=%v", resp1.StatusCode, body1)
	}
	if fakeGateway.calls != 1 {
		t.Fatalf("第一次呼叫應該觸發 1 次 Google Nearby Search,實際 = %d", fakeGateway.calls)
	}
	attractions1, _ := body1["attractions"].([]any)
	if len(attractions1) != 2 {
		t.Fatalf("第一次呼叫應該有 2 筆(1 筆資料庫 + 1 筆 Google 補上),實際 = %v", body1["attractions"])
	}

	// 第二次呼叫:同一個視窗內,nearbyAttractionSearchLimiter 應該拒絕
	// 這次呼叫——不再打 Google API,但仍正常回傳資料庫候選。
	resp2, body2 := getAttractionSearch(t, routes, 23.0, 120.2)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("第二次呼叫狀態碼 = %d,期待 200(限流拒絕不當作錯誤回應);body=%v", resp2.StatusCode, body2)
	}
	if fakeGateway.calls != 1 {
		t.Errorf("第二次呼叫應該被限流擋下,不再觸發 Google API,實際累計呼叫次數 = %d", fakeGateway.calls)
	}
	attractions2, _ := body2["attractions"].([]any)
	if len(attractions2) != 1 {
		t.Errorf("第二次呼叫被限流時應該只回傳已查到的 1 筆資料庫候選,實際 = %v", body2["attractions"])
	}
}
