package main

import (
	"log"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/store"
)

// storeGeoCallLogger 是 apigateway.CallLogger 的實作,把每一次對 Google
// Places/Geocoding API 的呼叫記錄寫進 store 的 geo_api_call_logs 表(見
// store.LogGeoAPICall)。跟 internal/api 套件的 storePhotoCache 是同一種
// 轉接手法(geo/apigateway 套件本身都不依賴 store,由持有 *store.Store 的
// 這一層做轉接),差別是這個實作要注入的對象是 geo.ConfigureDefaultGateway
// (process 啟動時呼叫一次的全域設定),不是個別 request 才建立的
// *api.Server,故放在 cmd/server 而非 internal/api。
//
// 寫入失敗只記 log、不影響任何實際的 API 呼叫結果——記錄本身是可觀測性
// 用途,不該讓資料庫暫時不可用連帶拖垮 Places/Geocoding 查詢功能本身。
type storeGeoCallLogger struct {
	store *store.Store
}

func (l storeGeoCallLogger) LogCall(endpoint, caller, path string, statusCode int, durationMs int64, err error) {
	if logErr := l.store.LogGeoAPICall(endpoint, caller, path, statusCode, durationMs, err != nil); logErr != nil {
		log.Printf("geo api call log 寫入失敗: %v", logErr)
	}
}

var _ apigateway.CallLogger = storeGeoCallLogger{}
