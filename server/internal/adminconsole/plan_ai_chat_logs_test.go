package adminconsole

// plan_ai_chat_logs_test.go 測 GET /admin/api/plan-ai-chat-logs(見
// listPlanAiChatLogs 的完整說明)。跟 attraction_place_id_check_test.go
// 共用同一套「開一個真的 httptest.Server + 登入取得 session cookie」測試
// 手法。

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

func TestPlanAiChatLogs_UnauthenticatedRequestIsRejected(t *testing.T) {
	st := newTestStore(t)
	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/admin/api/plan-ai-chat-logs")
	if err != nil {
		t.Fatalf("unauth GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth GET /admin/api/plan-ai-chat-logs = %d, want 401", resp.StatusCode)
	}
}

// adminLoggedInClient 登入一個新建的管理員帳號,回傳帶有有效 session cookie
// 的 http.Client,供後續 authed 呼叫使用。
func adminLoggedInClient(t *testing.T, srv *httptest.Server, auth *adminauth.Store) *http.Client {
	t.Helper()
	const email = "plan-ai-chat-logs-test@example.com"
	const password = "supersecret123"
	if _, err := auth.Bootstrap(email, password); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}
	resp, err := client.Post(srv.URL+"/admin/api/login", "application/json",
		strings.NewReader(`{"email":"`+email+`","password":"`+password+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login = %d, want 200", resp.StatusCode)
	}
	return client
}

func TestPlanAiChatLogs_ReturnsMessagesNewestFirstWithUserEmail(t *testing.T) {
	st := newTestStore(t)

	// 一個帶 email 的使用者,寫兩筆訊息——回應應該帶出這個 email
	// (userEmail),驗證 listPlanAiChatLogs 透過 ListUsers 建的
	// emailByUserID 對照表有正確生效。
	if _, err := st.CreatePasswordUser("usr_1", "有信箱的使用者", "#fff", "usr-with-email@example.com", "hash"); err != nil {
		t.Fatalf("create password user: %v", err)
	}

	if _, err := st.InsertPlanAiChatMessage("usr_1", "conv_1", "user", "第一句"); err != nil {
		t.Fatalf("insert msg1: %v", err)
	}
	if _, err := st.InsertPlanAiChatMessage("usr_1", "conv_1", "assistant", "第二句"); err != nil {
		t.Fatalf("insert msg2: %v", err)
	}

	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := adminLoggedInClient(t, srv, auth)

	resp, err := client.Get(srv.URL + "/admin/api/plan-ai-chat-logs")
	if err != nil {
		t.Fatalf("authed GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authed GET /admin/api/plan-ai-chat-logs = %d, want 200", resp.StatusCode)
	}

	var got planAiChatLogsResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Total != 2 {
		t.Fatalf("total = %d, want 2", got.Total)
	}
	if len(got.Messages) != 2 {
		t.Fatalf("messages 筆數 = %d, want 2", len(got.Messages))
	}
	// 降冪排序:最新寫入(第二句)在前。
	if got.Messages[0].Content != "第二句" {
		t.Fatalf("第一筆內容 = %q, want 第二句", got.Messages[0].Content)
	}
	if got.Messages[1].Content != "第一句" {
		t.Fatalf("第二筆內容 = %q, want 第一句", got.Messages[1].Content)
	}
	// userEmail 應該透過 ListUsers 對照表正確帶出。
	if got.Messages[0].UserEmail != "usr-with-email@example.com" {
		t.Fatalf("userEmail = %q, want usr-with-email@example.com", got.Messages[0].UserEmail)
	}
}

func TestPlanAiChatLogs_LimitCapsReturnedCount(t *testing.T) {
	st := newTestStore(t)
	if err := st.UpsertUser(model.User{ID: "usr_1", Name: "測試使用者"}); err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, err := st.InsertPlanAiChatMessage("usr_1", "conv_1", "user", "訊息"); err != nil {
			t.Fatalf("insert message %d: %v", i, err)
		}
	}

	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := adminLoggedInClient(t, srv, auth)

	resp, err := client.Get(srv.URL + "/admin/api/plan-ai-chat-logs?limit=2")
	if err != nil {
		t.Fatalf("authed GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authed GET = %d, want 200", resp.StatusCode)
	}

	var got planAiChatLogsResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Total != 2 {
		t.Fatalf("limit=2 時 total = %d, want 2", got.Total)
	}
}
