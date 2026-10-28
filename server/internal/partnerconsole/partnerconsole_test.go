package partnerconsole

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
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
	st     *store.Store
}

func newEnv(t *testing.T, users ...string) *testEnv {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	signer := auth.NewSigner("test-secret", time.Hour)
	env := &testEnv{t: t, mux: http.NewServeMux(), tokens: map[string]string{}, st: st}
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

func TestKKdayPlanValidatesDomainAndInjectsCID(t *testing.T) {
	env := newEnv(t, "usr_a")
	_, camp := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": "活動"})
	path := "/partner/api/campaigns/" + camp["id"].(string) + "/plans"

	for name, detail := range map[string]string{
		"缺 cid":   `{"landingUrl":"https://www.kkday.com/zh-tw/product/1"}`,
		"非 kkday": `{"cid":"abc","landingUrl":"https://example.com/x"}`,
		"http":    `{"cid":"abc","landingUrl":"http://www.kkday.com/x"}`,
		"偽裝網域":    `{"cid":"abc","landingUrl":"https://kkday.com.evil.com/x"}`,
	} {
		code, res := env.do("usr_a", "POST", path, map[string]string{"title": "t", "category": "kkday", "detail": detail})
		if code != http.StatusBadRequest || errCode(res) != "invalid_kkday" {
			t.Fatalf("%s: %d %v,應回 400 invalid_kkday", name, code, res)
		}
	}
	_, plans := env.do("usr_a", "GET", path, nil)
	if n := len(plans["plans"].([]any)); n != 0 {
		t.Fatalf("被拒絕的方案不該寫入,現有 %d 筆", n)
	}

	code, plan := env.do("usr_a", "POST", path, map[string]string{
		"title": "九份一日遊", "category": "kkday",
		"detail": `{"cid":"tripace-27468","landingUrl":"https://www.kkday.com/zh-tw/product/2287?cid=other"}`,
	})
	if code != http.StatusCreated {
		t.Fatalf("合法 KKday 方案 = %d %v", code, plan)
	}
	var d map[string]string
	_ = json.Unmarshal([]byte(plan["detail"].(string)), &d)
	if d["landingUrl"] != "https://www.kkday.com/zh-tw/product/2287?cid=tripace-27468" {
		t.Fatalf("cid 應寫進網址: %s", d["landingUrl"])
	}

	// 更新時也要驗證:把網址改成別的網域應被擋下,資料不變。
	code, res := env.do("usr_a", "PUT", "/partner/api/plans/"+plan["id"].(string), map[string]string{
		"title": "九份一日遊", "category": "kkday", "detail": `{"cid":"tripace-27468","landingUrl":"https://example.com/x"}`,
	})
	if code != http.StatusBadRequest || errCode(res) != "invalid_kkday" {
		t.Fatalf("更新成非 kkday 網域: %d %v", code, res)
	}
}

func TestValidPlacementValue(t *testing.T) {
	for _, ok := range []string{"", "jiufen", "itinerary-sidebar", "itinerary-jozankei-1day", "itinerary-hokkaido-5day"} {
		if !validPlacementValue(ok) {
			t.Errorf("%q 應合法", ok)
		}
	}
	for _, bad := range []string{"jiufen2", "itinerary-", "itinerary-Has Space", "itinerary-UPPER", "itinerary-a/b", "itinerary--x", "Itinerary-x"} {
		if validPlacementValue(bad) {
			t.Errorf("%q 不該合法", bad)
		}
	}
}

func TestCampaignPlacementIsValidatedAndItinerariesAreListed(t *testing.T) {
	env := newEnv(t, "usr_a")
	code, res := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": "活動", "placement": "jiufen2"})
	if code != http.StatusBadRequest || errCode(res) != "invalid_placement" {
		t.Fatalf("打錯的版位: %d %v,應回 400 invalid_placement", code, res)
	}
	code, camp := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": "活動", "placement": "itinerary-jozankei-1day"})
	if code != http.StatusCreated {
		t.Fatalf("行程版位應可建立: %d %v", code, camp)
	}
	code, res = env.do("usr_a", "PUT", "/partner/api/campaigns/"+camp["id"].(string), map[string]string{"name": "活動", "placement": "nope"})
	if code != http.StatusBadRequest || errCode(res) != "invalid_placement" {
		t.Fatalf("更新成不合法版位: %d %v", code, res)
	}

	if _, err := env.st.CreateItineraryPage("owner", "jozankei-1day", `{"title":"定山溪一日遊"}`, "t"); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.CreateItineraryPage("owner", "draft-one", `{"title":"草稿"}`, "t"); err != nil {
		t.Fatal(err)
	}
	if err := env.st.SetItineraryPageStatus("owner", "jozankei-1day", "published"); err != nil {
		t.Fatal(err)
	}
	_, list := env.do("usr_a", "GET", "/partner/api/placements", nil)
	labels := map[string]string{}
	for _, p := range list["placements"].([]any) {
		m := p.(map[string]any)
		labels[m["value"].(string)] = m["label"].(string)
	}
	if labels["jiufen"] == "" {
		t.Fatal("靜態版位應都在")
	}
	if labels["itinerary-jozankei-1day"] != "行程頁側欄：定山溪一日遊" {
		t.Fatalf("已發布的行程應列為版位: %v", labels)
	}
	if _, ok := labels["itinerary-draft-one"]; ok {
		t.Fatal("草稿行程不該列出")
	}
}

func TestPlanLandingURLRejectsDangerousSchemesAndNormalizesKKdayCategory(t *testing.T) {
	env := newEnv(t, "usr_a")
	_, camp := env.do("usr_a", "POST", "/partner/api/campaigns", map[string]string{"name": "活動"})
	path := "/partner/api/campaigns/" + camp["id"].(string) + "/plans"

	for _, u := range []string{"javascript:alert(1)", "data:text/html,x", "//example.com", "/relative"} {
		code, res := env.do("usr_a", "POST", path, map[string]string{"title": "t", "category": "group_tour", "detail": `{"landingUrl":"` + u + `"}`})
		if code != http.StatusBadRequest || errCode(res) != "invalid_url" {
			t.Fatalf("%s: %d %v,應回 400 invalid_url", u, code, res)
		}
	}
	if code, _ := env.do("usr_a", "POST", path, map[string]string{"title": "t", "category": "group_tour", "detail": `{"landingUrl":"https://example.com/x"}`}); code != http.StatusCreated {
		t.Fatalf("一般 https 連結應可建立: %d", code)
	}

	// 大小寫不同的 KKday 分類不能繞過網域檢查,且會被統一成 kkday
	code, res := env.do("usr_a", "POST", path, map[string]string{"title": "t", "category": "KKday", "detail": `{"cid":"abc","landingUrl":"https://evil.example.com/x"}`})
	if code != http.StatusBadRequest || errCode(res) != "invalid_kkday" {
		t.Fatalf("KKday(大寫)+非 kkday 網域: %d %v", code, res)
	}
	code, plan := env.do("usr_a", "POST", path, map[string]string{"title": "t", "category": " KKday ", "detail": `{"cid":"abc","landingUrl":"https://www.kkday.com/x"}`})
	if code != http.StatusCreated || plan["category"] != "kkday" {
		t.Fatalf("分類應統一成 kkday: %d %v", code, plan["category"])
	}
}

// 登入成功(JWT 有效)但還沒開通業主身分:回 403 partner_not_enabled 並附申請說明與帳號識別;
// 沒有 token 或 token 無效仍是 401。
func TestNonPartnerGetsGuidance(t *testing.T) {
	env := newEnv(t, "usr_a")
	signer := auth.NewSigner("test-secret", time.Hour)
	tok, err := signer.Sign("usr_plain", "一般使用者")
	if err != nil {
		t.Fatal(err)
	}
	env.tokens["usr_plain"] = tok

	code, res := env.do("usr_plain", "GET", "/partner/api/me", nil)
	if code != http.StatusForbidden || errCode(res) != "partner_not_enabled" {
		t.Fatalf("非業主: %d %v,應回 403 partner_not_enabled", code, res)
	}
	msg, _ := res["error"].(map[string]any)["message"].(string)
	if !strings.Contains(msg, "usr_plain") || !strings.Contains(msg, "email") {
		t.Fatalf("訊息應含帳號識別與申請說明: %q", msg)
	}

	if code, _ := env.do("nobody", "GET", "/partner/api/me", nil); code != http.StatusUnauthorized {
		t.Fatalf("無效 token = %d,應回 401", code)
	}
}
