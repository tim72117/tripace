// Package api 提供對齊 docs/API.md 的 HTTP handlers。
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/onagenttools"
	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/store"
	"github.com/tim72117/tripace/internal/tripsvc"
)

type Server struct {
	store  *store.Store
	signer *auth.Signer
	hub    *Hub
	// devMode:Apple token 不驗簽章(原型用)。
	devMode bool
	// googleClientID:Google OAuth Client ID,GET /v1/auth/google 驗證
	// ID Token 的 audience 用(見 auth.VerifyGoogleToken)。空字串代表
	// Google 登入功能未設定,handleGoogleAuth 一律回錯誤(見該 handler)。
	googleClientID string
	// 未登入時的預設使用者(維持可跳過登入的體驗)。
	guestUser model.User

	// photoCache 實作 geo.PhotoCache,由 s.store 提供的圖片快取表(見
	// store.GetCachedPhoto/SetCachedPhoto)支撐——geo_outline.go 裡建立
	// geo.Client 的地方會呼叫 client.SetCache(s.photoCache) 接上這層快取,
	// 避免同一批飯店/地點照片隨地圖移動被重複下載(見該檔案的說明)。
	photoCache geo.PhotoCache

	// photoUploader 把景點區域的照片來源網址(使用者指定或 Pexels 查詢
	// 結果)下載後上傳到 GCS,見 internal/photostorage 的完整說明與
	// handleMaintenanceAttractionAdd/handleMaintenanceAttractionUpdatePhoto
	// 的呼叫端。GCS_PHOTO_BUCKET 未設定時 photostorage.New 回傳一個
	// bucket 為空字串的 Uploader,Upload 呼叫會直接回傳 ErrNoBucket,
	// 呼叫端據此降級(維持原始外部連結,不阻擋建檔/更新操作)。
	photoUploader *photostorage.Uploader

	// newGeoGeocodeClient 建立 handleGeoGeocode 專用的 geo.Client——預設
	// geo.New(真的打 Google Places API,見該函式)。只有這支 handler 透過
	// 這個可覆寫欄位取得 client(其餘 8 處呼叫端仍直接寫死 geo.New,見
	// geo_outline.go/maintenance.go/entry_geocode.go 各自的呼叫點,這次
	// 沒有一併重構——只有 handleGeoGeocode 的兩階段 bias/restrict 判斷
	// 邏輯需要測試守住,不是每支 handler 都需要這個可測試性投資)。測試
	// 用 newTestServerWithGeoClient(見 geo_outline_test.go)把這個欄位換成
	// 回傳「內部 gateway 是假實作」的 client,讓 handleGeoGeocode 整支
	// (含兩階段串接判斷)可以在不打真實 Google API 的情況下被驗證。
	newGeoGeocodeClient func(apiKey string) *geo.Client

	// newPlaceDetailsClient 建立 handleGeoPlaceDetails 一般模式(fetchAndCachePlaceDetails)
	// 專用的 geo.Client——預設 geo.New(真的打 Google Places API)。理由與
	// newGeoGeocodeClient 相同:這支 handler 內部串接了補圖節奏決策
	// (decidePlacePhotoRefreshIndex)、IncrementPlaceClickCount 等多個
	// 步驟,需要能在測試裡完整驗證整條鏈路(而不只是各自獨立的純函式/
	// store 方法),同時不能真的打 Google API。測試用
	// newTestServerWithFakePlaceDetailsGateway 把這個欄位換成回傳
	// 「內部 gateway 是假實作」的 client。
	newPlaceDetailsClient func(apiKey string) *geo.Client

	// newMaintenancePhotoClient 建立 handleMaintenanceAttractionUpdatePhoto
	// (tripace-cli attraction photo-update 對應的後端 endpoint)專用的
	// geo.Client——預設 geo.New(真的打 Google Places API)。理由與
	// newPlaceDetailsClient 相同:2026-10 這支 handler 新增「place_id
	// 優先序」邏輯(body.PlaceID > 地標既有登記的 place_id > 查詢命中的
	// place.PlaceID,見該 handler 的完整說明),需要能在測試裡驗證整條
	// 查詢+寫入鏈路,不能真的打 Google API。測試用
	// newTestServerWithFakeMaintenancePhotoGateway 把這個欄位換成回傳
	// 「內部 gateway 是假實作」的 client。
	newMaintenancePhotoClient func(apiKey string) *geo.Client

	// placeDetailsInFlight 標記目前哪些 placeID 正在執行
	// fetchAndCachePlaceDetails(handleGeoPlaceDetails 一般模式的實際查詢
	// 邏輯)——兩個使用者幾乎同時點擊地圖上同一個 Google 原生 POI 圖標、
	// 且快取都未命中時,若不做任何處理,兩個請求會各自重複打
	// GetPlaceDetails/PhotoDataURI/Pexels Search 這些依用量計費的外部
	// API,且各自呼叫 SetGooglePlacePhotos/SetPlacePexelsPhotos(整批
	// 覆寫寫入,見兩者的完整說明)可能互相覆蓋、造成其中一個請求查到的
	// 結果被另一個請求的結果蓋掉。
	//
	// 這裡刻意不用 golang.org/x/sync/singleflight——singleflight.Group.Do
	// 的語意是「合併」:只有第一個呼叫真正執行,後續同 key 的呼叫阻塞
	// 等待、共享第一個呼叫的結果,是「等待」不是「丟棄」。這次的成本
	// 控制設計要求的是真正的丟棄語意:同一 placeID 若已經有請求在
	// in-flight,後續並發請求必須不等待、立即得知「這次被丟棄」,交由
	// 呼叫端(handleGeoPlaceDetails)決定接下來的降級行為(例如改讀現有
	// 快取),而不是讓它們排隊等第一個請求做完——singleflight 沒有提供
	// 這種「不等待、直接告知被丟棄」的 API(DoChan 讓呼叫端可以不等待
	// channel,但底層邏輯仍是排隊執行,只是呼叫端選擇不等而已,不是
	// 「這次直接不執行」的語意),故改用最簡單的 sync.Map 自行實作。
	//
	// key 是 placeID,value 恆為 struct{}{}(只用來當 set 使用,不需要
	// 儲存任何實際內容)——用 LoadOrStore 確保「檢查是否已存在」與「標記
	// 為存在」是單一原子操作,避免兩個 goroutine 同時通過檢查、都以為
	// 自己是第一個。搶到的呼叫端(LoadOrStore 回傳 loaded=false)負責在
	// 查詢完成後(不論成功失敗)呼叫 Delete 移除標記,讓這個 placeID
	// 之後的請求能重新觸發查詢——這個「搶到/移除」的配對邏輯收在
	// tryClaimPlaceDetailsInFlight/releasePlaceDetailsInFlight 這兩個
	// 方法裡(見 geo_outline.go),不直接在 handler 裡操作這個欄位,
	// 方便測試單獨驗證「兩個並發請求,第一個進去、第二個被丟棄」這種
	// 情境,不需要真的發兩個並發 HTTP 請求才能測試搶佔邏輯本身。
	//
	// 這只在單一 process 內生效——多個 Cloud Run instance 之間不會互相
	// 合併,但目前規模下這已經足夠攔下同一台伺服器內的重複查詢,跟原本
	// singleflight 的既有侷限一致。
	placeDetailsInFlight sync.Map

	// planAiRateLimiter 保護 GET /internal/geo/plan-ai/place-search 與
	// GET /internal/geo/plan-ai/attraction-search(見
	// handlePublicGeoPlaceSearch/handlePublicGeoAttractionSearch 的完整
	// 說明)這兩支端點,各自用獨立的 key(publicPlaceSearchEndpoint/
	// nearbyAttractionSearchEndpoint,見 geo_plan_ai.go)在同一個
	// *apigateway.RateLimiter 實例上各開一組視窗(SetLimitForKey 本來就是
	// 設計成單一實例管理多組彼此獨立的 key/視窗——見 apigateway 自己的
	// 測試對 "places.get"/"places.photoMedia" 的既有用法),不需要為每支
	// 端點各自建立一個 Server 欄位/RateLimiter 實例(2026-09 code review
	// 發現:原本這裡是兩個獨立欄位/兩次 NewRateLimiter(),純粹是同一件
	// 事重複刻了兩次樣板程式碼——兩支端點各自視窗長度/次數不同這件事,
	// SetLimitForKey 的 per-key 設計本來就完全支援,不需要靠獨立實例才能
	// 做到)。
	//
	// 2026-09:這兩支端點已搬到 internalAuth 底下(原本掛在 /public/geo/*
	// 免登入),但限流**刻意保留**——現在的理由不是「防匿名訪客濫用」,而是
	// **防 LLM 工具呼叫迴圈**:唯一呼叫端是 plan-core/attractionTools.ts
	// 的 search_attraction 工具,由 LLM 自主決定何時呼叫、呼叫幾次。稽核
	// 記錄過真實 log:LLM 撞到同一個錯誤後會反覆重試同一次查詢,沒有任何
	// 前端節流能擋(重試決策發生在 LLM 端,不在前端)。少了這層拒絕型
	// 限流,一次失控的重試迴圈就能在幾秒內打出數十次計費的 Google API
	// 呼叫。**已登入不等於成本可控——額度是專案共用的,不是 per-user 的。**
	//
	// 跟 geo 套件的 defaultRateLimiter(依 "places.get"/"places.photoMedia"
	// 這類 Google API endpoint 分類,只在真正打 Google API 時透過
	// Gateway.Do 生效)是刻意獨立的機制——那組限流保護的是「不同呼叫來源
	// 共用同一個 Google API 額度」,這裡要保護的是「這兩支特定端點不被
	// 失控的呼叫節奏觸發大量計費」,語意不同;且這兩支端點呼叫的
	// "places.searchText"/"places.searchNearby" endpoint 並未被
	// defaultRateLimiter 設定拒絕型限流(見 geo.RateLimitConfig 的完整
	// 說明,那裡刻意只涵蓋 places.get/photoMedia 兩者),不能依賴那組機制
	// 間接擋下這裡的濫用。
	//
	// 全域共用同一個視窗、不分呼叫者——即使現在有身份可用,防的是單一
	// 使用者自己的 LLM 迴圈,per-user 細分反而讓每個使用者各自擁有一整份
	// 配額,與保護總額度的目的相反。兩個 key 各自的視窗長度/次數在 New()
	// 裡設定(見該處說明)。
	planAiRateLimiter *apigateway.RateLimiter

	// geoQueryUserRateLimiter 保護一批會觸發 Google API 呼叫的查詢端點
	// (見 geoQueryEndpointsWithUserThrottle 的完整說明),用 key =
	// userID(s.userFor(r).ID)做「每個使用者」的節流——跟上面的
	// planAiRateLimiter 刻意相反:那裡的全域共用是為了防「單一使用者的
	// LLM 迴圈耗盡專案共用總額度」,這裡要防的是「單一使用者自己連點/
	// 連續操作太快」,語意上本來就該各自獨立計算,不該讓使用者 A 的
	// 操作頻率影響到使用者 B 還剩多少配額可用——per-user 在這裡才是
	// 正確的粒度,不是重複發明同一件事。
	//
	// 2026-10 使用者明確要求「後端自己的端點,加上每秒的請求節流限制,
	// 但是以個人為單位,預設 200 毫秒一次」——跟 planAiRateLimiter 共用
	// apigateway.RateLimiter 這個元件,但刻意用獨立實例(不是同一個
	// RateLimiter 開兩種 key 前綴混用),理由是兩者的 key 空間本質不同:
	// planAiRateLimiter 的 key 是固定的少數幾個 endpoint 字串,這裡的
	// key 是使用者 ID、數量隨使用者成長——混在同一個實例裡容易在未來
	// 調整 planAiRateLimiter 邏輯時不小心牽動到這裡,分開更清楚。
	//
	// 已知限制:apigateway.RateLimiter 的 windows map 沒有過期清除機制
	// (見該型別的完整說明,原本設計假設 key 數量少且固定)——key 改成
	// per-user 後,使用者數量成長會讓這個 map 緩慢增長,目前規模下可
	// 接受,日後若使用者數明顯增加需要重新評估是否要加上清掃機制。
	geoQueryUserRateLimiter *apigateway.RateLimiter
}

// geoQueryUserThrottleWindow/geoQueryUserThrottleMaxCalls 是
// geoQueryUserRateLimiter 預設的節流規則——2026-10 使用者明確要求「預設
// 200 毫秒一次」,對應「每秒最多 5 次」的呼叫頻率上限,套用在同一個
// 使用者身上。2026-10 再次要求統一改用「每分鐘」表示(對齊
// geo.RateLimitConfig 的 places.get/photoMedia 兩個 endpoint 同一輪
// 改動,見 cmd/server/main.go 的完整說明)——只是換算單位,實際速率不變:
// 200ms 一次等效於 60 秒視窗內最多 300 次(60s / 0.2s = 300)。
const geoQueryUserThrottleWindow = 60 * time.Second
const geoQueryUserThrottleMaxCalls = 300

func New(st *store.Store, signer *auth.Signer, devMode bool, googleClientID string) *Server {
	uploader, err := photostorage.New(context.Background(), os.Getenv("GCS_PHOTO_BUCKET"))
	if err != nil {
		// 建立 GCS client 失敗(通常是本機沒有可用的 Application Default
		// Credentials)不該讓整個 server 起不來——景點照片落地是輔助功能,
		// 降級成「這次啟動沒有這個功能」,記一則警示 log,理由同下方
		// AutoMigrate 失敗時的既有降級慣例。
		log.Printf("!!! 建立 GCS photo uploader 失敗,景點照片將不會落地到 GCS,僅使用原始來源網址: %v", err)
		uploader = &photostorage.Uploader{}
	}
	// planAiRateLimiter:兩支 plan-ai 查詢端點各自的視窗長度/次數,見這個
	// 欄位在 Server struct 上的完整說明(單一 RateLimiter 實例、各自
	// 獨立的 key)。
	//
	// publicPlaceSearchEndpoint:固定 10 秒視窗內最多 1 次(比照
	// geo.RateLimitConfig 給 "places.get" 的預設喳度,見
	// cmd/server/main.go)——全域共用同一個 key,不分呼叫者。
	//
	// nearbyAttractionSearchEndpoint:0.5 秒視窗內最多 1 次——使用者明確
	// 要求把視窗從原本沿用 publicPlaceSearchEndpoint 的 10 秒縮短成 0.5
	// 秒(真實踩坑記錄:10 秒視窗下,/plan-ai 對話中連續幾次查詢很容易
	// 撞上同一個視窗,導致後面的呼叫直接降級成只回傳資料庫候選、完全沒
	// 機會觸發 Google Nearby Search 補點,見這支端點的完整說明——查
	// 候選數量從預期的 10 筆掉到只剩資料庫本身查到的幾筆)。這代表這層
	// 保護幾乎不再能防住短時間內重複觸發計費 API 的情況,是使用者評估
	// 過後接受的取捨,不是這裡自行放寬的判斷——沿用「視窗內最多 1 次」
	// 的既有限制邏輯本身不變,只是視窗長度縮短。
	planAiRateLimiter := apigateway.NewRateLimiter()
	planAiRateLimiter.SetLimitForKey(publicPlaceSearchEndpoint, 10*time.Second, 1)
	planAiRateLimiter.SetLimitForKey(nearbyAttractionSearchEndpoint, 500*time.Millisecond, 1)

	// geoQueryUserRateLimiter:不在這裡預先呼叫 SetLimitForKey——key 是
	// 使用者 ID,數量隨使用者登入而動態出現,不像 planAiRateLimiter 只有
	// 兩個固定的 endpoint 字串可以在啟動時就設定好。改成每次請求時由
	// throttleGeoQueryByUser(見該函式的完整說明)對當下的 userID 懶惰呼叫
	// SetLimitForKey——RateLimiter.SetLimitForKey 用同一個 key 重複呼叫
	// 只是覆寫成同一組規則,不會重置該 key 已經累積的視窗計數(見該方法
	// 實作:只動 limits 表,不動 windows 表),所以每次請求都呼叫一次
	// 不會錯誤地讓使用者每次都拿到全新配額。
	geoQueryUserRateLimiter := apigateway.NewRateLimiter()

	return &Server{
		store:                     st,
		signer:                    signer,
		hub:                       newHub(),
		devMode:                   devMode,
		googleClientID:            googleClientID,
		guestUser:                 model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"},
		photoCache:                storePhotoCache{store: st},
		photoUploader:             uploader,
		newGeoGeocodeClient:       geo.New,
		newPlaceDetailsClient:     geo.New,
		newMaintenancePhotoClient: geo.New,
		planAiRateLimiter:         planAiRateLimiter,
		geoQueryUserRateLimiter:   geoQueryUserRateLimiter,
	}
}

// throttleGeoQueryByUser 是一批會觸發 Google API 呼叫的查詢端點
// (handleGeocodeEntry/handleGeoGeocode/handleGeoPlaceDetails/
// handlePublicGeoPlaceSearch/handlePublicGeoAttractionSearch/
// handlePublicGeoPlaceDetailsAny/handleMaintenanceGeocode)共用的
// per-user 節流檢查——2026-10 使用者明確要求「後端自己的端點,加上每秒
// 的請求節流限制,但是以個人為單位,預設 200 毫秒一次」。
//
// 不包含 handlePublicGeoTransitEstimate:這支端點目前是純本地計算
// (haversine 直線距離+固定速度換算表,見該 handler 的完整說明),完全
// 不含任何外部 API 呼叫,不屬於「會觸發 Google API 呼叫」這個套用範圍。
//
// handlePublicGeoAttractionSearch 疊加兩層彼此獨立的節流,刻意不是只有
// 一層:這支端點原本就有自己的 nearbyAttractionSearchEndpoint 限流
// (見該 handler 的完整說明),被擋下時走「降級」路徑——跳過打 Google
// Nearby Search 補點,但仍正常回傳資料庫已查到的候選、回 200,不讓
// 整個請求失敗(這層的設計目的是「這支端點內部,保護打 Google API
// 那一小段邏輯」)。這裡新增的 per-user 節流則是完全獨立的另一層,
// 擋下時直接回 429、不做任何降級(2026-10 使用者明確要求「per-user
// 的限流還是要有,只是沒有回退」)——兩層節流的語意不同,不能互相取代:
// 前者只決定「這次要不要打 Google API」,後者決定「這個使用者這次
// 請求能不能被處理」,被 per-user 節流擋下的請求連資料庫查詢都不會
// 執行,跟被 nearbyAttractionSearchEndpoint 擋下只省略 Google 呼叫是
// 兩種不同範圍的拒絕。
//
// 回傳 true 代表這次請求可以繼續處理;回傳 false 代表已經寫好 429
// 回應,呼叫端應該立刻 return,不再執行任何後續邏輯——用法比照既有的
// planAiRateLimiter.Allow 呼叫慣例(見 geo_plan_ai.go 對該欄位的用法),
// 每個 handler 開頭呼叫一行完成節流檢查,不做成 middleware:這批端點
// 分散定義在 geo_outline.go/geo_plan_ai.go/maintenance.go 幾個檔案裡,
// 在 handler 內顯式呼叫比在 middleware 層用路徑字串比對白名單更不容易
// 因為拼字誤差漏保護或誤傷其他端點。
//
// key 用 s.userFor(r).ID(真實使用者的資料庫 ID,或訪客固定 ID
// usr_me)——這批端點都掛在 internalAuth 底下,必須先帶合法簽章的 JWT
// 才能走到 handler,userFor 退回訪客 usr_me 只會發生在「簽章有效但
// 對應使用者已被資料庫刪除」這種極端邊界情況(見 userFromToken 的完整
// 說明),多個這種異常請求共用同一份 200ms 配額是可接受的降級行為,
// 不影響一般登入使用者——不需要為了這個邊緣情況額外用 token 字串本身
// 當 key。
//
// 用 Allow 前才呼叫 SetLimitForKey(懶惰設定,每次請求都呼叫一次)而非
// 在 New() 預先設定好——這個 limiter 的 key 空間是動態的使用者 ID 集合,
// 不像 planAiRateLimiter 只有兩個固定的 endpoint 字串可以在啟動時一次
// 設定好。SetLimitForKey 用同一個 key 重複呼叫只會覆寫規則本身(視窗
// 長度、上限次數),不會重置該 key 已經累積的視窗計數(見該方法實作:
// 只動 limits 表、不動 windows 表),所以這裡每次請求呼叫一次不會錯誤
// 地讓使用者每次都拿到全新配額,是安全的用法。
func (s *Server) throttleGeoQueryByUser(w http.ResponseWriter, r *http.Request) bool {
	userID := s.userFor(r).ID
	s.geoQueryUserRateLimiter.SetLimitForKey(userID, geoQueryUserThrottleWindow, geoQueryUserThrottleMaxCalls)
	if s.geoQueryUserRateLimiter.Allow(userID) {
		return true
	}
	writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
	return false
}

// photoCacheMaxAge 是圖片快取視為新鮮的上限——超過這個天數,即使資料庫
// 裡有值也視為未命中,強制重新向 Google 查詢。使用者確認過的預設值:7 天。
const photoCacheMaxAge = 7 * 24 * time.Hour

// storePhotoCache 是 geo.PhotoCache 的實作,把讀寫轉發給 *store.Store 的
// photo_cache 資料表——geo 套件本身不依賴 store(見 geo.PhotoCache 的
// 說明),這層轉接留在 api 套件,是唯一同時持有 geo.Client 與 *store.Store
// 的地方。Get/Set 內部的 store 呼叫失敗(如底層資料庫暫時不可用)不視為
// 致命錯誤,直接視為快取未命中/寫入失敗即可——快取只是效能優化,不該讓
// 圖片查詢因為快取層本身的問題而整體失敗。
type storePhotoCache struct {
	store *store.Store
}

func (c storePhotoCache) Get(placeID string, photoIndex, maxWidthPx int) (string, bool) {
	dataURI, ok, err := c.store.GetCachedPhoto(placeID, photoIndex, maxWidthPx, photoCacheMaxAge)
	if err != nil {
		return "", false
	}
	return dataURI, ok
}

func (c storePhotoCache) Set(placeID string, photoIndex, maxWidthPx int, dataURI string) {
	_ = c.store.SetCachedPhoto(placeID, photoIndex, maxWidthPx, dataURI)
}

func (c storePhotoCache) List(placeID string, maxWidthPx int) (map[int]time.Time, error) {
	rows, err := c.store.ListCachedPhotos(placeID, maxWidthPx)
	if err != nil {
		return nil, err
	}
	out := make(map[int]time.Time, len(rows))
	for _, r := range rows {
		out[r.PhotoIndex] = r.FetchedAt
	}
	return out, nil
}

func (c storePhotoCache) Trim(placeID string, maxWidthPx, fromIndex int) error {
	return c.store.TrimCachedPhotos(placeID, maxWidthPx, fromIndex)
}

// NotifyEntriesUpdated 廣播 entries_updated 給指定行程的訂閱者(供 wanttools 呼叫)。
func (s *Server) NotifyEntriesUpdated(tripID string) {
	s.hub.Broadcast(tripID, map[string]any{"event": "entries_updated", "tripID": tripID})
}

// NotifyEntryUpdating 廣播 entry_updating(帶 entryID)給指定行程的訂閱者(供 wanttools 呼叫),
// 讓前端在工具更新該條目期間顯示「更新中」動畫。
func (s *Server) NotifyEntryUpdating(tripID, entryID string) {
	s.hub.Broadcast(tripID, map[string]any{"event": "entry_updating", "tripID": tripID, "entryID": entryID})
}

// NotifyAskUser 廣播 ask_user(帶 askType/prompt)給指定行程的訂閱者(供 wanttools 呼叫),
// 讓前端開啟對應 UI(如日期選擇器)請使用者補上缺失資訊。
func (s *Server) NotifyAskUser(tripID, askType, prompt string) {
	s.hub.Broadcast(tripID, map[string]any{"event": "ask_user", "tripID": tripID, "askType": askType, "prompt": prompt})
}

// NotifyAskChoice 廣播 ask_choice(帶 prompt/options)給指定行程的訂閱者(供 wanttools 呼叫),
// 讓前端開啟選單 UI 請使用者從 options 中選一個。
func (s *Server) NotifyAskChoice(tripID, prompt string, options []map[string]any) {
	s.hub.Broadcast(tripID, map[string]any{"event": "ask_choice", "tripID": tripID, "prompt": prompt, "options": options})
}

// NotifyTaskCreated 廣播 task_created(帶 taskID/date/text/kind)給指定行程的訂閱者(供 wanttools 呼叫),
// 讓前端在該日期下插入一張標示動作(新增/更新)的佔位卡。
func (s *Server) NotifyTaskCreated(tripID string, taskID int, date, text, kind string) {
	s.hub.Broadcast(tripID, map[string]any{
		"event": "task_created", "tripID": tripID, "taskID": taskID, "date": date, "text": text, "kind": kind,
	})
}

// NotifyTaskEntryReady 廣播 task_entry_ready(帶 taskID/entryID)給指定行程的訂閱者(供 wanttools 呼叫),
// 讓前端把對應的佔位卡直接替換成正式條目卡。
func (s *Server) NotifyTaskEntryReady(tripID string, taskID int, entryID string) {
	s.hub.Broadcast(tripID, map[string]any{
		"event": "task_entry_ready", "tripID": tripID, "taskID": taskID, "entryID": entryID,
	})
}

// NotifyEntriesLoaded 廣播 entries_loaded(帶 entry_query 查到、轉換成前端
// TripEntry 格式的條目清單)給指定行程的訂閱者(供 wanttools 的 entry_query
// 工具呼叫),讓前端合併進旅程清單表格供使用者查看/編輯。entries 用
// []map[string]any 而非具名型別,避免 api 套件為了此簽章反向依賴 wanttools
// (見 wanttools.TripEntryPayload 的定義處)。
func (s *Server) NotifyEntriesLoaded(tripID string, entries []map[string]any) {
	s.hub.Broadcast(tripID, map[string]any{
		"event": "entries_loaded", "tripID": tripID, "entries": entries,
	})
}

// Routes 註冊路由(Go 1.22+ 的方法+路徑樣式)。
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)

	// onagent/* — onagent 平台 BackendDispatch 主動打過來的端點(server 端,
	// 非前端 clienttools),見 onagent_dispatch.go 開頭的完整說明。刻意不掛在
	// /internal/*(internalAuth 要求的 JWT 是 tripace 使用者登入憑證,onagent
	// 伺服器對伺服器呼叫沒有這種憑證可帶),獨立命名空間 /onagent/* 只是路徑
	// 慣例上跟其餘端點分開,不構成安全邊界(PoC 階段刻意先不驗證,見該檔案
	// 開頭說明的已知範圍)。
	mux.HandleFunc("POST /onagent/recommend_nearby", onagenttools.HandleRecommendNearby)
	mux.HandleFunc("POST /onagent/geocode", onagenttools.HandleGeocode)

	mux.HandleFunc("POST /v1/auth/apple", s.handleAppleAuth)
	mux.HandleFunc("POST /v1/auth/google", s.handleGoogleAuth)
	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("GET /v1/me", s.handleMe)
	mux.HandleFunc("GET /v1/trips", s.handleListTrips)
	mux.HandleFunc("POST /v1/trips", s.handleCreateTrip)
	mux.HandleFunc("GET /v1/trips/{id}/members", s.handleListMembers)
	mux.HandleFunc("POST /v1/trips/{id}/members", s.handleAddMember)
	mux.HandleFunc("PATCH /v1/trips/{id}/members/{userID}", s.handleSetMemberRole)
	mux.HandleFunc("GET /v1/trips/{id}/entries", s.handleListEntries)
	mux.HandleFunc("POST /v1/trips/{id}/entries", s.handleCreateTripEntry)
	mux.HandleFunc("DELETE /v1/trips/{id}/entries", s.handleResetTripData)
	mux.HandleFunc("PUT /v1/trips/{id}/entries/{entryID}", s.handleUpdateTripEntry)
	mux.HandleFunc("DELETE /v1/trips/{id}/entries/{entryID}", s.handleDeleteTripEntry)
	mux.HandleFunc("PATCH /v1/entries/{id}", s.handleUpdateEntry)
	mux.HandleFunc("GET /v1/trips/{id}/ws", s.handleWS)
	mux.HandleFunc("POST /v1/trips/{id}/public-link", s.handleCreatePublicLink)
	mux.HandleFunc("GET /v1/trips/{id}/public-link", s.handleGetPublicLink)
	mux.HandleFunc("DELETE /v1/trips/{id}/public-link", s.handleDeletePublicLink)
	mux.HandleFunc("GET /v1/public/{token}", s.handlePublicView)
	mux.HandleFunc("POST /v1/public/{token}/compute-route", s.handlePublicComputeRoute)

	// PaceRouteMap(web/src/PaceRouteMap.tsx,UI 試做用)展示頁的固定路線資料,
	// 不需要登入(展示頁本身不需要身分),見 pace_route.go 的說明。
	mux.HandleFunc("GET /v1/demo/pace-route", s.handlePaceRoute)

	// cli-auth — CLI(cmd/cli)瀏覽器登入流程(`tripace-cli login --web`),
	// 換回一個能通過下面 internalAuth 的 JWT。start/exchange 不需登入:
	// start 是整個流程最一開始的呼叫,此時 CLI 還沒有任何憑證;exchange 靠的
	// 是 id 本身(32 bytes 隨機、單次使用)當憑證,而不是使用者身分。
	// approve 則相反,必須是真正登入的使用者(見 handleApproveCliAuth 內部
	// 明確拒絕訪客身分的檢查),核准的當下才簽出要交給 CLI 的 JWT。
	// 詳細安全性設計見 internal/store/cliauth.go 的說明。
	mux.HandleFunc("POST /v1/cli-auth/start", s.handleStartCliAuth)
	mux.HandleFunc("GET /v1/cli-auth/{id}", s.handleGetCliAuth)
	mux.HandleFunc("POST /v1/cli-auth/{id}/approve", s.handleApproveCliAuth)
	mux.HandleFunc("POST /v1/cli-auth/{id}/exchange", s.handleExchangeCliAuth)

	// cli-auth/device — `tripace-cli login --device` 的 device code 流程
	// (RFC 8628),給真正無頭、CLI 本機沒有可達網路位址的環境用(見
	// internal/store/cliauth.go 開頭的說明,對照上面 loopback 回呼流程的
	// 差異)。exchange 沿用上面同一支 /v1/cli-auth/{id}/exchange,CLI 輪詢
	// 用的就是這支——device/start 回傳的 deviceCode 直接對應這裡的 {id}。
	// "device" 是這幾條路由第一段的固定字串、"{id}"/"{userCode}" 都是各自
	// pattern 唯一的變動段,Go 1.22+ ServeMux 對字面字串段的比對優先於萬用
	// 字元段,不會跟上面 {id} 系列的路由互相蓋掉。
	mux.HandleFunc("POST /v1/cli-auth/device/start", s.handleStartDeviceAuth)
	mux.HandleFunc("GET /v1/cli-auth/device/{userCode}", s.handleGetDeviceAuth)
	mux.HandleFunc("POST /v1/cli-auth/device/{userCode}/approve", s.handleApproveDeviceAuth)

	// public — 登入前的公開展示頁(主題介紹頁,見
	// web/src/home/InteractiveExploreMap.tsx)專用,刻意不掛 internalAuth
	// (訪客沒有 JWT,見該元件 GUEST_CFG 的完整說明)。
	//
	// 目前是這三支(place-details/place-photo-assets/attractions),每一支
	// 都有授權限制查詢範圍——前兩支要求 placeID 必須是已建檔的 attraction
	// 才放行,attractions 則限制在城市白名單內(見
	// publicAttractionsCityAllowlist 的完整說明)。這不是一般性「免認證」
	// 的路由群組,新增其他公開端點時應各自評估是否也需要類似的範圍限制,
	// 不能直接比照這裡的寫法就假設安全。
	//
	// 2026-09:原本這個群組還有 plan-ai 用的五支查詢端點(place-search/
	// attraction-search/place-details-any/attraction/{id}/transit-estimate)
	// ——那批沒有白名單可限制範圍(可以查任意地名/placeID),只靠拒絕型
	// 限流把關,等於讓任何訪客都能消耗 Google Places 計費配額。已全部搬到
	// 需登入的 /internal/geo/plan-ai/*(見下方 internalMux 的該區塊)。
	mux.HandleFunc("GET /public/geo/place-details", s.handlePublicGeoPlaceDetails)
	// GET /public/geo/place-photo-assets:handlePublicGeoPlacePhotoAssets
	// 的免登入版(見該函式的完整說明)——純讀 photo_assets,不觸發點擊
	// 計數/漸進補圖決策,供前端「查完沒圖,原地重試幾次」的情境使用
	// (fetchPublicGeoPlacePhotoAssets),授權機制對齊上一行的
	// place-details。2026-09:這支路由先前漏掛,導致該重試功能在正式
	// 環境一律 404(handler 本身已實作/測試完成,只是沒有接上 mux)。
	mux.HandleFunc("GET /public/geo/place-photo-assets", s.handlePublicGeoPlacePhotoAssets)
	mux.HandleFunc("GET /public/geo/attractions", s.handlePublicGeoAttractions)

	// 註:AI 規劃時間軸的「模擬推論 WebSocket」(handlePlanSimWS)不在這個
	// 分支上——它只服務試作原型(web/src/plan-ai/AIPlanTimelinePage.tsx),
	// 不是正式功能(web/src/trip-plan/TripPlanPage.tsx)的一部分,正式功能
	// 走真實 onagent 對話。那支端點與整個試作原型保存在 plan-ai-sim 分支,
	// 之後若要一併上線,需要連同 plan_sim_demo.go 與 plan-ai/ 目錄一起接
	// 回來,並在這裡補上路由註冊(它必須註冊在這個 mux 而非下方的
	// internalMux——WebSocket 的 token 只能從 query string 帶,掛在
	// internalAuth 底下會因為沒有 Authorization header 一律被打回 401)。

	// internal — 供 CLI(cmd/cli)/自動化腳本操作資料,不走 /v1/* 那套
	// requireOwner/requireEditor 行程層級的權限檢查,改由 internalAuth 要求
	// 呼叫端帶有效的自家 JWT(與 /v1/* 一般使用者同一套 auth.Signer),避免任何
	// 知道 entryID/tripID 的外部呼叫者繞過上面 /v1/* 的權限檢查(這兩組路由
	// 掛在同一個對外 port,路徑命名本身不構成安全邊界,見 middleware.go
	// internalAuth 的說明)。CLI 端透過 `tripace-cli login --web` 取得這把 JWT
	// (見 /v1/cli-auth/* 路由與 cmd/cli/login.go)。
	internalMux := http.NewServeMux()
	internalMux.HandleFunc("GET /internal/trips", s.handleInternalListTrips)
	internalMux.HandleFunc("POST /internal/trips/{id}/notify", s.handleNotify)
	internalMux.HandleFunc("GET /internal/trips/{id}/entries", s.handleInternalListEntries)
	internalMux.HandleFunc("POST /internal/trips/{id}/entries", s.handleInternalRecord)
	internalMux.HandleFunc("PATCH /internal/entries/{id}", s.handleInternalUpdateEntry)
	internalMux.HandleFunc("DELETE /internal/entries/{id}", s.handleInternalDeleteEntry)
	internalMux.HandleFunc("PATCH /internal/entries/{id}/latlng", s.handleInternalSetLatLng)
	internalMux.HandleFunc("POST /internal/entries/{id}/geocode", s.handleGeocodeEntry)
	internalMux.HandleFunc("POST /internal/entries/compute-route", s.handleComputeRouteFromEntries)
	internalMux.HandleFunc("DELETE /internal/trips/{id}/entries", s.handleInternalReset)
	internalMux.HandleFunc("GET /internal/geo/attractions", s.handleGeoAttractions)
	internalMux.HandleFunc("GET /internal/geo/attractions/nearby", s.handleGeoAttractionsNearby)
	internalMux.HandleFunc("GET /internal/geo/attractions/nearby-only", s.handleGeoAttractionsOnlyNearby)
	internalMux.HandleFunc("GET /internal/geo/geocode", s.handleGeoGeocode)
	internalMux.HandleFunc("GET /internal/geo/place-details", s.handleGeoPlaceDetails)
	// GET /internal/geo/place-photo-assets:純讀 photo_assets,不觸發點擊
	// 計數/漸進補圖決策(見 handleGeoPlacePhotoAssets 的完整說明)。
	// 2026-09:同上一支公開版,先前漏掛路由,導致重試功能一律 404。
	internalMux.HandleFunc("GET /internal/geo/place-photo-assets", s.handleGeoPlacePhotoAssets)

	// plan-ai — AI 規劃行程功能專用的查詢端點(見 geo_plan_ai.go 開頭的
	// 完整說明),同時服務正式功能(web/src/trip-plan/TripPlanPage.tsx)與
	// 試作原型(web/src/plan-ai/AIPlanTimelinePage.tsx)——兩者共用
	// web/src/plan-core/attractionTools.ts 這層 onagent 工具資料層,由它
	// 呼叫這批端點。
	//
	// 獨立成 /internal/geo/plan-ai/* 子命名空間、不混進上面那批
	// /internal/geo/* 核心端點,理由同 /internal/maintenance/* 的既有分法:
	// 方便日後從請求統計(見 adminconsole 的 request-stats)一眼分辨流量
	// 來源,也讓「這批是服務 LLM 工具呼叫」這件事從路徑就看得出來。
	//
	// 2026-09:這五支原本掛在免登入的 /public/geo/* 底下——它們不像主題
	// 介紹頁那三支有城市/placeID 白名單可以限制查詢範圍(這批可以查任意
	// 地名、任意 placeID),只靠拒絕型限流把關,等於任何訪客都能消耗
	// Google Places 的計費配額。搬到 internalAuth 底下關掉這個曝險。
	internalMux.HandleFunc("GET /internal/geo/plan-ai/place-search", s.handlePublicGeoPlaceSearch)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/attraction-search", s.handlePublicGeoAttractionSearch)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/place-details-any", s.handlePublicGeoPlaceDetailsAny)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/attraction/{id}", s.handlePublicGeoAttractionByID)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/transit-estimate", s.handlePublicGeoTransitEstimate)

	// maintenance — 只給 tripace-cli 這類維運工具用的端點,不是產品前端
	// 會呼叫的路徑(見 maintenance.go 開頭對「核心」與「維運」端點分開的
	// 完整說明)。刻意獨立命名空間 /internal/maintenance/*,不混進上面
	// /internal/geo/* 那批核心端點,方便日後從請求統計(見 adminconsole
	// 的 request-stats)一眼分辨流量來源。
	internalMux.HandleFunc("GET /internal/maintenance/geocode", s.handleMaintenanceGeocode)
	internalMux.HandleFunc("POST /internal/maintenance/attractions/{id}/update-photo", s.handleMaintenanceAttractionUpdatePhoto)
	internalMux.HandleFunc("POST /internal/maintenance/attractions", s.handleMaintenanceAttractionAdd)
	internalMux.HandleFunc("GET /internal/maintenance/attractions", s.handleMaintenanceAttractionList)
	internalMux.HandleFunc("GET /internal/maintenance/attractions/cities", s.handleMaintenanceAttractionCities)
	internalMux.HandleFunc("GET /internal/maintenance/attractions/query", s.handleMaintenanceAttractionQuery)
	internalMux.HandleFunc("DELETE /internal/maintenance/attractions/{id}", s.handleMaintenanceAttractionDelete)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/coords", s.handleMaintenanceAttractionUpdateCoords)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/field", s.handleMaintenanceAttractionUpdateField)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/place-id", s.handleMaintenanceAttractionUpdatePlaceID)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/theme", s.handleMaintenanceAttractionUpdateTheme)
	// 景點資料同步機制新增的端點(見 attraction_sync.go、
	// docs/ATTRACTION_SYNC_DESIGN.md)——專門服務
	// server/internal/attractionsync 套件的三層比對 + 交握式傳輸,不是
	// 給前端或一般維運操作用,獨立命名空間 /internal/maintenance/sync/*
	// 跟上面的 /internal/maintenance/attractions* 區分開來。
	internalMux.HandleFunc("GET /internal/maintenance/sync/attractions/schema", s.handleMaintenanceAttractionSchema)
	internalMux.HandleFunc("GET /internal/maintenance/sync/server-time", s.handleMaintenanceServerTime)
	internalMux.HandleFunc("GET /internal/maintenance/sync/attractions/freshness", s.handleMaintenanceAttractionFreshness)
	internalMux.HandleFunc("GET /internal/maintenance/sync/attractions/list", s.handleMaintenanceAttractionSyncList)
	internalMux.HandleFunc("GET /internal/maintenance/sync/attractions/{id}", s.handleMaintenanceAttractionSyncGet)
	internalMux.HandleFunc("POST /internal/maintenance/sync/attractions/compare", s.handleMaintenanceAttractionSyncCompare)
	internalMux.HandleFunc("POST /internal/maintenance/sync/attractions/write", s.handleMaintenanceAttractionSyncWrite)
	internalMux.HandleFunc("POST /internal/maintenance/sync/attractions/update", s.handleMaintenanceAttractionSyncUpdate)
	internalMux.HandleFunc("POST /internal/maintenance/sync/attractions/delete", s.handleMaintenanceAttractionSyncDelete)
	// setup/run 是「本機」角色專用:CLI 觸發後,由本機 server 主動發起
	// HTTP 請求去跟同步對象(target)對話(見 attraction_sync.go 開頭的
	// 角色說明),跟上面那批「被動接收方」端點分開列出。
	internalMux.HandleFunc("POST /internal/maintenance/sync/setup", s.handleMaintenanceSyncSetup)
	internalMux.HandleFunc("POST /internal/maintenance/sync/attractions/run", s.handleMaintenanceSyncRun)

	mux.Handle("/internal/", internalAuth(s.signer, internalMux))

	return s.requestLogging(cors(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /v1/trips — 只回目前使用者參與的行程。
func (s *Server) handleListTrips(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	chs, err := s.store.ListTripsForUser(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if chs == nil {
		chs = []model.Trip{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"trips": chs})
}

// POST /v1/trips  { "name": "..." }
func (s *Server) handleCreateTrip(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_name", "name 不可為空")
		return
	}
	ch, err := s.store.CreateTrip("ch_"+newID(), body.Name, s.userFor(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ch)
}

// 原話(message)已移至各裝置端 DB,後端不再保存或提供 messages 端點。
// owner 記事走 POST /assist(LLM 解析成 entry),member 查詢走 POST /query(查 entry)。

// GET /v1/trips/{id}/members
func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	members, err := s.store.ListMembers(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if members == nil {
		members = []model.Member{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// POST /v1/trips/{id}/members  { "email": "...", "role": "editor"|"viewer" }
// 以 email 查出使用者後加入行程。role 留空預設 viewer。僅 owner 能加入成員。
func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	user := s.userFor(r)

	// 權限:只有 owner 能加入/管理成員。
	if !s.requireOwner(w, id, user.ID) {
		return
	}

	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !decode(w, r, &body) {
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	if email == "" {
		writeErr(w, http.StatusBadRequest, "invalid_email", "email 不可為空")
		return
	}
	role := body.Role
	if role != model.RoleEditor && role != model.RoleViewer {
		role = model.RoleViewer // 預設或非法值一律 viewer
	}

	u, _, err := s.store.FindUserByEmail(email)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "user_not_found", "找不到使用此 email 的使用者")
			return
		}
		writeErr(w, http.StatusInternalServerError, "lookup_failed", err.Error())
		return
	}

	members, err := s.store.AddMember(id, u, role)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "trip_not_found", "行程不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "add_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// PATCH /v1/trips/{id}/members/{userID}  { "role": "editor"|"viewer" }
// 變更成員角色。僅 owner 能改;不能改 owner 自己的角色(owner 恆為 editor)。
func (s *Server) handleSetMemberRole(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	targetID := r.PathValue("userID")
	user := s.userFor(r)

	if !s.requireOwner(w, id, user.ID) {
		return
	}
	if targetID == user.ID {
		writeErr(w, http.StatusBadRequest, "cannot_change_owner", "不能變更行程擁有者自己的角色")
		return
	}

	var body struct {
		Role string `json:"role"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Role != model.RoleEditor && body.Role != model.RoleViewer {
		writeErr(w, http.StatusBadRequest, "invalid_role", "role 須為 editor 或 viewer")
		return
	}

	if err := s.store.SetMemberRole(id, targetID, body.Role); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "member_not_found", "該成員不在此行程")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	members, err := s.store.ListMembers(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// requireOwner 檢查 userID 是否為行程 owner;非 owner 時寫入錯誤回應並回 false。
func (s *Server) requireOwner(w http.ResponseWriter, tripID, userID string) bool {
	owner, err := s.store.GetTripOwner(tripID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "trip_not_found", "行程不存在")
			return false
		}
		writeErr(w, http.StatusInternalServerError, "owner_check_failed", err.Error())
		return false
	}
	if userID != owner {
		writeErr(w, http.StatusForbidden, "not_owner", "只有行程擁有者能管理成員")
		return false
	}
	return true
}

// requireEditor 檢查 userID 在行程內是否有 editor 角色(可修改/記事);
// 非成員或非 editor 時寫入錯誤回應並回 false。
// owner 恆視為 editor:不論 members.role 為何(例如後補欄位時被預設成 viewer),
// owner 一律放行,確保行程擁有者永遠能記事。
func (s *Server) requireEditor(w http.ResponseWriter, tripID, userID string) bool {
	owner, err := s.store.GetTripOwner(tripID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "trip_not_found", "行程不存在")
			return false
		}
		writeErr(w, http.StatusInternalServerError, "owner_check_failed", err.Error())
		return false
	}
	if userID == owner {
		return true
	}

	role, err := s.store.GetMemberRole(tripID, userID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusForbidden, "not_member", "你不是此行程的成員")
			return false
		}
		writeErr(w, http.StatusInternalServerError, "role_check_failed", err.Error())
		return false
	}
	if role != model.RoleEditor {
		writeErr(w, http.StatusForbidden, "not_editor", "只有具編輯權限的成員能記事;你目前是查詢權限")
		return false
	}
	return true
}

// requireMember 檢查 userID 是否為行程成員(owner 或任一角色皆可);
// 非成員時寫入錯誤回應並回 false。用於「查詢」等任何成員都能做、但須屬於行程的操作。
// owner 恆視為成員(即使 members 表沒有對應列)。
func (s *Server) requireMember(w http.ResponseWriter, tripID, userID string) bool {
	owner, err := s.store.GetTripOwner(tripID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "trip_not_found", "行程不存在")
			return false
		}
		writeErr(w, http.StatusInternalServerError, "owner_check_failed", err.Error())
		return false
	}
	if userID == owner {
		return true
	}

	// 非 owner:須在 members 表中(任一角色)才放行。
	if _, err := s.store.GetMemberRole(tripID, userID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusForbidden, "not_member", "你不是此行程的成員")
			return false
		}
		writeErr(w, http.StatusInternalServerError, "role_check_failed", err.Error())
		return false
	}
	return true
}

// GET /v1/trips/{id}/entries — 行程的日期/事件條目(LLM 從訊息解析,關聯訊息)。
func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	s.writeEntries(w, r.PathValue("id"))
}

// DELETE /v1/trips/{id}/entries — 清空行程的所有條目與行程(開發/測試重置用)。
// 屬破壞性操作,限行程 owner。
func (s *Server) handleResetTripData(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireOwner(w, id, s.userFor(r).ID) {
		return
	}
	s.resetTrip(w, id)
}

// tripEntryBody 是前端旅程清單「儲存」動作的請求/回應共用形狀,欄位對齊前端
// TripEntry(web/src/clienttools/tripEntryTools.ts 的 {id, title, date, time,
// note})與 server/tools/clienttools.yaml 的 trip_entry_add/trip_entry_update
// 命名——這三個端點是給前端「儲存」按鈕呼叫的一般 REST API(逐筆
// upsert),不經過 wanttools/want 那套 LLM 工具註冊機制,故欄位命名直接對齊
// 前端型別即可,不需要跟 entry_query.go 的 TripEntryPayload 共用型別
// (兩邊各自獨立、只是欄位剛好同名同義)。
type tripEntryBody struct {
	ID    string `json:"id,omitempty"`
	Title string `json:"title"`
	Date  string `json:"date"`
	Time  string `json:"time"`
	Note  string `json:"note"`
}

// POST /v1/trips/{id}/entries — 前端旅程清單「儲存」新增一筆(不含 id,由後端產生)。
// body 帶 TripEntry 格式(title/date/time/note);成功回傳含新產生 id 的完整 tripEntryBody。
// 屬「修改」操作,需 editor 角色(owner 預設即 editor,同其餘寫入端點的權限慣例)。
func (s *Server) handleCreateTripEntry(w http.ResponseWriter, r *http.Request) {
	tripID := r.PathValue("id")
	if !s.requireEditor(w, tripID, s.userFor(r).ID) {
		return
	}

	var body tripEntryBody
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Title) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_title", "title 不可為空")
		return
	}

	svc := tripsvc.New(s.store, nil)
	res, err := svc.Record(tripsvc.RecordInput{
		TripID:    tripID,
		Title:     body.Title,
		Start:     body.Date,
		StartTime: body.Time,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	// note 目前無獨立寫入欄位(RecordInput 沒有 Note),新增後若帶了 note 用
	// UpdateEntry 補上——tripsvc.Record 專注在「新增條目」本身,note 是手動
	// 編輯情境的欄位,沿用 UpdateEntry 的既有寫入路徑,不擴大 RecordInput
	// 的職責。
	if body.Note != "" {
		if err := svc.UpdateEntry(tripsvc.UpdateEntryInput{ID: res.EntryID, Note: body.Note}); err != nil {
			writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
			return
		}
	}
	s.hub.Broadcast(tripID, map[string]any{"event": "entries_updated", "tripID": tripID})
	writeJSON(w, http.StatusCreated, tripEntryBody{ID: res.EntryID, Title: body.Title, Date: body.Date, Time: body.Time, Note: body.Note})
}

// PUT /v1/trips/{id}/entries/{entryID} — 前端旅程清單「儲存」修改既有一筆。
// body 帶要更新的欄位(TripEntry 格式);entryID 須屬於路徑上的 tripID,
// 避免前端誤帶其他行程的 id 時跨行程修改到別人的資料。
func (s *Server) handleUpdateTripEntry(w http.ResponseWriter, r *http.Request) {
	tripID := r.PathValue("id")
	entryID := r.PathValue("entryID")
	if !s.requireEditor(w, tripID, s.userFor(r).ID) {
		return
	}

	entry, err := s.store.GetEntry(entryID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "entry_not_found", "條目不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "lookup_failed", err.Error())
		return
	}
	if entry.TripID != tripID {
		writeErr(w, http.StatusNotFound, "entry_not_found", "條目不存在")
		return
	}

	var body tripEntryBody
	if !decode(w, r, &body) {
		return
	}

	svc := tripsvc.New(s.store, nil)
	if err := svc.UpdateEntry(tripsvc.UpdateEntryInput{
		ID:        entryID,
		Title:     body.Title,
		Start:     body.Date,
		StartTime: body.Time,
		Note:      body.Note,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	s.hub.Broadcast(tripID, map[string]any{"event": "entries_updated", "tripID": tripID})
	writeJSON(w, http.StatusOK, map[string]string{"updated": entryID})
}

// DELETE /v1/trips/{id}/entries/{entryID} — 前端旅程清單「儲存」刪除既有一筆
// (使用者在前端表格移除該列後,儲存時觸發)。entryID 須屬於路徑上的
// tripID,理由同 handleUpdateTripEntry。
func (s *Server) handleDeleteTripEntry(w http.ResponseWriter, r *http.Request) {
	tripID := r.PathValue("id")
	entryID := r.PathValue("entryID")
	if !s.requireEditor(w, tripID, s.userFor(r).ID) {
		return
	}

	entry, err := s.store.GetEntry(entryID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "entry_not_found", "條目不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "lookup_failed", err.Error())
		return
	}
	if entry.TripID != tripID {
		writeErr(w, http.StatusNotFound, "entry_not_found", "條目不存在")
		return
	}

	if err := s.store.DeleteEntry(entryID); err != nil {
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	s.hub.Broadcast(tripID, map[string]any{"event": "entries_updated", "tripID": tripID})
	writeJSON(w, http.StatusOK, map[string]string{"deleted": entryID})
}

// PATCH /v1/entries/{id} — 手動編輯條目(不經 AI,前端表單直接送出要改的欄位)。
// entryID 本身不帶 tripID,故先查出該條目所屬行程,再依 editor 權限放行;
// 只更新請求帶了值的欄位(空字串視為不改,見 store.UpdateEntry),未帶到的欄位維持原值。
func (s *Server) handleUpdateEntry(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("id")
	entry, err := s.store.GetEntry(entryID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "entry_not_found", "條目不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "lookup_failed", err.Error())
		return
	}
	if !s.requireEditor(w, entry.TripID, s.userFor(r).ID) {
		return
	}

	var body struct {
		Title     string         `json:"title"`
		Start     string         `json:"start"`
		StartTime string         `json:"startTime"`
		End       string         `json:"end"`
		EndTime   string         `json:"endTime"`
		Location  string         `json:"location"`
		Note      string         `json:"note"`
		Kind      string         `json:"kind"`
		Detail    map[string]any `json:"detail"`
	}
	if !decode(w, r, &body) {
		return
	}

	svc := tripsvc.New(s.store, nil)
	if err := svc.UpdateEntry(tripsvc.UpdateEntryInput{
		ID:        entryID,
		Title:     body.Title,
		Start:     body.Start,
		StartTime: body.StartTime,
		End:       body.End,
		EndTime:   body.EndTime,
		Location:  body.Location,
		Note:      body.Note,
		Kind:      body.Kind,
		Detail:    body.Detail,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	s.hub.Broadcast(entry.TripID, map[string]any{"event": "entries_updated", "tripID": entry.TripID})
	writeJSON(w, http.StatusOK, map[string]string{"updated": entryID})
}

// ----- shared query helpers -----

func (s *Server) writeEntries(w http.ResponseWriter, tripID string) {
	entries, err := s.store.ListEntriesByTrip(tripID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if entries == nil {
		entries = []model.Entry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) resetTrip(w http.ResponseWriter, tripID string) {
	if err := s.store.DeleteTripEntries(tripID); err != nil {
		writeErr(w, http.StatusInternalServerError, "reset_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "reset", "trip": tripID})
}

// ----- helpers -----

func newID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", "請求格式錯誤")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]any{
		"error": map[string]string{"code": errCode, "message": msg},
	})
}
