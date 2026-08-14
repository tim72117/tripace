package api

// synctoken.go 管理景點資料同步機制的 sync-token 在「本機 server」端的
// 存放（見 docs/ATTRACTION_SYNC_DESIGN.md「三、架構」「四、認證」）。
//
// 依設計文件,比對與資料搬運邏輯放在 server 層,由本機 server 主動發起
// HTTP 請求去跟同步對象(target)的 server 對話——sync-token 因此也應該
// 由本機 server 進程自己保管,而不是 CLI 的設定目錄:CLI 只負責觸發
// attraction-sync-setup 走一次瀏覽器核准換到 JWT,再把 {target, token}
// 轉交給本機 server 的一個端點(見 attraction_sync.go 的
// handleMaintenanceSyncSetup),由這裡的 saveSyncToken 寫進本機 server
// 進程自己的設定目錄。
//
// 檔案路徑刻意沿用跟 cmd/cli 的個人 token 相同的慣例
// (os.UserConfigDir()/tripace/...)——本機開發情境下 server 與 CLI 通常
// 是同一台機器、同一個使用者在跑,路徑行為一致比較好理解;檔名
// (sync-token)也刻意跟個人登入 token 分開,因為代表的是不同的憑證
// (「本機 server 代表使用者去跟同步對象對話的憑證」,不是「使用者用
// CLI 操作時的身分」)。
import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// syncTokenData 是 sync-token 檔案的內容。
type syncTokenData struct {
	Target string `json:"target"`
	Token  string `json:"token"`
}

// syncTokenPath 回傳 sync-token 的存放位置。
func syncTokenPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "tripace", "sync-token"), nil
}

// saveSyncToken 把 attraction-sync-setup 換到的 JWT 連同 target 網址
// 一併寫進本機 server 的 sync-token 檔案。
func saveSyncToken(target, token string) error {
	path, err := syncTokenPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(syncTokenData{Target: target, Token: token})
	if err != nil {
		return err
	}
	// 0600:這個檔案內容含 bearer 憑證——任何讀得到這個檔案的人都能冒充
	// 本機 server 呼叫同步對象的 /internal/* API。
	return os.WriteFile(path, data, 0600)
}

// loadSyncToken 讀回本機 server 的 sync-token。尚未執行過
// attraction-sync-setup 時檔案不存在,回傳一個明確的 error,呼叫端應
// 提示使用者先執行設定指令,而不是靜默回傳一份看似有效但內容是空字串
// 的假資料。
func loadSyncToken() (syncTokenData, error) {
	path, err := syncTokenPath()
	if err != nil {
		return syncTokenData{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return syncTokenData{}, fmt.Errorf("尚未執行過 attraction-sync-setup: %w", err)
	}
	var data syncTokenData
	if err := json.Unmarshal(raw, &data); err != nil {
		return syncTokenData{}, err
	}
	return data, nil
}
