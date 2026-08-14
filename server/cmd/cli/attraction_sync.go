package main

// attraction_sync.go 實作 attraction-sync-setup / attraction-sync 兩個
// 子命令（見 docs/ATTRACTION_SYNC_DESIGN.md「五、CLI 指令介面」）。
//
// 依設計文件「三、架構」：CLI 只負責觸發指令、顯示結果，不直接呼叫兩邊
// 的 API，也不執行任何比對邏輯——比對與資料搬運邏輯放在本機 server
// 層（見 server/internal/api/attraction_sync.go），本機 server 收到
// CLI 觸發後才主動發起 HTTP 請求去跟同步對象（target）對話。
//
// attractionSyncSetup 是唯一的例外：Phase 1（開瀏覽器走核准流程換到
// JWT）本質上需要一個能接瀏覽器 callback 的本機 loopback 監聽器，這段
// 沿用既有 login --web 的機制（見 login.go 的 cliAuthClient/
// loginCallbackHandler），在 CLI 進程裡執行——但換到 JWT 後，CLI 不會
// 自己存檔，而是呼叫本機 server 的 setup 端點，把 {target, token} 轉交
// 給本機 server 存進它自己的 sync-token 檔案（見
// server/internal/api/synctoken.go）。之後所有同步請求都是本機 server
// 用這份 sync-token 發起，不再經過 CLI。
//
// attractionSync 本身則單純：把使用者的旗標打包成一個請求，呼叫本機
// server（c.base，即這個 httpClient 實例當下 -api 指向的伺服器）的
// run 端點，顯示回應——不直接呼叫 target，也不執行任何比對。

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// attractionSyncSetup 對應設計文件「四、認證」的 Phase 1：走一次跟
// login --web（見 login.go 的 runLoginWeb）完全相同的機制——開本機
// loopback 伺服器、開瀏覽器導向 target 的核准頁、等待 callback 換到
// JWT，換到後呼叫本機 server（c.base）的 setup 端點，把 {target, token}
// 交給本機 server 存檔，CLI 本身不保留這份 token。
func (c *httpClient) attractionSyncSetup(target string) (any, error) {
	name, _ := os.Hostname()
	if name == "" {
		name = "cli"
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("啟動本機伺服器失敗: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	authClient := &cliAuthClient{base: target}
	id, err := authClient.start(redirectURI, name)
	if err != nil {
		listener.Close()
		return nil, fmt.Errorf("啟動授權流程失敗: %w", err)
	}

	result := make(chan loginCallbackResult, 1)
	srv := &http.Server{Handler: loginCallbackHandler(authClient, result)}
	go func() { _ = srv.Serve(listener) }()
	defer srv.Close()

	authURL := strings.TrimSuffix(target, "/") + "/cli-auth?" + url.Values{"id": {id}}.Encode()

	fmt.Println("正在開啟瀏覽器進行授權...")
	fmt.Println("若未自動開啟,請手動造訪:")
	fmt.Println(" ", authURL)
	fmt.Println("等待核准中...")
	_ = openBrowser(authURL) // best-effort;失敗就靠上面印出的網址讓使用者手動開

	select {
	case res := <-result:
		if res.err != nil {
			return nil, res.err
		}
		// 換到的 JWT 交給本機 server 存檔,不是這個 CLI 進程自己存——見
		// 本檔案開頭的說明。這裡走一般的 c.do(),帶的是使用者自己的個人
		// 登入 token(loadToken,見 http.go),用來驗證「呼叫這支設定
		// 端點的人是誰」;res.token 是另一把不同的 JWT,放進 body 裡,
		// 代表「之後本機 server 同步時要用哪把 JWT 跟 target 對話」。
		if _, err := c.do("POST", "/internal/maintenance/sync/setup", map[string]any{
			"target": target,
			"token":  res.token,
		}); err != nil {
			return nil, fmt.Errorf("儲存 sync-token 至本機 server 失敗: %w", err)
		}
		return map[string]any{"target": target, "ok": true}, nil
	case <-time.After(5 * time.Minute):
		return nil, fmt.Errorf("等待瀏覽器核准逾時")
	}
}

// attractionSync 對應「五、CLI 指令介面」的同步指令本身：把使用者的
// 旗標打包成請求,呼叫本機 server（c.base）的 run 端點——本機 server
// 收到後才依 direction 主動發起對 target 的 HTTP 請求、執行三層比對／
// 交握式傳輸（見 server/internal/api/attraction_sync.go 的
// handleMaintenanceSyncRun）。CLI 這裡不執行任何比對邏輯,單純轉發＋
// 顯示結果。
func (c *httpClient) attractionSync(direction string, allowDelete, apply, retry bool) (any, error) {
	if direction != "push" && direction != "pull" {
		return nil, fmt.Errorf("未知的 -direction %q(僅接受 push 或 pull)", direction)
	}
	return c.do("POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction":   direction,
		"allowDelete": allowDelete,
		"apply":       apply,
		"retry":       retry,
	})
}

func cmdAttractionSyncSetup(c client, args []string) {
	fs := flag.NewFlagSet("attraction-sync-setup", flag.ExitOnError)
	target := fs.String("target", "", "正式站 API 網址（必填）")
	_ = fs.Parse(args)
	if *target == "" {
		fatal("attraction-sync-setup 需要 -target")
	}
	res, err := c.attractionSyncSetup(*target)
	if err != nil {
		fatal("attraction-sync-setup: %v", err)
	}
	output(res)
}

func cmdAttractionSync(c client, args []string) {
	fs := flag.NewFlagSet("attraction-sync", flag.ExitOnError)
	direction := fs.String("direction", "", "push 或 pull（必填）")
	allowDelete := fs.Bool("allow-delete", false, "允許刪除只存在於目的方的記錄（預設不刪除，保留）")
	apply := fs.Bool("apply", false, "真正執行寫入（預設 dry-run，只顯示差異報告）")
	retry := fs.Bool("retry", false, "強制從目的方最新狀態重新查詢斷點並續傳")
	_ = fs.Parse(args)
	if *direction != "push" && *direction != "pull" {
		fatal("attraction-sync 需要 -direction push 或 -direction pull")
	}
	res, err := c.attractionSync(*direction, *allowDelete, *apply, *retry)
	if err != nil {
		fatal("attraction-sync: %v", err)
	}
	output(res)
}
