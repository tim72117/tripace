package main

import (
	"bytes"
	"encoding/json"
	"flag"
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

// cmdLogin 支援兩種登入:瀏覽器核准(-web,沒給 -email/-password 時的預設)
// 與帳密(-email/-password)。瀏覽器核准複用主站 /v1/cli-auth/* 與核准頁,
// 密碼不經過 CLI;業主身分仍由 /partner/api/me 在登入後驗證。
func cmdLogin(args []string) {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	web := fs.Bool("web", false, "用瀏覽器核准登入(不需要在終端機輸入密碼;未給 -email/-password 時預設)")
	email := fs.String("email", "", "業主的 Tripace 帳號 email(帳密登入用)")
	password := fs.String("password", "", "密碼(帳密登入用)")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL(之後指令操作的對象)")
	mainAPIFlag := fs.String("main-api", "", "主站 server URL(登入端點所在,留空時等於 -api,正式環境同源部署時適用)")
	consoleFlag := fs.String("console", "", "核准頁面所在的前端 origin(僅本機開發前後端不同 origin 時需要,留空時等於 -main-api)")
	_ = fs.Parse(args)

	mainBase := *mainAPIFlag
	if mainBase == "" {
		mainBase = *apiURLFlag
	}

	useWeb := *web || (*email == "" && *password == "")
	if !useWeb && (*email == "" || *password == "") {
		fatal("帳密登入需要同時給 -email 與 -password;或改用 -web")
	}

	var token string
	if useWeb {
		console := *consoleFlag
		if console == "" {
			console = mainBase
		}
		t, err := loginViaBrowser(mainBase, console)
		if err != nil {
			fatal("login: %v", err)
		}
		token = t
	} else {
		t, err := loginWithPassword(mainBase, *email, *password)
		if err != nil {
			fatal("login: %v", err)
		}
		token = t
	}

	// token 存在 -api(partnerserver)底下,之後 campaign/plan 指令讀同一個 key。
	if err := saveToken(*apiURLFlag, token); err != nil {
		fatal("login: 儲存 token 失敗: %v", err)
	}

	c := newHTTPClient(*apiURLFlag)
	me, err := c.do("GET", "/partner/api/me", nil)
	if err != nil {
		fmt.Println("已登入,但這個帳號似乎沒有業主權限(呼叫 /partner/api/me 失敗):", err)
		fmt.Println("請確認內部窗口已經透過 `tripace-cli partner-grant` 開通此帳號。")
		return
	}
	output(map[string]any{"status": "logged_in", "partner": me})
}

func loginWithPassword(mainBase, email, password string) (string, error) {
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := http.Post(mainBase+"/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Token string `json:"token"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("無法解析回應: %w", err)
	}
	if resp.StatusCode >= 400 {
		if result.Error != nil {
			return "", fmt.Errorf("%s", result.Error.Message)
		}
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return result.Token, nil
}

// loginViaBrowser:本機起 loopback 伺服器 → 向主站登記 → 瀏覽器核准後導回
// → 用一次性 code 換 token。網址上只帶 opaque id,token 不經過瀏覽器。
func loginViaBrowser(mainBase, console string) (string, error) {
	name, _ := os.Hostname()
	if name == "" {
		name = "partner-cli"
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("啟動本機伺服器失敗: %w", err)
	}
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", listener.Addr().(*net.TCPAddr).Port)

	id, err := cliAuthStart(mainBase, redirectURI, name)
	if err != nil {
		listener.Close()
		return "", fmt.Errorf("啟動登入流程失敗: %w", err)
	}

	type result struct {
		token string
		err   error
	}
	done := make(chan result, 1)
	var handled bool
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/callback" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><p>可以關閉這個分頁,回到終端機繼續。</p></body></html>`)
		if handled {
			return
		}
		handled = true
		code := r.URL.Query().Get("code")
		if code == "" {
			done <- result{err: fmt.Errorf("callback 未帶 code(登入是否被取消了?)")}
			return
		}
		t, err := cliAuthExchange(mainBase, code)
		done <- result{token: t, err: err}
	})}
	go func() { _ = srv.Serve(listener) }()
	defer srv.Close()

	authURL := strings.TrimSuffix(console, "/") + "/cli-auth?" + url.Values{"id": {id}}.Encode()
	fmt.Println("正在開啟瀏覽器進行登入...")
	fmt.Println("若未自動開啟,請手動造訪:")
	fmt.Println(" ", authURL)
	fmt.Println("等待核准中...")
	_ = openBrowser(authURL)

	select {
	case res := <-done:
		return res.token, res.err
	case <-time.After(5 * time.Minute):
		return "", fmt.Errorf("等待瀏覽器核准逾時")
	}
}

func cliAuthStart(base, redirectURI, name string) (string, error) {
	body, _ := json.Marshal(map[string]string{"redirectUri": redirectURI, "name": name})
	res, err := http.Post(base+"/v1/cli-auth/start", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("連不上 %s: %w", base, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		return "", statusError(res)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("解析回應失敗: %w", err)
	}
	return out.ID, nil
}

func cliAuthExchange(base, id string) (string, error) {
	res, err := http.Post(base+"/v1/cli-auth/"+url.PathEscape(id)+"/exchange", "application/json", nil)
	if err != nil {
		return "", fmt.Errorf("連不上 %s: %w", base, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("換取 token 失敗: %w", statusError(res))
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("解析回應失敗: %w", err)
	}
	return out.Token, nil
}

func statusError(res *http.Response) error {
	text, _ := io.ReadAll(res.Body)
	msg := strings.TrimSpace(string(text))
	if msg == "" {
		msg = res.Status
	}
	return fmt.Errorf("%s: %s", res.Status, msg)
}

// Windows 不用 "cmd /c start":網址裡的 "&" 會被 cmd 當命令分隔字元截斷。
func openBrowser(u string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		return exec.Command("open", u).Start()
	default:
		return exec.Command("xdg-open", u).Start()
	}
}
