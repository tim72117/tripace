// Command seedtrip 是 entry/trip 的 CLI,供 Claude Code 直接操作行程資料。
//
// 設計:所有邏輯都復用 internal/tripsvc 服務層(與 LLM 工具同一套),CLI 本身
// 不含任何歸組/寫入邏輯。互動模式對齊 LLM:
//
//	record 一筆 entry → 回傳 entryID + 候選行程(JSON)
//	→ Claude Code 依語意判斷該歸入哪個候選(或新建)
//	→ add-to-trip 寫入歸屬
//
// 所有輸出為 JSON(方便 Claude Code 解析)。時間用絕對字串
// 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM'(日期換算由呼叫端先做)。
//
// 子命令:
//
//	record       -channel ID -item 文字 [-start ... -end ... -location ...]
//	add-to-trip  -entry ID [-trip ID] [-title 文字]
//	list-trips   -channel ID
//	trip-entries -channel ID -trip ID
//	candidates   -channel ID -start ... [-end ...]
//	reset        -channel ID
//
// DATABASE_URL 由 server/.env 提供(godotenv 自動載入)。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/channel/server/internal/store"
	"github.com/channel/server/internal/tripsvc"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	if len(os.Args) < 2 {
		usage()
	}
	cmd := os.Args[1]
	args := os.Args[2:]

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fatal("未設 DATABASE_URL(請在 server/.env 設定)")
	}
	st, err := store.Open(dsn)
	if err != nil {
		fatal("open store: %v", err)
	}
	defer st.Close()
	svc := tripsvc.New(st)

	switch cmd {
	case "record":
		cmdRecord(svc, args)
	case "add-to-trip":
		cmdAddToTrip(svc, args)
	case "list-trips":
		cmdListTrips(svc, args)
	case "trip-entries":
		cmdTripEntries(svc, args)
	case "candidates":
		cmdCandidates(svc, args)
	case "update-entry":
		cmdUpdateEntry(svc, args)
	case "notify":
		cmdNotify(args)
	case "delete-trip":
		cmdDeleteTrip(svc, args)
	case "reset":
		cmdReset(svc, args)
	case "-h", "--help", "help":
		usage()
	default:
		fatal("未知子命令 %q(用 -h 看用法)", cmd)
	}
}

// record:寫入一筆 entry,輸出 { entryID, allDay, candidates }。
// candidates 是時間重疊的候選行程,供呼叫端決定是否 add-to-trip。
func cmdRecord(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("record", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID(必填)")
	item := fs.String("item", "", "事項描述(必填)")
	start := fs.String("start", "", "開始時間 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM'")
	end := fs.String("end", "", "結束時間(區間 entry 用,如住宿)")
	location := fs.String("location", "", "地點")
	_ = fs.Parse(args)
	if *channel == "" || *item == "" {
		fatal("record 需要 -channel 與 -item")
	}
	res, err := svc.Record(tripsvc.RecordInput{
		ChannelID: *channel, Item: *item, Start: *start, End: *end, Location: *location,
	})
	if err != nil {
		fatal("record: %v", err)
	}
	output(res)
}

// add-to-trip:把 entry 歸入 trip;-trip 留空則新建(用 -title 或 entry.Item)。
func cmdAddToTrip(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("add-to-trip", flag.ExitOnError)
	entry := fs.String("entry", "", "entry ID(必填)")
	trip := fs.String("trip", "", "trip ID(留空則新建)")
	title := fs.String("title", "", "新建 trip 時的行程名(留空用 entry.Item)")
	_ = fs.Parse(args)
	if *entry == "" {
		fatal("add-to-trip 需要 -entry")
	}
	tripID, channelID, err := svc.AddToTrip(*entry, *trip, *title)
	if err != nil {
		fatal("add-to-trip: %v", err)
	}
	notifyChannel(channelID, "http://localhost:8080")
	output(map[string]string{"entryID": *entry, "tripID": tripID})
}

func cmdListTrips(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("list-trips", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID(必填)")
	_ = fs.Parse(args)
	if *channel == "" {
		fatal("list-trips 需要 -channel")
	}
	trips, err := svc.ListTrips(*channel)
	if err != nil {
		fatal("list-trips: %v", err)
	}
	output(map[string]any{"trips": trips})
}

func cmdTripEntries(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("trip-entries", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID(必填)")
	trip := fs.String("trip", "", "trip ID(必填)")
	_ = fs.Parse(args)
	if *channel == "" || *trip == "" {
		fatal("trip-entries 需要 -channel 與 -trip")
	}
	ents, err := svc.ListTripEntries(*channel, *trip)
	if err != nil {
		fatal("trip-entries: %v", err)
	}
	output(map[string]any{"entries": ents})
}

func cmdCandidates(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("candidates", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID(必填)")
	start := fs.String("start", "", "開始時間(必填)")
	end := fs.String("end", "", "結束時間")
	_ = fs.Parse(args)
	if *channel == "" || *start == "" {
		fatal("candidates 需要 -channel 與 -start")
	}
	trips, err := svc.FindCandidates(*channel, *start, *end)
	if err != nil {
		fatal("candidates: %v", err)
	}
	output(map[string]any{"candidates": trips})
}

func cmdUpdateEntry(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("update-entry", flag.ExitOnError)
	id       := fs.String("entry", "", "entry ID(必填)")
	item     := fs.String("item", "", "事項描述")
	start    := fs.String("start", "", "開始時間")
	end      := fs.String("end", "", "結束時間")
	location := fs.String("location", "", "地點")
	summary  := fs.String("summary", "", "細節描述")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("update-entry 需要 -entry")
	}
	if err := svc.UpdateEntry(tripsvc.UpdateEntryInput{
		ID: *id, Item: *item, Start: *start, End: *end, Location: *location, Summary: *summary,
	}); err != nil {
		fatal("update-entry: %v", err)
	}
	output(map[string]string{"updated": *id})
}

func cmdNotify(args []string) {
	fs := flag.NewFlagSet("notify", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID(必填)")
	apiURL  := fs.String("api", "http://localhost:8080", "server base URL")
	_ = fs.Parse(args)
	if *channel == "" {
		fatal("notify 需要 -channel")
	}
	notifyChannel(*channel, *apiURL)
	output(map[string]string{"notified": *channel})
}

func notifyChannel(channelID, apiURL string) {
	url := apiURL + "/internal/channels/" + channelID + "/notify"
	resp, err := http.Post(url, "application/json", nil)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func cmdDeleteTrip(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("delete-trip", flag.ExitOnError)
	trip := fs.String("trip", "", "trip ID(必填)")
	_ = fs.Parse(args)
	if *trip == "" {
		fatal("delete-trip 需要 -trip")
	}
	if err := svc.DeleteTrip(*trip); err != nil {
		fatal("delete-trip: %v", err)
	}
	output(map[string]string{"deleted": *trip})
}

func cmdReset(svc *tripsvc.Service, args []string) {
	fs := flag.NewFlagSet("reset", flag.ExitOnError)
	channel := fs.String("channel", "", "頻道 ID(必填)")
	_ = fs.Parse(args)
	if *channel == "" {
		fatal("reset 需要 -channel")
	}
	if err := svc.Reset(*channel); err != nil {
		fatal("reset: %v", err)
	}
	output(map[string]string{"status": "ok", "channel": *channel})
}

// output 以縮排 JSON 印到 stdout(供 Claude Code 解析)。
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
	fmt.Print(`seedtrip — entry/trip CLI(復用 internal/tripsvc,與 LLM 同一套邏輯)

用法: seedtrip <子命令> [旗標]

子命令:
  record       -channel ID -item 文字 [-start 'YYYY-MM-DD[ HH:MM]'] [-end ...] [-location ...]
               寫入一筆 entry,輸出 entryID 與候選行程(candidates)。
  add-to-trip  -entry ID [-trip ID] [-title 文字]
               把 entry 歸入 trip;-trip 留空則新建。
  list-trips   -channel ID                  列出頻道的所有行程。
  trip-entries -channel ID -trip ID         列出某行程底下的條目。
  candidates   -channel ID -start ... [-end ...]  查時間重疊的候選行程。
  update-entry -entry ID [-item 文字] [-start ...] [-end ...] [-location ...]
               更新一筆 entry 的欄位；留空者不更新。
  reset        -channel ID                  清空頻道的 entries/trips。

時間用絕對字串 'YYYY-MM-DD'(全日)或 'YYYY-MM-DD HH:MM'。所有輸出為 JSON。
`)
	os.Exit(0)
}
