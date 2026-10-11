package adminidentity

import "testing"

func TestIsAdminEmail_完全相符(t *testing.T) {
	if !IsAdminEmail("admin@example.com", "admin@example.com") {
		t.Fatalf("完全相符的 email 應該判定為 admin")
	}
}

// TestIsAdminEmail_大小寫不同仍相符 對應 2026-10 code review 發現的正確性
// 問題:密碼註冊路徑(internal/api.handleRegister/handleLogin)對 email
// 一律做 strings.ToLower 正規化,但 Google 登入回傳的 email 大小寫可能
// 跟 ADMIN_BOOTSTRAP_EMAIL 環境變數設定值不同——嚴格 == 比較會讓 admin
// 本人被鎖在白名單外,這裡驗證兩邊大小寫不同時仍判定為相符。
func TestIsAdminEmail_大小寫不同仍相符(t *testing.T) {
	cases := []struct{ email, bootstrap string }{
		{"Admin@Example.com", "admin@example.com"},
		{"admin@example.com", "ADMIN@EXAMPLE.COM"},
		{"AdMiN@ExAmPlE.CoM", "admin@example.com"},
	}
	for _, c := range cases {
		if !IsAdminEmail(c.email, c.bootstrap) {
			t.Fatalf("email=%q bootstrap=%q 大小寫不同應仍判定為 admin", c.email, c.bootstrap)
		}
	}
}

func TestIsAdminEmail_不相符(t *testing.T) {
	if IsAdminEmail("someone-else@example.com", "admin@example.com") {
		t.Fatalf("不相符的 email 不應該判定為 admin")
	}
}

// TestIsAdminEmail_白名單為空字串時fail closed 驗證環境變數未設定時,
// 即使 email 剛好也是空字串,仍一律拒絕——避免「忘記設定這個環境變數」
// 被誤判成「沒有白名單限制、任何人都能用」。
func TestIsAdminEmail_白名單為空字串時failClosed(t *testing.T) {
	if IsAdminEmail("admin@example.com", "") {
		t.Fatalf("adminBootstrapEmail 為空字串時應一律拒絕")
	}
	if IsAdminEmail("", "") {
		t.Fatalf("email 與 adminBootstrapEmail 都是空字串時仍應該拒絕(fail-closed)")
	}
}
