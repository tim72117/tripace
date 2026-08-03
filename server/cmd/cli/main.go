// Command cli 是 entry 的操作工具，供 Claude Code / LLM 直接操作行程資料。
//
// 預設走 HTTP 存取本地或遠端 server（/internal/ API）。
// 加 -db 旗標改為直連 PostgreSQL（需要 DATABASE_URL）。
//
// /internal/ API 需要先登入:執行一次 `tripace-cli login --web`（走瀏覽器
// 核准流程，見 login.go）或 `tripace-cli login --device`（無頭環境用的
// device code 流程，同樣見 login.go），換到的 JWT 會存在本機（見
// token.go），之後的指令都會自動帶上，不需要每次都重新登入。
//
// 子命令:
//
//	login --web       透過瀏覽器核准登入，換取本機快取的 token（其餘指令的前置條件）
//	login --device    無頭環境用:印出一組代碼，在任意裝置手動輸入核准
//	list-channels
//	create-channel -name 文字
//	trip-entries -channel ID
//	entry-add    -channel ID -title 文字 [-start ... -end ... -location ...]
//	entry-update -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
//	entry-delete -entry ID
//	reset        -channel ID
//	geocode      -place 文字 [-region 國碼] [-entry ID]
//	notify       -channel ID
//
//	drop-trip-grouping   一次性維運指令,清除 trip 歸組機制留下的孤兒資料庫
//	                     物件(entries.trip_id 欄位與 trips 表)(僅 -db 模式)
//
// 所有輸出為 JSON（方便 Claude Code 解析）。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/tim72117/tripace/internal/tripsvc"
)

// client 定義統一的操作介面，由 httpClient 或 dbClient 實作。
type client interface {
	listChannels() (any, error)
	createChannel(name string) (any, error)
	tripEntries(channelID string) (any, error)
	record(channelID, title, start, startTime, end, endTime, location string) (any, error)
	updateEntry(in tripsvc.UpdateEntryInput) error
	deleteEntry(entryID string) error
	reset(channelID string) error
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}

	// 全域旗標（在子命令前解析）
	useDB := false
	apiURL := "http://localhost:8080"
	args1 := os.Args[1:]
	filtered := args1[:0:len(args1)]
	for i := 0; i < len(args1); i++ {
		a := args1[i]
		if a == "-db" {
			useDB = true
			continue
		}
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

	cmd := os.Args[1]
	args := os.Args[2:]

	var c client
	var db *dbClient
	if useDB {
		db = newDBClient()
		defer db.close()
		c = db
	} else {
		c = newHTTPClient(apiURL)
	}

	switch cmd {
	case "login":
		if err := runLogin(apiURL, args); err != nil {
			fatal("login: %v", err)
		}
	case "list-channels":
		cmdListChannels(c)
	case "create-channel":
		cmdCreateChannel(c, args)
	case "entry-add":
		cmdEntryAdd(c, args)
	case "entry-update":
		cmdEntryUpdate(c, args)
	case "entry-delete":
		cmdEntryDelete(c, args)
	case "trip-entries":
		cmdTripEntries(c, args)
	case "reset":
		cmdReset(c, args)
	case "geocode":
		cmdGeocode(args)
	case "notify":
		cmdNotify(args)
	case "drop-trip-grouping":
		cmdDropTripGrouping(useDB, db)
	case "-h", "--help", "help":
		usage()
	default:
		fatal("未知子命令 %q（用 -h 看用法）", cmd)
	}
}

func cmdListChannels(c client) {
	res, err := c.listChannels()
	if err != nil {
		fatal("list-channels: %v", err)
	}
	output(res)
}

func cmdCreateChannel(c client, args []string) {
	fs := flag.NewFlagSet("create-channel", flag.ExitOnError)
	name := fs.String("name", "", "頻道名稱（必填）")
	_ = fs.Parse(args)
	if *name == "" {
		fatal("create-channel 需要 -name")
	}
	res, err := c.createChannel(*name)
	if err != nil {
		fatal("create-channel: %v", err)
	}
	output(res)
}

func cmdEntryAdd(c client, args []string) {
	fs := flag.NewFlagSet("entry-add", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID（必填）")
	title := fs.String("title", "", "事項描述（必填）")
	start := fs.String("start", "", "開始日期 'YYYY-MM-DD'")
	startTime := fs.String("start-time", "", "開始時刻 'HH:MM'")
	end := fs.String("end", "", "結束日期 'YYYY-MM-DD'（區間用）")
	endTime := fs.String("end-time", "", "結束時刻 'HH:MM'")
	location := fs.String("location", "", "地點")
	_ = fs.Parse(args)
	if *channel == "" || *title == "" {
		fatal("entry-add 需要 -channel 與 -title")
	}
	res, err := c.record(*channel, *title, *start, *startTime, *end, *endTime, *location)
	if err != nil {
		fatal("entry-add: %v", err)
	}
	output(res)
}

func cmdEntryUpdate(c client, args []string) {
	fs := flag.NewFlagSet("entry-update", flag.ExitOnError)
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
		fatal("entry-update 需要 -entry")
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
		fatal("entry-update: %v", err)
	}
	output(map[string]string{"updated": *id})
}

func cmdEntryDelete(c client, args []string) {
	fs := flag.NewFlagSet("entry-delete", flag.ExitOnError)
	id := fs.String("entry", "", "entry ID（必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("entry-delete 需要 -entry")
	}
	if err := c.deleteEntry(*id); err != nil {
		fatal("entry-delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// cmdTripEntries 列出某個頻道的所有 entry。名稱沿用歷史(舊版是列某個 trip
// 底下的 entry,需要 -channel 與 -trip 兩個參數;trip 歸組移除後改成列整個
// 頻道,只需要 -channel),等頻道本身改名為 trip 之後這個名稱剛好會對上實際
// 語意,故不另外改名。
func cmdTripEntries(c client, args []string) {
	fs := flag.NewFlagSet("trip-entries", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID（必填）")
	_ = fs.Parse(args)
	if *channel == "" {
		fatal("trip-entries 需要 -channel")
	}
	res, err := c.tripEntries(*channel)
	if err != nil {
		fatal("trip-entries: %v", err)
	}
	output(res)
}

func cmdReset(c client, args []string) {
	fs := flag.NewFlagSet("reset", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID（必填）")
	_ = fs.Parse(args)
	if *channel == "" {
		fatal("reset 需要 -channel")
	}
	if err := c.reset(*channel); err != nil {
		fatal("reset: %v", err)
	}
	output(map[string]string{"status": "ok", "channel": *channel})
}

func cmdNotify(args []string) {
	fs := flag.NewFlagSet("notify", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID（必填）")
	apiURL := fs.String("api", "http://localhost:8080", "server base URL")
	_ = fs.Parse(args)
	if *channel == "" {
		fatal("notify 需要 -channel")
	}
	notifyChannel(*channel, *apiURL)
	output(map[string]string{"notified": *channel})
}

// cmdDropTripGrouping 是一次性維運指令:清掉 trip 歸組機制留下的孤兒資料庫
// 物件(entries.trip_id 欄位與 trips 表,見 store.DropTripGroupingObjects)。
//
// 這不是常規的業務操作，而是直接動資料庫 schema，因此只在 -db 模式下有意義；
// 沒加 -db 就直接 fatal，不嘗試走 HTTP client(HTTP 沒有也不該有對應端點)。
func cmdDropTripGrouping(useDB bool, db *dbClient) {
	if !useDB {
		fatal("drop-trip-grouping 只能搭配 -db 使用（這是直接動資料庫 schema 的一次性維運操作，不走 HTTP）")
	}
	dropped, err := db.dropTripGrouping()
	if err != nil {
		fatal("drop-trip-grouping: %v", err)
	}
	if len(dropped) == 0 {
		output(map[string]any{
			"dropped": []string{},
			"message": "trip 歸組的資料庫物件（entries.trip_id、trips 表）已不存在，無需操作",
		})
		return
	}
	output(map[string]any{"dropped": dropped})
}

// notifyChannel 直接用 http.Post(不經 httpClient.do),故 /internal/* 現在
// 要求的 Authorization: Bearer token 得在這裡自己補上;讀不到本機 token 或
// 請求失敗都只是靜默放棄通知(維持原本的 best-effort 行為——這只是即時推播
// 更新用的通知,不是資料寫入本身,失敗不影響資料正確性,不值得讓呼叫端也
// 跟著失敗或印出錯誤)。
func notifyChannel(channelID, apiURL string) {
	token, err := loadToken()
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, apiURL+"/internal/channels/"+channelID+"/notify", nil)
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

func usage() {
	fmt.Print(`cli — entry/trip 操作工具

用法: cli [-api URL] [-db] <子命令> [旗標]

全域旗標:
  -api URL  server 位址（預設 http://localhost:8080）
  -db       直連 PostgreSQL（需要 DATABASE_URL，不走 HTTP）

子命令:
  login --web [-console URL]
               透過瀏覽器核准登入，換取本機快取的 token（其餘子命令的前置條件）。
               -console URL 只影響開瀏覽器要導去的核准頁面 origin，API 呼叫仍打
               -api（預設等於 -api，正式環境不需要帶；本機另外跑 Vite dev server
               時可用 -console http://localhost:5173）
  login --device [-console URL]
               無頭環境用（沒有本機可達網路位址、無法起本機伺服器等 --web
               依賴的前提）：印出一組短代碼與固定網址，在任意一台裝置打開
               網址、手動輸入代碼核准，CLI 自行輪詢換取 token。-console 用法
               同上。
  list-channels
  create-channel -name 文字
  trip-entries -channel ID
               列出該頻道的所有 entry。
  entry-add    -channel ID -title 文字 [-start 'YYYY-MM-DD'] [-start-time 'HH:MM'] [-end ...] [-end-time ...] [-location ...]
  entry-update -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
  entry-delete -entry ID
  reset        -channel ID
  geocode      -place 文字 [-region 國碼] [-n 筆數] [-entry ID]
               查詢地點座標；帶 -entry 時直接寫回該筆 entry 的經緯度。
  notify       -channel ID [-api URL]

  drop-trip-grouping   [僅限 -db] 一次性維運指令，清除 trip 歸組機制留下的
                        孤兒資料庫物件（entries.trip_id 欄位與 trips 表）。
                        非常規操作，不加 -db 會直接報錯。

所有輸出為 JSON。
`)
	os.Exit(0)
}
