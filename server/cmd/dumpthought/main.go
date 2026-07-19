// Command dumpthought 是一個極簡單的一次性命令列小工具:讀取一個語言代碼,
// 印出 tripace 正式 LLM agent(server/internal/llm/assistant_agent.go)
// 依該語言組好的完整 system prompt(thought)文字到標準輸出。
//
// 這個工具屬於 tripace 主專案的一部分(同 cmd/server、cmd/cli,同屬 tripace
// module),合法 import internal/llm——但這個工具存在的目的,是讓完全獨立、
// 依專案架構原則不能 import internal/llm 的 agentbench(server/cmd/agentbench)
// 可以透過「執行子程序、讀 stdout」的方式間接取得正式 thought 內容,而不需要
// 任何 Go 程式碼層級的 import 依賴。
//
// 用法:
//
//	go run ./cmd/dumpthought -lang zh-TW
//
// -lang 是唯一參數,預設值 "zh-TW"(對應 assistant_agent.go 的
// defaultAssistLang)。輸出是純文字,原封不動印出 llm.BuildThought(lang)
// 回傳的字串本身(不加任何額外格式化文字、前後綴換行符號、或 JSON 包裝),
// 呼叫端可以直接把 stdout 全部內容當成 thought 字串使用。
//
// 這個工具刻意保持單純:不監聽 port、不啟動 HTTP server、不做任何 want 引擎
// /LLM provider 初始化(BuildThought 純粹是字串組裝,不需要),執行一次、
// 印出結果、結束。不要在這裡新增其他無關功能。
package main

import (
	"flag"
	"fmt"

	"github.com/tim72117/tripace/internal/llm"
)

func main() {
	lang := flag.String("lang", "zh-TW", "語言代碼(如 zh-TW、en),決定要組出哪個語言版本的 system prompt")
	flag.Parse()

	fmt.Print(llm.BuildThought(*lang))
}
