// Command cli 是 entry 的操作工具，供 Claude Code / LLM 直接操作行程資料。
//
// 一律走 HTTP 存取本地或遠端 server（/internal/、/v1/ API）——不再支援直連
// 資料庫（見下方「架構說明」）。
//
// /internal/ API 需要先登入:執行一次 `tripace-cli login --web`（走瀏覽器
// 核准流程，見 login.go）或 `tripace-cli login --device`（無頭環境用的
// device code 流程，同樣見 login.go），換到的 JWT 會存在本機（見
// token.go），之後的指令都會自動帶上，不需要每次都重新登入。
//
// # 架構說明:全部改走 API，維護用/一般使用者用端點分離
//
// CLI 曾經支援 -db 旗標直連 PostgreSQL（繞過 server 的認證與業務邏輯層）,
// 現已完全移除:所有操作一律經過 server 的 HTTP API,不再有任何一條路徑
// 繞過認證/節流/請求記錄。維運性質的操作(景點區域人工建檔等)歸在
// /internal/maintenance/* 命名空間,跟一般使用者會呼叫的 /v1/*、產品核心
// 功能用的 /internal/geo/* 等端點分開,方便從請求統計一眼分辨流量來源
// (見 server/internal/api/maintenance.go 開頭的完整說明)。
//
// # 指令結構:resource-first(「名詞 動詞」),取代原本扁平的「動詞-名詞」
//
// 2026-10 參考 onagent CLI(c:\www\my\agent\backend\cmd\onagent)的設計
// 重構——原本 attraction-add/attraction-update-photo 這類扁平指令,
// 隨著 attraction 底下子指令累積到 9 個,指令字首重複(attraction-)
// 佔掉大半行寬,不容易一眼看出同屬一組資源。改成「tripace-cli attraction
// add」「tripace-cli attraction photo-update」這種兩段式——第一段是
// 資源名詞(trip/entry/attraction),第二段是動詞(add/list/update/...),
// 對齊 `gh repo create`/`kubectl get pods` 的慣例。trip/entry 底下子
// 指令數量少(各 3~4 個),同樣改成二段式以求整體一致,不特別為了指令
// 數量少就維持扁平。login/geocode/notify/version/help 不屬於任何特定
// 資源,維持全域指令不分組。
//
// 子命令:
//
//	login --web       透過瀏覽器核准登入，換取本機快取的 token（其餘指令的前置條件）
//	login --device    無頭環境用:印出一組代碼，在任意裝置手動輸入核准
//	trip list
//	trip create -name 文字
//	trip entries -trip ID
//	trip reset   -trip ID
//	entry add    -trip ID -title 文字 [-start ... -end ... -location ...]
//	entry update -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
//	entry delete -entry ID
//	geocode      -place 文字 [-region 國碼] [-entry ID]
//	notify       -trip ID
//	geo-stats show [-from YYYY-MM-DD] [-to YYYY-MM-DD] [-period day|hour] [-tz 時區] [-json]   Google 呼叫次數與快取命中率
//	partner-grant -email 文字 [-name 文字]   開通某個既有使用者的廣告業主身分（純內部維運操作）
//
// 所有輸出為 JSON（方便 Claude Code 解析）。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/ratelimits"
	"github.com/tim72117/tripace/internal/tripsvc"
)

// client 定義統一的操作介面，由 httpClient 實作。
type client interface {
	listTrips() (any, error)
	createTrip(name string) (any, error)
	tripEntries(tripID string) (any, error)
	record(tripID, title, start, startTime, end, endTime, location string) (any, error)
	updateEntry(in tripsvc.UpdateEntryInput) error
	deleteEntry(entryID string) error
	reset(tripID string) error
	// attractionSyncSetup/attractionSync 見 attraction_sync.go——兩者刻意
	// 不像其餘方法那樣打 c.base(這個 httpClient 實例自己代表的伺服器),
	// 而是打 sync-token 記錄的 target 網址(見 docs/ATTRACTION_SYNC_DESIGN.md
	// 「四、認證」),因為同步的對象是另一台伺服器,不是這個 CLI 當下
	// -api 指向的那一台。
	attractionSyncSetup(target string) (any, error)
	attractionSync(direction string, allowDelete, apply, retry bool) (any, error)
}

// resourceCommand 是某個資源底下的一個動詞指令(例如 attraction 的
// "add"/"photo-update")——對齊 onagent CLI 的 resourceCommand(見
// c:\www\my\agent\backend\cmd\onagent\main.go),usage 是這個指令的
// 一行用法,供 resourceUsage/全域 usage() 組出說明文字,不需要在兩個
// 地方各寫一次。
type resourceCommand struct {
	verb  string
	run   func(args []string)
	usage string // 一行「tripace-cli <resource> <verb> ...」，help/錯誤訊息共用
}

// resource 把一個名詞(例如 "attraction")跟它底下支援的動詞指令分組——
// CLI 最上層的 dispatch table,resource-first、verb-second,對齊
// `gh repo create`/`kubectl get pods` 的慣例。
type resource struct {
	name     string
	commands []resourceCommand
}

// resources 是全部的「名詞 動詞」指令——login/geocode/notify/version/help
// 不屬於任何特定資源,不在這裡,直接在 main() 的 switch 處理(對齊
// onagent main() 對 login/version/help 的既有做法)。
var resources []resource

// buildResources 回傳完整的 resource 清單——寫成函式而非套件層級變數
// 字面值,因為每個 run 閉包都要抓 c(httpClient 實例)跟 apiURL,這兩個
// 值要等 main() 解析完 -api 全域旗標、建好 client 之後才能確定,不能在
// 套件初始化時就固定下來。
func buildResources(c *httpClient, apiURL string) []resource {
	return []resource{
		{
			name: "trip",
			commands: []resourceCommand{
				{verb: "list", run: func(args []string) { cmdTripList(c) }, usage: "tripace-cli trip list"},
				{verb: "create", run: func(args []string) { cmdTripCreate(c, args) }, usage: "tripace-cli trip create -name 文字"},
				{verb: "entries", run: func(args []string) { cmdTripEntries(c, args) }, usage: "tripace-cli trip entries -trip ID"},
				{verb: "reset", run: func(args []string) { cmdTripReset(c, args) }, usage: "tripace-cli trip reset -trip ID"},
			},
		},
		{
			// rate-limit:可設定的拒絕型限流規則(見
			// server/internal/ratelimits 的登錄表與
			// handleMaintenanceRateLimitList/Set 的完整說明)。
			// 2026-10 新增——在這之前要知道目前生效的限流只能讀程式碼,
			// 而程式碼裡的字面值未必等於實際生效值(後台管理介面可能
			// 已經改過資料庫)。
			name: "rate-limit",
			commands: []resourceCommand{
				{verb: "list", run: func(args []string) { cmdRateLimitList(c, args) }, usage: "tripace-cli rate-limit list [-json]"},
				{verb: "set", run: func(args []string) { cmdRateLimitSet(c, args) }, usage: "tripace-cli rate-limit set -endpoint KEY [-window 秒 | -window-ms 毫秒] [-max-calls 次數] [-daily-max 每日上限]"},
			},
		},
		{
			// field-mask:Google Places 查詢要取哪些欄位(見
			// server/internal/fieldmasks 的登錄表與
			// handleMaintenanceFieldMaskList/Set 的完整說明)。
			// 2026-10 新增——field mask 直接決定每次呼叫的計費層級,
			// 單一欄位(editorialSummary)就能讓整個情境從 Pro 跳到
			// Enterprise + Atmosphere。
			name: "field-mask",
			commands: []resourceCommand{
				{verb: "list", run: func(args []string) { cmdFieldMaskList(c, args) }, usage: "tripace-cli field-mask list [-json]"},
				{verb: "set", run: func(args []string) { cmdFieldMaskSet(c, args) }, usage: "tripace-cli field-mask set -scenario KEY -fields a,b,c"},
			},
		},
		{
			// geo-stats:Google API 呼叫次數,依日期區間與週期(day/hour)
			// 分組(見 handleMaintenanceGeoAPIStats)。只有請求筆數,
			// 沒有當時的計費層級。
			name: "geo-stats",
			commands: []resourceCommand{
				{verb: "show", run: func(args []string) { cmdGeoStatsShow(c, args) }, usage: "tripace-cli geo-stats show [-from YYYY-MM-DD] [-to YYYY-MM-DD] [-period day|hour] [-tz 時區] [-json]"},
			},
		},
		{
			// geo-setting:可線上調整的數值設定(照片最大張數、照片過期週期,
			// 見 server/internal/geosettings 的登錄表與
			// handleMaintenanceGeoSettingList/Set 的完整說明)。
			// 2026-10 新增——這兩個值直接決定 Google Place Photos 與
			// places.get 的呼叫量與費用,原本寫死在程式碼裡。
			name: "geo-setting",
			commands: []resourceCommand{
				{verb: "list", run: func(args []string) { cmdGeoSettingList(c, args) }, usage: "tripace-cli geo-setting list [-json]"},
				{verb: "set", run: func(args []string) { cmdGeoSettingSet(c, args) }, usage: "tripace-cli geo-setting set -key KEY -value 數值"},
			},
		},
		{
			name: "entry",
			commands: []resourceCommand{
				{verb: "add", run: func(args []string) { cmdEntryAdd(c, args) }, usage: "tripace-cli entry add -trip ID -title 文字 [-start ...] [-start-time ...] [-end ...] [-end-time ...] [-location ...]"},
				{verb: "update", run: func(args []string) { cmdEntryUpdate(c, args) }, usage: "tripace-cli entry update -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]"},
				{verb: "delete", run: func(args []string) { cmdEntryDelete(c, args) }, usage: "tripace-cli entry delete -entry ID"},
			},
		},
		{
			name: "attraction",
			commands: []resourceCommand{
				{verb: "add", run: func(args []string) { cmdAttractionAdd(c, args) }, usage: "tripace-cli attraction add -name 文字 -city 文字 (-lat 緯度 -lng 經度 | -place 文字 [-region 國碼]) -level 1~5 [-radius 公尺] [-summary 文字] [-place-id ID] [-theme]"},
				{verb: "list", run: func(args []string) { cmdAttractionList(c, args) }, usage: "tripace-cli attraction list -city 文字"},
				{verb: "cities", run: func(args []string) { cmdAttractionCities(c) }, usage: "tripace-cli attraction cities"},
				{verb: "query", run: func(args []string) { cmdAttractionQuery(c, args) }, usage: "tripace-cli attraction query -status no-google-photo [-city 文字]"},
				{verb: "delete", run: func(args []string) { cmdAttractionDelete(c, args) }, usage: "tripace-cli attraction delete -id 地標ID"},
				{verb: "update", run: func(args []string) { cmdAttractionUpdate(c, args) }, usage: "tripace-cli attraction update -id 地標ID [-lat 緯度 -lng 經度 | -place 文字 [-region 國碼]] [-field 欄位名 -value 新內容]"},
				{verb: "set-place-id", run: func(args []string) { cmdAttractionSetPlaceID(c, args) }, usage: "tripace-cli attraction set-place-id -id 地標ID (-place-id ID | -place 文字 [-region 國碼])"},
				{verb: "set-theme", run: func(args []string) { cmdAttractionSetTheme(c, args) }, usage: "tripace-cli attraction set-theme -id 地標ID -theme=true|false"},
				{verb: "photo-update", run: func(args []string) { cmdAttractionUpdatePhoto(apiURL, args) }, usage: "tripace-cli attraction photo-update -id 地標ID [-query 文字] [-place-id ID]"},
				{verb: "sync-setup", run: func(args []string) { cmdAttractionSyncSetup(c, args) }, usage: "tripace-cli attraction sync-setup -target 正式站網址"},
				{verb: "sync", run: func(args []string) { cmdAttractionSync(c, args) }, usage: "tripace-cli attraction sync -direction push|pull [-allow-delete] [-apply] [-retry]"},
			},
		},
		{
			// content-page:主題介紹頁/部落格文章內容管理(見 docs/
			// refactor-theme-page-content-cms-plan-2026-10.md、
			// server/internal/api/content_page.go)——九份/京都/台南等
			// 城市主題介紹頁,原本整篇文案手寫在各自的 .tsx 檔案裡,改成
			// 透過這組指令編輯、存進資料庫,前端打 API 讀取內容渲染;
			// 2026-10 起同一組指令也承載部落客發文,資源名稱從
			// theme-page 改成 content-page,對齊後端型別/表名一起改名
			// (見 model.ContentPage/store.contentPageRow 的完整說明)。
			//
			// -official 旗標(2026-10 新增,破壞性變更,見各 cmdContentPage*
			// 函式開頭的完整說明)——預設(不加這個旗標)現在是「使用者
			// 自己的身份」:ownerID 由後端從登入者的 JWT 解析,用於部落格
			// 發文;加了 -official 才是維持改動前的行為,ownerID 固定
			// 空字串,服務城市介紹頁等官方內容。**之後編寫城市介紹頁都要
			// 記得加 -official 旗標**,這是使用者明確確認過的刻意設計,
			// 不是疏漏。
			//
			// -official 需要管理員權限(2026-10 新增,修正 code review
			// 發現的權限提升漏洞,見 server/internal/api/content_page.go
			// resolveContentPageOwnerID 的完整說明):登入者的 email 必須
			// 等於後端 ADMIN_BOOTSTRAP_EMAIL 環境變數設定的值,否則這個
			// 旗標會被後端拒絕(403),不是任何已登入使用者都能用——原本
			// 這裡完全沒有這層檢查,任何登入者都能編輯/刪除官方內容。
			name: "content-page",
			commands: []resourceCommand{
				{verb: "add", run: func(args []string) { cmdContentPageAdd(c, args) }, usage: "tripace-cli content-page add -slug 文字 (-content JSON | -content-file 路徑) [-official]"},
				{verb: "list", run: func(args []string) { cmdContentPageList(c) }, usage: "tripace-cli content-page list"},
				{verb: "get", run: func(args []string) { cmdContentPageGet(c, args) }, usage: "tripace-cli content-page get -slug 文字 [-official]"},
				{verb: "set", run: func(args []string) { cmdContentPageSet(c, args) }, usage: "tripace-cli content-page set -slug 文字 (-content JSON | -content-file 路徑) [-official]"},
				{verb: "publish", run: func(args []string) { cmdContentPagePublish(c, args, true) }, usage: "tripace-cli content-page publish -slug 文字 [-official]"},
				{verb: "unpublish", run: func(args []string) { cmdContentPagePublish(c, args, false) }, usage: "tripace-cli content-page unpublish -slug 文字 [-official]"},
				{verb: "delete", run: func(args []string) { cmdContentPageDelete(c, args) }, usage: "tripace-cli content-page delete -slug 文字 [-official]"},
			},
		},
		{
			// itinerary-page:範例行程內容管理(見「AI 排過的主題行程
			// 展示」構想、server/internal/api/itinerary_page.go)——原本
			// 寫死在 web/src/itineraries/example/*.ts 的範例行程
			// 檔案,改成透過這組指令編輯、存進資料庫,前端打 API 讀取
			// 內容渲染。
			//
			// 沒有 -official 旗標——跟 content-page 不同,範例行程目前
			// 只有官方命名空間一種情境(沒有使用者自己發布行程的概念,
			// 見 model.ItineraryPage/store.itineraryPageRow 的完整
			// 說明),所有操作固定要求呼叫者是管理員(email 在
			// ADMIN_BOOTSTRAP_EMAIL 白名單內,見
			// requireItineraryPageAdmin 的完整說明),不需要像
			// content-page 那樣額外用旗標切換身份。
			name: "itinerary-page",
			commands: []resourceCommand{
				{verb: "add", run: func(args []string) { cmdItineraryPageAdd(c, args) }, usage: "tripace-cli itinerary-page add -slug 文字 (-content JSON | -content-file 路徑)"},
				{verb: "list", run: func(args []string) { cmdItineraryPageList(c) }, usage: "tripace-cli itinerary-page list"},
				{verb: "get", run: func(args []string) { cmdItineraryPageGet(c, args) }, usage: "tripace-cli itinerary-page get -slug 文字"},
				{verb: "set", run: func(args []string) { cmdItineraryPageSet(c, args) }, usage: "tripace-cli itinerary-page set -slug 文字 (-content JSON | -content-file 路徑)"},
				{verb: "publish", run: func(args []string) { cmdItineraryPagePublish(c, args, true) }, usage: "tripace-cli itinerary-page publish -slug 文字"},
				{verb: "unpublish", run: func(args []string) { cmdItineraryPagePublish(c, args, false) }, usage: "tripace-cli itinerary-page unpublish -slug 文字"},
				{verb: "delete", run: func(args []string) { cmdItineraryPageDelete(c, args) }, usage: "tripace-cli itinerary-page delete -slug 文字"},
			},
		},
		{
			// blog-profile:「部落客公開身份」設定(handle + 頭像網址,見
			// server/internal/api/blog_profile.go)——用登入者自己的 JWT
			// 身份(s.userFor(r)解析),不需要也不支援指定任意 ownerID,
			// 跟 content-page 的 -official 身份切換不是同一回事:這組
			// 指令永遠只操作「目前登入者自己」的 profile。
			name: "blog-profile",
			commands: []resourceCommand{
				{verb: "set", run: func(args []string) { cmdBlogProfileSet(c, args) }, usage: "tripace-cli blog-profile set -handle 文字 [-avatar-url https://...]"},
				{verb: "get", run: func(args []string) { cmdBlogProfileGet(c) }, usage: "tripace-cli blog-profile get"},
			},
		},
		{
			// blog-photo:部落格配圖上傳與管理(見
			// server/internal/api/blog_photo.go 開頭的完整說明)。身份
			// 固定是登入者自己,跟 blog-profile 一樣不支援 -official。
			// upload 是這組指令裡唯一一個組合了「簽發 pre-signed
			// URL→直接 PUT 檔案→回報完成」三個步驟的複合動詞(對應
			// 前端 PhotoManagerPage 實際發生的三次獨立 API 呼叫),
			// 其餘動詞各自對應單一後端端點。
			name: "blog-photo",
			commands: []resourceCommand{
				{verb: "upload", run: func(args []string) { cmdBlogPhotoUpload(c, args) }, usage: "tripace-cli blog-photo upload -file 路徑 -content-type image/jpeg [-skip-process] [-sync] [-note 文字]"},
				{verb: "list", run: func(args []string) { cmdBlogPhotoList(c) }, usage: "tripace-cli blog-photo list"},
				{verb: "retry", run: func(args []string) { cmdBlogPhotoRetry(c, args) }, usage: "tripace-cli blog-photo retry -id 文字 [-sync]"},
				{verb: "focal", run: func(args []string) { cmdBlogPhotoFocal(c, args) }, usage: "tripace-cli blog-photo focal -id 文字 -x 0.5 -y 0.5"},
				{verb: "note", run: func(args []string) { cmdBlogPhotoNote(c, args) }, usage: "tripace-cli blog-photo note -id 文字 -note 文字"},
				{verb: "rating", run: func(args []string) { cmdBlogPhotoRating(c, args) }, usage: "tripace-cli blog-photo rating -id 文字 -rating 1~3(0 清空)"},
				{verb: "delete", run: func(args []string) { cmdBlogPhotoDelete(c, args) }, usage: "tripace-cli blog-photo delete -id 文字"},
			},
		},
	}
}

// defaultAPIURL——所有子命令 -api 旗標未指定時的預設值。2026-10 改成
// 正式網域(原為 http://localhost:8080):使用者明確要求「正式機預設不用
// 加網址」,CLI 主要使用情境已經是對正式環境查詢/調整(例如
// rate-limit list/set),本機開發時改為明確帶 -api http://localhost:8080
// (風險取捨:trip reset/entry delete/attraction delete 這類會刪資料的
// 指令,沒加 -api 時現在預設也會打正式環境,使用者已確認接受這個行為)。
const defaultAPIURL = "https://tripace.io"

// findResource 回傳名為 name 的資源，查無則回傳 nil。
func findResource(resources []resource, name string) *resource {
	for i := range resources {
		if resources[i].name == name {
			return &resources[i]
		}
	}
	return nil
}

// findCommand 回傳 r 底下動詞為 verb 的指令，查無則回傳 nil。
func findCommand(r *resource, verb string) *resourceCommand {
	for i := range r.commands {
		if r.commands[i].verb == verb {
			return &r.commands[i]
		}
	}
	return nil
}

func main() {
	// 全域旗標（在子命令前解析）——先於 resources 建立/len(os.Args)<2
	// 的提早返回,因為兩者都可能呼叫 usage(),而 usage() 底層的
	// topUsage()/resourceUsage() 讀取套件層級的 resources 變數,必須在
	// 任何可能呼叫 usage() 的分支之前就就緒,否則會印出空的指令清單。
	apiURL := defaultAPIURL
	args1 := os.Args[1:]
	filtered := args1[:0:len(args1)]
	for i := 0; i < len(args1); i++ {
		a := args1[i]
		if len(a) > 5 && a[:5] == "-api=" {
			apiURL = a[5:]
			continue
		}
		if a == "-api" && i+1 < len(args1) {
			apiURL = args1[i+1]
			i++
			continue
		}
		filtered = append(filtered, a)
	}
	os.Args = append(os.Args[:1], filtered...)

	c := newHTTPClient(apiURL)
	resources = buildResources(c, apiURL)

	if len(os.Args) < 2 {
		usage(nil)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "login":
		if err := runLogin(apiURL, args); err != nil {
			fatal("login: %v", err)
		}
		return
	case "geocode":
		cmdGeocode(args, apiURL)
		return
	case "notify":
		cmdNotify(args, apiURL)
		return
	case "partner-grant":
		cmdPartnerGrant(args, apiURL)
		return
	case "-h", "--help", "help":
		usage(args)
		return
	}

	r := findResource(resources, cmd)
	if r == nil {
		fatal("未知資源 %q（用 -h 看用法）", cmd)
	}
	dispatchResource(r, args)
}

// dispatchResource 解析 r 底下的動詞(args[0])並執行對應的 run 函式——
// 對齊 onagent CLI 的 dispatchResource(見 c:\www\my\agent\backend\cmd\
// onagent\main.go)。動詞不存在或缺少時印出這個資源的用法並以非零碼
// 結束(fatal 內部已經是 log.Fatalf,會自動結束 process)。
func dispatchResource(r *resource, args []string) {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		fmt.Fprint(os.Stderr, resourceUsage(r))
		if len(args) == 0 {
			fatal("缺少 %q 的子指令", r.name)
		}
		os.Exit(0)
	}

	verb := args[0]
	rest := args[1:]

	cmd := findCommand(r, verb)
	if cmd == nil {
		fmt.Fprint(os.Stderr, resourceUsage(r))
		fatal("未知指令 %q（資源 %q 底下）", verb, r.name)
	}
	cmd.run(rest)
}

func cmdTripList(c client) {
	res, err := c.listTrips()
	if err != nil {
		fatal("trip list: %v", err)
	}
	output(res)
}

func cmdTripCreate(c client, args []string) {
	fs := flag.NewFlagSet("trip create", flag.ExitOnError)
	name := fs.String("name", "", "行程名稱（必填）")
	_ = fs.Parse(args)
	if *name == "" {
		fatal("trip create 需要 -name")
	}
	res, err := c.createTrip(*name)
	if err != nil {
		fatal("trip create: %v", err)
	}
	output(res)
}

func cmdEntryAdd(c client, args []string) {
	fs := flag.NewFlagSet("entry add", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	title := fs.String("title", "", "事項描述（必填）")
	start := fs.String("start", "", "開始日期 'YYYY-MM-DD'")
	startTime := fs.String("start-time", "", "開始時刻 'HH:MM'")
	end := fs.String("end", "", "結束日期 'YYYY-MM-DD'（區間用）")
	endTime := fs.String("end-time", "", "結束時刻 'HH:MM'")
	location := fs.String("location", "", "地點")
	_ = fs.Parse(args)
	if *trip == "" || *title == "" {
		fatal("entry add 需要 -trip 與 -title")
	}
	res, err := c.record(*trip, *title, *start, *startTime, *end, *endTime, *location)
	if err != nil {
		fatal("entry add: %v", err)
	}
	output(res)
}

func cmdEntryUpdate(c client, args []string) {
	fs := flag.NewFlagSet("entry update", flag.ExitOnError)
	id := fs.String("entry", "", "entry ID（必填）")
	title := fs.String("title", "", "事項描述")
	start := fs.String("start", "", "開始時間")
	end := fs.String("end", "", "結束時間")
	location := fs.String("location", "", "地點")
	note := fs.String("note", "", "細節描述")
	kind := fs.String("kind", "", "類型: stay|flight|activity|note|car|restaurant|ticket")
	detail := fs.String("detail", "", "kind 專屬細節（JSON 字串）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("entry update 需要 -entry")
	}
	var detailMap map[string]any
	if *detail != "" {
		if err := json.Unmarshal([]byte(*detail), &detailMap); err != nil {
			fatal("detail 必須是合法 JSON: %v", err)
		}
	}
	if err := c.updateEntry(tripsvc.UpdateEntryInput{
		ID: *id, Title: *title, Start: *start, End: *end, Location: *location,
		Note: *note, Kind: *kind, Detail: detailMap,
	}); err != nil {
		fatal("entry update: %v", err)
	}
	output(map[string]string{"updated": *id})
}

func cmdEntryDelete(c client, args []string) {
	fs := flag.NewFlagSet("entry delete", flag.ExitOnError)
	id := fs.String("entry", "", "entry ID（必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("entry delete 需要 -entry")
	}
	if err := c.deleteEntry(*id); err != nil {
		fatal("entry delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// cmdTripEntries 列出某個行程的所有 entry。
func cmdTripEntries(c client, args []string) {
	fs := flag.NewFlagSet("trip entries", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	_ = fs.Parse(args)
	if *trip == "" {
		fatal("trip entries 需要 -trip")
	}
	res, err := c.tripEntries(*trip)
	if err != nil {
		fatal("trip entries: %v", err)
	}
	output(res)
}

func cmdTripReset(c client, args []string) {
	fs := flag.NewFlagSet("trip reset", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	_ = fs.Parse(args)
	if *trip == "" {
		fatal("trip reset 需要 -trip")
	}
	if err := c.reset(*trip); err != nil {
		fatal("trip reset: %v", err)
	}
	output(map[string]string{"status": "ok", "trip": *trip})
}

func cmdNotify(args []string, defaultAPI string) {
	fs := flag.NewFlagSet("notify", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	apiURL := fs.String("api", defaultAPI, "server base URL")
	_ = fs.Parse(args)
	if *trip == "" {
		fatal("notify 需要 -trip")
	}
	notifyTrip(*trip, *apiURL)
	output(map[string]string{"notified": *trip})
}

// resolveCoords 依 -lat/-lng 或 -place 決定座標,供 cmdAttractionAdd 與
// cmdAttractionUpdate 共用——兩者原本各自內聯一份逐字重複的邏輯(查詢
// geocode、剝 JSON、取第一筆候選),抽成純函式後不只省重複,還讓這段
// 邏輯第一次變得可單元測試(原本夾在 flag.Parse 與 fatal() 之間,
// fatal 會直接 os.Exit,無法在測試裡攔截)。
//
// haveCoords 明確帶 -lat/-lng 時優先採用,不查 geocode,讓使用者在已知
// 精確座標時能跳過一次網路查詢;否則要求 place 非空,改查該地名的座標
// (取第一筆候選結果),不需要使用者自己先查好經緯度。lat/lng 皆為 0
// 視為「未帶」——這在理論上會誤判座標剛好落在赤道或本初子午線的地點,
// 但 tripace 目前的資料範圍(日本/台灣/泰國等)不會出現這種座標,不為
// 這個理論邊界增加旗標複雜度(例如改用 *float64 或另開 -coords 旗標)。
// resolveCoords 解析 -lat/-lng 或 -place 二擇一的座標輸入,額外回傳查詢
// 候選地點附帶的 place_id(第三個回傳值 placeID)——只有走 -place 查詢
// 分支、且該筆候選結果確實有解析出 place_id(見 geo.Place.PlaceID 的
// 完整說明,json tag 已從 "-" 改成輸出 "placeId")時才會有值,明確帶
// -lat/-lng 的分支、或查詢結果沒有 place_id 時回傳空字串,不是錯誤——
// place_id 是選填的加值資訊,呼叫端(cmdAttractionAdd/cmdAttractionUpdate)
// 自行決定拿到空字串時要不要當作沒有變動。
func resolveCoords(c *httpClient, lat, lng float64, place, region string) (float64, float64, string, error) {
	if lat != 0 || lng != 0 {
		return lat, lng, "", nil
	}
	if place == "" {
		return 0, 0, "", fmt.Errorf("需要 -lat/-lng 或 -place 其中一組")
	}

	q := url.Values{}
	q.Set("place", place)
	if region != "" {
		q.Set("region", region)
	}
	geoRes, err := c.do("GET", "/internal/maintenance/geocode?"+q.Encode(), nil)
	if err != nil {
		return 0, 0, "", fmt.Errorf("geocode: %w", err)
	}
	places, _ := geoRes["places"].([]any)
	if len(places) == 0 {
		return 0, 0, "", fmt.Errorf("-place 查無候選地點")
	}
	first, _ := places[0].(map[string]any)
	newLat, _ := first["lat"].(float64)
	newLng, _ := first["lng"].(float64)
	newPlaceID, _ := first["placeId"].(string)
	return newLat, newLng, newPlaceID, nil
}

// cmdAttractionAdd 新增一筆景點區域資料(見 model.Attraction 的完整說明)。
// 走 POST /internal/maintenance/attractions(見
// server/internal/api/maintenance.go)——這是人工建檔操作,不開放給一般
// 使用者的 /v1/* 寫入,但跟其餘 CLI 指令一樣走 HTTP + JWT 登入路徑,不再
// 直連資料庫(見本檔案開頭「架構說明」)。
//
// 不支援 -photo-url——attractions.photo_url 這個相容欄位已經連同資料庫
// 欄位本身徹底移除(見 cmd/migrate-drop-photo-url 的完整說明)。建檔時
// 一律不帶照片,之後要補照片用 attraction photo-update(需要這筆地標
// 先有 place_id)。
//
// -lat/-lng 與 -place 二擇一,做法與 cmdAttractionUpdate 一致(見
// resolveCoords 的完整說明):-place 有值時改用 GET
// /internal/maintenance/geocode 查詢該地名的座標,取第一筆候選結果當
// 建檔座標,不需要使用者自己先查好經緯度;明確帶 -lat/-lng 時優先採用
// (不查 geocode)。兩個子命令共用同一段查詢邏輯,不再各自維護一份。
func cmdAttractionAdd(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction add", flag.ExitOnError)
	name := fs.String("name", "", "地標/區域白話名稱（必填），如「古城區」「101」")
	city := fs.String("city", "", "所屬城市名稱（必填），對齊 GET /internal/geo/attractions?city= 的查詢字串")
	lat := fs.Float64("lat", 0, "緯度（與 -place 二擇一）")
	lng := fs.Float64("lng", 0, "經度（與 -place 二擇一）")
	place := fs.String("place", "", "改查這個地名的座標（與 -lat/-lng 二擇一，取第一筆候選結果）")
	region := fs.String("region", "", "地名查詢的國家代碼限制，如 jp / tw / cn（僅搭配 -place 使用，選填）")
	level := fs.Int("level", 0, "知名度分級（必填），1=國際 2=國家 3=區域 4=城市 5=在地")
	radius := fs.Int("radius", 0, "大致範圍半徑（公尺），0 表示這是單點地標而非有範圍的區域")
	summary := fs.String("summary", "", "白話簡介（選填）")
	category := fs.String("category", "", "「附近景點」清單用的店家分類（選填），見 model.Attraction.Category 的完整說明，目前前端 CuratedCategory 定義的合法值為 tea/restaurant/craft/street，這裡不驗證列舉值")
	// placeIDFlag:讓使用者可以不透過 -place 查詢、直接明確指定 place_id
	// ——例如使用者已經從別處(如 Google Maps 網頁版分享連結)拿到確切的
	// place_id,不需要再讓 -place 的文字查詢去猜一次(文字查詢可能因為
	// 地名口語化/多個同名候選而選到不是使用者原本想要的那筆)。有值時
	// 優先採用(不查 -place 查詢結果附帶的 place_id),對齊 -lat/-lng
	// 優先於 -place 查詢結果的既有慣例。
	placeIDFlag := fs.String("place-id", "", "手動指定這個景點對應的 Google place_id（選填，優先於 -place 查詢結果附帶的 place_id）；有值時可讓前端開始使用漸進補圖機制取得照片")
	// themeFlag:決定 model.Attraction.IsTheme 的值(散策羅盤用語,見
	// model.Attraction.IsTheme 欄位註解的完整說明)——主題點是使用者點開後
	// 會揭露周邊「精選點」的錨點,非主題點(精選點)預設不顯示。預設值
	// false 只是 flag.Bool 語法上要求的初始值,實際套用的預設行為見下方
	// fs.Visit 判斷:未明確帶這個 flag 時,依 model.Attraction.IsTheme 欄位
	// 註解記載的既有慣例,退回用 -level === 1 自動推斷(對齊本函式下方
	// 「非主題點強制要求 place_id」那段判斷式的既有語意),而不是一律預設
	// false——這樣才不會讓沒特別處理過 -theme 的既有建檔流程,建出一批
	// level=1 卻 IsTheme=false 的資料。若使用者明確帶 -theme(不論
	// -theme=true 或 -theme=false),一律以使用者輸入為準,允許之後
	// IsTheme 跟 Level 分開設定(例如某個 level 2 的地點也想設為主題點)。
	themeFlag := fs.Bool("theme", false, "是否為「主題點」（選填，決定 model.Attraction.IsTheme；散策羅盤用語，主題點是使用者點開後會揭露周邊精選點的錨點）。未明確帶這個 flag 時，依 -level===1 自動推斷（對齊既有慣例）；明確帶 -theme=true 或 -theme=false 時，一律以使用者輸入為準，可讓 IsTheme 跟 -level 分開設定")
	_ = fs.Parse(args)
	if *name == "" || *city == "" || *level == 0 {
		fatal("attraction add 需要 -name、-city、-level（1~5）")
	}
	if *level < 1 || *level > 5 {
		fatal("attraction add 的 -level 必須介於 1~5")
	}

	newLat, newLng, resolvedPlaceID, err := resolveCoords(c, *lat, *lng, *place, *region)
	if err != nil {
		fatal("attraction add: %v", err)
	}

	// isTheme 決定順序:使用者明確帶 -theme(不論 true/false)時以其為準;
	// 否則退回用 -level === 1 自動推斷(見上方 themeFlag 宣告處的完整
	// 說明、model.Attraction.IsTheme 欄位註解)。用 fs.Visit 判斷使用者是
	// 否「有傳這個 flag」,因為 flag.Bool 本身無法區分「沒傳」跟「傳了
	// -theme=false」這兩種情況。
	isTheme := *level == 1
	themeFlagSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "theme" {
			themeFlagSet = true
		}
	})
	if themeFlagSet {
		isTheme = *themeFlag
	}

	in := model.Attraction{
		Name: *name, CityName: *city, Lat: newLat, Lng: newLng,
		Level: *level, IsTheme: isTheme, RadiusMeters: *radius,
	}
	if *summary != "" {
		in.Summary = summary
	}
	if *category != "" {
		in.Category = category
	}
	// place_id 優先順序:使用者明確帶 -place-id > -place 查詢結果附帶的
	// place_id > 都沒有時維持 nil。
	finalPlaceID := *placeIDFlag
	if finalPlaceID == "" {
		finalPlaceID = resolvedPlaceID
	}
	// 非主題點(isTheme === false)強制要求要有 place_id——「主題點/非
	// 主題點」是這次「點擊 attraction 改開 place 資訊卡」功能(見
	// web/src/geo-planning/GeoOutlineMap.tsx 的 handleAttractionClickRouted)
	// 的判斷依據。這裡改用上方算出的 isTheme(預設等同 level===1,但使用者
	// 明確帶 -theme 時可以覆寫),不再直接看 *level,對齊
	// model.Attraction.IsTheme 欄位註解「IsTheme 跟 Level 之後可以獨立
	// 設定」的說明——例如使用者明確用 -theme=true 把某個 level 2 的地點
	// 設為主題點時,place_id 檢查也要跟著放寬,否則會出現「明明設定成主題
	// 點卻還被當非主題點擋下來」的矛盾。前端點擊非主題點時完全依賴
	// placeId 去打 /internal/geo/place-details,沒有 place_id 就查不到
	// 任何東西、點擊會沒有反應。與其讓這批資料悄悄建檔成「看起來正常、
	// 點下去卻沒有卡片可看」的壞資料,寧可在建檔當下就擋下來,把問題攤在
	// 使用者眼前——不論這個 place_id 是使用者用 -place-id 明確指定,或是
	// -place 查詢帶回的,只要最終有值就算滿足要求;-lat/-lng 手動指定座標
	// 的路徑沒有查詢可以帶回 place_id,若同時也沒帶 -place-id,一律視為
	// 不符合要求。主題點不受影響,place_id 仍是選填(主題點本身就會開
	// attraction 自己的介紹卡,不依賴 place_id)。
	if !isTheme && finalPlaceID == "" {
		fatal("attraction add: 非主題點(isTheme 為 false，預設等同 level 不是 1)必須有 place_id(前端點擊時會改開 place 資訊卡,沒有 place_id 會查不到資料)——請用 -place-id 明確指定,或改用 -place 查詢且該地名查得到 place_id")
	}
	if finalPlaceID != "" {
		in.PlaceID = &finalPlaceID
	}
	res, err := c.attractionAdd(in)
	if err != nil {
		fatal("attraction add: %v", err)
	}
	output(res)
}

// cmdAttractionList 列出指定城市的所有景點區域資料。走
// GET /internal/maintenance/attractions?city=(見 http.go 的
// httpClient.attractionList)。
func cmdAttractionList(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction list", flag.ExitOnError)
	city := fs.String("city", "", "城市名稱（必填）")
	_ = fs.Parse(args)
	if *city == "" {
		fatal("attraction list 需要 -city")
	}
	res, err := c.attractionList(*city)
	if err != nil {
		fatal("attraction list: %v", err)
	}
	output(res)
}

// cmdAttractionCities 列出目前已有景點區域資料的城市清單。走
// GET /internal/maintenance/attractions/cities。
func cmdAttractionCities(c *httpClient) {
	res, err := c.attractionCities()
	if err != nil {
		fatal("attraction cities: %v", err)
	}
	output(res)
}

// cmdAttractionQuery 是通用的景點區域狀態查詢入口——走
// GET /internal/maintenance/attractions/query(見
// httpClient.attractionQuery 與 handleMaintenanceAttractionQuery 的
// 完整說明)。-status 挑選要查哪種狀態,目前只支援 no-google-photo
// (有登記 place_id、但 photo_assets 裡沒有任何仍在有效期內的紀錄,
// 實際上規劃地圖/AI Plan 只會顯示 placeholder 的那批景點)。之後若要
// 支援新的 status 值,只需要在後端 switch 多加一個 case,這裡的旗標
// 解析邏輯不需要跟著改(status 只是原樣透傳的字串)。-city 選填,空字串
// 代表查全部城市。
func cmdAttractionQuery(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction query", flag.ExitOnError)
	status := fs.String("status", "", "要查詢的狀態（必填，目前支援：no-google-photo）")
	city := fs.String("city", "", "城市名稱（選填，不帶則查全部城市）")
	_ = fs.Parse(args)
	if *status == "" {
		fatal("attraction query 需要 -status")
	}
	res, err := c.attractionQuery(*status, *city)
	if err != nil {
		fatal("attraction query: %v", err)
	}
	output(res)
}

// cmdAttractionDelete 刪除一筆景點區域資料。走
// DELETE /internal/maintenance/attractions/{id}。
func cmdAttractionDelete(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction delete", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction delete 需要 -id")
	}
	if err := c.attractionDelete(*id); err != nil {
		fatal("attraction delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// cmdAttractionUpdate 修正一筆景點區域資料的座標和/或其他單一欄位——
// 座標走 PATCH /internal/maintenance/attractions/{id}/coords(見
// httpClient.attractionUpdateCoords 的完整說明);其餘欄位(目前開放
// name、summary,見 store.attractionUpdatableFields 白名單)走通用的
// PATCH .../field,用 -field 指定欄位名、-value 指定新內容(見
// httpClient.attractionUpdateField)。新增可更新欄位只需要在後端白名單
// 加一行,不需要在這裡多加一組 CLI flag——理由同
// handleMaintenanceAttractionUpdateCoords 的說明:座標需要同時處理兩個
// 數字欄位、且有 geocode 查詢邏輯,不適合塞進這個通用機制,維持獨立。
// -field/-value 與座標修正互不排斥,可以同時帶入、也可以只改其中一種。
//
// -lat/-lng 與 -place 二擇一:-place 有值時改用 GET
// /internal/maintenance/geocode 查詢該地名的座標(對齊 cmdGeocode 的
// -entry 寫回模式,見 geocode.go),取第一筆候選結果當新座標,不需要
// 使用者自己查好經緯度再手動輸入;明確帶 -lat/-lng 時優先採用(不查
// geocode),讓使用者仍能在已知精確座標時跳過一次網路查詢。
func cmdAttractionUpdate(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction update", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	lat := fs.Float64("lat", 0, "新緯度（與 -place 二擇一）")
	lng := fs.Float64("lng", 0, "新經度（與 -place 二擇一）")
	place := fs.String("place", "", "改查這個地名的座標（與 -lat/-lng 二擇一，取第一筆候選結果）")
	region := fs.String("region", "", "地名查詢的國家代碼限制，如 jp / tw / cn（僅搭配 -place 使用，選填）")
	field := fs.String("field", "", "要更新的欄位名（目前開放 name、summary，與 -value 一起使用）")
	value := fs.String("value", "", "-field 指定欄位的新內容")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction update 需要 -id")
	}
	haveCoords := *lat != 0 || *lng != 0
	if !haveCoords && *place == "" && *field == "" {
		fatal("attraction update 需要 -lat/-lng、-place 或 -field/-value 其中一項")
	}
	if (*field == "") != (*value == "") {
		fatal("attraction update 的 -field 與 -value 必須一起提供")
	}

	if haveCoords || *place != "" {
		// 第三個回傳值(place_id)這裡不需要——attraction update 只修正座標,
		// 不動 place_id;要補上/修改 place_id 用 attraction set-place-id
		// (見該指令的說明)。
		newLat, newLng, _, err := resolveCoords(c, *lat, *lng, *place, *region)
		if err != nil {
			fatal("attraction update: %v", err)
		}

		res, err := c.attractionUpdateCoords(*id, newLat, newLng)
		if err != nil {
			fatal("attraction update: %v", err)
		}
		output(res)
	}

	if *field != "" {
		res, err := c.attractionUpdateField(*id, *field, *value)
		if err != nil {
			fatal("attraction update: %v", err)
		}
		output(res)
	}
}

// cmdAttractionSetPlaceID 補上(或清空)一筆既有景點區域對應的 Google
// place_id——走 PATCH /internal/maintenance/attractions/{id}/place-id(見
// httpClient.attractionUpdatePlaceID 的完整說明)。獨立於 attraction update
// 之外(不塞進 -field/-value 通用機制),理由同後端 handler 的說明:
// place_id 允許明確傳空字串清空,跟 -field/-value 那組欄位「不可為空」的
// 既有語意不同。
//
// 使用情境:這批 attraction 資料原本(2026-09 之前)完全沒有 place_id
// 概念,既有已建檔的景點區域不會自動補上——透過這個指令補上後,前端
// (AttractionInfoPanel.tsx)才會開始改用「地點照片漸進補圖機制」的
// Google/Pexels 雙來源照片,取代/補強單一的 photo_url。新建的景點區域
// 可以直接用 attraction add -place-id(或 -place 查詢自動帶出),不需要
// 額外再跑這個指令。
//
// -place-id(手動指定)與 -place(改查地名)二擇一,互斥:-place-id 是
// 使用者已經從別處(如 Google Maps 網頁版分享連結)拿到確切的
// place_id,直接信任這個輸入、不再查詢驗證它是否有效(對齊
// attraction add 對這個 flag 的既有慣例,見該處說明);-place 則跟
// attraction add 共用同一支 resolveCoords 查詢地名的座標/place_id,不
// 重新實作一次查詢邏輯。優先序:兩者都帶視為使用者輸入衝突,直接報錯
// 而非靜默選一個(這裡沒有明顯的「合理預設」可言——不像
// attraction add 的 -lat/-lng 優先於 -place 查詢結果附帶的
// place_id,那是「精確輸入優先於查詢猜測」的單向覆蓋關係;這裡兩個
// flag 各自都是使用者主動指定的明確意圖,同時給很可能是誤用,錯誤
// 訊息比默默選一個更安全)。resolveCoords 查到的座標在這裡用不到
// (這個指令只改 place_id,不動座標),只取第三個回傳值。
func cmdAttractionSetPlaceID(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction set-place-id", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	placeID := fs.String("place-id", "", "手動指定 Google place_id（與 -place 二擇一，信任使用者輸入，不查詢驗證）")
	place := fs.String("place", "", "改查這個地名帶回的 place_id（與 -place-id 二擇一，取第一筆候選結果，查詢邏輯與 attraction add 共用）")
	region := fs.String("region", "", "地名查詢的國家代碼限制，如 jp / tw / cn（僅搭配 -place 使用，選填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction set-place-id 需要 -id")
	}
	if *placeID != "" && *place != "" {
		fatal("attraction set-place-id 的 -place-id 與 -place 二擇一，不能同時提供")
	}
	if *placeID == "" && *place == "" {
		fatal("attraction set-place-id 需要 -place-id 或 -place 其中一項")
	}

	finalPlaceID := *placeID
	if finalPlaceID == "" {
		// -place 分支:跟 attraction add 共用同一支 resolveCoords(見該
		// 函式的完整說明)——這裡傳入的 lat/lng 固定是 0,強迫
		// resolveCoords 一定走 -place 查詢分支(haveCoords 判斷式恆為
		// false),不會誤用 lat==0&&lng==0 的邊界情況(理由同該函式對這個
		// 邊界的既有說明:tripace 目前的資料範圍不會出現座標剛好落在
		// 0,0 的地點)。座標本身這裡用不到,只取查詢帶回的 place_id;
		// 查無 place_id(resolveCoords 查得到候選地點,但該筆候選沒有
		// place_id)時,fatal 提示使用者改用 -place-id 手動指定,而非
		// 靜默送出空字串清空既有的 place_id(那樣會讓使用者誤以為補上了
		// 卻其實被清空)。
		_, _, resolvedPlaceID, err := resolveCoords(c, 0, 0, *place, *region)
		if err != nil {
			fatal("attraction set-place-id: %v", err)
		}
		if resolvedPlaceID == "" {
			fatal("attraction set-place-id: -place 查到的候選地點沒有 place_id，請改用 -place-id 手動指定")
		}
		finalPlaceID = resolvedPlaceID
	}

	res, err := c.attractionUpdatePlaceID(*id, finalPlaceID)
	if err != nil {
		fatal("attraction set-place-id: %v", err)
	}
	output(res)
}

// cmdAttractionSetTheme 更新一筆既有景點區域是否為「主題點」(散策羅盤
// 用語,見 model.Attraction.IsTheme 欄位註解)——走 PATCH
// /internal/maintenance/attractions/{id}/theme(見
// httpClient.attractionUpdateTheme 的完整說明)。比 attraction set-place-id
// 單純:-theme 是必填的布林值,沒有「-place 改查」那種多來源輸入,單純
// 設定使用者明確指定的值即可,不需要另外查詢驗證。
//
// 使用情境:is_theme 欄位剛新增時,資料庫既有資料一律預設為 false(不論
// 原本 level 是多少),需要靠這支指令逐筆補上正確分類,把過去用
// level===1 判斷主題點的既有前端邏輯,換成獨立的 isTheme 欄位。
func cmdAttractionSetTheme(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction set-theme", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	isTheme := fs.Bool("theme", false, "是否為主題點（必填，true 或 false）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction set-theme 需要 -id")
	}
	themeGiven := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "theme" {
			themeGiven = true
		}
	})
	if !themeGiven {
		fatal("attraction set-theme 需要明確指定 -theme=true 或 -theme=false")
	}

	res, err := c.attractionUpdateTheme(*id, *isTheme)
	if err != nil {
		fatal("attraction set-theme: %v", err)
	}
	output(res)
}

// cmdAttractionUpdatePhoto 重新查詢一次地標圖片並回寫到資料庫——走
// POST /internal/maintenance/attractions/{id}/update-photo(見
// server/internal/api/maintenance.go 與 httpClient.attractionUpdatePhoto
// 的完整說明)。-query 未指定時用該筆地標既有的城市+名稱組成預設查詢
// 字串(後端決定,不在 CLI 端組)。固定走 Google Places 查詢真實照片
// (需要 GOOGLE_PLACES_API_KEY)——2026-10 已移除 Pexels 示意圖這個
// 來源選項。
//
// -place-id:2026-10 新增,選填——這筆地標還沒透過 attraction
// set-place-id 登記 place_id 時,也能直接補圖,不需要先跑完全獨立的
// 另一個指令(使用者明確要求「place 與 photo 就分離」,見後端 handler
// 開頭的完整說明)。留空時後端依序退回地標資料庫裡原本登記的
// place_id、或這次查詢意外命中的 place_id,行為對齊改動前。
func cmdAttractionUpdatePhoto(apiURL string, args []string) {
	fs := flag.NewFlagSet("attraction photo-update", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	query := fs.String("query", "", "查詢字串（選填，預設用該地標的城市+名稱）")
	placeID := fs.String("place-id", "", "手動指定這次要寫入 photo_assets 的 place_id（選填，不依賴這筆地標是否已透過 attraction set-place-id 登記過 place_id；留空時退回地標既有登記的 place_id、或這次查詢意外命中的 place_id）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction photo-update 需要 -id")
	}
	res, err := newHTTPClient(apiURL).attractionUpdatePhoto(*id, *query, *placeID)
	if err != nil {
		fatal("attraction photo-update: %v", err)
	}
	output(res)
}

// loadContentPageContent 從 -content(JSON 字串)或 -content-file(檔案
// 路徑)讀出主題介紹頁內容,解析成 map[string]any——兩者二擇一,刻意
// 都支援是因為 ThemePageContent 內容通常很長(見 docs/
// refactor-theme-page-content-cms-plan-2026-10.md 的規劃說明),整份
// 塞進 shell 參數字串容易被殼層引號/轉義規則搞壞,-content-file 讓
// 使用者可以先在編輯器裡寫好一份 JSON 檔案再交給 CLI,-content 仍保留
// 給簡短內容或腳本化呼叫用。
func loadContentPageContent(content, contentFile string) map[string]any {
	if content == "" && contentFile == "" {
		fatal("需要 -content 或 -content-file 其中一個")
	}
	if content != "" && contentFile != "" {
		fatal("-content 與 -content-file 只能二選一")
	}
	raw := []byte(content)
	if contentFile != "" {
		b, err := os.ReadFile(contentFile)
		if err != nil {
			fatal("讀取 -content-file 失敗: %v", err)
		}
		raw = b
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		fatal("content 必須是合法 JSON: %v", err)
	}
	return m
}

// cmdContentPageAdd 新增一筆主題介紹頁/部落格文章內容(初始狀態為
// draft,見 store.CreateContentPage 的完整說明)。走 POST
// /internal/maintenance/content-pages。
//
// -official 旗標(2026-10 新增,破壞性變更)——預設(不加這個旗標)
// ownerID 由後端從目前登入者的 JWT 解析出 UserID,寫入的是「自己的」
// 部落格文章;加了 -official,ownerID 固定空字串,等同改動前的唯一
// 行為,寫入的是城市介紹頁等官方內容共用的「系統帳號」命名空間。
// **之後編寫城市介紹頁(九份/京都/台南等)都要記得加 -official 旗標**
// ——這是使用者明確確認過的刻意設計決策,不是預設值選錯或遺漏。
func cmdContentPageAdd(c *httpClient, args []string) {
	fs := flag.NewFlagSet("content-page add", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填），例如 tainan-chikan")
	content := fs.String("content", "", "完整 ThemePageContent JSON 字串（與 -content-file 二選一）")
	contentFile := fs.String("content-file", "", "完整 ThemePageContent JSON 檔案路徑（與 -content 二選一）")
	updatedBy := fs.String("updated-by", "", "操作者識別（選填）")
	official := fs.Bool("official", false, "官方/系統帳號命名空間（城市介紹頁等既有內容用）；不加時預設寫入目前登入者自己的部落格文章身份")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("content-page add 需要 -slug")
	}
	m := loadContentPageContent(*content, *contentFile)
	res, err := c.contentPageCreate(*slug, m, *updatedBy, *official)
	if err != nil {
		fatal("content-page add: %v", err)
	}
	output(res)
}

// cmdContentPageList 列出全部主題介紹頁/部落格文章(含 draft,不分
// ownerID)。走 GET /internal/maintenance/content-pages——這支不支援
// -official,理由見 httpClient.contentPageList 的完整說明:列出全部
// 本來就不分身份,一次就能看到所有人建過的頁面。
func cmdContentPageList(c *httpClient) {
	res, err := c.contentPageList()
	if err != nil {
		fatal("content-page list: %v", err)
	}
	output(res)
}

// cmdContentPageGet 查詢單一主題介紹頁/部落格文章目前的內容(含
// draft,管理端點不區分發布狀態)——供「get 一份、本機編輯、set 整份
// 寫回」的操作流程使用(見 store.UpdateContentPageContent 的完整
// 說明)。走 GET /internal/maintenance/content-pages/{slug}。
//
// -official 旗標語意同 cmdContentPageAdd 的完整說明——查詢城市介紹頁
// 記得加 -official,否則預設查的是登入者自己的部落格文章命名空間。
func cmdContentPageGet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("content-page get", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	official := fs.Bool("official", false, "官方/系統帳號命名空間（城市介紹頁等既有內容用）；不加時預設查詢目前登入者自己的部落格文章身份")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("content-page get 需要 -slug")
	}
	res, err := c.contentPageGet(*slug, *official)
	if err != nil {
		fatal("content-page get: %v", err)
	}
	output(res)
}

// cmdContentPageSet 整份覆寫一筆既有主題介紹頁/部落格文章的內容——
// 不動發布狀態(見 store.UpdateContentPageContent 的完整說明,改發布
// 狀態要用 content-page publish/unpublish)。走 PUT
// /internal/maintenance/content-pages/{slug}。
//
// -official 旗標語意同 cmdContentPageAdd 的完整說明——編輯城市介紹頁
// 記得加 -official,否則預設改的是登入者自己的部落格文章命名空間。
func cmdContentPageSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("content-page set", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	content := fs.String("content", "", "完整 ThemePageContent JSON 字串（與 -content-file 二選一）")
	contentFile := fs.String("content-file", "", "完整 ThemePageContent JSON 檔案路徑（與 -content 二選一）")
	updatedBy := fs.String("updated-by", "", "操作者識別（選填）")
	official := fs.Bool("official", false, "官方/系統帳號命名空間（城市介紹頁等既有內容用）；不加時預設寫入目前登入者自己的部落格文章身份")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("content-page set 需要 -slug")
	}
	m := loadContentPageContent(*content, *contentFile)
	if _, err := c.contentPageUpdate(*slug, m, *updatedBy, *official); err != nil {
		fatal("content-page set: %v", err)
	}
	output(map[string]string{"updated": *slug})
}

// cmdContentPagePublish 切換發布狀態——publish 設為 "published",
// unpublish 設回 "draft"(見 handleMaintenanceContentPagePublish 的
// 完整說明)。走 PATCH /internal/maintenance/content-pages/{slug}/publish。
//
// -official 旗標語意同 cmdContentPageAdd 的完整說明——發布/取消發布
// 城市介紹頁記得加 -official,否則預設動的是登入者自己的部落格文章
// 命名空間。
func cmdContentPagePublish(c *httpClient, args []string, published bool) {
	label := "content-page publish"
	if !published {
		label = "content-page unpublish"
	}
	fs := flag.NewFlagSet(label, flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	official := fs.Bool("official", false, "官方/系統帳號命名空間（城市介紹頁等既有內容用）；不加時預設動的是目前登入者自己的部落格文章身份")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("%s 需要 -slug", label)
	}
	res, err := c.contentPagePublish(*slug, published, *official)
	if err != nil {
		fatal("%s: %v", label, err)
	}
	output(res)
}

// cmdContentPageDelete 刪除一筆主題介紹頁/部落格文章內容。走 DELETE
// /internal/maintenance/content-pages/{slug}。
//
// -official 旗標語意同 cmdContentPageAdd 的完整說明——刪除城市介紹頁
// 記得加 -official,否則預設刪的是登入者自己的部落格文章命名空間。
func cmdContentPageDelete(c *httpClient, args []string) {
	fs := flag.NewFlagSet("content-page delete", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	official := fs.Bool("official", false, "官方/系統帳號命名空間（城市介紹頁等既有內容用）；不加時預設刪除目前登入者自己的部落格文章身份")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("content-page delete 需要 -slug")
	}
	if err := c.contentPageDelete(*slug, *official); err != nil {
		fatal("content-page delete: %v", err)
	}
	output(map[string]string{"deleted": *slug})
}

// loadItineraryPageContent 從 -content(JSON 字串)或 -content-file(檔案
// 路徑)讀出範例行程內容,解析成 map[string]any——兩者二擇一,理由同
// loadContentPageContent 的完整說明(行程內容通常很長,-content-file
// 讓使用者可以先在編輯器裡寫好一份 JSON 檔案再交給 CLI)。
func loadItineraryPageContent(content, contentFile string) map[string]any {
	if content == "" && contentFile == "" {
		fatal("需要 -content 或 -content-file 其中一個")
	}
	if content != "" && contentFile != "" {
		fatal("-content 與 -content-file 只能二選一")
	}
	raw := []byte(content)
	if contentFile != "" {
		b, err := os.ReadFile(contentFile)
		if err != nil {
			fatal("讀取 -content-file 失敗: %v", err)
		}
		raw = b
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		fatal("content 必須是合法 JSON: %v", err)
	}
	return m
}

// cmdItineraryPageAdd 新增一筆範例行程內容(初始狀態為 draft,見
// store.CreateItineraryPage 的完整說明)。走 POST
// /internal/maintenance/itinerary-pages。沒有 -official 旗標,理由見
// itinerary-page 資源註冊處的完整說明——固定寫入官方命名空間,呼叫者
// 必須是管理員。
func cmdItineraryPageAdd(c *httpClient, args []string) {
	fs := flag.NewFlagSet("itinerary-page add", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填），例如 tainan-chikan-2day")
	content := fs.String("content", "", "完整行程 JSON 字串（與 -content-file 二選一）")
	contentFile := fs.String("content-file", "", "完整行程 JSON 檔案路徑（與 -content 二選一）")
	updatedBy := fs.String("updated-by", "", "操作者識別（選填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("itinerary-page add 需要 -slug")
	}
	m := loadItineraryPageContent(*content, *contentFile)
	res, err := c.itineraryPageCreate(*slug, m, *updatedBy)
	if err != nil {
		fatal("itinerary-page add: %v", err)
	}
	output(res)
}

// cmdItineraryPageList 列出全部範例行程(含 draft)。走 GET
// /internal/maintenance/itinerary-pages。
func cmdItineraryPageList(c *httpClient) {
	res, err := c.itineraryPageList()
	if err != nil {
		fatal("itinerary-page list: %v", err)
	}
	output(res)
}

// cmdItineraryPageGet 查詢單一範例行程目前的內容(含 draft,管理端點
// 不區分發布狀態)——供「get 一份、本機編輯、set 整份寫回」的操作流程
// 使用,理由同 cmdContentPageGet 的完整說明。走 GET
// /internal/maintenance/itinerary-pages/{slug}。
func cmdItineraryPageGet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("itinerary-page get", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("itinerary-page get 需要 -slug")
	}
	res, err := c.itineraryPageGet(*slug)
	if err != nil {
		fatal("itinerary-page get: %v", err)
	}
	output(res)
}

// cmdItineraryPageSet 整份覆寫一筆既有範例行程的內容——不動發布狀態
// (見 store.UpdateItineraryPageContent 的完整說明,改發布狀態要用
// itinerary-page publish/unpublish)。走 PUT
// /internal/maintenance/itinerary-pages/{slug}。
func cmdItineraryPageSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("itinerary-page set", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	content := fs.String("content", "", "完整行程 JSON 字串（與 -content-file 二選一）")
	contentFile := fs.String("content-file", "", "完整行程 JSON 檔案路徑（與 -content 二選一）")
	updatedBy := fs.String("updated-by", "", "操作者識別（選填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("itinerary-page set 需要 -slug")
	}
	m := loadItineraryPageContent(*content, *contentFile)
	if _, err := c.itineraryPageUpdate(*slug, m, *updatedBy); err != nil {
		fatal("itinerary-page set: %v", err)
	}
	output(map[string]string{"updated": *slug})
}

// cmdItineraryPagePublish 切換發布狀態——publish 設為 "published",
// unpublish 設回 "draft"(見 handleMaintenanceItineraryPagePublish 的
// 完整說明)。走 PATCH /internal/maintenance/itinerary-pages/{slug}/publish。
func cmdItineraryPagePublish(c *httpClient, args []string, published bool) {
	label := "itinerary-page publish"
	if !published {
		label = "itinerary-page unpublish"
	}
	fs := flag.NewFlagSet(label, flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("%s 需要 -slug", label)
	}
	res, err := c.itineraryPagePublish(*slug, published)
	if err != nil {
		fatal("%s: %v", label, err)
	}
	output(res)
}

// cmdItineraryPageDelete 刪除一筆範例行程內容。走 DELETE
// /internal/maintenance/itinerary-pages/{slug}。
func cmdItineraryPageDelete(c *httpClient, args []string) {
	fs := flag.NewFlagSet("itinerary-page delete", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("itinerary-page delete 需要 -slug")
	}
	if err := c.itineraryPageDelete(*slug); err != nil {
		fatal("itinerary-page delete: %v", err)
	}
	output(map[string]string{"deleted": *slug})
}

// cmdBlogProfileSet 設定或更新登入者自己的部落客公開身份(upsert,見
// server/internal/api/blog_profile.go 開頭的完整說明)。走 POST
// /v1/blog/profile。-avatar-url 選填,留空時沿用/建立一筆無頭像設定
// (後端 avatarUrl 本身就是選填欄位)。
func cmdBlogProfileSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-profile set", flag.ExitOnError)
	handle := fs.String("handle", "", "部落客公開 handle(必填),只能是英數字、底線或連字符")
	avatarURL := fs.String("avatar-url", "", "頭像網址（選填）")
	_ = fs.Parse(args)
	if *handle == "" {
		fatal("blog-profile set 需要 -handle")
	}
	res, err := c.blogProfileSet(*handle, *avatarURL)
	if err != nil {
		fatal("blog-profile set: %v", err)
	}
	output(res)
}

// cmdBlogProfileGet 查詢登入者自己目前的部落客公開身份設定。走 GET
// /v1/blog/profile——尚未設定過時後端回 404,err 會是非 nil,交由
// fatal 印出清楚的錯誤訊息(對齊其餘 cmd* 函式對查詢失敗的既有處理)。
func cmdBlogProfileGet(c *httpClient) {
	res, err := c.blogProfileGet()
	if err != nil {
		fatal("blog-profile get: %v", err)
	}
	output(res)
}

// cmdBlogPhotoUpload 是「上傳一張本機圖片」的複合動詞,依序完成
// server/internal/api/blog_photo.go 開頭說明的步驟 1-2(簽發 pre-signed
// URL→PUT 檔案),對應前端 PhotoManagerPage 實際發生的兩次獨立 API
// 呼叫+一次 GCS 直傳。-content-type 不自動偵測(避免引入額外依賴或
// 猜錯導致 GCS 簽章驗證失敗),要求呼叫端明確指定。
//
// -skip-process(2026-10 新增,實測正式環境批次上傳時發現的真實問題:
// Cloud Run 預設只在處理 HTTP 請求期間分配 CPU,complete 觸發的背景
// goroutine 在回應送出後幾乎拿不到 CPU,30 秒逾時內處理不完,短時間
// 連續上傳多張更會疊加成 OOM。有這個旗標時只做步驟 1-2(簽發
// URL→PUT 檔案),不呼叫 complete,讓呼叫端自行控制觸發背景處理的
// 時間點與節奏——例如全部原圖上傳完後,再用 `blog-photo retry` 逐張、
// 間隔幾秒觸發處理,避開一次性大量觸發的資源競爭)。
func cmdBlogPhotoUpload(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-photo upload", flag.ExitOnError)
	file := fs.String("file", "", "本機圖片檔案路徑（必填）")
	contentType := fs.String("content-type", "", "圖片 MIME type（必填，例如 image/jpeg、image/png）")
	skipProcess := fs.Bool("skip-process", false, "只上傳原圖(簽發 URL+PUT 檔案),不觸發處理(resize/產生縮圖);之後要處理時可用 `blog-photo retry -id` 逐張手動觸發")
	sync := fs.Bool("sync", false, "讓伺服器端在這次請求處理期間同步完成圖片處理(見 blog_photo.go handleBlogPhotoTriggerProcessing 的完整說明),不是丟進背景處理——根因是 Cloud Run 只在處理 HTTP 請求期間分配 CPU,背景處理容易因 CPU 被收回而卡住/逾時;加這個旗標讓 CLI 多等一次 round trip,換取處理期間確實有 CPU 可用、且能直接從回應知道這次處理是否成功。跟 -skip-process 互斥(skip-process 時完全不觸發處理,sync 無意義)")
	note := fs.String("note", "", "選填,上傳當下順手標記這張圖實際拍的是什麼(例如「基山街入口」),之後查詢列表或配圖時方便辨認;也可以之後用 `blog-photo note -id` 單獨補/改")
	_ = fs.Parse(args)
	if *file == "" {
		fatal("blog-photo upload 需要 -file")
	}
	if *contentType == "" {
		fatal("blog-photo upload 需要 -content-type")
	}

	signed, err := c.blogPhotoUploadURL(*contentType, *note)
	if err != nil {
		fatal("blog-photo upload: 簽發 upload URL 失敗: %v", err)
	}
	m, ok := signed.(map[string]any)
	if !ok {
		fatal("blog-photo upload: 預期的回應格式不符: %#v", signed)
	}
	photoID, _ := m["photoId"].(string)
	uploadURL, _ := m["uploadUrl"].(string)
	if photoID == "" || uploadURL == "" {
		fatal("blog-photo upload: 回應缺少 photoId 或 uploadUrl: %#v", m)
	}

	if err := blogPhotoPutFile(uploadURL, *contentType, *file); err != nil {
		fatal("blog-photo upload: 上傳檔案失敗(photoId=%s,這筆記錄已建立但原圖從未真正寫入,不再需要的話可用 `blog-photo delete -id %s` 清除): %v", photoID, photoID, err)
	}

	if *skipProcess {
		output(map[string]string{"photoId": photoID, "status": "uploaded_pending_process"})
		return
	}

	res, err := c.blogPhotoComplete(photoID, *sync)
	if err != nil {
		fatal("blog-photo upload: 回報完成失敗(photoId=%s,檔案已上傳但處理可能未觸發,可用 `blog-photo retry -id %s` 重試): %v", photoID, photoID, err)
	}
	output(res)
}

// cmdBlogPhotoList 列出登入者自己上傳過的所有圖片。走 GET /v1/blog/photos。
func cmdBlogPhotoList(c *httpClient) {
	res, err := c.blogPhotoList()
	if err != nil {
		fatal("blog-photo list: %v", err)
	}
	output(res)
}

// cmdBlogPhotoRetry 針對處理失敗的原圖重新觸發處理。走 POST
// /v1/blog/photos/{photoId}/retry。
func cmdBlogPhotoRetry(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-photo retry", flag.ExitOnError)
	id := fs.String("id", "", "圖片 ID（必填）")
	sync := fs.Bool("sync", false, "同步處理,見 `blog-photo upload -sync` 的完整說明")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("blog-photo retry 需要 -id")
	}
	res, err := c.blogPhotoRetry(*id, *sync)
	if err != nil {
		fatal("blog-photo retry: %v", err)
	}
	output(res)
}

// cmdBlogPhotoFocal 設定裁切焦點(0~1 之間的相對座標)。走 PATCH
// /v1/blog/photos/{photoId}/focal。
func cmdBlogPhotoFocal(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-photo focal", flag.ExitOnError)
	id := fs.String("id", "", "圖片 ID（必填）")
	x := fs.Float64("x", 0, "焦點 X 座標（0~1 之間，必填）")
	y := fs.Float64("y", 0, "焦點 Y 座標（0~1 之間，必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("blog-photo focal 需要 -id")
	}
	// -x/-y 預設值 0 剛好也是合法的焦點座標(左上角),不能用「是否等於
	// 預設值」判斷使用者是否真的有帶這兩個參數,改用 fs.Visit 檢查
	// 這兩個 flag 有沒有真的出現在 args 裡,避免使用者忘記帶時悄悄送出
	// 一組看似合法、但其實未經使用者確認的 (0, 0) 座標。
	xSet, ySet := false, false
	fs.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "x":
			xSet = true
		case "y":
			ySet = true
		}
	})
	if !xSet || !ySet {
		fatal("blog-photo focal 需要同時帶 -x 與 -y")
	}
	res, err := c.blogPhotoFocal(*id, *x, *y)
	if err != nil {
		fatal("blog-photo focal: %v", err)
	}
	output(res)
}

// cmdBlogPhotoNote 單獨設定/修改一張已上傳圖片的備註(見
// model.UploadedPhoto.Note 的完整說明)。走 PATCH
// /v1/blog/photos/{photoId}/note。跟上傳時的 -note(cmdBlogPhotoUpload)
// 是同一個欄位,這裡是給「上傳當下沒標記」或「想事後修改」的情境用,
// -note 允許傳空字串清空既有備註(不像 blog-photo focal 的 -x/-y 需要
// 用 fs.Visit 判斷是否真的有帶——空字串本身就是合法輸入,不需要額外
// 判斷「有沒有帶」)。
func cmdBlogPhotoNote(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-photo note", flag.ExitOnError)
	id := fs.String("id", "", "圖片 ID（必填）")
	note := fs.String("note", "", "備註內容,留空代表清空既有備註")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("blog-photo note 需要 -id")
	}
	res, err := c.blogPhotoNote(*id, *note)
	if err != nil {
		fatal("blog-photo note: %v", err)
	}
	output(res)
}

// cmdBlogPhotoRating 設定/清空一張已上傳圖片的品質評分(見
// model.UploadedPhoto.Rating 的完整說明)。走 PATCH
// /v1/blog/photos/{photoId}/rating。-rating 用 0 代表清空既有評分
// (回到「尚未評分」狀態)——1~3 才是合法分數,0 本身沒有評分意義,
// 拿來當「清空」的語意標記不會跟任何合法輸入混淆,不需要像
// blog-photo focal 的 -x/-y 那樣額外用 fs.Visit 判斷有沒有帶旗標。
func cmdBlogPhotoRating(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-photo rating", flag.ExitOnError)
	id := fs.String("id", "", "圖片 ID（必填）")
	rating := fs.Int("rating", 0, "品質評分 1~3(3 分最適合當主圖,1 分適合合併成小圖),0 代表清空既有評分")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("blog-photo rating 需要 -id")
	}
	if *rating < 0 || *rating > 3 {
		fatal("blog-photo rating 的 -rating 必須是 0~3(0 代表清空)")
	}
	var ratingPtr *int
	if *rating != 0 {
		ratingPtr = rating
	}
	res, err := c.blogPhotoRating(*id, ratingPtr)
	if err != nil {
		fatal("blog-photo rating: %v", err)
	}
	output(res)
}

// cmdBlogPhotoDelete 刪除一張圖片(資料庫記錄+GCS 物件)。走 DELETE
// /v1/blog/photos/{photoId}。
func cmdBlogPhotoDelete(c *httpClient, args []string) {
	fs := flag.NewFlagSet("blog-photo delete", flag.ExitOnError)
	id := fs.String("id", "", "圖片 ID（必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("blog-photo delete 需要 -id")
	}
	if err := c.blogPhotoDelete(*id); err != nil {
		fatal("blog-photo delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// notifyTrip 直接用 http.Post(不經 httpClient.do),故 /internal/* 現在
// 要求的 Authorization: Bearer token 得在這裡自己補上;讀不到本機 token 或
// 請求失敗都只是靜默放棄通知(維持原本的 best-effort 行為——這只是即時推播
// 更新用的通知,不是資料寫入本身,失敗不影響資料正確性,不值得讓呼叫端也
// 跟著失敗或印出錯誤)。
func notifyTrip(tripID, apiURL string) {
	token, err := loadToken(apiURL)
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, apiURL+"/internal/trips/"+tripID+"/notify", nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
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

// resourceUsage 印出單一資源底下所有動詞指令的一行用法——內容直接取自
// resource.commands 的 usage 欄位(定義指令的同一處)，不是另外手寫一份
// 容易漏改的複本。供 dispatchResource 遇到未知/缺少動詞時、以及
// `tripace-cli <資源> help`、`tripace-cli help <資源>` 使用。
func resourceUsage(r *resource) string {
	var b strings.Builder
	fmt.Fprintf(&b, "用法: tripace-cli %s <動詞> [旗標]\n", r.name)
	for _, c := range r.commands {
		b.WriteString("  " + c.usage + "\n")
	}
	return b.String()
}

// topUsage 組出完整的頂層用法文字——login/geocode/notify 這些不屬於
// 任何資源的全域指令維持手寫的詳細說明(語意複雜，表格驅動不划算)；
// trip/entry/attraction 底下每個指令的一行用法則用 resources 表自動
// 產生，不需要在這裡另外維護一份容易跟實際指令定義脫節的複本。詳細的
// 參數語意/限制說明(例如 attraction add 的 place_id 強制要求)留在
// 各自 cmd* 函式開頭的說明註解，這裡只收斂成「有哪些指令、一行怎麼
// 打」的速查表，完整原因要翻程式碼註解——這跟 cmd* 函式本身的角色分工
// 一致，usage() 不重複維護一份完整理由。
func topUsage() string {
	var b strings.Builder
	b.WriteString("cli — entry/trip 操作工具\n\n")
	b.WriteString("用法: tripace-cli [-api URL] <資源> <動詞> [旗標]，或 tripace-cli <全域指令> [旗標]\n\n")
	b.WriteString("全域旗標:\n")
	b.WriteString("  -api URL  server 位址（預設 " + defaultAPIURL + "，本機開發請明確帶 -api http://localhost:8080）\n\n")
	b.WriteString("全域指令:\n")
	b.WriteString("  login --web [-console URL]\n")
	b.WriteString("               透過瀏覽器核准登入，換取本機快取的 token（其餘指令的前置條件）。\n")
	b.WriteString("               -console URL 只影響開瀏覽器要導去的核准頁面 origin，API 呼叫仍打\n")
	b.WriteString("               -api（預設等於 -api，正式環境不需要帶；本機另外跑 Vite dev server\n")
	b.WriteString("               時可用 -console http://localhost:5173）\n")
	b.WriteString("  login --device [-console URL]\n")
	b.WriteString("               無頭環境用（沒有本機可達網路位址、無法起本機伺服器等 --web\n")
	b.WriteString("               依賴的前提）：印出一組短代碼與固定網址，在任意一台裝置打開\n")
	b.WriteString("               網址、手動輸入代碼核准，CLI 自行輪詢換取 token。-console 用法\n")
	b.WriteString("               同上。\n")
	b.WriteString("  geocode      -place 文字 [-region 國碼] [-n 筆數] [-entry ID]\n")
	b.WriteString("               查詢地點座標（走 /internal/maintenance/geocode，需要先登入）；\n")
	b.WriteString("               帶 -entry 時直接寫回該筆 entry 的經緯度。\n")
	b.WriteString("  notify       -trip ID [-api URL]\n")
	b.WriteString("  help [<資源>]\n")
	b.WriteString("               印出這份說明，或只印出單一資源(trip/entry/attraction)底下的指令。\n\n")
	b.WriteString("資源指令（「tripace-cli <資源> <動詞> [旗標]」，各資源詳細用法見\n")
	b.WriteString("`tripace-cli help <資源>`）:\n")
	for _, r := range resources {
		for _, c := range r.commands {
			b.WriteString("  " + c.usage + "\n")
		}
	}
	b.WriteString("\n")
	b.WriteString("attraction add 的 -theme/place_id 規則、attraction set-place-id 的\n")
	b.WriteString("-place-id/-place 互斥規則等細節參數語意，見各自子指令對應的\n")
	b.WriteString("cmd* 函式開頭的說明（cmd/cli/main.go），這裡只收錄一行用法速查。\n\n")
	b.WriteString("所有輸出為 JSON。\n")
	return b.String()
}

// usage 印出用法說明——不帶 args(或 args 為 nil/空)印出完整頂層說明，
// args[0] 是已知資源名稱時只印出該資源的指令(對齊 dispatchResource 對
// `<資源> help` 的既有處理，這裡額外支援 `help <資源>` 這個反過來的
// 呼叫順序)，其餘情況一律印出完整說明(對齊 onagent CLI runHelp「找不到
// 資源名就退回完整說明」的既有慣例，不讓 help 本身因為打錯資源名而
// 報錯)。
func usage(args []string) {
	if len(args) > 0 {
		if r := findResource(resources, args[0]); r != nil {
			fmt.Print(resourceUsage(r))
			os.Exit(0)
		}
	}
	fmt.Print(topUsage())
	os.Exit(0)
}

// cmdRateLimitList 列出全部可設定的限流規則——走
// GET /internal/maintenance/rate-limits(見 handleMaintenanceRateLimitList
// 的完整說明)。
//
// 2026-10 新增(使用者明確要求「cli 可以列出所有限流設定及個別設定
// 視窗大小」)。
//
// 預設印成對齊的表格而非原始 JSON:這個指令的用途是「一眼看出目前生效
// 的限流是什麼」,七條規則各有視窗/次數/每日額度/是否已自訂,JSON 讀
// 起來要自己對照欄位。加 -json 時才輸出原始回應(對齊其餘指令一律
// output(res) 的既有慣例,也讓需要接管線處理的情境仍然可用)。
func cmdRateLimitList(c *httpClient, args []string) {
	fs := flag.NewFlagSet("rate-limit list", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "輸出原始 JSON 回應,不印表格")
	_ = fs.Parse(args)

	res, err := c.rateLimitList()
	if err != nil {
		fatal("rate-limit list: %v", err)
	}
	if *asJSON {
		output(res)
		return
	}

	m, ok := res.(map[string]any)
	if !ok {
		output(res)
		return
	}
	rows, ok := m["rateLimits"].([]any)
	if !ok {
		output(res)
		return
	}

	// num 取 JSON 數字欄位(encoding/json 解到 any 時一律是 float64)。
	//
	// 2026-10（review 發現）：原本缺欄位時回 0,但 0 在限流語意下有實質
	// 意義(次數 0 看起來像「完全禁止」、每日 0 是「不限制」),把「欄位
	// 缺漏」顯示成 0 會被誤讀成真實設定。改成回 (值, 是否存在),缺漏時
	// 顯示 "?"——那不會被誤讀成任何一種限流語意。
	num := func(v any) (int, bool) {
		f, ok := v.(float64)
		if !ok {
			return 0, false
		}
		return int(f), true
	}
	str := func(v any) string {
		s, _ := v.(string)
		return s
	}
	// intCell 把一個數字欄位印成表格裡的一格,缺漏時印 "?"。
	intCell := func(v any) string {
		n, ok := num(v)
		if !ok {
			return "?"
		}
		return fmt.Sprintf("%d", n)
	}
	// windowCell 把視窗長度印成人看得懂的單位。一律從毫秒換算,來源由
	// 呼叫端決定(見下方 configured 的分流)。
	//
	// 2026-10（review 發現）：原本的簽名是 window(sec, ms),而 sec 跟著
	// configured 分流、ms 永遠傳登錄表的 defaultWindowMs——兩個參數不
	// 同源。資料庫 windowSec 為 0 時(限流實質異常)會印出登錄表的
	// 500ms,而 CUSTOM 欄還標著已自訂,等於把「設定壞了」顯示成
	// 「設定正常」,是最危險方向的錯。
	//
	// 0 明確印成警示而不是 "-":0 秒視窗會被 RateLimiter 夾成 1 秒
	// (見 apigateway.SetLimitForKey),那是異常狀態,不該長得像
	// 「沒有設定」。
	windowCell := func(ms int, ok bool) string {
		if !ok {
			return "?"
		}
		if ms == 0 {
			return "0(異常)"
		}
		if ms%1000 == 0 {
			return fmt.Sprintf("%ds", ms/1000)
		}
		return fmt.Sprintf("%dms", ms)
	}

	// 表頭一律用 ASCII:%-32s 這類寬度按 byte 數補空白,中文字元佔 3
	// bytes 但終端機只顯示 2 格,中文表頭會比對應的資料欄少佔顯示格、
	// 誤差逐欄累積(review 實測「已自訂」表頭比底下的值偏左約 6 格)。
	// 說明欄是最後一欄、沒有後續欄位要對齊,放中文無妨。
	fmt.Printf("%-32s %-16s %-10s %-6s %-12s %-7s %s\n",
		"ENDPOINT", "KIND", "WINDOW", "MAX", "DAILY", "CUSTOM", "說明")
	for _, raw := range rows {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		configured, _ := r["configured"].(bool)
		// 已自訂的用資料庫的值,沒自訂的印登錄表預設值——兩者在同一欄
		// 顯示,靠 CUSTOM 欄位區分來源,不要分成兩組欄位讓表格變寬
		// (實際生效的值永遠只有一個)。
		var winMs int
		var winOK bool
		var maxCell, dailyCell string
		if configured {
			sec, ok := num(r["windowSec"])
			winMs, winOK = sec*1000, ok
			maxCell = intCell(r["maxCalls"])
			// DAILY 在已自訂時印「今天用掉/上限」——usedToday 是這張表
			// 唯一會變動的執行期狀態,也是「今天還剩多少額度」這個運維
			// 問題的直接答案(review 建議)。上限 <= 0 代表不限制。
			used, usedOK := num(r["usedToday"])
			daily, dailyOK := num(r["dailyMax"])
			switch {
			case !dailyOK:
				dailyCell = "?"
			case daily <= 0 && usedOK:
				dailyCell = fmt.Sprintf("%d/-", used)
			case daily <= 0:
				dailyCell = "-"
			case usedOK:
				dailyCell = fmt.Sprintf("%d/%d", used, daily)
			default:
				dailyCell = fmt.Sprintf("?/%d", daily)
			}
		} else {
			ms, ok := num(r["defaultWindowMs"])
			winMs, winOK = ms, ok
			maxCell = intCell(r["defaultMaxCalls"])
			daily, dailyOK := num(r["defaultDailyMax"])
			switch {
			case !dailyOK:
				dailyCell = "?"
			case daily <= 0:
				dailyCell = "-"
			default:
				dailyCell = fmt.Sprintf("%d", daily)
			}
		}
		mark := "-"
		if configured {
			mark = "yes"
		}
		fmt.Printf("%-32s %-16s %-10s %-6s %-12s %-7s %s\n",
			str(r["endpoint"]), str(r["kind"]),
			windowCell(winMs, winOK), maxCell, dailyCell, mark, str(r["desc"]))
	}
	fmt.Println()
	fmt.Println("CUSTOM 為 - 代表這條規則目前仍是預設值(會被啟動參數覆寫);")
	fmt.Println("設定過之後就以資料庫的值為準。DAILY 已自訂時顯示「今天用掉/上限」,- 代表不限制。")
	// 生效秒數讀 ratelimits 的共用常數,不再寫死 45——原本這個數字在
	// 三個地方各寫死一份(handler 的 appliesWithinSec、這行文字、
	// cmd/server 的 geoRateLimitRefreshInterval),有人調整重讀間隔時
	// 端點與 CLI 會繼續回報 45,運維照著等卻沒生效(review 發現)。
	fmt.Printf("修改後約 %d 秒內生效,不需要重啟。\n", int(ratelimits.RefreshInterval/time.Second))
}

// cmdRateLimitSet 修改一條限流規則——走
// PATCH /internal/maintenance/rate-limits/{endpoint}(見
// handleMaintenanceRateLimitSet 的完整說明)。
//
// -window 與 -window-ms 二選一:後者是為了能設定短於 1 秒的視窗。沒帶
// 的欄位維持目前值,不會被覆寫成零值。
func cmdRateLimitSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("rate-limit set", flag.ExitOnError)
	endpoint := fs.String("endpoint", "", "要修改的限流 endpoint(用 rate-limit list 看可用的值)")
	windowSec := fs.Int("window", 0, "視窗長度(秒)")
	windowMs := fs.Int("window-ms", 0, "視窗長度(毫秒);目前資料表只存整數秒,傳不滿整秒的值會被後端拒絕")
	maxCalls := fs.Int("max-calls", 0, "視窗內最多可放行的呼叫次數")
	dailyMax := fs.Int("daily-max", 0, "每日總額度上限(0 代表不限制)")
	_ = fs.Parse(args)

	if *endpoint == "" {
		fatal("rate-limit set: 需要 -endpoint(用 rate-limit list 看可用的值)")
	}

	// 用 fs.Visit 判斷哪些旗標真的出現在命令列,而不是用哨兵值
	// (0 / -1)反推。
	//
	// 2026-10（review 發現）：原本的哨兵寫法會把所有不合法的值靜默吞掉
	// ——`-max-calls -5`(打錯字、或 shell 把後續參數吃進來)不會送出
	// 請求,使用者看到的是「至少要指定一項要修改的值」,他會以為自己漏
	// 打旗標,而不是值不合法。後端對這些值本來就有精準的錯誤訊息(例如
	// 「上限次數必須大於 0（要完全關閉某個功能請用對應的功能開關,不是
	// 把限流設成 0）」),那整句永遠到不了使用者眼前。
	//
	// 改用 fs.Visit 之後:旗標有出現就照原值送出,驗證一律交給後端
	// (單一驗證處,CLI 不複製一份規則),哨兵值整套消失,`-daily-max`
	// 的預設值也回到自然的 0。
	seen := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { seen[f.Name] = true })

	if seen["window"] && seen["window-ms"] {
		fatal("rate-limit set: -window 與 -window-ms 只能給一個")
	}

	var wSec, wMs, mc, dm *int
	if seen["window"] {
		wSec = windowSec
	}
	if seen["window-ms"] {
		wMs = windowMs
	}
	if seen["max-calls"] {
		mc = maxCalls
	}
	if seen["daily-max"] {
		dm = dailyMax
	}
	if wSec == nil && wMs == nil && mc == nil && dm == nil {
		fatal("rate-limit set: 至少要指定一項要修改的值(-window / -window-ms / -max-calls / -daily-max)")
	}

	res, err := c.rateLimitSet(*endpoint, wSec, wMs, mc, dm)
	if err != nil {
		fatal("rate-limit set: %v", err)
	}
	output(res)
}

// cmdFieldMaskList 列出全部可設定的 Google Places field mask——走
// GET /internal/maintenance/field-masks(見 handleMaintenanceFieldMaskList
// 的完整說明)。
//
// 2026-10 新增(使用者明確要求「加入可以控制欄位的設定,也讓 cli 可以
// 設定」)。
//
// 預設印人看得懂的分段輸出而非表格:每個情境有不定數量的欄位、各帶
// 計費層級與用途說明,硬塞進固定寬度的表格會讓說明欄被截斷,而那些說明
// 正是「該不該砍這個欄位」的判斷依據。-json 輸出原始回應供管線處理
// (理由同 rate-limit list 的同名旗標)。
func cmdFieldMaskList(c *httpClient, args []string) {
	fs := flag.NewFlagSet("field-mask list", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "輸出原始 JSON 回應")
	_ = fs.Parse(args)

	res, err := c.fieldMaskList()
	if err != nil {
		fatal("field-mask list: %v", err)
	}
	if *asJSON {
		output(res)
		return
	}
	m, ok := res.(map[string]any)
	if !ok {
		output(res)
		return
	}
	rows, ok := m["fieldMasks"].([]any)
	if !ok {
		output(res)
		return
	}

	str := func(v any) string { s, _ := v.(string); return s }
	strs := func(v any) []string {
		arr, _ := v.([]any)
		out := make([]string, 0, len(arr))
		for _, x := range arr {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}

	for i, raw := range rows {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if i > 0 {
			fmt.Println()
		}
		mark := "預設值"
		if c, _ := r["configured"].(bool); c {
			mark = "已自訂"
		}
		fmt.Printf("%s  [%s]  計費層級: %s  (%s)\n",
			str(r["key"]), mark, str(r["tier"]), str(r["endpoint"]))
		fmt.Printf("  %s\n", str(r["desc"]))
		fmt.Printf("  目前欄位: %s\n", strings.Join(strs(r["fields"]), ","))
		cur := map[string]bool{}
		for _, f := range strs(r["fields"]) {
			cur[f] = true
		}
		avail, _ := r["availableFields"].([]any)
		for _, a := range avail {
			f, ok := a.(map[string]any)
			if !ok {
				continue
			}
			on := " "
			if cur[str(f["name"])] {
				on = "✓"
			}
			req := ""
			if b, _ := f["required"].(bool); b {
				req = " (必填)"
			}
			fmt.Printf("    [%s] %-18s %-22s%s %s\n",
				on, str(f["name"]), str(f["tier"]), req, str(f["desc"]))
		}
	}
	fmt.Println()
	fmt.Println("Google 按「請求裡最高層級的那一個欄位」計費,所以單一欄位就能決定整個情境的單價。")
	fmt.Printf("改完約 %d 秒內生效,不需要重啟。\n", int(ratelimits.RefreshInterval/time.Second))
}

// cmdFieldMaskSet 修改一個查詢情境要取哪些欄位——走
// PATCH /internal/maintenance/field-masks/{key}。
//
// -fields 是完整取代(不是增量加減):這個設定的語意就是「這個情境要取
// 這些欄位」,用增量語法(+a -b)會讓「目前到底有哪些」變成要自己推算。
// 想知道可用的值與目前狀態用 field-mask list。
//
// 必填欄位由後端驗證(見 handleMaintenanceFieldMaskSet),CLI 不複製一份
// 規則——否則兩邊的驗證會各自長歪。
func cmdFieldMaskSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("field-mask set", flag.ExitOnError)
	key := fs.String("scenario", "", "要修改的查詢情境(用 field-mask list 看可用的值)")
	fields := fs.String("fields", "", "逗號分隔的欄位清單,完整取代目前設定")
	_ = fs.Parse(args)

	if *key == "" {
		fatal("field-mask set: 需要 -scenario(用 field-mask list 看可用的值)")
	}
	if *fields == "" {
		fatal("field-mask set: 需要 -fields(逗號分隔;完整取代目前設定)")
	}
	list := []string{}
	for _, f := range strings.Split(*fields, ",") {
		if f = strings.TrimSpace(f); f != "" {
			list = append(list, f)
		}
	}
	res, err := c.fieldMaskSet(*key, list)
	if err != nil {
		fatal("field-mask set: %v", err)
	}
	output(res)
}

// cmdGeoSettingList 對應 GET /internal/maintenance/geo-settings。預設印表格
// (表頭一律 ASCII——中文字元佔 3 bytes 但終端機只顯示 2 格,%-Ns 這類按
// byte 補空白的寬度會讓欄位錯位,見 cmdRateLimitList 踩過的同一個坑),
// -json 印原始回應。
func cmdGeoSettingList(c *httpClient, args []string) {
	fs := flag.NewFlagSet("geo-setting list", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "輸出原始 JSON 回應")
	_ = fs.Parse(args)

	res, err := c.geoSettingList()
	if err != nil {
		fatal("geo-setting list: %v", err)
	}
	if *asJSON {
		output(res)
		return
	}
	m, ok := res.(map[string]any)
	if !ok {
		output(res)
		return
	}
	rows, ok := m["settings"].([]any)
	if !ok {
		output(res)
		return
	}

	num := func(v any) int { f, _ := v.(float64); return int(f) }
	fmt.Printf("%-24s %-7s %-8s %-9s %s\n", "KEY", "VALUE", "DEFAULT", "RANGE", "CUSTOM")
	for _, raw := range rows {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		custom := "-"
		if cfg, _ := r["configured"].(bool); cfg {
			custom = "yes"
		}
		key, _ := r["key"].(string)
		fmt.Printf("%-24s %-7d %-8d %-9s %s\n", key, num(r["value"]), num(r["default"]),
			fmt.Sprintf("%d-%d", num(r["min"]), num(r["max"])), custom)
	}
	fmt.Println()
	for _, raw := range rows {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		key, _ := r["key"].(string)
		desc, _ := r["desc"].(string)
		fmt.Printf("%s: %s\n", key, desc)
	}
	fmt.Println()
	fmt.Println("CUSTOM 為 - 代表目前仍是預設值;設定過之後就以資料庫的值為準。")
	if sec := num(m["appliesWithinSec"]); sec > 0 {
		fmt.Printf("修改後這個實例立即生效,多實例部署時其他實例約 %d 秒內跟上,不需要重啟。\n", sec)
	}
}

// cmdGeoSettingSet 對應 PATCH /internal/maintenance/geo-settings/{key}。
//
// 用 flag.Visit 判斷 -value 有沒有出現在命令列,而不是拿預設值 0 當「沒給」
// 的哨兵——0 與負數必須原樣送到後端,由後端回精準的錯誤訊息(同
// cmdRateLimitSet 改用 flag.Visit 的同一個教訓)。
func cmdGeoSettingSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("geo-setting set", flag.ExitOnError)
	key := fs.String("key", "", "要修改的設定(用 geo-setting list 看可用的值)")
	value := fs.Int("value", 0, "新的數值")
	_ = fs.Parse(args)

	if *key == "" {
		fatal("geo-setting set: 需要 -key(用 geo-setting list 看可用的值)")
	}
	given := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "value" {
			given = true
		}
	})
	if !given {
		fatal("geo-setting set: 需要 -value(整數;合法範圍用 geo-setting list 查看)")
	}
	res, err := c.geoSettingSet(*key, *value)
	if err != nil {
		fatal("geo-setting set: %v", err)
	}
	output(res)
}

// cmdGeoStatsShow 印出 Google API 呼叫次數:先是區間內各 endpoint 的合計,
// 再是依週期(day/hour)展開的表格(列是週期、欄是 endpoint)。
// 走 GET /internal/maintenance/geo-api-stats;沒帶旗標的預設值由後端決定。
func cmdGeoStatsShow(c *httpClient, args []string) {
	fs := flag.NewFlagSet("geo-stats show", flag.ExitOnError)
	from := fs.String("from", "", "起日 YYYY-MM-DD(含);預設 to 往前 6 天")
	to := fs.String("to", "", "迄日 YYYY-MM-DD(含);預設今天")
	period := fs.String("period", "day", "分組週期:day 或 hour(hour 區間最多 7 天)")
	tz := fs.String("tz", "", "IANA 時區,決定「一天」從哪裡切;預設 Asia/Taipei")
	asJSON := fs.Bool("json", false, "輸出原始 JSON")
	_ = fs.Parse(args)

	res, err := c.geoAPIStats(*from, *to, *period, *tz)
	if err != nil {
		fatal("geo-stats show: %v", err)
	}
	if *asJSON {
		output(res)
		return
	}
	m, ok := res.(map[string]any)
	if !ok {
		output(res)
		return
	}
	str := func(v any) string { s, _ := v.(string); return s }
	rows := func(v any) []map[string]any {
		var out []map[string]any
		list, _ := v.([]any)
		for _, it := range list {
			if r, ok := it.(map[string]any); ok {
				out = append(out, r)
			}
		}
		return out
	}
	n := func(v any) int { f, _ := v.(float64); return int(f) }

	fmt.Printf("區間 %s ~ %s(%s,以 %s 切分)\n\n", str(m["from"]), str(m["to"]), str(m["period"]), str(m["tz"]))

	printGeoCacheStats(m["cache"], n, str, rows)

	totals := rows(m["totals"])
	if len(totals) == 0 {
		fmt.Println("這段期間沒有任何 Google API 呼叫記錄。")
		return
	}
	grandTotal := 0
	fmt.Printf("%-24s %8s %8s\n", "ENDPOINT", "COUNT", "ERRORS")
	for _, t := range totals {
		grandTotal += n(t["count"])
		fmt.Printf("%-24s %8d %8d\n", str(t["endpoint"]), n(t["count"]), n(t["errorCount"]))
	}
	fmt.Printf("%-24s %8d\n\n", "TOTAL", grandTotal)

	// 欄順序沿用合計表(次數多的在前),列依週期標籤排序。
	var cols []string
	for _, t := range totals {
		cols = append(cols, str(t["endpoint"]))
	}
	byBucket := map[string]map[string]int{}
	var order []string
	for _, b := range rows(m["buckets"]) {
		label := str(b["bucket"])
		if byBucket[label] == nil {
			byBucket[label] = map[string]int{}
			order = append(order, label)
		}
		byBucket[label][str(b["endpoint"])] = n(b["count"])
	}
	sort.Strings(order)
	fmt.Printf("%-18s", "PERIOD")
	for _, col := range cols {
		fmt.Printf(" %*s", len(col), col)
	}
	fmt.Printf(" %8s\n", "SUM")
	for _, label := range order {
		fmt.Printf("%-18s", label)
		sum := 0
		for _, col := range cols {
			v := byBucket[label][col]
			sum += v
			fmt.Printf(" %*d", len(col), v)
		}
		fmt.Printf(" %8d\n", sum)
	}
}

// printGeoCacheStats 印出地點詳情快取的 hit/miss/shared 合計與命中率,再依週期
// 展開。沒有記錄(快取記錄上線前的日期,或這段期間沒有查詢)時只印一行說明。
func printGeoCacheStats(raw any, n func(any) int, str func(any) string, rows func(any) []map[string]any) {
	c, _ := raw.(map[string]any)
	totals, _ := c["totals"].(map[string]any)
	hit, miss, shared := n(totals["hit"]), n(totals["miss"]), n(totals["shared"])
	all := hit + miss + shared
	if all == 0 {
		fmt.Println("地點詳情快取:這段期間沒有查詢記錄(記錄功能上線前的日期不會有資料)。")
		fmt.Println()
		return
	}
	rate, _ := c["hitRate"].(float64)
	fmt.Printf("地點詳情快取:共 %d 次查詢,命中 %d(%.1f%%)、沒命中 %d(打了 Google)、搭便車 %d(共用同時進行的那次)\n\n",
		all, hit, rate*100, miss, shared)

	byBucket := map[string]map[string]int{}
	var order []string
	for _, b := range rows(c["buckets"]) {
		label := str(b["bucket"])
		if byBucket[label] == nil {
			byBucket[label] = map[string]int{}
			order = append(order, label)
		}
		byBucket[label][str(b["outcome"])] = n(b["count"])
	}
	sort.Strings(order)
	fmt.Printf("%-18s %8s %8s %8s %8s\n", "PERIOD", "HIT", "MISS", "SHARED", "HIT%")
	for _, label := range order {
		h, ms, sh := byBucket[label]["hit"], byBucket[label]["miss"], byBucket[label]["shared"]
		fmt.Printf("%-18s %8d %8d %8d %7.1f%%\n", label, h, ms, sh, float64(h)*100/float64(h+ms+sh))
	}
	fmt.Println()
}
