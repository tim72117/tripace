package adminconsole

// attraction_place_id_check_test.go 測 GET /admin/api/
// attraction-missing-place-id-check(見 checkAttractionMissingPlaceID
// 的完整說明)。跟 photo_target_check_test.go 共用同一套「開一個真的
// httptest.Server + 登入取得 session cookie」測試手法。
import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/model"
)

func TestAttractionMissingPlaceIDCheck_UnauthenticatedRequestIsRejected(t *testing.T) {
	st := newTestStore(t)
	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/admin/api/attraction-missing-place-id-check")
	if err != nil {
		t.Fatalf("unauth GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth GET /admin/api/attraction-missing-place-id-check = %d, want 401", resp.StatusCode)
	}
}

func TestAttractionMissingPlaceIDCheck_ReturnsOnlyMissingPlaceID(t *testing.T) {
	st := newTestStore(t)

	placeID := "ChIJfakeplaceid"

	// has-place-id:有 place_id,不該出現在結果裡。
	if _, err := st.CreateAttraction(model.Attraction{
		Name: "有地點ID的景點", CityName: "京都", Lat: 35, Lng: 135,
		PlaceID: &placeID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}
	// missing-place-id-is-theme:place_id 為 nil、IsTheme 為 true——
	// 應該出現在結果裡。
	if _, err := st.CreateAttraction(model.Attraction{
		Name: "缺地點ID的主題點", CityName: "京都", Lat: 35, Lng: 135,
		IsTheme: true,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}
	// missing-place-id-empty-string:place_id 是空字串(而非 nil)——
	// 同樣視為缺少,應該出現在結果裡。
	emptyPlaceID := ""
	if _, err := st.CreateAttraction(model.Attraction{
		Name: "缺地點ID也非主題點", CityName: "台北", Lat: 25, Lng: 121,
		PlaceID: &emptyPlaceID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	const email = "attraction-place-id-check-test@example.com"
	const password = "supersecret123"
	auth := adminauth.New(st, false)
	if _, err := auth.Bootstrap(email, password); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}
	loginResp, err := client.Post(srv.URL+"/admin/api/login", "application/json",
		strings.NewReader(`{"email":"`+email+`","password":"`+password+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login = %d, want 200", loginResp.StatusCode)
	}

	resp, err := client.Get(srv.URL + "/admin/api/attraction-missing-place-id-check")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /admin/api/attraction-missing-place-id-check = %d, want 200", resp.StatusCode)
	}
	var got attractionMissingPlaceIDResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Attractions) != 2 {
		t.Fatalf("expected 2 attractions missing place_id, got %d: %+v", len(got.Attractions), got.Attractions)
	}
	byName := map[string]attractionMissingPlaceIDRow{}
	for _, a := range got.Attractions {
		byName[a.Name] = a
	}
	isThemeRow, ok := byName["缺地點ID的主題點"]
	if !ok {
		t.Fatalf("expected 缺地點ID的主題點 in results, got %+v", got.Attractions)
	}
	if !isThemeRow.IsTheme {
		t.Fatalf("expected IsTheme=true for 缺地點ID的主題點, got %+v", isThemeRow)
	}
	if _, ok := byName["缺地點ID也非主題點"]; !ok {
		t.Fatalf("expected 缺地點ID也非主題點 in results, got %+v", got.Attractions)
	}
	if _, ok := byName["有地點ID的景點"]; ok {
		t.Fatalf("attraction with place_id should not appear in results, got %+v", got.Attractions)
	}
}

// TestRefetchAttractionPlaceID 只涵蓋不需要真的打 Google Places API 的
// 邊界情況(未登入/缺 id/找不到景點)——refetchAttractionPlaceID 內部
// 用 geo.New(apiKey) 建立真實 client,沒有可注入的 mock transport,「查詢
// 成功並寫回」這條主要路徑無法在單元測試裡驗證,這是既有 codebase 對這
// 類維運端點(如 handleMaintenanceGeocode)一貫的既有模式,不是這個
// handler 特有的測試缺口。
func TestRefetchAttractionPlaceID_UnauthenticatedRequestIsRejected(t *testing.T) {
	st := newTestStore(t)
	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/admin/api/attraction-missing-place-id-check/refetch", "application/json",
		strings.NewReader(`{"id":"lmk_x"}`))
	if err != nil {
		t.Fatalf("unauth POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth POST /admin/api/attraction-missing-place-id-check/refetch = %d, want 401", resp.StatusCode)
	}
}

func TestRefetchAttractionPlaceID_MissingIDReturns400(t *testing.T) {
	st := newTestStore(t)
	const email = "refetch-place-id-missing-id@example.com"
	const password = "supersecret123"
	auth := adminauth.New(st, false)
	if _, err := auth.Bootstrap(email, password); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}
	loginResp, err := client.Post(srv.URL+"/admin/api/login", "application/json",
		strings.NewReader(`{"email":"`+email+`","password":"`+password+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	loginResp.Body.Close()

	resp, err := client.Post(srv.URL+"/admin/api/attraction-missing-place-id-check/refetch", "application/json",
		strings.NewReader(`{"id":""}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST with empty id = %d, want 400", resp.StatusCode)
	}
}

func TestRefetchAttractionPlaceID_UnknownIDReturns404(t *testing.T) {
	st := newTestStore(t)
	const email = "refetch-place-id-unknown-id@example.com"
	const password = "supersecret123"
	auth := adminauth.New(st, false)
	if _, err := auth.Bootstrap(email, password); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}
	loginResp, err := client.Post(srv.URL+"/admin/api/login", "application/json",
		strings.NewReader(`{"email":"`+email+`","password":"`+password+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	loginResp.Body.Close()

	// lmk_does_not_exist 從未被 CreateAttraction 建立過——GetAttraction
	// 應該直接回錯誤,不會走到後面真的打 Google Places API 的邏輯。
	resp, err := client.Post(srv.URL+"/admin/api/attraction-missing-place-id-check/refetch", "application/json",
		strings.NewReader(`{"id":"lmk_does_not_exist"}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("POST with unknown id = %d, want 404", resp.StatusCode)
	}
}
