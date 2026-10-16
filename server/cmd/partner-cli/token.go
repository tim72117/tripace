package main

// token.go 管理業主登入換到的 JWT 在本機的存放——結構比照 cmd/cli/
// token.go(見該檔案開頭的完整說明:依 apiBase 分開存放、SHA-256 雜湊
// 當檔名避免路徑逸出字元問題),但存放目錄獨立(tripace/partner-cli/
// 而非 tripace/),理由:partner-cli 的 token 是業主身分(JWT 的 Sub 是
// 一般使用者 ID,但語意上代表的是業主操作),跟 tripace-cli(一般維運/
// 開發用途)的 token 混在同一個目錄,容易在同一台機器上誤用錯身分
// 操作錯的 API(例如業主不小心拿業主身分的 token 打維運端點,或反過
// 來)。獨立子目錄讓兩者物理上不會混放,不需要靠使用者自己分辨。
import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

func tokenFileName(apiBase string) string {
	sum := sha256.Sum256([]byte(apiBase))
	return "token-" + hex.EncodeToString(sum[:])
}

func tokenPath(apiBase string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "tripace", "partner-cli", tokenFileName(apiBase)), nil
}

func saveToken(apiBase, token string) error {
	path, err := tokenPath(apiBase)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	// 0600:這個檔案內容是 bearer 憑證——任何讀得到這個檔案的人都能冒充
	// 這個業主呼叫 /partner/api/* API。
	return os.WriteFile(path, []byte(token), 0600)
}

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
