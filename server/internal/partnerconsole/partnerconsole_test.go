package partnerconsole

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/store"
)

func TestHasBadText(t *testing.T) {
	if hasBadText("北海道溫泉 函館夜景 5日", "", "$21,900 ｜＋") {
		t.Fatal("正常文字不該被擋")
	}
	if !hasBadText("ok", "a�b") {
		t.Fatal("含 U+FFFD 應被擋")
	}
	if !hasBadText("a\xffb") {
		t.Fatal("非法 UTF-8 應被擋")
	}
}

type testEnv struct {
	t      *testing.T
	mux    *http.ServeMux
	tokens map[string]string
}

func newEnv(t *testing.T, users ...string) *testEnv {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	signer := auth.NewSigner("test-secret", time.Hour)
	env := &testEnv{t: t, mux: http.NewServeMux(), tokens: map[string]string{}}
	for _, u := range users {
		if _, err := st.CreatePartner(u, "業主 "+u); err != nil {
			t.Fatalf("CreatePartner: %v", err)
		}
		tok, err := signer.Sign(u, u)
		if err != nil {
			t.Fatalf("Sign: %v", err)
		}
		env.tokens[u] = tok
	}
	NewHandler(signer, st).Register(env.mux)
	return env
}

func (e *testEnv) do(user, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Authorization", "Bearer "+e.tokens[user])
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	out := map[string]any{}
	if rec.Body.Len() > 0 {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return rec.Code, out
}

func errCode(m map[string]any) string {
	e, _ := m["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

func TestCorruptedTextIsRejectedAndNotStored(t *testing.T) {
	env := newEnv(t, "usr_a")
	const bad = "亂�碼"

	code, camp := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": "好活動"})
	if code != http.StatusCreated {
		t.Fatalf("建立活動 = %d", code)
	}
	cid := camp["id"].(string)

	code, res := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": bad})
	if code != http.StatusBadRequest || errCode(res) != "invalid_text" {
		t.Fatalf("含亂碼的活動名稱: %d %v,應回 400 invalid_text", code, res)
	}
	_, list := env.do("usr_a", "GET", "/partner/api/campaigns", nil)
	if n := len(list["campaigns"].([]any)); n != 1 {
		t.Fatalf("被拒絕的活動不該寫入,現有 %d 筆", n)
	}

	code, res = env.do("usr_a", "PUT", "/partner/api/campaigns/"+cid, map[string]string{"name": bad})
	if code != http.StatusBadRequest || errCode(res) != "invalid_text" {
		t.Fatalf("更新活動含亂碼: %d %v", code, res)
	}
	_, got := env.do("usr_a", "GET", "/partner/api/campaigns/"+cid, nil)
	if got["name"] != "好活動" {
		t.Fatalf("被拒絕的更新不該改到資料: name=%v", got["name"])
	}

	code, res = env.do("usr_a", "POST", "/partner/api/campaigns/"+cid+"/plans", map[string]string{"title": "t", "detail": `{"desc":"` + bad + `"}`})
	if code != http.StatusBadRequest || errCode(res) != "invalid_text" {
		t.Fatalf("方案 detail 含亂碼: %d %v", code, res)
	}
	_, plans := env.do("usr_a", "GET", "/partner/api/campaigns/"+cid+"/plans", nil)
	if n := len(plans["plans"].([]any)); n != 0 {
		t.Fatalf("被拒絕的方案不該寫入,現有 %d 筆", n)
	}

	code, plan := env.do("usr_a", "POST", "/partner/api/campaigns/"+cid+"/plans", map[string]string{"title": "好方案", "detail": `{"days":"5"}`})
	if code != http.StatusCreated {
		t.Fatalf("建立方案 = %d", code)
	}
	pid := plan["id"].(string)
	code, res = env.do("usr_a", "PUT", "/partner/api/plans/"+pid, map[string]string{"title": bad})
	if code != http.StatusBadRequest || errCode(res) != "invalid_text" {
		t.Fatalf("更新方案標題含亂碼: %d %v", code, res)
	}
}

func TestGetAdPlanAndUpdateReturnsFullObject(t *testing.T) {
	env := newEnv(t, "usr_a", "usr_b")

	_, camp := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": "活動"})
	_, plan := env.do("usr_a", "POST", "/partner/api/campaigns/"+camp["id"].(string)+"/plans",
		map[string]string{"title": "方案", "category": "group_tour", "detail": `{"days":"5"}`})
	pid := plan["id"].(string)

	code, got := env.do("usr_a", "GET", "/partner/api/plans/"+pid, nil)
	if code != http.StatusOK || got["title"] != "方案" || got["detail"] != `{"days":"5"}` {
		t.Fatalf("GET plan: %d %v", code, got)
	}

	if code, _ := env.do("usr_b", "GET", "/partner/api/plans/"+pid, nil); code != http.StatusNotFound {
		t.Fatalf("別的業主讀取不屬於自己的方案 = %d,應為 404", code)
	}

	code, upd := env.do("usr_a", "PUT", "/partner/api/plans/"+pid,
		map[string]string{"title": "新標題", "category": "group_tour", "detail": `{"days":"7"}`})
	if code != http.StatusOK || upd["title"] != "新標題" || upd["detail"] != `{"days":"7"}` || upd["status"] != "draft" {
		t.Fatalf("PUT plan 應回完整物件: %d %v", code, upd)
	}
}
