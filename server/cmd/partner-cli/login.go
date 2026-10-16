package main

// login.go——partner-cli 的登入流程。跟 cmd/cli 的 login --web/--device
// 刻意不同:那兩種走瀏覽器核准或 device code,是為了「不想讓密碼經過
// CLI 本身」這個安全考量設計的(給一般 Tripace 使用者/工程師用)。但
// partner-cli 的使用者是業主——業主本來就是用 email/password 登入
// web/partner(見該 SPA 的 AuthScreen),直接讓 CLI 接受 -email
// -password 旗標、呼叫同一支 POST /v1/auth/login,比照 web/partner
// api.ts login() 的既有流程,不需要另外設計一套瀏覽器核准機制——這是
// 給業主自己在終端機操作用的工具,不是給不信任的第三方自動化流程用。

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"strings"
)

// mainServerBase 從 partnerBase(通常是 partnerserver 的 URL,例如
// http://localhost:8082)推導主站的 URL——/v1/auth/login 只存在於
// cmd/server(見 web/partner/src/api.ts 的 MAIN_BASE 同一個問題與同一套
// 解法說明)。正式環境下 partnerserver 與主站同源部署,mainBase 旗標留
// 空時直接等於 partnerBase 即可(見 cmdLogin 的預設值邏輯);本機開發
// 兩者是不同 port,必須明確指定 -main-api。
func cmdLogin(args []string) {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	email := fs.String("email", "", "業主的 Tripace 帳號 email（必填）")
	password := fs.String("password", "", "密碼（必填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL（之後指令操作的對象）")
	mainAPIFlag := fs.String("main-api", "", "主站 server URL（/v1/auth/login 所在,留空時預設等於 -api,正式環境同源部署時適用）")
	_ = fs.Parse(args)

	if *email == "" || *password == "" {
		fatal("login 需要 -email 與 -password")
	}
	mainBase := *mainAPIFlag
	if mainBase == "" {
		mainBase = *apiURLFlag
	}

	body, _ := json.Marshal(map[string]string{"email": *email, "password": *password})
	resp, err := http.Post(mainBase+"/v1/auth/login", "application/json", strings.NewReader(string(body)))
	if err != nil {
		fatal("login: %v", err)
	}
	defer resp.Body.Close()

	var result struct {
		Token string `json:"token"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fatal("login: 無法解析回應: %v", err)
	}
	if resp.StatusCode >= 400 {
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if result.Error != nil {
			msg = result.Error.Message
		}
		fatal("login: %s", msg)
	}

	// token 存進 -api(partnerserver)這個 base 底下——之後所有指令
	// (campaign/plan)都是打這個 base,loadToken 用同一個 key 才讀得到
	// (見 token.go 的完整說明)。不額外存一份到 mainBase,因為 partner-cli
	// 不會再打主站的其他端點,存兩份只會增加「哪份才是最新」的混淆。
	if err := saveToken(*apiURLFlag, result.Token); err != nil {
		fatal("login: 儲存 token 失敗: %v", err)
	}

	// 登入成功後立即打一次 /partner/api/me,確認這個帳號確實有業主身分
	// ——若沒有,提早在這裡給出明確訊息,而不是讓使用者之後呼叫
	// campaign/plan 指令時才一頭霧水地看到 401。
	c := newHTTPClient(*apiURLFlag)
	me, err := c.do("GET", "/partner/api/me", nil)
	if err != nil {
		fmt.Println("已登入,但這個帳號似乎沒有業主權限(呼叫 /partner/api/me 失敗):", err)
		fmt.Println("請確認內部窗口已經透過 `tripace-cli partner-grant` 開通此帳號。")
		return
	}
	output(map[string]any{"status": "logged_in", "partner": me})
}
