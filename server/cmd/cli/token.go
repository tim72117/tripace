package main

// token.go 管理 `tripace-cli login --web` 換到的 JWT 在本機的存放——存成一個
// 純文字檔,仿照 onagent cmd/onagent/main.go 的 saveToken/loadToken 寫法。

import (
	"os"
	"path/filepath"
	"strings"
)

// tokenPath 回傳 CLI 快取 bearer token 的位置:每位使用者的設定目錄
// (os.UserConfigDir() 依作業系統決定,例如 macOS/Linux 是 ~/.config、Windows
// 是 %AppData%),而不是目前工作目錄——這樣才能跨專案共用同一份登入狀態,
// 也不會不小心被誤 commit 進某個 git 儲存庫。
func tokenPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "tripace", "token"), nil
}

// saveToken 把 login --web 換到的 JWT 寫進本機快取檔。
func saveToken(token string) error {
	path, err := tokenPath()
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

// loadToken 讀回本機快取的 JWT;檔案不存在或讀取失敗時回傳 error,呼叫端應
// 提示使用者先執行 `tripace-cli login --web`。
func loadToken() (string, error) {
	path, err := tokenPath()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}
