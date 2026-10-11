// Package adminidentity 提供「這個 email 是否為管理員」的單一判斷邏輯,
// 供 internal/api(resolveContentPageOwnerID 的 official 模式)與
// internal/adminconsole(withAdmin)共用。
//
// 這兩個套件刻意互不相依(internal/adminconsole 只依賴
// internal/auth、internal/model、internal/store,目的是讓
// cmd/adminserver 能獨立編譯、不帶入 internal/api 的其餘主業務依賴,
// 見 cmd/adminserver/main.go 開頭的說明)——因此「比對 email 是否為
// ADMIN_BOOTSTRAP_EMAIL 白名單」這段原本在兩邊各自重複實作一次的邏輯,
// 抽到這個極小、兩邊都能安全依賴、本身不依賴任何東西的共用套件,
// 之後只需要改一個地方。
package adminidentity

import "strings"

// IsAdminEmail 判斷 email 是否等於 adminBootstrapEmail 這組白名單值
// (來自環境變數 ADMIN_BOOTSTRAP_EMAIL)。
//
// 比對前兩邊都做 strings.ToLower 正規化,不用原始大小寫直接比較——
// 這個專案密碼註冊路徑(internal/api.handleRegister/handleLogin)對
// email 一律做 strings.ToLower 正規化後才存進資料庫/查詢,但 Google
// 登入回傳的 email 大小寫可能跟 ADMIN_BOOTSTRAP_EMAIL 環境變數設定值
// 不同(例如 "Admin@Example.com" vs "admin@example.com")——嚴格 ==
// 比較會讓 admin 本人被鎖在白名單外,故這裡统一正規化後再比對。
//
// adminBootstrapEmail 為空字串時(環境變數未設定)一律回傳 false,
// 即使 email 也剛好是空字串——fail-closed:避免「忘記設定這個環境
// 變數」被誤判成「沒有白名單限制、任何人都能用」這種 fail-open 的
// 危險預設值。
func IsAdminEmail(email, adminBootstrapEmail string) bool {
	if adminBootstrapEmail == "" {
		return false
	}
	return strings.ToLower(strings.TrimSpace(email)) == strings.ToLower(strings.TrimSpace(adminBootstrapEmail))
}
