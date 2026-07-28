package main

// login.go 實作 `tripace-cli login --web`:透過瀏覽器核准的登入流程,取代
// 直接把密碼打進終端機。整套設計比照 onagent cmd/onagent/main.go 的
// runLoginWeb/callbackHandler/openBrowser——起一個本機臨時伺服器、印出(並
// 嘗試自動開啟)一個核准頁面網址、等待該頁面把瀏覽器導回本機伺服器的
// /callback,再用網址帶回的 code(即 server 端 StartCliAuth 產生的 opaque
// id)向 server 換一次性的 JWT。
//
// 網址上自始至終只帶著這一個 opaque、單次使用的 id——從未帶著要核發的
// token,也從未帶著這個本機伺服器的位址本身(那個位址是這個流程一開始就
// 已經在 server 端登記過的,不是由核准頁面的網址內容決定的)。這正是這整套
// 設計能防止惡意連結把剛核發的 token 導到攻擊者網址的關鍵,詳見
// server/internal/store/cliauth.go 開頭的說明與 web/src/CliAuthPage.tsx。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// runLogin 是 `login` 子命令的入口。目前只支援 --web 這一種登入方式
// (瀏覽器核准),沒有 onagent 那種「互動輸入帳密」的分支——tripace 這次
// 只需要解決「CLI 怎麼安全地拿到一把 JWT」,不需要重新做一套終端機帳密登入。
//
// -console <url> 是選填的本機開發用旗標:只影響「開瀏覽器要導去的核准頁面」
// 網址開頭,不影響任何 API 呼叫(client.start/exchange 一律打 apiBase)。
// 正式環境前後端同源,不需要這個旗標;但本機開發常見「Vite dev server
// (:5173)另外跑,跟 go:embed 進 server binary 的靜態檔(:8080)不是同一個
// origin」的情況,這時候用 -console http://localhost:5173 就能讓核准頁面
// 走有熱重載的 dev server,同時仍對 :8080 的真正 API 授權。這能行得通全靠
// cors middleware(見 server/internal/api/middleware.go)本來就放行跨 origin
// 呼叫,以及核准頁面(web/src/CliAuthPage.tsx)呼叫 API 時用的是 cfg.baseURL
// (由 VITE_API_BASE 決定),不是用「頁面自己是從哪個 origin 載入的」。
func runLogin(apiBase string, args []string) error {
	web := false
	console := ""
	rest := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--web" {
			web = true
			continue
		}
		if len(a) > 10 && a[:10] == "-console=" {
			console = a[10:]
			continue
		}
		if a == "-console" && i+1 < len(args) {
			console = args[i+1]
			i++
			continue
		}
		rest = append(rest, a)
	}
	if !web {
		return fmt.Errorf("目前只支援 login --web(用法:tripace-cli -api <url> login --web [-console <url>])")
	}
	if len(rest) != 0 {
		return fmt.Errorf("login --web 不需要額外參數")
	}
	if console == "" {
		console = apiBase
	}
	return runLoginWeb(apiBase, console)
}

// runLoginWeb 起一個本機 loopback 伺服器、向 server 登記這次登入意圖、
// 印出(並嘗試自動開啟)核准頁面網址,然後等待瀏覽器核准後導回本機伺服器,
// 換到 JWT 並存進本機 token 快取檔(見 token.go)。5 分鐘逾時,比照 onagent
// runLoginWeb 的設計:短到不會無限期卡住一個沒人理會的登入流程,長到使用者
// 在瀏覽器裡完成登入/核准綽綽有餘。
//
// console 是核准頁面的 origin,預設等於 apiBase(前後端同源);見上面
// runLogin 對 -console 旗標的說明。
func runLoginWeb(apiBase, console string) error {
	name, _ := os.Hostname()
	if name == "" {
		name = "cli"
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("啟動本機伺服器失敗: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	client := &cliAuthClient{base: apiBase}
	id, err := client.start(redirectURI, name)
	if err != nil {
		listener.Close()
		return fmt.Errorf("啟動登入流程失敗: %w", err)
	}

	result := make(chan loginCallbackResult, 1)
	srv := &http.Server{Handler: loginCallbackHandler(client, result)}
	go func() { _ = srv.Serve(listener) }()
	defer srv.Close()

	// 正式環境 tripace 前後端同源,console 預設就是 apiBase(見 runLogin);
	// 本機開發若另外跑 Vite dev server,呼叫端可用 -console 指到那個 origin。
	// 網址只帶這一個 opaque id——見本檔案開頭的說明。
	authURL := strings.TrimSuffix(console, "/") + "/cli-auth?" + url.Values{"id": {id}}.Encode()

	fmt.Println("正在開啟瀏覽器進行登入...")
	fmt.Println("若未自動開啟,請手動造訪:")
	fmt.Println(" ", authURL)
	fmt.Println("等待核准中...")
	_ = openBrowser(authURL) // best-effort;失敗就靠上面印出的網址讓使用者手動開

	select {
	case res := <-result:
		if res.err != nil {
			return res.err
		}
		if err := saveToken(res.token); err != nil {
			return fmt.Errorf("儲存 token 失敗: %w", err)
		}
		fmt.Printf("登入成功,token 已儲存(標記為 %q)——之後的指令不會再要求登入。\n", name)
		return nil
	case <-time.After(5 * time.Minute):
		return fmt.Errorf("等待瀏覽器核准逾時")
	}
}

type loginCallbackResult struct {
	token string
	err   error
}

// loginCallbackHandler 處理瀏覽器核准後導回的一次性 GET /callback 請求,帶著
// ?code=<StartCliAuth 當初回傳的同一個 opaque id>。這裡用這個 code 向 server
// 換出實際的 token——明文 token 全程只經過這個本機 process(從 server 回應
// 本文直接讀出),從未出現在瀏覽器網址或畫面上。
//
// result 是 buffer size 1 的 channel,故只有第一次請求真正有意義:之後任何
// 重複的請求(例如瀏覽器重新整理該分頁)都只會拿到同一頁「可以關閉分頁」的
// 提示,不會再嘗試往 channel 送第二次、也不會 panic。
func loginCallbackHandler(client *cliAuthClient, result chan<- loginCallbackResult) http.HandlerFunc {
	var done bool
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/callback" {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
<p>可以關閉這個分頁,回到終端機繼續。</p></body></html>`)

		if done {
			return
		}
		done = true

		code := r.URL.Query().Get("code")
		if code == "" {
			result <- loginCallbackResult{err: fmt.Errorf("callback 未帶 code(登入是否被取消了?)")}
			return
		}

		token, err := client.exchange(code)
		if err != nil {
			result <- loginCallbackResult{err: fmt.Errorf("換取 token 失敗: %w", err)}
			return
		}
		result <- loginCallbackResult{token: token}
	}
}

// openBrowser 盡力嘗試用系統預設瀏覽器開啟 url。失敗不算致命錯誤——
// runLoginWeb 一律會先印出網址,無圖形介面環境或辨識不出的作業系統就只能
// 讓使用者自己複製貼上。
func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		// 不用 "cmd /c start":cmd.exe 在 Go 已經做完 argv 層級的引號處理後,
		// 會再解析一次自己的命令列,把網址查詢字串裡沒特別跳脫的 "&" 當成
		// 命令分隔字元,導致網址在第一個 "&" 就被截斷、後面的參數全部消失。
		// rundll32 直接呼叫開啟 URL 的系統 API,不經過 shell、不會有第二次
		// 解析,不需要擔心特殊字元。
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

// ---- 這次登入流程專用的最小 API client(不共用 httpClient:那個是給已登入
// 後、一般業務指令用的,帶的是「已存好的 token」;這裡的 start/exchange 兩個
// 呼叫都刻意不需要登入,見 server 端 /v1/cli-auth/* 路由註冊處的說明)。----

type cliAuthClient struct {
	base string
}

func (c *cliAuthClient) start(redirectURI, name string) (id string, err error) {
	body, _ := json.Marshal(map[string]string{"redirectUri": redirectURI, "name": name})
	req, err := http.NewRequest(http.MethodPost, c.base+"/v1/cli-auth/start", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("連不上 %s: %w", c.base, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		return "", loginStatusError(res)
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("解析回應失敗: %w", err)
	}
	return out.ID, nil
}

func (c *cliAuthClient) exchange(id string) (token string, err error) {
	req, err := http.NewRequest(http.MethodPost, c.base+"/v1/cli-auth/"+url.PathEscape(id)+"/exchange", nil)
	if err != nil {
		return "", err
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("連不上 %s: %w", c.base, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", loginStatusError(res)
	}

	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("解析回應失敗: %w", err)
	}
	return out.Token, nil
}

func loginStatusError(res *http.Response) error {
	text, _ := io.ReadAll(res.Body)
	msg := strings.TrimSpace(string(text))
	if msg == "" {
		msg = res.Status
	}
	return fmt.Errorf("%s: %s", res.Status, msg)
}
