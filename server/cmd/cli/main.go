// Command cli 是 entry/trip 的操作工具，供 Claude Code / LLM 直接操作行程資料。
//
// 預設走 HTTP 存取本地或遠端 server（/internal/ API）。
// 加 -db 旗標改為直連 PostgreSQL（需要 DATABASE_URL）。
//
// 子命令:
//
//	record       -channel ID -title 文字 [-start ... -end ... -location ...]
//	add-to-trip  -entry ID [-trip ID] [-title 文字]
//	list-trips   -channel ID
//	trip-entries -channel ID -trip ID
//	candidates   -channel ID -start ... [-end ...]
//	update-entry -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
//	delete-trip  -trip ID
//	reset        -channel ID
//	notify       -channel ID
//
//	drop-legacy-columns  一次性維運指令,用於清除已改名的舊資料庫欄位(僅 -db 模式)
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
	record(channelID, title, start, startTime, end, endTime, location string) (any, error)
	addToTrip(entryID, tripID, title string) (string, string, error)
	listTrips(channelID string) (any, error)
	tripEntries(channelID, tripID string) (any, error)
	candidates(channelID, start, end string) (any, error)
	updateEntry(in tripsvc.UpdateEntryInput) error
	deleteEntry(entryID string) error
	deleteTrip(tripID string) error
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
	case "list-channels":
		cmdListChannels(c)
	case "entry-add":
		cmdEntryAdd(c, args)
	case "entry-update":
		cmdEntryUpdate(c, args)
	case "entry-delete":
		cmdEntryDelete(c, args)
	case "add-to-trip":
		cmdAddToTrip(c, apiURL, args)
	case "list-trips":
		cmdListTrips(c, args)
	case "trip-entries":
		cmdTripEntries(c, args)
	case "candidates":
		cmdCandidates(c, args)
	case "delete-trip":
		cmdDeleteTrip(c, args)
	case "reset":
		cmdReset(c, args)
	case "geocode":
		cmdGeocode(args)
	case "notify":
		cmdNotify(args)
	case "drop-legacy-columns":
		cmdDropLegacyColumns(useDB, db)
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

// cmdDropLegacyColumns 是一次性維運指令:清掉 entries 表已改名淘汰的舊欄位
// (item -> title, summary -> note 改名後留下的死欄位)。
//
// 這不是常規的業務操作，而是直接動資料庫 schema，因此只在 -db 模式下有意義；
// 沒加 -db 就直接 fatal，不嘗試走 HTTP client(HTTP 沒有也不該有對應端點)。
func cmdDropLegacyColumns(useDB bool, db *dbClient) {
	if !useDB {
		fatal("drop-legacy-columns 只能搭配 -db 使用（這是直接動資料庫 schema 的一次性維運操作，不走 HTTP）")
	}
	dropped, err := db.dropLegacyColumns()
	if err != nil {
		fatal("drop-legacy-columns: %v", err)
	}
	if len(dropped) == 0 {
		output(map[string]any{
			"dropped": []string{},
			"message": "舊欄位（item/summary）已不存在，無需操作",
		})
		return
	}
	output(map[string]any{"dropped": dropped})
}

func notifyChannel(channelID, apiURL string) {
	url := apiURL + "/internal/channels/" + channelID + "/notify"
	resp, err := http.Post(url, "application/json", nil)
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
  record       -channel ID -title 文字 [-start 'YYYY-MM-DD[ HH:MM]'] [-end ...] [-location ...]
  add-to-trip  -entry ID [-trip ID] [-title 文字]
  list-trips   -channel ID
  trip-entries -channel ID -trip ID
  candidates   -channel ID -start ... [-end ...]
  update-entry -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
  delete-trip  -trip ID
  reset        -channel ID
  notify       -channel ID [-api URL]

  drop-legacy-columns  [僅限 -db] 一次性維運指令，清除已改名的舊資料庫欄位
                        (entries.item/entries.summary，已改名為 title/note)。
                        非常規操作，不加 -db 會直接報錯。

所有輸出為 JSON。
`)
	os.Exit(0)
}
