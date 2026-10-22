// Command partner-cli 是廣告業主/聯盟行銷夥伴在終端機操作的工具——
// 比照 server/cmd/cli(一般使用者/維運用的 tripace-cli)的設計精神,
// 但服務的是不同的身分與不同的 API:
//
//   - 身分:用自己的 Tripace 帳號登入(見 login.go),預設走瀏覽器核准
//     (-web),也支援 -email/-password。
//   - API:只打 partnerserver 的 /partner/api/*(campaign/plan 的
//     CRUD),不碰 /internal/*、/v1/trips 等一般使用者或維運端點。
//
// 子命令與旗標見 usage()。所有輸出為 JSON。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
)

// version 由 release 流程的 build 旗標注入(見
// .github/workflows/release-partner-cli.yml 的
// -ldflags="-X main.version=..."),本機 `go build`/`go run` 不帶這個
// 旗標時維持預設值 "dev"——比照 agent 專案 onagent CLI 的既有模式
// (release-onagent.yml 同一套做法),讓使用者可以用 `partner-cli
// version` 分辨手上這支執行檔是哪個 release、還是本機自行編譯的。
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "login":
		cmdLogin(args)
	case "campaign":
		dispatchCampaign(args)
	case "plan":
		dispatchPlan(args)
	case "version":
		fmt.Println(version)
	case "-h", "--help", "help":
		usage()
	default:
		fatal("未知指令 %q（用 -h 看用法）", cmd)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `partner-cli — 廣告業主控制台的終端機工具

子命令:
  login              [-web | -email ... -password ...] [-api partnerserver URL] [-main-api 主站 URL] [-console 前端 origin]
  campaign list      [-api ...]
  campaign create    -name 文字 [-placement slug] [-start YYYY-MM-DD] [-end YYYY-MM-DD] [-api ...]
  campaign update    -id ID [-name 文字] [-placement slug] [-start YYYY-MM-DD] [-end YYYY-MM-DD] [-api ...]   (沒給的欄位保留原值)
  campaign status    -id ID -status draft|scheduled|active|paused|ended [-api ...]
  campaign placements [-api ...]
  campaign delete    -id ID [-api ...]
  plan list        -campaign 活動ID [-api ...]
  plan create      -campaign 活動ID -title 文字 [-category 文字] [方案內容旗標] [-api ...]
  plan update      -id ID [-title 文字] [-category 文字] [方案內容旗標] [-api ...]   (沒給的欄位保留原值)

方案內容旗標(create/update 共用):
  -detail JSON | -detail-file 檔案(UTF-8,'-' 為 stdin)   整份內容
  -departure "日期|星期|團費"(可重複)  -highlight 文字(可重複)
  -days  -original-price  -desc  -cta-label  -landing-url
  plan status      -id ID -status draft|published [-api ...]
  plan delete      -id ID [-api ...]
  version`)
}

func dispatchCampaign(args []string) {
	if len(args) == 0 {
		fatal("缺少 campaign 的子指令（list/create/update/status/placements/delete）")
	}
	verb, rest := args[0], args[1:]
	switch verb {
	case "list":
		cmdCampaignList(rest)
	case "create":
		cmdCampaignCreate(rest)
	case "update":
		cmdCampaignUpdate(rest)
	case "status":
		cmdCampaignStatus(rest)
	case "delete":
		cmdCampaignDelete(rest)
	case "placements":
		cmdCampaignPlacements(rest)
	default:
		fatal("未知指令 %q（campaign 底下）", verb)
	}
}

func dispatchPlan(args []string) {
	if len(args) == 0 {
		fatal("缺少 plan 的子指令（list/create/update/status/delete）")
	}
	verb, rest := args[0], args[1:]
	switch verb {
	case "list":
		cmdPlanList(rest)
	case "create":
		cmdPlanCreate(rest)
	case "update":
		cmdPlanUpdate(rest)
	case "status":
		cmdPlanStatus(rest)
	case "delete":
		cmdPlanDelete(rest)
	default:
		fatal("未知指令 %q（plan 底下）", verb)
	}
}

// --- campaign --------------------------------------------------------------

func cmdCampaignList(args []string) {
	fs := flag.NewFlagSet("campaign list", flag.ExitOnError)
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("GET", "/partner/api/campaigns", nil)
	if err != nil {
		fatal("campaign list: %v", err)
	}
	output(res)
}

// cmdCampaignPlacements 查詢後端目前已知的可投放頁面清單（見
// partnerconsole.validPlacements 的完整說明）——建立/更新活動時要填
// -placement 旗標，可以先跑這個指令看有哪些合法的 slug 可用，不需要
// 另外打開網頁版控制台查。
func cmdCampaignPlacements(args []string) {
	fs := flag.NewFlagSet("campaign placements", flag.ExitOnError)
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("GET", "/partner/api/placements", nil)
	if err != nil {
		fatal("campaign placements: %v", err)
	}
	output(res)
}

func cmdCampaignCreate(args []string) {
	fs := flag.NewFlagSet("campaign create", flag.ExitOnError)
	name := fs.String("name", "", "活動名稱（必填）")
	placement := fs.String("placement", "", "投放頁面 slug（選填，例如 kyoto-kiyomizu；留空代表尚未指定，之後可用 campaign update 補上）")
	start := fs.String("start", "", "開始日期 YYYY-MM-DD（選填）")
	end := fs.String("end", "", "結束日期 YYYY-MM-DD（選填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *name == "" {
		fatal("campaign create 需要 -name")
	}
	for label, v := range map[string]string{"-name": *name, "-placement": *placement} {
		if err := cleanText(label, v); err != nil {
			fatal("campaign create: %v", err)
		}
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("POST", "/partner/api/campaigns", map[string]string{
		"name": *name, "placement": *placement, "startDate": *start, "endDate": *end,
	})
	if err != nil {
		fatal("campaign create: %v", err)
	}
	output(res)
}

// cmdCampaignUpdate 只改有給旗標的欄位:先讀出現有活動,沒給的欄位沿用原值
// 再整份送 PUT(後端仍是全量替換)。明確傳空字串(例如 -placement "")代表
// 清空該欄位。
func cmdCampaignUpdate(args []string) {
	fs := flag.NewFlagSet("campaign update", flag.ExitOnError)
	id := fs.String("id", "", "活動 ID（必填）")
	name := fs.String("name", "", "活動名稱（選填，沒給就保留原值）")
	placement := fs.String("placement", "", "投放頁面 slug（選填，沒給就保留原值；給空字串會清空）")
	start := fs.String("start", "", "開始日期 YYYY-MM-DD（選填，沒給就保留原值）")
	end := fs.String("end", "", "結束日期 YYYY-MM-DD（選填，沒給就保留原值）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)
	visited := visitedFlags(fs)

	if *id == "" {
		fatal("campaign update 需要 -id")
	}
	if !visited["name"] && !visited["placement"] && !visited["start"] && !visited["end"] {
		fatal("campaign update 至少要指定一個要修改的欄位（-name/-placement/-start/-end），沒給的欄位會保留原值")
	}
	if visited["name"] && *name == "" {
		fatal("campaign update: -name 不能是空字串")
	}

	c := newHTTPClient(*apiURLFlag)
	cur, err := c.do("GET", "/partner/api/campaigns/"+*id, nil)
	if err != nil {
		fatal("campaign update: 讀取現有活動失敗: %v", err)
	}
	next := map[string]string{
		"name":      strField(cur, "name"),
		"placement": strField(cur, "placement"),
		"startDate": strField(cur, "startDate"),
		"endDate":   strField(cur, "endDate"),
	}
	for flagName, key := range map[string]string{"name": "name", "placement": "placement", "start": "startDate", "end": "endDate"} {
		if visited[flagName] {
			next[key] = map[string]string{"name": *name, "placement": *placement, "start": *start, "end": *end}[flagName]
		}
	}
	for key, v := range next {
		if err := cleanText(key, v); err != nil {
			fatal("campaign update: %v", err)
		}
	}

	res, err := c.do("PUT", "/partner/api/campaigns/"+*id, next)
	if err != nil {
		fatal("campaign update: %v", err)
	}
	output(res)
}

func cmdCampaignStatus(args []string) {
	fs := flag.NewFlagSet("campaign status", flag.ExitOnError)
	id := fs.String("id", "", "活動 ID（必填）")
	status := fs.String("status", "", "draft|scheduled|active|paused|ended（必填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *id == "" || *status == "" {
		fatal("campaign status 需要 -id 與 -status")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("PUT", "/partner/api/campaigns/"+*id+"/status", map[string]string{"status": *status})
	if err != nil {
		fatal("campaign status: %v", err)
	}
	output(res)
}

func cmdCampaignDelete(args []string) {
	fs := flag.NewFlagSet("campaign delete", flag.ExitOnError)
	id := fs.String("id", "", "活動 ID（必填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *id == "" {
		fatal("campaign delete 需要 -id")
	}

	c := newHTTPClient(*apiURLFlag)
	if _, err := c.do("DELETE", "/partner/api/campaigns/"+*id, nil); err != nil {
		fatal("campaign delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// --- plan --------------------------------------------------------------

func cmdPlanList(args []string) {
	fs := flag.NewFlagSet("plan list", flag.ExitOnError)
	campaignID := fs.String("campaign", "", "活動 ID（必填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *campaignID == "" {
		fatal("plan list 需要 -campaign")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("GET", "/partner/api/campaigns/"+*campaignID+"/plans", nil)
	if err != nil {
		fatal("plan list: %v", err)
	}
	output(res)
}

func cmdPlanCreate(args []string) {
	fs := flag.NewFlagSet("plan create", flag.ExitOnError)
	campaignID := fs.String("campaign", "", "活動 ID（必填）")
	title := fs.String("title", "", "方案標題（必填）")
	category := fs.String("category", "", "方案分類（選填，例如 display/deeplink/sponsorship）")
	df := registerDetailFlags(fs)
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)
	visited := visitedFlags(fs)

	if *campaignID == "" {
		fatal("plan create 需要 -campaign")
	}
	if *title == "" {
		fatal("plan create 需要 -title")
	}
	for label, v := range map[string]string{"-title": *title, "-category": *category} {
		if err := cleanText(label, v); err != nil {
			fatal("plan create: %v", err)
		}
	}
	detail, _, err := df.build("", visited, os.Stdin)
	if err != nil {
		fatal("plan create: %v", err)
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("POST", "/partner/api/campaigns/"+*campaignID+"/plans", map[string]string{
		"title": *title, "category": *category, "detail": detail,
	})
	if err != nil {
		fatal("plan create: %v", err)
	}
	output(res)
}

// cmdPlanUpdate 只改有給旗標的欄位:先讀出現有方案,沒給的欄位沿用原值,
// detail 的結構化旗標(-departure/-days/...)只覆蓋有給的那幾個欄位。
// 給 -detail/-detail-file 則整份取代現有內容。
func cmdPlanUpdate(args []string) {
	fs := flag.NewFlagSet("plan update", flag.ExitOnError)
	id := fs.String("id", "", "方案 ID（必填）")
	title := fs.String("title", "", "方案標題（選填，沒給就保留原值）")
	category := fs.String("category", "", "方案分類（選填，沒給就保留原值）")
	df := registerDetailFlags(fs)
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)
	visited := visitedFlags(fs)

	if *id == "" {
		fatal("plan update 需要 -id")
	}
	if !visited["title"] && !visited["category"] && !df.any(visited) {
		fatal("plan update 至少要指定一個要修改的欄位（-title/-category 或任一個方案內容旗標），沒給的欄位會保留原值")
	}
	if visited["title"] && *title == "" {
		fatal("plan update: -title 不能是空字串")
	}

	c := newHTTPClient(*apiURLFlag)
	cur, err := c.do("GET", "/partner/api/plans/"+*id, nil)
	if err != nil {
		fatal("plan update: 讀取現有方案失敗: %v", err)
	}
	next := map[string]string{
		"title":    strField(cur, "title"),
		"category": strField(cur, "category"),
		"detail":   strField(cur, "detail"),
	}
	if visited["title"] {
		next["title"] = *title
	}
	if visited["category"] {
		next["category"] = *category
	}
	detail, changed, err := df.build(next["detail"], visited, os.Stdin)
	if err != nil {
		fatal("plan update: %v", err)
	}
	if changed {
		next["detail"] = detail
	}
	for key, v := range next {
		if err := cleanText(key, v); err != nil {
			fatal("plan update: %v", err)
		}
	}

	res, err := c.do("PUT", "/partner/api/plans/"+*id, next)
	if err != nil {
		fatal("plan update: %v", err)
	}
	output(res)
}

func cmdPlanStatus(args []string) {
	fs := flag.NewFlagSet("plan status", flag.ExitOnError)
	id := fs.String("id", "", "方案 ID（必填）")
	status := fs.String("status", "", "draft|published（必填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *id == "" || *status == "" {
		fatal("plan status 需要 -id 與 -status")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("PUT", "/partner/api/plans/"+*id+"/status", map[string]string{"status": *status})
	if err != nil {
		fatal("plan status: %v", err)
	}
	output(res)
}

func cmdPlanDelete(args []string) {
	fs := flag.NewFlagSet("plan delete", flag.ExitOnError)
	id := fs.String("id", "", "方案 ID（必填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *id == "" {
		fatal("plan delete 需要 -id")
	}

	c := newHTTPClient(*apiURLFlag)
	if _, err := c.do("DELETE", "/partner/api/plans/"+*id, nil); err != nil {
		fatal("plan delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// --- helpers ---------------------------------------------------------------

func strField(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

func output(v any) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		fatal("marshal: %v", err)
	}
	fmt.Println(string(b))
}

func fatal(format string, a ...any) {
	log.Fatalf(format, a...)
}
