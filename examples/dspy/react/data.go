package main

// reactExample 是一筆訓練/評估資料:一句記事,加上 pathID 連結到 flow.mmd
// 裡展開出的某一條行為路徑(見 flow.go 的 flowPath)——「這句話該不該呼叫
// 哪個工具、預期關鍵字是什麼」這個行為規格定義在 flow.mmd,不在這裡。
//
// text 不是手寫的——flow.mmd 只定義行為骨架,不含任何具體中文句子,
// 例句由 "go run . gendata" 呼叫 generate.go 的 generateDataset(...)對
// 每條路徑各自用 LLM 生成、存成 dataset.json(見 generate.go 的完整
// 說明);"go run . train" 再讀回這個檔案訓練——欄位大寫匯出是為了
// 給 dataset.go 的 encoding/json 讀寫用。
type reactExample struct {
	Text   string `json:"text"`
	PathID string `json:"pathID"`
}

// 兩個路徑 ID 常數,對應 flow.mmd 目前僅有的兩條路徑(有地點 vs 無地點)
// ——寫成常數而非每次都重新組節點 ID 字串,可讀性好很多,也讓 flow.mmd
// 若改了節點命名,只需要改這裡兩處。目前只用在 main.go 決定「訓練用幾句、
// 評估用幾句」時,分別呼叫 generateDataset 各生成一批。
const (
	pathHasLocation = "start->hasLocation->callGeocode->replyGeocoded"
	pathNoLocation  = "start->hasLocation->replyNoted"
)
