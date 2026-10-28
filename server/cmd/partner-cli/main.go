// Command partner-cli 是廣告業主/聯盟行銷夥伴在終端機操作的工具——
// 比照 server/cmd/cli(一般使用者/維運用的 tripace-cli)的設計精神,
// 但服務的是不同的身分與不同的 API:
//
//   - 身分:用自己的 Tripace 帳號登入(見 login.go),預設走瀏覽器核准
//     (-web),也支援 -email/-password。
//   - API:只打主服務的 /partner/api/*(campaign/plan 的
//     CRUD),不碰 /internal/*、/v1/trips 等一般使用者或維運端點。
//
// 子命令與旗標見 usage()。所有輸出為 JSON。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
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

// usageText 獨立成常數,讓 usage_test.go 能拿來比對各子指令實際註冊的旗標。
const usageText = `partner-cli — 廣告業主控制台的終端機工具

子命令:
  login              [-web | -email ... -password ...] [-api 業主控制台 URL,預設 https://tripace.io] [-main-api 主站 URL] [-console 前端 origin]
  campaign list      [-api ...]
  campaign create    -name 文字 [-placement slug] [-start YYYY-MM-DD] [-end YYYY-MM-DD] [-activate] [-quiet] [-api ...]   (-activate 建立後接著設為 active;-quiet 只印 id)
  campaign update    -id ID [-name 文字] [-placement slug] [-start YYYY-MM-DD] [-end YYYY-MM-DD] [-quiet] [-api ...]   (沒給的欄位保留原值)
  campaign status    -id ID -status draft|scheduled|active|paused|ended [-quiet] [-api ...]
  campaign placements [-api ...]
  campaign delete    -id ID [-api ...]
  plan list        -campaign 活動ID [-api ...]
  plan create      -campaign 活動ID -title 文字 [-category 文字] [方案內容旗標] [-publish] [-quiet] [-api ...]   (-publish 建立後接著設為 published;-quiet 只印 id)
  plan update      -id ID [-title 文字] [-category 文字] [方案內容旗標] [-quiet] [-api ...]   (沒給的欄位保留原值)

方案內容旗標(create/update 共用):
  -detail JSON | -detail-file 檔案(UTF-8,'-' 為 stdin)   整份內容
  -departure "日期|星期|團費"(可重複)  -highlight 文字(可重複)
  -days  -original-price  -desc  -cta-label  -landing-url  -cid(KKday 聯盟代碼,category 為 kkday 時必填)  -from-price(參考價,例如 "NT$ 599 起")
  plan status      -id ID -status draft|published [-quiet] [-api ...]
  plan delete      -id ID [-api ...]
  version`

func usage() {
	fmt.Fprintln(os.Stderr, usageText)
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
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	activate := fs.Bool("activate", false, "建立後接著把狀態設為 active（失敗時會明確回報已建立但上架失敗）")
	quiet := fs.Bool("quiet", false, quietUsage)
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	finishCreate(c, "campaign create", res, "/partner/api/campaigns/", "active", *activate, *quiet)
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
	quiet := fs.Bool("quiet", false, quietUsage)
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	printResult(res, *quiet)
}

func cmdCampaignStatus(args []string) {
	fs := flag.NewFlagSet("campaign status", flag.ExitOnError)
	id := fs.String("id", "", "活動 ID（必填）")
	status := fs.String("status", "", "draft|scheduled|active|paused|ended（必填）")
	quiet := fs.Bool("quiet", false, quietUsage)
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
	_ = fs.Parse(args)

	if *id == "" || *status == "" {
		fatal("campaign status 需要 -id 與 -status")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("PUT", "/partner/api/campaigns/"+*id+"/status", map[string]string{"status": *status})
	if err != nil {
		fatal("campaign status: %v", err)
	}
	printResult(res, *quiet)
}

func cmdCampaignDelete(args []string) {
	fs := flag.NewFlagSet("campaign delete", flag.ExitOnError)
	id := fs.String("id", "", "活動 ID（必填）")
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	category := fs.String("category", "", "方案分類（選填，例如 group_tour；KKday 聯盟連結用 kkday，需搭配 -cid 與 -landing-url）")
	df := registerDetailFlags(fs)
	publish := fs.Bool("publish", false, "建立後接著把狀態設為 published（失敗時會明確回報已建立但上架失敗）")
	quiet := fs.Bool("quiet", false, quietUsage)
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	finishCreate(c, "plan create", res, "/partner/api/plans/", "published", *publish, *quiet)
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
	quiet := fs.Bool("quiet", false, quietUsage)
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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
	printResult(res, *quiet)
}

func cmdPlanStatus(args []string) {
	fs := flag.NewFlagSet("plan status", flag.ExitOnError)
	id := fs.String("id", "", "方案 ID（必填）")
	status := fs.String("status", "", "draft|published（必填）")
	quiet := fs.Bool("quiet", false, quietUsage)
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
	_ = fs.Parse(args)

	if *id == "" || *status == "" {
		fatal("plan status 需要 -id 與 -status")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("PUT", "/partner/api/plans/"+*id+"/status", map[string]string{"status": *status})
	if err != nil {
		fatal("plan status: %v", err)
	}
	printResult(res, *quiet)
}

func cmdPlanDelete(args []string) {
	fs := flag.NewFlagSet("plan delete", flag.ExitOnError)
	id := fs.String("id", "", "方案 ID（必填）")
	apiURLFlag := fs.String("api", "https://tripace.io", "業主控制台 URL(預設正式環境;本機開發請改 http://localhost:8080)")
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

// stdout 是結果輸出的目的地,獨立成變數讓測試可以攔截。
var stdout io.Writer = os.Stdout

// quietUsage 是各指令 -quiet 旗標共用的說明。
const quietUsage = "只印回應物件的 id 一行（給 shell 變數接用），不印完整 JSON"

// finishCreate 處理 create 之後的收尾:withStatus 為 true 時接著把狀態設為
// status(campaign -activate / plan -publish),再依 -quiet 印結果。第二步失敗
// 時資源其實已經建立,所以明確印出已建立的 id,避免使用者重跑而重複建立。
func finishCreate(c *httpClient, label string, res map[string]any, statusPathPrefix, status string, withStatus, quiet bool) {
	if withStatus {
		next, err := applyStatus(c, statusPathPrefix, status, res)
		if err != nil {
			fatal("%s: %v", label, err)
		}
		res = next
	}
	printResult(res, quiet)
}

// applyStatus 對剛建立的資源送狀態變更(PUT <prefix><id>/status)。回傳更新後
// 的物件;狀態 API 沒回 id 時沿用建立時的回應並補上新狀態。
func applyStatus(c *httpClient, pathPrefix, status string, created map[string]any) (map[string]any, error) {
	id := strField(created, "id")
	if id == "" {
		return nil, fmt.Errorf("已建立但回應沒有 id，無法接著設為 %s", status)
	}
	res, err := c.do("PUT", pathPrefix+id+"/status", map[string]string{"status": status})
	if err != nil {
		return nil, fmt.Errorf("已建立但上架失敗（id=%s，目前仍是建立時的狀態，可用 status 指令重試設為 %s）: %w", id, status, err)
	}
	if strField(res, "id") == "" {
		created["status"] = status
		return created, nil
	}
	return res, nil
}

// printResult 依 -quiet 決定印完整 JSON 還是只印 id。
func printResult(v map[string]any, quiet bool) {
	if !quiet {
		output(v)
		return
	}
	id := strField(v, "id")
	if id == "" {
		fatal("-quiet: 回應沒有 id，原始回應: %v", v)
	}
	fmt.Fprintln(stdout, id)
}

func output(v any) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		fatal("marshal: %v", err)
	}
	fmt.Fprintln(stdout, string(b))
}

func fatal(format string, a ...any) {
	log.Fatalf(format, a...)
}
