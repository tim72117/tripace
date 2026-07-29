package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/llm"
	"github.com/tim72117/tripace/internal/store"
)

// newTestServer 用記憶體 SQLite 建一個可測試的 Server,不需要外部 Postgres。
func newTestServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open("file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	signer := auth.NewSigner("test-secret", time.Hour)
	return New(st, llm.NewMock(st), signer, true)
}

// TestUserFromToken_DeletedUser 重現一個真實發生過的問題:JWT 簽章有效,
// 但 claims.Sub 對應的使用者已不存在於資料庫(例如資料庫被重建、帳號被
// 刪除)。修復前,userFromToken 會用 token 裡的 claims 偽造一個
// model.User{ID: claims.Sub, ...} 回傳,讓呼叫端誤以為拿到一個通過資料庫
// 驗證的真實使用者——實際上這個 ID 在資料庫裡查無此人。
//
// 期待行為:應該回退成訪客(s.guestUser),而不是偽造一個「看起來存在、實際
// 查無此人」的假身份。
func TestUserFromToken_DeletedUser(t *testing.T) {
	s := newTestServer(t)

	// 簽一把「使用者不存在於資料庫」的 token——刻意不呼叫任何
	// CreateXxxUser,claims.Sub 對應的 usr_ghost 從未被寫入過。
	ghostToken, err := s.signer.Sign("usr_ghost", "ghost")
	if err != nil {
		t.Fatalf("sign ghost token: %v", err)
	}

	got := s.userFromToken(ghostToken)

	if got.ID == "usr_ghost" {
		t.Fatalf("userFromToken 不應偽造查無此人的 usr_ghost 身份,卻回傳 %+v", got)
	}
	if got.ID != s.guestUser.ID {
		t.Fatalf("查無此人的 token 應回退成訪客(%q),卻回傳 %+v", s.guestUser.ID, got)
	}
}

// TestHandleMe_DeletedUser 對應同一個問題在 GET /v1/me 端點上的表現形式:
// 修復前,即使使用者已不存在,handleMe 仍會回 200 並附上偽造的使用者資料,
// 呼叫端(例如前端)無從得知這其實是一個已失效的身份。
//
// 期待行為:應回 401,要求呼叫端重新登入。
func TestHandleMe_DeletedUser(t *testing.T) {
	s := newTestServer(t)

	ghostToken, err := s.signer.Sign("usr_ghost", "ghost")
	if err != nil {
		t.Fatalf("sign ghost token: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+ghostToken)
	rec := httptest.NewRecorder()

	s.handleMe(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("查無此人的 token 呼叫 /v1/me 應回 401,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}
}

// TestHandleApproveCliAuth_DeletedUser 對應同一個問題在 CLI 登入核准流程上
// 最嚴重的表現形式:修復前,一個查無此人的 token 仍能核准成功,並用
// claims.Sub(一個不存在的使用者 ID)重新簽出一把新的 CLI token——等於讓
// 一個空氣身份無限循環延續下去,永遠不會被真正攔下來。
//
// 期待行為:應回 401,不簽發任何新 token,也不應該呼叫
// store.ApproveCliAuth(否則會把這個不存在的登入請求標記為已核准)。
func TestHandleApproveCliAuth_DeletedUser(t *testing.T) {
	s := newTestServer(t)

	ghostToken, err := s.signer.Sign("usr_ghost", "ghost")
	if err != nil {
		t.Fatalf("sign ghost token: %v", err)
	}

	// 先照 handleStartCliAuth 的流程建立一筆待核准的登入請求。
	id, err := s.store.StartCliAuth("http://127.0.0.1:12345/callback", "test-cli")
	if err != nil {
		t.Fatalf("start cli auth: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/cli-auth/"+id+"/approve", nil)
	req.Header.Set("Authorization", "Bearer "+ghostToken)
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()

	s.handleApproveCliAuth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("查無此人的 token 核准 CLI 登入應回 401,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}

	// 這筆登入請求不應該被標記為已核准——之後用同一個 id 呼叫 exchange
	// 應該仍拿不到任何 token。
	if _, ok := s.store.ExchangeCliAuth(id); ok {
		t.Fatal("查無此人的核准請求不應讓這筆 cli-auth request 變成已核准狀態")
	}
}
