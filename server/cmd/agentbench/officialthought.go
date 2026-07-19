// 正式 thought 取得機制:讓 agentbench 能取得 tripace 正式 LLM agent
// (server/internal/llm/assistant_agent.go)的 system prompt 內容,
// 但完全不透過 Go 程式碼層級的 import(這是使用者明確要求的架構原則,
// 不是 Go 語言本身的限制——即使 agentbench 與 internal/llm 同屬 tripace
// module、Go 語言規則上其實允許互相 import,這裡仍刻意不這麼做)。
//
// 做法:執行一個獨立的子程序 `go run ./cmd/dumpthought -lang <lang>`
// (cmd/dumpthought 是同屬 tripace module、可合法 import internal/llm 的
// 一次性命令列小工具,見該檔案開頭註解),讀它印到 stdout 的純文字內容
// 當作 thought 字串——這是 process 層級的呼叫,不是 import。
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// tripaceServerDirEnv 是可選的環境變數:明確指出 tripace 專案 server/ 目錄的
// 絕對(或相對於 agentbench 啟動時工作目錄的)路徑,用來組出子程序的
// cmd.Dir。設這個環境變數是最穩健的做法,不受「使用者從哪個目錄啟動
// agentbench」影響。
const tripaceServerDirEnv = "TRIPACE_SERVER_DIR"

// dumpthoughtModulePath 是 tripace module 內 dumpthought 這個一次性小工具的
// package 路徑(相對於 server/ module root),供 `go run` 使用。
const dumpthoughtModulePath = "./cmd/dumpthought"

// resolveTripaceServerDir 決定執行 `go run ./cmd/dumpthought` 時要用的
// 工作目錄(cmd.Dir),依序:
//  1. 環境變數 TRIPACE_SERVER_DIR 有設定就直接採用(最明確、不受啟動目錄影響)。
//  2. 否則假設 agentbench 本身就是在 tripace 的 server/ 目錄下啟動的
//     (同 agentbench 現有的慣例:main.go 文件註解要求 `go run ./cmd/agentbench`、
//     且啟動時已經用 os.Getwd() 當 wanttypes.InitialWorkingDir、嘗試載入當下
//     目錄的 .env——這些既有邏輯都預設 CWD 就是 server/),回傳目前工作目錄。
//
// 回傳前會用 looksLikeTripaceServerDir 驗證解析出的目錄,驗證失敗時回傳清楚的
// 錯誤訊息(而非讓 `go run` 用一個錯誤目錄失敗、留下難懂的錯誤字串給呼叫端)。
func resolveTripaceServerDir() (string, error) {
	dir := os.Getenv(tripaceServerDirEnv)
	usedEnv := dir != ""

	if dir == "" {
		wd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("resolve tripace server dir: getwd: %w", err)
		}
		dir = wd
	}

	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("resolve tripace server dir: abs(%q): %w", dir, err)
	}

	if !looksLikeTripaceServerDir(abs) {
		if usedEnv {
			return "", fmt.Errorf(
				"%s=%q 不像是 tripace 專案的 server/ 目錄(找不到 module github.com/tim72117/tripace 的 go.mod);"+
					"請確認這個環境變數指向 tripace 專案下的 server/ 目錄",
				tripaceServerDirEnv, abs)
		}
		return "", fmt.Errorf(
			"目前工作目錄 %q 不像是 tripace 專案的 server/ 目錄(找不到 module github.com/tim72117/tripace 的 go.mod);"+
				"agentbench 預設假設你是在 server/ 目錄下啟動的(go run ./cmd/agentbench),"+
				"若並非如此,請設定環境變數 %s 指向 tripace 專案的 server/ 目錄",
			abs, tripaceServerDirEnv)
	}

	return abs, nil
}

// looksLikeTripaceServerDir 檢查 dir 底下的 go.mod 是否宣告
// module github.com/tim72117/tripace,以此判斷這個目錄是不是正確的
// tripace server/ module root(避免用錯目錄時,`go run` 給出一段跟真正問題
// 無關、難以理解的錯誤訊息)。
func looksLikeTripaceServerDir(dir string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "go.mod"))
	if err != nil {
		return false
	}
	firstLine := strings.SplitN(string(b), "\n", 2)[0]
	return strings.TrimSpace(firstLine) == "module github.com/tim72117/tripace"
}

// fetchOfficialThought 執行 `go run ./cmd/dumpthought -lang <lang>` 子程序,
// 回傳它印到 stdout 的完整內容當作正式 thought 字串。
//
// 錯誤處理:任何一步失敗(目錄解析失敗、子程序啟動失敗、子程序非零結束)都
// 回傳清楚描述問題的 error,由呼叫端(session.go)轉成 4xx/5xx 錯誤訊息
// 回應給 API 呼叫端,不會讓整個 agentbench process 掛掉。
func fetchOfficialThought(lang string) (string, error) {
	if strings.TrimSpace(lang) == "" {
		return "", errors.New("fetchOfficialThought: lang 不可為空字串")
	}

	dir, err := resolveTripaceServerDir()
	if err != nil {
		return "", fmt.Errorf("取得正式 thought 失敗: %w", err)
	}

	cmd := exec.Command("go", "run", dumpthoughtModulePath, "-lang", lang)
	cmd.Dir = dir

	var stderr strings.Builder
	cmd.Stderr = &stderr

	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf(
			"取得正式 thought 失敗:執行 `go run %s -lang %s`(於目錄 %q)失敗: %s",
			dumpthoughtModulePath, lang, dir, msg)
	}

	return string(out), nil
}
