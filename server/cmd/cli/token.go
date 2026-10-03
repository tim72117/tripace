package main

// token.go 管理 `tripace-cli login --web` 換到的 JWT 在本機的存放——存成一個
// 純文字檔,仿照 onagent cmd/onagent/main.go 的 saveToken/loadToken 寫法。
//
// 2026-10 修正:token 檔名依 apiBase(-api 旗標指向的 server,例如
// http://localhost:8080 或 https://tripace.shuttle.tools)分開存放,不再
// 全部共用同一個固定檔名——原本不分 host 時,login 連正式機換到的 token
// 會直接覆蓋掉本機開發環境的登入狀態(反之亦然),使用者需要在本機/正式機
// 之間切換操作時,每次都要重新登入前一個環境,且容易在不自覺的情況下拿著
// 正式機的身分對本機發請求、或反過來。

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// tokenFileName 把 apiBase 轉成安全的檔名——不能直接把網址字串當檔名
// (含 "://"、":"、"/" 這些在檔案系統路徑裡有特殊意義或在某些平台不合法
// 的字元),改用該字串的 SHA-256 雜湊十六進位表示,同一個 apiBase 永遠對應
// 同一個檔名,不同 apiBase 幾乎不可能碰撞,且不需要處理任何逸出/合法字元
// 的邊界情況。
func tokenFileName(apiBase string) string {
	sum := sha256.Sum256([]byte(apiBase))
	return "token-" + hex.EncodeToString(sum[:])
}

// tokenPath 回傳 CLI 快取 bearer token 的位置:每位使用者的設定目錄
// (os.UserConfigDir() 依作業系統決定,例如 macOS/Linux 是 ~/.config、Windows
// 是 %AppData%),而不是目前工作目錄——這樣才能跨專案共用同一份登入狀態,
// 也不會不小心被誤 commit 進某個 git 儲存庫。apiBase 決定實際檔名(見上方
// tokenFileName 的完整說明),同一個設定目錄底下可以同時存放多個 host 各自
// 的 token,互不覆蓋。
func tokenPath(apiBase string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "tripace", tokenFileName(apiBase)), nil
}

// saveToken 把 login --web 換到的 JWT 寫進本機快取檔,依 apiBase 分開存放
// (見上方 tokenPath 的完整說明)。
func saveToken(apiBase, token string) error {
	path, err := tokenPath(apiBase)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	// 0600:這個檔案內容是 bearer 憑證——任何讀得到這個檔案的人都能冒充這個
	// 使用者呼叫 /internal/* API。
	return os.WriteFile(path, []byte(token), 0600)
}

// loadToken 讀回本機快取的 JWT(依 apiBase 分開存放,見上方 tokenPath 的
// 完整說明);檔案不存在或讀取失敗時回傳 error,呼叫端應提示使用者先針對
// 這個 apiBase 執行 `tripace-cli login --web`。
func loadToken(apiBase string) (string, error) {
	path, err := tokenPath(apiBase)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}
