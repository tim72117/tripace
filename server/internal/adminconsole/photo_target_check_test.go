package adminconsole

// photo_target_check_test.go 測 GET /admin/api/photo-target-zero-check
// (見 checkPhotoTargetZero 的完整說明)。跟 geo_rate_limits_test.go 共用
// 同一套「開一個真的 httptest.Server + 登入取得 session cookie」測試
// 手法。
import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/adminauth"
)

func TestPhotoTargetZeroCheck_UnauthenticatedRequestIsRejected(t *testing.T) {
	st := newTestStore(t)
	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/admin/api/photo-target-zero-check")
	if err != nil {
		t.Fatalf("unauth GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth GET /admin/api/photo-target-zero-check = %d, want 401", resp.StatusCode)
	}
}

func TestPhotoTargetZeroCheck_ReturnsOnlyZeroTargetPlaces(t *testing.T) {
	st := newTestStore(t)

	// never-confirmed:sentinel -1,不該出現在結果裡。
	if err := st.SetCachedPlaceDetails("place-never-confirmed", "尚未確認", "", 0, 0, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// confirmed-zero:已確認過、真的沒有照片,應該出現在結果裡。
	if err := st.SetCachedPlaceDetails("place-confirmed-zero", "確認過沒照片", "", 0, 0, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	if err := st.UpdatePlacePhotoProgress("place-confirmed-zero", 0, 0, true); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}

	const email = "photo-target-check-test@example.com"
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

	resp, err := client.Get(srv.URL + "/admin/api/photo-target-zero-check")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /admin/api/photo-target-zero-check = %d, want 200", resp.StatusCode)
	}
	var got photoTargetZeroCheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Places) != 1 || got.Places[0].PlaceID != "place-confirmed-zero" {
		t.Fatalf("expected exactly [place-confirmed-zero], got %+v", got.Places)
	}
	// GooglePhotoTargetCount:2026-09 新增欄位,供後台介面直接顯示這個
	// 數值本身(見該欄位的完整說明)——這份清單本身已經用 WHERE 限定只
	// 回傳這個欄位恰好是 0 的紀錄,故這裡驗證的重點是「有沒有把值正確
	// 帶出來」,不是驗證查詢條件本身(那是上面 len/PlaceID 斷言的職責)。
	if got.Places[0].GooglePhotoTargetCount != 0 {
		t.Fatalf("expected GooglePhotoTargetCount=0, got %d", got.Places[0].GooglePhotoTargetCount)
	}
}

func TestResetPhotoTarget_UnauthenticatedRequestIsRejected(t *testing.T) {
	st := newTestStore(t)
	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/admin/api/photo-target-zero-check/reset", "application/json",
		strings.NewReader(`{"placeId":"place-x"}`))
	if err != nil {
		t.Fatalf("unauth POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth POST /admin/api/photo-target-zero-check/reset = %d, want 401", resp.StatusCode)
	}
}

func TestResetPhotoTarget_ResetsToSentinelAndZeroesNewPhotoCount(t *testing.T) {
	st := newTestStore(t)

	// 模擬一筆卡住的舊資料:target=0、但 new_photo_count 不是 0(正常
	// 流程下這種組合不該出現,這裡刻意製造出來驗證重置動作會把兩者都
	// 修正,不是只改 target 留著不一致的 new_photo_count)。
	if err := st.SetCachedPlaceDetails("place-stuck", "卡住的地點", "", 0, 0, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	if err := st.UpdatePlacePhotoProgress("place-stuck", 2, 0, true); err != nil {
		t.Fatalf("seed UpdatePlacePhotoProgress failed: %v", err)
	}

	const email = "reset-photo-target-test@example.com"
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

	resp, err := client.Post(srv.URL+"/admin/api/photo-target-zero-check/reset", "application/json",
		strings.NewReader(`{"placeId":"place-stuck"}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /admin/api/photo-target-zero-check/reset = %d, want 200", resp.StatusCode)
	}

	cached, ok, err := st.GetCachedPlaceDetails("place-stuck", 24*3600*1e9)
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok {
		t.Fatal("expected place-stuck row to still exist after reset")
	}
	if cached.GooglePhotoTargetCount != -1 {
		t.Fatalf("expected GooglePhotoTargetCount reset to -1, got %d", cached.GooglePhotoTargetCount)
	}
	if cached.NewPhotoCount != 0 {
		t.Fatalf("expected NewPhotoCount reset to 0, got %d", cached.NewPhotoCount)
	}
}

func TestResetPhotoTarget_UnknownPlaceIDReturns404(t *testing.T) {
	st := newTestStore(t)
	const email = "reset-photo-target-unknown-id@example.com"
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

	// place-does-not-exist 從未被 SetCachedPlaceDetails 建立過——模擬
	// 管理員打錯字，或針對一個從未被快取過的 placeId 呼叫 reset。沒有這
	// 個檢查以前，UpdatePlacePhotoProgress 對不存在的 WHERE 條件仍會
	// 靜默回報成功（見 resetPhotoTarget 的完整說明），這裡驗證修正後
	// 的行為：明確回 404，而不是誤導操作者以為真的重置到了什麼。
	resp, err := client.Post(srv.URL+"/admin/api/photo-target-zero-check/reset", "application/json",
		strings.NewReader(`{"placeId":"place-does-not-exist"}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("POST with unknown placeId = %d, want 404", resp.StatusCode)
	}
}

func TestResetPhotoTarget_MissingPlaceIDReturns400(t *testing.T) {
	st := newTestStore(t)
	const email = "reset-photo-target-missing-id@example.com"
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

	resp, err := client.Post(srv.URL+"/admin/api/photo-target-zero-check/reset", "application/json",
		strings.NewReader(`{"placeId":""}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST with empty placeId = %d, want 400", resp.StatusCode)
	}
}
