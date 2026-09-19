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

func main() {
	if len(os.Args) < 2 {
		usage()
	}

	// 全域旗標（在子命令前解析）
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

	cmd := os.Args[1]
	args := os.Args[2:]

	c := newHTTPClient(apiURL)

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
	case "attraction-add":
		cmdAttractionAdd(c, args)
	case "attraction-list":
		cmdAttractionList(c, args)
	case "attraction-cities":
		cmdAttractionCities(c)
	case "attraction-delete":
		cmdAttractionDelete(c, args)
	case "attraction-update":
		cmdAttractionUpdate(c, args)
	case "attraction-set-place-id":
		cmdAttractionSetPlaceID(c, args)
	case "attraction-set-theme":
		cmdAttractionSetTheme(c, args)
	case "attraction-update-photo":
		cmdAttractionUpdatePhoto(apiURL, args)
	case "attraction-sync-setup":
		cmdAttractionSyncSetup(c, args)
	case "attraction-sync":
		cmdAttractionSync(c, args)
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
// 直連資料庫(見本檔案開頭「架構說明」)。-photo-url 未帶時,後端會自動
// 查 Pexels 補一張示意圖(見該端點的完整說明)。
//
// -lat/-lng 與 -place 二擇一,做法與 cmdAttractionUpdate 一致(見
// resolveCoords 的完整說明):-place 有值時改用 GET
// /internal/maintenance/geocode 查詢該地名的座標,取第一筆候選結果當
// 建檔座標,不需要使用者自己先查好經緯度;明確帶 -lat/-lng 時優先採用
// (不查 geocode)。兩個子命令共用同一段查詢邏輯,不再各自維護一份。
func cmdAttractionAdd(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction-add", flag.ExitOnError)
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
	photoURL := fs.String("photo-url", "", "代表性照片網址（選填）")
	// placeIDFlag:讓使用者可以不透過 -place 查詢、直接明確指定 place_id
	// ——例如使用者已經從別處(如 Google Maps 網頁版分享連結)拿到確切的
	// place_id,不需要再讓 -place 的文字查詢去猜一次(文字查詢可能因為
	// 地名口語化/多個同名候選而選到不是使用者原本想要的那筆)。有值時
	// 優先採用(不查 -place 查詢結果附帶的 place_id),對齊 -lat/-lng
	// 優先於 -place 查詢結果的既有慣例。
	placeIDFlag := fs.String("place-id", "", "手動指定這個景點對應的 Google place_id（選填，優先於 -place 查詢結果附帶的 place_id）；有值時可讓前端優先使用漸進補圖機制的雙來源照片")
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
		fatal("attraction-add 需要 -name、-city、-level（1~5）")
	}
	if *level < 1 || *level > 5 {
		fatal("attraction-add 的 -level 必須介於 1~5")
	}

	newLat, newLng, resolvedPlaceID, err := resolveCoords(c, *lat, *lng, *place, *region)
	if err != nil {
		fatal("attraction-add: %v", err)
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
	if *photoURL != "" {
		in.PhotoURL = photoURL
	}
	// place_id 優先順序:使用者明確帶 -place-id > -place 查詢結果附帶的
	// place_id > 都沒有時維持 nil(舊有行為,只用 PhotoURL 這條路徑)。
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
		fatal("attraction-add: 非主題點(isTheme 為 false，預設等同 level 不是 1)必須有 place_id(前端點擊時會改開 place 資訊卡,沒有 place_id 會查不到資料)——請用 -place-id 明確指定,或改用 -place 查詢且該地名查得到 place_id")
	}
	if finalPlaceID != "" {
		in.PlaceID = &finalPlaceID
	}
	res, err := c.attractionAdd(in)
	if err != nil {
		fatal("attraction-add: %v", err)
	}
	output(res)
}

// cmdAttractionList 列出指定城市的所有景點區域資料。走
// GET /internal/maintenance/attractions?city=(見 http.go 的
// httpClient.attractionList)。
func cmdAttractionList(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction-list", flag.ExitOnError)
	city := fs.String("city", "", "城市名稱（必填）")
	_ = fs.Parse(args)
	if *city == "" {
		fatal("attraction-list 需要 -city")
	}
	res, err := c.attractionList(*city)
	if err != nil {
		fatal("attraction-list: %v", err)
	}
	output(res)
}

// cmdAttractionCities 列出目前已有景點區域資料的城市清單。走
// GET /internal/maintenance/attractions/cities。
func cmdAttractionCities(c *httpClient) {
	res, err := c.attractionCities()
	if err != nil {
		fatal("attraction-cities: %v", err)
	}
	output(res)
}

// cmdAttractionDelete 刪除一筆景點區域資料。走
// DELETE /internal/maintenance/attractions/{id}。
func cmdAttractionDelete(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction-delete", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction-delete 需要 -id")
	}
	if err := c.attractionDelete(*id); err != nil {
		fatal("attraction-delete: %v", err)
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
	fs := flag.NewFlagSet("attraction-update", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	lat := fs.Float64("lat", 0, "新緯度（與 -place 二擇一）")
	lng := fs.Float64("lng", 0, "新經度（與 -place 二擇一）")
	place := fs.String("place", "", "改查這個地名的座標（與 -lat/-lng 二擇一，取第一筆候選結果）")
	region := fs.String("region", "", "地名查詢的國家代碼限制，如 jp / tw / cn（僅搭配 -place 使用，選填）")
	field := fs.String("field", "", "要更新的欄位名（目前開放 name、summary，與 -value 一起使用）")
	value := fs.String("value", "", "-field 指定欄位的新內容")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction-update 需要 -id")
	}
	haveCoords := *lat != 0 || *lng != 0
	if !haveCoords && *place == "" && *field == "" {
		fatal("attraction-update 需要 -lat/-lng、-place 或 -field/-value 其中一項")
	}
	if (*field == "") != (*value == "") {
		fatal("attraction-update 的 -field 與 -value 必須一起提供")
	}

	if haveCoords || *place != "" {
		// 第三個回傳值(place_id)這裡不需要——attraction-update 只修正座標,
		// 不動 place_id;要補上/修改 place_id 用 attraction-set-place-id
		// (見該指令的說明)。
		newLat, newLng, _, err := resolveCoords(c, *lat, *lng, *place, *region)
		if err != nil {
			fatal("attraction-update: %v", err)
		}

		res, err := c.attractionUpdateCoords(*id, newLat, newLng)
		if err != nil {
			fatal("attraction-update: %v", err)
		}
		output(res)
	}

	if *field != "" {
		res, err := c.attractionUpdateField(*id, *field, *value)
		if err != nil {
			fatal("attraction-update: %v", err)
		}
		output(res)
	}
}

// cmdAttractionSetPlaceID 補上(或清空)一筆既有景點區域對應的 Google
// place_id——走 PATCH /internal/maintenance/attractions/{id}/place-id(見
// httpClient.attractionUpdatePlaceID 的完整說明)。獨立於 attraction-update
// 之外(不塞進 -field/-value 通用機制),理由同後端 handler 的說明:
// place_id 允許明確傳空字串清空,跟 -field/-value 那組欄位「不可為空」的
// 既有語意不同。
//
// 使用情境:這批 attraction 資料原本(2026-09 之前)完全沒有 place_id
// 概念,既有已建檔的景點區域不會自動補上——透過這個指令補上後,前端
// (AttractionInfoPanel.tsx)才會開始改用「地點照片漸進補圖機制」的
// Google/Pexels 雙來源照片,取代/補強單一的 photo_url。新建的景點區域
// 可以直接用 attraction-add -place-id(或 -place 查詢自動帶出),不需要
// 額外再跑這個指令。
//
// -place-id(手動指定)與 -place(改查地名)二擇一,互斥:-place-id 是
// 使用者已經從別處(如 Google Maps 網頁版分享連結)拿到確切的
// place_id,直接信任這個輸入、不再查詢驗證它是否有效(對齊
// attraction-add 對這個 flag 的既有慣例,見該處說明);-place 則跟
// attraction-add 共用同一支 resolveCoords 查詢地名的座標/place_id,不
// 重新實作一次查詢邏輯。優先序:兩者都帶視為使用者輸入衝突,直接報錯
// 而非靜默選一個(這裡沒有明顯的「合理預設」可言——不像
// attraction-add 的 -lat/-lng 優先於 -place 查詢結果附帶的
// place_id,那是「精確輸入優先於查詢猜測」的單向覆蓋關係;這裡兩個
// flag 各自都是使用者主動指定的明確意圖,同時給很可能是誤用,錯誤
// 訊息比默默選一個更安全)。resolveCoords 查到的座標在這裡用不到
// (這個指令只改 place_id,不動座標),只取第三個回傳值。
func cmdAttractionSetPlaceID(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction-set-place-id", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	placeID := fs.String("place-id", "", "手動指定 Google place_id（與 -place 二擇一，信任使用者輸入，不查詢驗證）")
	place := fs.String("place", "", "改查這個地名帶回的 place_id（與 -place-id 二擇一，取第一筆候選結果，查詢邏輯與 attraction-add 共用）")
	region := fs.String("region", "", "地名查詢的國家代碼限制，如 jp / tw / cn（僅搭配 -place 使用，選填）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction-set-place-id 需要 -id")
	}
	if *placeID != "" && *place != "" {
		fatal("attraction-set-place-id 的 -place-id 與 -place 二擇一，不能同時提供")
	}
	if *placeID == "" && *place == "" {
		fatal("attraction-set-place-id 需要 -place-id 或 -place 其中一項")
	}

	finalPlaceID := *placeID
	if finalPlaceID == "" {
		// -place 分支:跟 attraction-add 共用同一支 resolveCoords(見該
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
			fatal("attraction-set-place-id: %v", err)
		}
		if resolvedPlaceID == "" {
			fatal("attraction-set-place-id: -place 查到的候選地點沒有 place_id，請改用 -place-id 手動指定")
		}
		finalPlaceID = resolvedPlaceID
	}

	res, err := c.attractionUpdatePlaceID(*id, finalPlaceID)
	if err != nil {
		fatal("attraction-set-place-id: %v", err)
	}
	output(res)
}

// cmdAttractionSetTheme 更新一筆既有景點區域是否為「主題點」(散策羅盤
// 用語,見 model.Attraction.IsTheme 欄位註解)——走 PATCH
// /internal/maintenance/attractions/{id}/theme(見
// httpClient.attractionUpdateTheme 的完整說明)。比 attraction-set-place-id
// 單純:-theme 是必填的布林值,沒有「-place 改查」那種多來源輸入,單純
// 設定使用者明確指定的值即可,不需要另外查詢驗證。
//
// 使用情境:is_theme 欄位剛新增時,資料庫既有資料一律預設為 false(不論
// 原本 level 是多少),需要靠這支指令逐筆補上正確分類,把過去用
// level===1 判斷主題點的既有前端邏輯,換成獨立的 isTheme 欄位。
func cmdAttractionSetTheme(c *httpClient, args []string) {
	fs := flag.NewFlagSet("attraction-set-theme", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	isTheme := fs.Bool("theme", false, "是否為主題點（必填，true 或 false）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction-set-theme 需要 -id")
	}
	themeGiven := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "theme" {
			themeGiven = true
		}
	})
	if !themeGiven {
		fatal("attraction-set-theme 需要明確指定 -theme=true 或 -theme=false")
	}

	res, err := c.attractionUpdateTheme(*id, *isTheme)
	if err != nil {
		fatal("attraction-set-theme: %v", err)
	}
	output(res)
}

// cmdAttractionUpdatePhoto 重新查詢一次地標圖片並回寫到資料庫——走
// POST /internal/maintenance/attractions/{id}/update-photo(見
// server/internal/api/maintenance.go 與 httpClient.attractionUpdatePhoto
// 的完整說明)。-query 未指定時用該筆地標既有的城市+名稱組成預設查詢
// 字串(後端決定,不在 CLI 端組)。-source 選 google(預設,真實照片,需要
// GOOGLE_PLACES_API_KEY)或 pexels(關鍵字比對到的示意圖,非真實照片,
// 需要 PEXELS_API_KEY,查到後端會自動下載並落地到 GCS)。
func cmdAttractionUpdatePhoto(apiURL string, args []string) {
	fs := flag.NewFlagSet("attraction-update-photo", flag.ExitOnError)
	id := fs.String("id", "", "地標 ID（必填）")
	query := fs.String("query", "", "查詢字串（選填，預設用該地標的城市+名稱）")
	source := fs.String("source", "google", "圖片來源：google（真實照片）或 pexels（示意圖，非真實照片）")
	_ = fs.Parse(args)
	if *id == "" {
		fatal("attraction-update-photo 需要 -id")
	}
	if *source != "google" && *source != "pexels" {
		fatal("attraction-update-photo 的 -source 須為 google 或 pexels")
	}
	res, err := newHTTPClient(apiURL).attractionUpdatePhoto(*id, *query, *source)
	if err != nil {
		fatal("attraction-update-photo: %v", err)
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

用法: cli [-api URL] <子命令> [旗標]

全域旗標:
  -api URL  server 位址（預設 http://localhost:8080）

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
               查詢地點座標（走 /internal/maintenance/geocode，需要先登入）；
               帶 -entry 時直接寫回該筆 entry 的經緯度。
  notify       -trip ID [-api URL]

  attraction-add    -name 文字 -city 文字 (-lat 緯度 -lng 經度 | -place 文字 [-region 國碼])
                        -level 1~5 [-radius 公尺] [-summary 文字] [-photo-url 網址] [-place-id ID]
                        [-theme]
                        新增景點區域資料（地理輪廓底圖用，構想 6，見
                        docs/TRIP_PLANNING_DESIGN_DISCUSSION.md）。分級對照：
                        1=國際（如 101） 2=國家（如中正紀念堂）
                        3=區域（如淡水、陽明山） 4=城市（如象山）
                        5=在地（如博愛特區、永康商圈、公館商圈）。走
                        POST /internal/maintenance/attractions，需要先登入；
                        -lat/-lng 與 -place 二擇一，-place 會先查該地名座標
                        （取第一筆候選）再建檔，不需要自己先查好經緯度；
                        -photo-url 未帶時，後端會自動查 Pexels 補一張示意圖
                        （查無結果不影響建檔）。-theme 決定這筆資料是否為
                        「主題點」（散策羅盤用語，主題點是使用者點開後會
                        揭露周邊精選點的錨點，見 model.Attraction.IsTheme
                        欄位註解）；未明確帶 -theme 時，依 -level===1
                        自動推斷（對齊既有慣例），明確帶 -theme=true 或
                        -theme=false 時一律以使用者輸入為準，可讓是否為
                        主題點跟 -level 分開設定。非主題點（最終判定的
                        IsTheme 為 false，預設等同 level 不是 1）強制要求
                        要有 place_id（不論來自 -place-id 手動指定或
                        -place 查詢帶回，-lat/-lng 手動座標且未帶
                        -place-id 時一律拒絕建檔）——前端點擊非主題點的
                        地標會改開 Google 地點資訊卡（見 web/src/
                        geo-planning/GeoOutlineMap.tsx 的
                        handleAttractionClickRouted），沒有 place_id 會
                        查不到資料、點擊沒有反應。主題點不受此限制，
                        place_id 仍為選填。
  attraction-list   -city 文字
                        列出指定城市的所有景點區域資料。
  attraction-cities
                        列出目前已有景點區域資料的城市清單。
  attraction-delete -id 地標ID
                        刪除一筆景點區域資料。
  attraction-update -id 地標ID [-lat 緯度 -lng 經度 | -place 文字 [-region 國碼]] [-field 欄位名 -value 新內容]
                        修正一筆景點區域資料的座標和/或其他單一欄位（座標
                        走 PATCH /internal/maintenance/attractions/{id}/coords、
                        其餘欄位走通用的 PATCH .../field，需要先登入）。
                        -lat/-lng 與 -place 二擇一：明確帶 -lat/-lng 時直接
                        採用；帶 -place 則改查該地名的座標（取第一筆候選
                        結果），不需要自己先查好經緯度。-field/-value 目前
                        開放 name、summary 兩個欄位，須一起提供，可單獨
                        使用也可與座標修正一起帶入。
  attraction-set-place-id -id 地標ID (-place-id ID | -place 文字 [-region 國碼])
                        補上（或改查）一筆既有景點區域對應的 Google
                        place_id（走 PATCH /internal/maintenance/
                        attractions/{id}/place-id，需要先登入）。
                        -place-id 與 -place 二擇一，不能同時提供：
                        -place-id 手動指定（信任使用者輸入，不查詢驗證）；
                        -place 改查該地名帶回的 place_id（取第一筆候選
                        結果，查詢邏輯與 attraction-add 共用），查無
                        place_id 時報錯，不會靜默清空既有值。
  attraction-set-theme -id 地標ID -theme=true|false
                        更新一筆既有景點區域是否為「主題點」（散策羅盤
                        用語，主題點是使用者點開後會揭露周邊精選點的
                        錨點，見 model.Attraction.IsTheme 欄位註解），走
                        PATCH /internal/maintenance/attractions/{id}/theme，
                        需要先登入。-theme 必填，須明確指定 true 或
                        false（不能省略，以免誤觸預設值）。
  attraction-update-photo -id 地標ID [-query 文字] [-source google|pexels]
                        重新查詢一次圖片並回寫到資料庫（走
                        /internal/maintenance/attractions/{id}/update-photo，
                        需要先登入）。-query 未指定時，用該地標既有的城市+名稱
                        當查詢字串。-source 預設 google（真實照片，需要
                        GOOGLE_PLACES_API_KEY）；pexels 是關鍵字比對到的示意圖
                        （非該地點真實照片，需要 PEXELS_API_KEY）。

所有輸出為 JSON。
`)
	os.Exit(0)
}
