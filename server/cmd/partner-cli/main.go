// Command partner-cli 是廣告業主/聯盟行銷夥伴在終端機操作的工具——
// 比照 server/cmd/cli(一般使用者/維運用的 tripace-cli)的設計精神,
// 但服務的是不同的身分與不同的 API:
//
//   - 身分:業主用自己的 Tripace 帳號(email/password)登入(見 login.go),
//     不走 tripace-cli 的瀏覽器核准/device code 流程——業主本來就是
//     用密碼登入 web/partner,CLI 直接接受密碼旗標最直覺。
//   - API:只打 partnerserver 的 /partner/api/*(campaign/plan 的
//     CRUD),不碰 /internal/*、/v1/trips 等一般使用者或維運端點。
//
// 子命令:
//
//	login            -email ... -password ... [-api partnerserver URL] [-main-api 主站 URL]
//	campaign list
//	campaign create  -name 文字 [-start YYYY-MM-DD] [-end YYYY-MM-DD]
//	campaign status  -id ID -status draft|scheduled|active|paused|ended
//	campaign delete  -id ID
//	plan list        -campaign 活動ID
//	plan create      -campaign 活動ID -title 文字 [-category 文字] [-detail JSON]
//	plan update      -id ID -title 文字 [-category 文字] [-detail JSON]
//	plan status      -id ID -status draft|published
//	plan delete      -id ID
//
// 所有輸出為 JSON。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
)

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
	case "-h", "--help", "help":
		usage()
	default:
		fatal("未知指令 %q（用 -h 看用法）", cmd)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `partner-cli — 廣告業主控制台的終端機工具

子命令:
  login            -email ... -password ... [-api partnerserver URL] [-main-api 主站 URL]
  campaign list    [-api ...]
  campaign create  -name 文字 [-start YYYY-MM-DD] [-end YYYY-MM-DD] [-api ...]
  campaign status  -id ID -status draft|scheduled|active|paused|ended [-api ...]
  campaign delete  -id ID [-api ...]
  plan list        -campaign 活動ID [-api ...]
  plan create      -campaign 活動ID -title 文字 [-category 文字] [-detail JSON] [-api ...]
  plan update      -id ID -title 文字 [-category 文字] [-detail JSON] [-api ...]
  plan status      -id ID -status draft|published [-api ...]
  plan delete      -id ID [-api ...]`)
}

func dispatchCampaign(args []string) {
	if len(args) == 0 {
		fatal("缺少 campaign 的子指令（list/create/status/delete）")
	}
	verb, rest := args[0], args[1:]
	switch verb {
	case "list":
		cmdCampaignList(rest)
	case "create":
		cmdCampaignCreate(rest)
	case "status":
		cmdCampaignStatus(rest)
	case "delete":
		cmdCampaignDelete(rest)
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

func cmdCampaignCreate(args []string) {
	fs := flag.NewFlagSet("campaign create", flag.ExitOnError)
	name := fs.String("name", "", "活動名稱（必填）")
	start := fs.String("start", "", "開始日期 YYYY-MM-DD（選填）")
	end := fs.String("end", "", "結束日期 YYYY-MM-DD（選填）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *name == "" {
		fatal("campaign create 需要 -name")
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("POST", "/partner/api/campaigns", map[string]string{
		"name": *name, "startDate": *start, "endDate": *end,
	})
	if err != nil {
		fatal("campaign create: %v", err)
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
	detail := fs.String("detail", "", "方案內容 JSON 字串（選填，不帶時為空物件）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *campaignID == "" {
		fatal("plan create 需要 -campaign")
	}
	if *title == "" {
		fatal("plan create 需要 -title")
	}
	if *detail != "" {
		var probe any
		if err := json.Unmarshal([]byte(*detail), &probe); err != nil {
			fatal("plan create: -detail 不是合法 JSON: %v", err)
		}
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("POST", "/partner/api/campaigns/"+*campaignID+"/plans", map[string]string{
		"title": *title, "category": *category, "detail": *detail,
	})
	if err != nil {
		fatal("plan create: %v", err)
	}
	output(res)
}

// cmdPlanUpdate 走 PUT /partner/api/plans/{id}(見 partnerconsole.go
// updateAdPlan 的完整說明:全量替換,不是部分欄位合併)——跟
// cmdPlanCreate 一樣要求 -title 必填、-detail 整串替換,不做「先查
// 現有值再合併未指定欄位」這種隱式邏輯,避免過度工程(CLI 使用情境
// 下,使用者通常是改完整份 detail JSON 一次送出,不是零散改單一
// 欄位)。
func cmdPlanUpdate(args []string) {
	fs := flag.NewFlagSet("plan update", flag.ExitOnError)
	id := fs.String("id", "", "方案 ID（必填）")
	title := fs.String("title", "", "方案標題（必填）")
	category := fs.String("category", "", "方案分類（選填）")
	detail := fs.String("detail", "", "方案內容 JSON 字串（選填，整串替換現有內容）")
	apiURLFlag := fs.String("api", "http://localhost:8082", "partnerserver URL")
	_ = fs.Parse(args)

	if *id == "" {
		fatal("plan update 需要 -id")
	}
	if *title == "" {
		fatal("plan update 需要 -title")
	}
	if *detail != "" {
		var probe any
		if err := json.Unmarshal([]byte(*detail), &probe); err != nil {
			fatal("plan update: -detail 不是合法 JSON: %v", err)
		}
	}

	c := newHTTPClient(*apiURLFlag)
	res, err := c.do("PUT", "/partner/api/plans/"+*id, map[string]string{
		"title": *title, "category": *category, "detail": *detail,
	})
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
