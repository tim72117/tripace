package store

import "testing"

// TestCliAuthFlow 走過完整的 Start → CliAuthName → Approve → Exchange 流程,
// 驗證正常路徑會成功、換到當初 Approve 傳入的 token。
func TestCliAuthFlow(t *testing.T) {
	s := newTestStore(t)

	id, err := s.StartCliAuth("http://127.0.0.1:12345/callback", "test cli")
	if err != nil {
		t.Fatalf("StartCliAuth: %v", err)
	}
	if id == "" {
		t.Fatal("StartCliAuth 應回傳非空 id")
	}

	name, ok := s.CliAuthName(id)
	if !ok || name != "test cli" {
		t.Fatalf("CliAuthName = (%q, %v),want (\"test cli\", true)", name, ok)
	}

	redirectURI, ok := s.ApproveCliAuth(id, "jwt-token-value")
	if !ok || redirectURI != "http://127.0.0.1:12345/callback" {
		t.Fatalf("ApproveCliAuth = (%q, %v),want (\"http://127.0.0.1:12345/callback\", true)", redirectURI, ok)
	}

	token, ok := s.ExchangeCliAuth(id)
	if !ok || token != "jwt-token-value" {
		t.Fatalf("ExchangeCliAuth = (%q, %v),want (\"jwt-token-value\", true)", token, ok)
	}
}

// TestStartCliAuth_RejectsNonLoopbackRedirect 驗證只有 loopback 位址能登記
// 為 redirect_uri——這是防止把剛核發的 token 導去任意外部網址的第一道關卡。
func TestStartCliAuth_RejectsNonLoopbackRedirect(t *testing.T) {
	s := newTestStore(t)

	cases := []string{
		"http://evil.example.com/callback",
		"https://127.0.0.1:8080/callback", // https(非 http)也不行
		"http://localhost/callback",       // 缺 port
		"not-a-url",
	}
	for _, redirectURI := range cases {
		if _, err := s.StartCliAuth(redirectURI, "cli"); err == nil {
			t.Errorf("StartCliAuth(%q) 應該失敗,卻成功了", redirectURI)
		}
	}
}

// TestApproveCliAuth_SingleUse 驗證同一個 id 只能被核准一次——第二次核准
// (即使帶著不同 token)必須失敗,否則會讓已核准過的 session 又核發一次新
// token,兩把 token 混淆使用者「這次登入到底核發了哪把」的認知。
func TestApproveCliAuth_SingleUse(t *testing.T) {
	s := newTestStore(t)
	id, _ := s.StartCliAuth("http://127.0.0.1:1/callback", "cli")

	if _, ok := s.ApproveCliAuth(id, "token-1"); !ok {
		t.Fatal("第一次 ApproveCliAuth 應成功")
	}
	if _, ok := s.ApproveCliAuth(id, "token-2"); ok {
		t.Fatal("第二次 ApproveCliAuth 應失敗(已核准過),卻成功了")
	}

	// 確認 Exchange 拿到的仍是第一次核准的 token,而非第二次嘗試的 token-2。
	token, ok := s.ExchangeCliAuth(id)
	if !ok || token != "token-1" {
		t.Fatalf("ExchangeCliAuth = (%q, %v),want (\"token-1\", true)——不該被第二次 Approve 覆寫", token, ok)
	}
}

// TestExchangeCliAuth_SingleUse 驗證 token 只能被取走一次——重放的 exchange
// 呼叫(例如瀏覽器 callback 被重複觸發)必須拿不到已經被取走的 token。
func TestExchangeCliAuth_SingleUse(t *testing.T) {
	s := newTestStore(t)
	id, _ := s.StartCliAuth("http://127.0.0.1:1/callback", "cli")
	s.ApproveCliAuth(id, "token-1")

	if _, ok := s.ExchangeCliAuth(id); !ok {
		t.Fatal("第一次 ExchangeCliAuth 應成功")
	}
	if _, ok := s.ExchangeCliAuth(id); ok {
		t.Fatal("第二次 ExchangeCliAuth 應失敗(token 已被取走),卻成功了")
	}
}

// TestExchangeCliAuth_RequiresApproval 驗證尚未核准的 session 換不到 token。
func TestExchangeCliAuth_RequiresApproval(t *testing.T) {
	s := newTestStore(t)
	id, _ := s.StartCliAuth("http://127.0.0.1:1/callback", "cli")

	if _, ok := s.ExchangeCliAuth(id); ok {
		t.Fatal("尚未核准就 ExchangeCliAuth 應失敗,卻成功了")
	}
}

// TestCliAuthUnknownID 驗證未知 id 在三個查詢/寫入方法上都乾淨地回傳「找不到」,
// 不 panic、不洩漏內部狀態。
func TestCliAuthUnknownID(t *testing.T) {
	s := newTestStore(t)

	if _, ok := s.CliAuthName("no-such-id"); ok {
		t.Error("CliAuthName(未知 id) 應回 false")
	}
	if _, ok := s.ApproveCliAuth("no-such-id", "token"); ok {
		t.Error("ApproveCliAuth(未知 id) 應回 false")
	}
	if _, ok := s.ExchangeCliAuth("no-such-id"); ok {
		t.Error("ExchangeCliAuth(未知 id) 應回 false")
	}
}
