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
//	list-trips
//	create-trip -name 文字
//	trip-entries -trip ID
//	entry-add    -trip ID -title 文字 [-start ... -end ... -location ...]
//	entry-update -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
//	entry-delete -entry ID
//	reset        -trip ID
//	geocode      -place 文字 [-region 國碼] [-entry ID]
//	notify       -trip ID
//
//	drop-trip-grouping   一次性維運指令,清除 trip 歸組機制留下的孤兒資料庫
//	                     物件(entries.trip_id 欄位與 trips 表)(僅 -db 模式)
//	rename-channel-to-trip   一次性維運指令,把 channel→trip 改名的資料庫結構
//	                     變更落實(channels 表改名 trips、channel_id 欄位改名
//	                     trip_id)(僅 -db 模式)
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

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/tripsvc"
)

// client 定義統一的操作介面，由 httpClient 或 dbClient 實作。
type client interface {
	listTrips() (any, error)
	createTrip(name string) (any, error)
	tripEntries(tripID string) (any, error)
	record(tripID, title, start, startTime, end, endTime, location string) (any, error)
	updateEntry(in tripsvc.UpdateEntryInput) error
	deleteEntry(entryID string) error
	reset(tripID string) error
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
	case "list-trips":
		cmdListTrips(c)
	case "create-trip":
		cmdCreateTrip(c, args)
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
	case "rename-channel-to-trip":
		cmdRenameChannelToTrip(useDB, db)
	case "landmark-add":
		cmdLandmarkAdd(useDB, db, args)
	case "landmark-list":
		cmdLandmarkList(useDB, db, args)
	case "landmark-cities":
		cmdLandmarkCities(useDB, db)
	case "landmark-delete":
		cmdLandmarkDelete(useDB, db, args)
	case "landmark-update-photo":
		cmdLandmarkUpdatePhoto(useDB, db, args)
	case "-h", "--help", "help":
		usage()
	default:
		fatal("未知子命令 %q（用 -h 看用法）", cmd)
	}
}

func cmdListTrips(c client) {
	res, err := c.listTrips()
	if err != nil {
		fatal("list-trips: %v", err)
	}
	output(res)
}

func cmdCreateTrip(c client, args []string) {
	fs := flag.NewFlagSet("create-trip", flag.ExitOnError)
	name := fs.String("name", "", "行程名稱（必填）")
	_ = fs.Parse(args)
	if *name == "" {
		fatal("create-trip 需要 -name")
	}
	res, err := c.createTrip(*name)
	if err != nil {
		fatal("create-trip: %v", err)
	}
	output(res)
}

func cmdEntryAdd(c client, args []string) {
	fs := flag.NewFlagSet("entry-add", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	title := fs.String("title", "", "事項描述（必填）")
	start := fs.String("start", "", "開始日期 'YYYY-MM-DD'")
	startTime := fs.String("start-time", "", "開始時刻 'HH:MM'")
	end := fs.String("end", "", "結束日期 'YYYY-MM-DD'（區間用）")
	endTime := fs.String("end-time", "", "結束時刻 'HH:MM'")
	location := fs.String("location", "", "地點")
	_ = fs.Parse(args)
	if *trip == "" || *title == "" {
		fatal("entry-add 需要 -trip 與 -title")
	}
	res, err := c.record(*trip, *title, *start, *startTime, *end, *endTime, *location)
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

// cmdTripEntries 列出某個行程的所有 entry。
func cmdTripEntries(c client, args []string) {
	fs := flag.NewFlagSet("trip-entries", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	_ = fs.Parse(args)
	if *trip == "" {
		fatal("trip-entries 需要 -trip")
	}
	res, err := c.tripEntries(*trip)
	if err != nil {
		fatal("trip-entries: %v", err)
	}
	output(res)
}

func cmdReset(c client, args []string) {
	fs := flag.NewFlagSet("reset", flag.ExitOnError)
	trip := fs.String("trip", "", "行程 ID（必填）")
	_ = fs.Parse(args)
	if *trip == "" {
		fatal("reset 需要 -trip")
	}
	if err := c.reset(*trip); err != nil {
		fatal("reset: %v", err)
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

// cmdRenameChannelToTrip 是一次性維運指令:把 channel→trip 改名這次程式碼
// 重構對應的資料庫結構變更真正落到資料庫上(見 store.RenameChannelToTrip)。
//
// 這不是常規的業務操作，而是直接動資料庫 schema，因此只在 -db 模式下有意義；
// 沒加 -db 就直接 fatal，不嘗試走 HTTP client(HTTP 沒有也不該有對應端點)。
func cmdRenameChannelToTrip(useDB bool, db *dbClient) {
	if !useDB {
		fatal("rename-channel-to-trip 只能搭配 -db 使用（這是直接動資料庫 schema 的一次性維運操作，不走 HTTP）")
	}
	renamed, err := db.renameChannelToTrip()
	if err != nil {
		fatal("rename-channel-to-trip: %v", err)
	}
	if len(renamed) == 0 {
		output(map[string]any{
			"renamed": []string{},
			"message": "channels/channel_id 已不存在（已改名過或本來就是新 schema），無需操作",
		})
		return
	}
	output(map[string]any{"renamed": renamed})
}

// cmdLandmarkAdd 新增一筆地標/區域資料(見 model.Landmark 的完整說明)。
// 只在 -db 模式下有意義——這是人工建檔操作,不透過 HTTP(不開放給
// 一般使用者寫入,避免資料被任意竄改)。
func cmdLandmarkAdd(useDB bool, db *dbClient, args []string) {
	if !useDB {
		fatal("landmark-add 只能搭配 -db 使用（這是直接寫資料庫的人工建檔操作，不走 HTTP）")
	}
	fs := flag.NewFlagSet("landmark-add", flag.ExitOnError)
	name := fs.String("name", "", "地標/區域白話名稱（必填），如「古城區」「101」")
	city := fs.String("city", "", "所屬城市名稱（必填），對齊 GET /internal/geo/districts?city= 的查詢字串")
	lat := fs.Float64("lat", 0, "緯度（必填）")
	lng := fs.Float64("lng", 0, "經度（必填）")
	level := fs.Int("level", 0, "知名度分級（必填），1=國際 2=國家 3=區域 4=城市 5=在地")
	radius := fs.Int("radius", 0, "大致範圍半徑（公尺），0 表示這是單點地標而非有範圍的區域")
	summary := fs.String("summary", "", "白話簡介（選填）")
	photoURL := fs.String("photo-url", "", "代表性照片網址（選填）")
	_ = fs.Parse(args)
	if *name == "" || *city == "" || *level == 0 {
		fatal("landmark-add 需要 -name、-city、-level（1~5）")
	}
	if *level < 1 || *level > 5 {
		fatal("landmark-add 的 -level 必須介於 1~5")
	}
	in := model.Landmark{
		Name: *name, CityName: *city, Lat: *lat, Lng: *lng,
		Level: *level, RadiusMeters: *radius,
	}
	if *summary != "" {
		in.Summary = summary
	}
	if *photoURL != "" {
		in.PhotoURL = photoURL
	}
	res, err := db.landmarkAdd(in)
	if err != nil {
		fatal("landmark-add: %v", err)
	}
	output(res)
}

// cmdLandmarkList 列出指定城市的所有地標/區域資料。
func cmdLandmarkList(useDB bool, db *dbClient, args []string) {
	if !useDB {
		fatal("landmark-list 只能搭配 -db 使用")
	}
	fs := flag.NewFlagSet("landmark-list", flag.ExitOnError)
	city := fs.String("city", "", "城市名稱（必填）")
	_ = fs.Parse(args)
	if *city == "" {
		fatal("landmark-list 需要 -city")
	}
	res, err := db.landmarkList(*city)
	if err != nil {
		fatal("landmark-list: %v", err)
	}
	output(res)
}

// cmdLandmarkCities 列出目前已有地標資料的城市清單。
func cmdLandmarkCities(useDB bool, db *dbClient) {
	if !useDB {
		fatal("landmark-cities 只能搭配 -db 使用")
	}
	res, err := db.landmarkCities()
	if err != nil {
		fatal("landmark-cities: %v", err)
	}
	output(res)
}

// cmdLandmarkDelete 刪除一筆地標資料。
func cmdLandmarkDelete(useDB bool, db *dbClient, args []string) {
	if !useDB {
		fatal("landmark-delete 只能搭配 -db 使用")
	}
	fs := flag.NewFlagSet("landmark-delete", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("landmark-delete 需要 -id")
	}
	if err := db.landmarkDelete(*id); err != nil {
		fatal("landmark-delete: %v", err)
	}
	output(map[string]string{"deleted": *id})
}

// cmdLandmarkUpdatePhoto 重新透過 Google Places 查詢一次地標圖片並回寫
// 到資料庫(見 dbClient.landmarkUpdatePhoto 的完整說明)。-query 未指定
// 時用該筆地標既有的城市+名稱組成預設查詢字串。
func cmdLandmarkUpdatePhoto(useDB bool, db *dbClient, args []string) {
	if !useDB {
		fatal("landmark-update-photo 只能搭配 -db 使用")
	}
	fs := flag.NewFlagSet("landmark-update-photo", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	query := fs.String("query", "", "查詢字串（選填，預設用該地標的城市+名稱）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("landmark-update-photo 需要 -id")
	}
	res, err := db.landmarkUpdatePhoto(*id, *query)
	if err != nil {
		fatal("landmark-update-photo: %v", err)
	}
	output(res)
}

// notifyTrip 直接用 http.Post(不經 httpClient.do),故 /internal/* 現在
// 要求的 Authorization: Bearer token 得在這裡自己補上;讀不到本機 token 或
// 請求失敗都只是靜默放棄通知(維持原本的 best-effort 行為——這只是即時推播
// 更新用的通知,不是資料寫入本身,失敗不影響資料正確性,不值得讓呼叫端也
// 跟著失敗或印出錯誤)。
func notifyTrip(tripID, apiURL string) {
	token, err := loadToken()
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
  list-trips
  create-trip -name 文字
  trip-entries -trip ID
               列出該行程的所有 entry。
  entry-add    -trip ID -title 文字 [-start 'YYYY-MM-DD'] [-start-time 'HH:MM'] [-end ...] [-end-time ...] [-location ...]
  entry-update -entry ID [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] [-kind ...] [-detail JSON]
  entry-delete -entry ID
  reset        -trip ID
  geocode      -place 文字 [-region 國碼] [-n 筆數] [-entry ID]
               查詢地點座標；帶 -entry 時直接寫回該筆 entry 的經緯度。
  notify       -trip ID [-api URL]

  drop-trip-grouping   [僅限 -db] 一次性維運指令，清除 trip 歸組機制留下的
                        孤兒資料庫物件（entries.trip_id 欄位與 trips 表）。
                        非常規操作，不加 -db 會直接報錯。

  rename-channel-to-trip   [僅限 -db] 一次性維運指令，把 channel→trip 改名
                        對應的資料庫結構變更落實（channels 表改名 trips、
                        entries/members/public_links 的 channel_id 欄位
                        改名 trip_id）。非常規操作，不加 -db 會直接報錯。

  landmark-add    [僅限 -db] -name 文字 -city 文字 -lat 緯度 -lng 經度
                        -level 1~5 [-radius 公尺] [-summary 文字] [-photo-url 網址]
                        新增地標/區域資料（地理輪廓底圖用，構想 6，見
                        docs/TRIP_PLANNING_DESIGN_DISCUSSION.md）。分級對照：
                        1=國際（如 101） 2=國家（如中正紀念堂）
                        3=區域（如淡水、陽明山） 4=城市（如象山）
                        5=在地（如博愛特區、永康商圈、公館商圈）
  landmark-list   [僅限 -db] -city 文字
                        列出指定城市的所有地標/區域資料。
  landmark-cities [僅限 -db]
                        列出目前已有地標資料的城市清單。
  landmark-delete [僅限 -db] -id 地標ID
                        刪除一筆地標資料。
  landmark-update-photo [僅限 -db] -id 地標ID [-query 文字]
                        重新透過 Google Places 查詢一次圖片並回寫到資料庫。
                        -query 未指定時，用該地標既有的城市+名稱當查詢字串。

所有輸出為 JSON。
`)
	os.Exit(0)
}
