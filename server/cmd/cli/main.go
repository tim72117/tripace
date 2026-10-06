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
	"strings"

	"github.com/tim72117/tripace/internal/model"
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
			// theme-page:主題介紹頁內容管理(見 docs/
			// refactor-theme-page-content-cms-plan-2026-10.md、
			// server/internal/api/theme_page.go)——九份/京都/台南等城市
			// 主題介紹頁,原本整篇文案手寫在各自的 .tsx 檔案裡,改成透過
			// 這組指令編輯、存進資料庫,前端打 API 讀取內容渲染。
			name: "theme-page",
			commands: []resourceCommand{
				{verb: "add", run: func(args []string) { cmdThemePageAdd(c, args) }, usage: "tripace-cli theme-page add -slug 文字 (-content JSON | -content-file 路徑)"},
				{verb: "list", run: func(args []string) { cmdThemePageList(c) }, usage: "tripace-cli theme-page list"},
				{verb: "get", run: func(args []string) { cmdThemePageGet(c, args) }, usage: "tripace-cli theme-page get -slug 文字"},
				{verb: "set", run: func(args []string) { cmdThemePageSet(c, args) }, usage: "tripace-cli theme-page set -slug 文字 (-content JSON | -content-file 路徑)"},
				{verb: "publish", run: func(args []string) { cmdThemePagePublish(c, args, true) }, usage: "tripace-cli theme-page publish -slug 文字"},
				{verb: "unpublish", run: func(args []string) { cmdThemePagePublish(c, args, false) }, usage: "tripace-cli theme-page unpublish -slug 文字"},
				{verb: "delete", run: func(args []string) { cmdThemePageDelete(c, args) }, usage: "tripace-cli theme-page delete -slug 文字"},
			},
		},
	}
}

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
	apiURL := "http://localhost:8080"
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
		cmdGeocode(args)
		return
	case "notify":
		cmdNotify(args)
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

func cmdNotify(args []string) {
	fs := flag.NewFlagSet("notify", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	apiURL := fs.String("api", "http://localhost:8080", "server base URL")
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

// loadThemePageContent 從 -content(JSON 字串)或 -content-file(檔案
// 路徑)讀出主題介紹頁內容,解析成 map[string]any——兩者二擇一,刻意
// 都支援是因為 ThemePageContent 內容通常很長(見 docs/
// refactor-theme-page-content-cms-plan-2026-10.md 的規劃說明),整份
// 塞進 shell 參數字串容易被殼層引號/轉義規則搞壞,-content-file 讓
// 使用者可以先在編輯器裡寫好一份 JSON 檔案再交給 CLI,-content 仍保留
// 給簡短內容或腳本化呼叫用。
func loadThemePageContent(content, contentFile string) map[string]any {
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

// cmdThemePageAdd 新增一筆主題介紹頁內容(初始狀態為 draft,見
// store.CreateThemePage 的完整說明)。走 POST
// /internal/maintenance/theme-pages。
func cmdThemePageAdd(c *httpClient, args []string) {
	fs := flag.NewFlagSet("theme-page add", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填），例如 tainan-chikan")
	content := fs.String("content", "", "完整 ThemePageContent JSON 字串（與 -content-file 二選一）")
	contentFile := fs.String("content-file", "", "完整 ThemePageContent JSON 檔案路徑（與 -content 二選一）")
	updatedBy := fs.String("updated-by", "", "操作者識別（選填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("theme-page add 需要 -slug")
	}
	m := loadThemePageContent(*content, *contentFile)
	res, err := c.themePageCreate(*slug, m, *updatedBy)
	if err != nil {
		fatal("theme-page add: %v", err)
	}
	output(res)
}

// cmdThemePageList 列出全部主題介紹頁(含 draft)。走 GET
// /internal/maintenance/theme-pages。
func cmdThemePageList(c *httpClient) {
	res, err := c.themePageList()
	if err != nil {
		fatal("theme-page list: %v", err)
	}
	output(res)
}

// cmdThemePageGet 查詢單一主題介紹頁目前的內容(含 draft,管理端點不
// 區分發布狀態)——供「get 一份、本機編輯、set 整份寫回」的操作流程
// 使用(見 store.UpdateThemePageContent 的完整說明)。走 GET
// /internal/maintenance/theme-pages/{slug}。
func cmdThemePageGet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("theme-page get", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("theme-page get 需要 -slug")
	}
	res, err := c.themePageGet(*slug)
	if err != nil {
		fatal("theme-page get: %v", err)
	}
	output(res)
}

// cmdThemePageSet 整份覆寫一筆既有主題介紹頁的內容——不動發布狀態
// (見 store.UpdateThemePageContent 的完整說明,改發布狀態要用
// theme-page publish/unpublish)。走 PUT
// /internal/maintenance/theme-pages/{slug}。
func cmdThemePageSet(c *httpClient, args []string) {
	fs := flag.NewFlagSet("theme-page set", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	content := fs.String("content", "", "完整 ThemePageContent JSON 字串（與 -content-file 二選一）")
	contentFile := fs.String("content-file", "", "完整 ThemePageContent JSON 檔案路徑（與 -content 二選一）")
	updatedBy := fs.String("updated-by", "", "操作者識別（選填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("theme-page set 需要 -slug")
	}
	m := loadThemePageContent(*content, *contentFile)
	if _, err := c.themePageUpdate(*slug, m, *updatedBy); err != nil {
		fatal("theme-page set: %v", err)
	}
	output(map[string]string{"updated": *slug})
}

// cmdThemePagePublish 切換發布狀態——publish 設為 "published",
// unpublish 設回 "draft"(見 handleMaintenanceThemePagePublish 的完整
// 說明)。走 PATCH /internal/maintenance/theme-pages/{slug}/publish。
func cmdThemePagePublish(c *httpClient, args []string, published bool) {
	label := "theme-page publish"
	if !published {
		label = "theme-page unpublish"
	}
	fs := flag.NewFlagSet(label, flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("%s 需要 -slug", label)
	}
	res, err := c.themePagePublish(*slug, published)
	if err != nil {
		fatal("%s: %v", label, err)
	}
	output(res)
}

// cmdThemePageDelete 刪除一筆主題介紹頁內容。走 DELETE
// /internal/maintenance/theme-pages/{slug}。
func cmdThemePageDelete(c *httpClient, args []string) {
	fs := flag.NewFlagSet("theme-page delete", flag.ExitOnError)
	slug := fs.String("slug", "", "路由 slug（必填）")
	_ = fs.Parse(args)
	if *slug == "" {
		fatal("theme-page delete 需要 -slug")
	}
	if err := c.themePageDelete(*slug); err != nil {
		fatal("theme-page delete: %v", err)
	}
	output(map[string]string{"deleted": *slug})
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
	b.WriteString("  -api URL  server 位址（預設 http://localhost:8080）\n\n")
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
