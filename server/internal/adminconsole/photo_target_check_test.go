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
}
