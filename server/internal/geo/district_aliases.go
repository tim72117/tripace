package geo

// Package geo 的分區暱稱資料集(構想 6 延伸,見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)。
//
// SearchDistricts 用 Google Places 的 addressComponents(sublocality/
// locality)分組時,只能拿到官方行政區劃名稱——這對清邁這類城市完全
// 沒用:清邁的官方行政區劃是泰文的 Tambon/Amphoe 層級地名,遊客實際
// 認知、規劃行程時用的是「古城區」「尼曼區」「夜市區」這種民間觀光
// 慣稱,兩者是完全不同的命名體系,Google Places API 沒有任何結構化
// 欄位能提供後者。
//
// 這份資料集手動整理少數熱門旅遊城市的觀光慣稱分區,每區給一個
// Google Places 查得到的地標名稱當定位錨點(而非直接寫死經緯度)——
// 定位錨點透過 Client.Search 即時查詢座標,不寫死座標數字,理由是
// Google 的座標資料庫比手動維護的座標更新、更準確,這裡只需要手動
// 維護「這個區該用哪個地標當代表」這個相對穩定的知識,不需要手動
// 維護會過時的座標數字。
//
// 目前只整理清邁(驗證機制用),之後可依需求逐城市擴充——擴充時只需要
// 新增 knownCityDistricts 的 entry,不需要更動 SearchDistricts 的查詢
// 邏輯(見該函式對 knownCityDistricts 的查表 fallback 判斷)。

// DistrictAlias 是一個手動整理的觀光慣稱分區。
type DistrictAlias struct {
	// Name 是分區的白話觀光慣稱,如「古城區」。
	Name string
	// LandmarkQuery 是這個區具代表性的地標查詢字串,用來定位該區的
	// 概略中心點與取得地標照片——沿用 SearchDistricts 既有的「查詢
	// 地標、取其座標與評分最高照片」邏輯,不另外開一套資料流程。
	LandmarkQuery string
	// RadiusMeters 是這個區大致範圍的半徑(公尺),供前端畫出示意圓圈
	// 用——這類觀光慣稱分區本來就沒有官方明確邊界(不像行政區劃有
	// 正式界線),圓形範圍只是「大概這一帶」的粗略示意,不是精確測繪
	// 結果,數字依人工對該區實際大小的認知手動設定。
	RadiusMeters int
}

// knownCityDistricts 的 key 是城市名稱(比對前會做 normalizeCityName
// 正規化,容忍常見別名/簡繁差異),value 是該城市手動整理的觀光慣稱
// 分區清單。
//
// 清邁原本在這裡的資料已於 2026-08 搬進正式的資料庫模型(見
// model.Landmark、cmd/cli 的 landmark-add 等指令),不再需要這條
// 過渡路徑——handleGeoDistricts 的查詢優先序是「資料庫→這裡→即時查
// Google Places」,資料庫有資料時這裡的 entry 根本不會被用到。搬遷
// 原因之一:這裡原本「河濱區」用 LandmarkQuery(文字搜尋)定位,實際
// 查詢結果曾經誤配到曼谷的湄南河區域而非清邁的賓河——資料庫模型直接
// 存精確座標,不會有這類文字搜尋誤判的風險,這正是這個資料集本身
// 「用查詢字串而非寫死座標」設計的已知代價。
var knownCityDistricts = map[string][]DistrictAlias{}

// normalizeCityName 把使用者輸入的城市名稱正規化,容忍常見的輸入差異
// (前後空白、全形/半形空白)——不做簡繁轉換或翻譯,knownCityDistricts
// 的 key 需要用與此正規化結果一致的寫法登錄。
func normalizeCityName(city string) string {
	runes := []rune(city)
	start, end := 0, len(runes)
	for start < end && (runes[start] == ' ' || runes[start] == '　') {
		start++
	}
	for end > start && (runes[end-1] == ' ' || runes[end-1] == '　') {
		end--
	}
	return string(runes[start:end])
}

// lookupKnownDistricts 查詢一個城市是否有手動整理的觀光慣稱分區資料。
// 回傳 (nil, false) 代表沒有,呼叫端應 fallback 回泛用的
// addressComponents 分組邏輯。
func lookupKnownDistricts(city string) ([]DistrictAlias, bool) {
	aliases, ok := knownCityDistricts[normalizeCityName(city)]
	return aliases, ok
}
