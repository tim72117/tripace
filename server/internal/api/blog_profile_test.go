package api

// blog_profile_test.go 測「部落客公開身份」設定端點(/v1/blog/profile,
// 見 blog_profile.go 開頭的完整說明)。
//
// 刻意透過 s.Routes() 打完整的 mux(對齊 blog_photo_test.go/content_page_test.go
// 的既有理由),不直接呼叫 handler 函式——驗證路由字串本身是否正確
// 註冊。測試輔助函式(doRequest 等)直接重用 blog_photo_test.go 已定義
// 的那一份,同一個套件內不重複定義。
import (
	"net/http"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/store"
)

// blogProfileFixture 是「已登入使用者」的測試環境——跟 blogPhotoFixture
// 的差異只在不需要注入假 SignedUploader,這支功能不涉及圖片上傳。
type blogProfileFixture struct {
	srv    *Server
	routes http.Handler
	token  string
	userID string
}

func newBlogProfileFixture(t *testing.T) *blogProfileFixture {
	t.Helper()
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", time.Hour)
	s := New(st, signer, true, "test-google-client-id")

	user, err := s.store.CreatePasswordUser("usr_profile_owner", "設定檔測試員", "#8C7B6A", "profileowner@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &blogProfileFixture{srv: s, routes: s.Routes(), token: token, userID: user.ID}
}

func (f *blogProfileFixture) do(t *testing.T, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	return doRequest(t, f.routes, method, path, body, f.token, wantStatus)
}

func (f *blogProfileFixture) doNoAuth(t *testing.T, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	return doRequest(t, f.routes, method, path, body, "", wantStatus)
}

// TestBlogProfileGet_未登入被拒絕 驗證這個功能不開放訪客使用。
func TestBlogProfileGet_未登入被拒絕(t *testing.T) {
	f := newBlogProfileFixture(t)
	f.doNoAuth(t, "GET", "/v1/blog/profile", nil, http.StatusUnauthorized)
}

// TestBlogProfileGet_已刪除使用者的合法JWT被拒絕 對應 2026-10 code
// review 發現的身份衝突漏洞(見 auth.go requireRealUser 的完整說明):
// JWT 簽章合法,但 claims.Sub 對應的使用者已不存在於資料庫——
// userFor/userFromToken 會悄悄回退成共用的 s.guestUser。這裡驗證
// handleBlogProfileGet 既有的 isGuestUser 檢查(邏輯上等價於
// requireRealUser)確實擋下這個情境,不會被當成訪客、以共用身份放行。
func TestBlogProfileGet_已刪除使用者的合法JWT被拒絕(t *testing.T) {
	f := newBlogProfileFixture(t)
	ghostToken, err := f.srv.signer.Sign("usr_ghost_profile", "ghost")
	if err != nil {
		t.Fatalf("簽 ghost token: %v", err)
	}
	doRequest(t, f.routes, "GET", "/v1/blog/profile", nil, ghostToken, http.StatusUnauthorized)
}

// TestBlogProfileSet_已刪除使用者的合法JWT被拒絕 對應上面 Get 的
// 情境,驗證 POST(建立/更新)也一樣被擋下來——不會被回退成的 guestUser
// 身份當成「某個使用者在設定自己的 profile」而悄悄寫入/覆蓋資料。
func TestBlogProfileSet_已刪除使用者的合法JWT被拒絕(t *testing.T) {
	f := newBlogProfileFixture(t)
	ghostToken, err := f.srv.signer.Sign("usr_ghost_profile_set", "ghost")
	if err != nil {
		t.Fatalf("簽 ghost token: %v", err)
	}
	doRequest(t, f.routes, "POST", "/v1/blog/profile", map[string]any{"handle": "ghost_handle"}, ghostToken, http.StatusUnauthorized)
}

// TestBlogProfileSet_未登入被拒絕 對照上面 Get 的既有理由。
func TestBlogProfileSet_未登入被拒絕(t *testing.T) {
	f := newBlogProfileFixture(t)
	f.doNoAuth(t, "POST", "/v1/blog/profile", map[string]any{"handle": "someone"}, http.StatusUnauthorized)
}

// TestBlogProfileGet_尚未設定時回404 驗證使用者從未呼叫過 set 時,
// GET 回 404(見 handleBlogProfileGet 的完整說明——前端據此顯示「設定
// 表單」而非「編輯表單」)。
func TestBlogProfileGet_尚未設定時回404(t *testing.T) {
	f := newBlogProfileFixture(t)
	f.do(t, "GET", "/v1/blog/profile", nil, http.StatusNotFound)
}

// TestBlogProfileSet_首次設定成功建立 驗證使用者第一次呼叫 set 時走
// 建立分支(201),回應的 userId/handle 正確,且後續 GET 能查到。
func TestBlogProfileSet_首次設定成功建立(t *testing.T) {
	f := newBlogProfileFixture(t)

	created := f.do(t, "POST", "/v1/blog/profile", map[string]any{
		"handle": "tim_test", "avatarUrl": "https://example.com/a.png",
	}, http.StatusCreated)
	if created["handle"] != "tim_test" {
		t.Fatalf("回應的 handle 不符: %v", created)
	}
	if created["userId"] != f.userID {
		t.Fatalf("回應的 userId 不符: %v", created)
	}
	if created["avatarUrl"] != "https://example.com/a.png" {
		t.Fatalf("回應的 avatarUrl 不符: %v", created)
	}

	got := f.do(t, "GET", "/v1/blog/profile", nil, http.StatusOK)
	if got["handle"] != "tim_test" {
		t.Fatalf("GET 查到的 handle 不符: %v", got)
	}
}

// TestBlogProfileSet_已有設定時走更新分支 驗證使用者已經有 profile 時,
// 再次呼叫 set(換一個 handle/頭像)會走 UpdateBlogProfile,回 200
// (不是 201),且查詢結果反映新值、ID 不變(同一筆記錄被更新,而非
// 建立了第二筆)。
func TestBlogProfileSet_已有設定時走更新分支(t *testing.T) {
	f := newBlogProfileFixture(t)

	first := f.do(t, "POST", "/v1/blog/profile", map[string]any{"handle": "old_handle"}, http.StatusCreated)
	firstID := first["id"]

	updated := f.do(t, "POST", "/v1/blog/profile", map[string]any{
		"handle": "new_handle", "avatarUrl": "https://example.com/new.png",
	}, http.StatusOK)
	if updated["handle"] != "new_handle" {
		t.Fatalf("更新後的 handle 不符: %v", updated)
	}
	if updated["id"] != firstID {
		t.Fatalf("更新應該是同一筆記錄,ID 不該改變,got %v want %v", updated["id"], firstID)
	}

	got := f.do(t, "GET", "/v1/blog/profile", nil, http.StatusOK)
	if got["handle"] != "new_handle" {
		t.Fatalf("GET 應該查到更新後的 handle,got: %v", got)
	}
	if got["avatarUrl"] != "https://example.com/new.png" {
		t.Fatalf("GET 應該查到更新後的 avatarUrl,got: %v", got)
	}
}

// TestBlogProfileSet_handle重複時回409 驗證使用者想改成一個已經被
// 其他使用者用掉的 handle 時,會被偵測並回 409(handle_taken),而不是
// 讓底層 unique constraint 違反直接以 500 往外傳(見
// store.UpdateBlogProfile 的完整說明)。這裡涵蓋「建立時衝突」與
// 「更新時衝突」兩種情境。
func TestBlogProfileSet_handle重複時回409(t *testing.T) {
	f := newBlogProfileFixture(t)

	// 另一個使用者先佔用 "taken_handle"。
	other, err := f.srv.store.CreatePasswordUser("usr_profile_other", "另一位使用者", "#112233", "profileother@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := f.srv.store.CreateBlogProfile(other.ID, "taken_handle", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}

	// 情境一:f 使用者第一次設定就想用這個已被佔用的 handle——建立
	// 分支(CreateBlogProfile)應該回 409。
	resp := f.do(t, "POST", "/v1/blog/profile", map[string]any{"handle": "taken_handle"}, http.StatusConflict)
	errBody, ok := resp["error"].(map[string]any)
	if !ok || errBody["code"] != "handle_taken" {
		t.Fatalf("建立時 handle 衝突應該回 handle_taken,got: %v", resp)
	}

	// 情境二:f 使用者已經有自己的 profile,之後想「改成」這個已被
	// 佔用的 handle——更新分支(UpdateBlogProfile)應該也回 409,且
	// f 使用者原本的 handle 不應該被動到。
	f.do(t, "POST", "/v1/blog/profile", map[string]any{"handle": "my_own_handle"}, http.StatusCreated)
	resp2 := f.do(t, "POST", "/v1/blog/profile", map[string]any{"handle": "taken_handle"}, http.StatusConflict)
	errBody2, ok := resp2["error"].(map[string]any)
	if !ok || errBody2["code"] != "handle_taken" {
		t.Fatalf("更新時 handle 衝突應該回 handle_taken,got: %v", resp2)
	}
	got := f.do(t, "GET", "/v1/blog/profile", nil, http.StatusOK)
	if got["handle"] != "my_own_handle" {
		t.Fatalf("衝突的更新不該動到原本的 handle,got: %v", got)
	}
}

// TestBlogProfileSet_改回自己原本的handle不視為衝突 驗證「先查到的
// 那筆剛好是自己」這個邊界——使用者送出跟目前完全相同的 handle(例如
// 只是想改頭像,handle 沒變),不該被誤判成「被別人用掉」而回 409。
func TestBlogProfileSet_改回自己原本的handle不視為衝突(t *testing.T) {
	f := newBlogProfileFixture(t)

	f.do(t, "POST", "/v1/blog/profile", map[string]any{"handle": "stable_handle"}, http.StatusCreated)
	updated := f.do(t, "POST", "/v1/blog/profile", map[string]any{
		"handle": "stable_handle", "avatarUrl": "https://example.com/only-avatar-changed.png",
	}, http.StatusOK)
	if updated["handle"] != "stable_handle" {
		t.Fatalf("handle 應該維持不變,got: %v", updated)
	}
	if updated["avatarUrl"] != "https://example.com/only-avatar-changed.png" {
		t.Fatalf("avatarUrl 應該被更新,got: %v", updated)
	}
}

// TestBlogProfileSet_handle格式驗證 驗證空字串/不合法字元會被 400 擋下。
func TestBlogProfileSet_handle格式驗證(t *testing.T) {
	f := newBlogProfileFixture(t)
	for _, handle := range []string{"", "有中文字", "with space", "slash/here", "a.b"} {
		resp := f.do(t, "POST", "/v1/blog/profile", map[string]any{"handle": handle}, http.StatusBadRequest)
		errBody, ok := resp["error"].(map[string]any)
		if !ok || errBody["code"] != "invalid_input" {
			t.Fatalf("handle=%q 應該回 invalid_input,got: %v", handle, resp)
		}
	}
}
