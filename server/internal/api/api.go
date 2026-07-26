// Package api 提供對齊 docs/API.md 的 HTTP handlers。
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/onagenttools"
	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/photoupload"
	"github.com/tim72117/tripace/internal/ratelimits"
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

	// adminBootstrapEmail:見 resolveContentPageOwnerID 的完整說明——
	// content-page 的 official 模式(ownerID="",對應九份/京都/台南等
	// 城市介紹頁共用的系統帳號命名空間)只有這個 email 對應的使用者能
	// 使用,跟 internal/adminconsole.Handler.AdminBootstrapEmail 讀的是
	// 同一個環境變數值(ADMIN_BOOTSTRAP_EMAIL),但這裡獨立持有一份——
	// internal/api 跟 internal/adminconsole 是兩個互不相依的套件,各自
	// 的 Server/Handler 建構時各自從環境變數讀一次,不透過共用全域變數
	// 或額外的套件間依賴傳遞這個值,保持兩個套件原本就互相獨立的既有
	// 結構。
	adminBootstrapEmail string

	// photoMaxCount:全域「照片最大張數」設定的目前生效值(見 photo_max_count.go),
	// 由維運端點與背景重讀更新,補圖判斷每次請求都讀,所以用 atomic。
	photoMaxCount atomic.Int64

	// photoFillInFlight:正在進行中的背景補圖(key 是 "placeID#photoIndex"),
	// 見 backgroundFillPlacePhoto 的去重說明。
	photoFillInFlight sync.Map

	// photoExpiryDays:全域「照片過期週期(天)」設定的目前生效值,見 PhotoAssetExpiry。
	photoExpiryDays atomic.Int64

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

	// blogPhotoUploader 簽發使用者上傳部落格配圖用的 pre-signed URL、
	// 下載/上傳/刪除 GCS 上的原圖與衍生版本,見 internal/photoupload 的
	// 完整說明與 blog_photo.go 的呼叫端。跟上面的 photoUploader
	// (photostorage.Uploader)刻意是兩個獨立欄位、各自對應獨立的
	// bucket 環境變數(BLOG_PHOTO_UPLOAD_BUCKET vs GCS_PHOTO_BUCKET)
	// ——兩者服務的是完全不同性質的圖片(使用者原創上傳 vs. 系統落地
	// 的外部照片快取),見 internal/photoupload 套件開頭「為什麼獨立
	// 成新套件」的完整說明。bucket 未設定時 photoupload.New 回傳一個
	// bucket 為空字串的 SignedUploader,各方法呼叫會直接回傳
	// photoupload.ErrNoBucket,呼叫端(blog_photo.go)據此降級回應。
	blogPhotoUploader *photoupload.SignedUploader

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
	// API,且各自呼叫 SetGooglePlacePhotos(整批
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
	// **防 LLM 工具呼叫迴圈**:唯一呼叫端是 planning/conversation/tools.ts
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
	// apigateway.RateLimiter 內部已有惰性過期清除機制(見該型別
	// maybeSweepLocked 的完整說明),key 改成 per-user 後,不活躍使用者
	// 的視窗狀態會在閒置超過 idleWindowTTL 後被自動回收,不會隨歷史上
	// 出現過的使用者總數無上限增長。
	geoQueryUserRateLimiter *apigateway.RateLimiter

	// geoQueryIPRateLimiter 保護 2026-10 新開放給訪客的
	// /public/geo/plan-ai/place-search 與
	// /public/geo/plan-ai/attraction-search 這兩支公開端點(見
	// throttleGeoQueryByIP 的完整說明)——這兩支端點複用
	// handlePublicGeoPlaceSearch/handlePublicGeoAttractionSearch,
	// handler 內部本來就會呼叫 throttleGeoQueryByUser 做 per-user
	// 節流,但訪客沒有登入身份,userFor 一律回退成共用的
	// s.guestUser(ID 固定 "usr_me"),等於所有訪客共用同一份
	// per-user 配額,完全沒有保護效果(見該欄位說明)。這裡用獨立的
	// RateLimiter 實例、key 改成來源 IP,在公開路由註冊處額外疊加一層
	// (見 Routes 內 /public/geo/plan-ai/* 區塊),跟 geoQueryUserRateLimiter/
	// planAiChatRateLimiter 一樣刻意用獨立實例、不混用同一份 key 空間,
	// 理由同上——這是為訪客流量另開的資源池,不該跟已登入使用者或其他
	// endpoint 的配額互相排擠。
	geoQueryIPRateLimiter *apigateway.RateLimiter

	// planAiChatRateLimiter 保護 POST /internal/plan-ai/chat(見
	// plan_ai_chat.go 的完整說明),用 key = user.ID(已登入使用者的真實
	// ID,或訪客的 X-Guest-Id,見 userOrGuestFor 的完整說明)做 per-user
	// 節流——跟 geoQueryUserRateLimiter 共用同一個元件(apigateway.
	// RateLimiter)但刻意用獨立實例,不混用同一份 key 空間:AI 規劃對話
	// 跟地圖查詢是不同的資源,不該互相排擠彼此的配額(例如使用者在地圖上
	// 連續操作用掉 geoQueryUserRateLimiter 的額度,不該連帶影響這個使用者
	// 還能不能送出下一則 AI 對話訊息,反之亦然)。限制值見
	// planAiChatRateLimitWindow/planAiChatRateLimitMaxCalls 的完整說明。
	planAiChatRateLimiter *apigateway.RateLimiter

	// planAiChatIPRateLimiter 保護 2026-10 新開放給訪客的
	// POST /public/plan-ai/chat 與 POST /public/plan-ai/chat/reply(見
	// withPlanAiChatIPThrottle 的完整說明)——理由跟 geoQueryIPRateLimiter
	// 類似但不完全相同:這支端點的 per-user 節流(planAiChatRateLimiter)
	// 對訪客並非完全無效(訪客各自帶獨立的 X-Guest-Id,見 userOrGuestFor
	// 的完整說明,不會像舊版共用固定 guestUser.ID 那樣讓 per-user 節流
	// 整個失效),但 X-Guest-Id 是前端存在 localStorage 的值,清掉
	// localStorage 或換一個瀏覽器/無痕視窗就能拿到全新的 id、繞過
	// per-user 節流——疊加一層以來源 IP 為 key 的節流,讓「換 id 繞過
	// per-user 限制」這條路徑仍然受到同一來源 IP 的總量限制,跟
	// geoQueryIPRateLimiter 疊加 geoQueryUserRateLimiter 的既有理由一致。
	planAiChatIPRateLimiter *apigateway.RateLimiter

	// geoAttractionsIPRateLimiter 保護 2026-10 新開放給訪客的
	// GET /public/geo/attractions/nearby 與 GET /public/geo/attractions
	// (見 throttleGeoAttractionsByIP 的完整說明)——這兩支複製自需登入的
	// handleGeoAttractionsNearby/handleGeoAttractions,內部都會呼叫
	// fetchNearbyHotels 即時查 Google Places Nearby Search(計費),
	// handleGeoAttractions 在資料庫查無資料時還會額外 fallback 到
	// SearchCityAttractions(同樣計費)。這兩支風險等級相同(都會觸發
	// 計費 API),刻意共用同一個 RateLimiter 實例與同一組節流函式,不像
	// geoQueryIPRateLimiter/planAiChatIPRateLimiter 那樣各自獨立一份
	// ——不是疏漏,是因為這裡要保護的是「訪客能觸發多少次計費查詢」
	// 這一件事本身,兩支端點是同一個風險池,沒有必要分開計算配額。
	// 跟 geoQueryIPRateLimiter(純查資料庫/輕量端點,300 次/60 秒)分開
	// 一個獨立實例,是因為這裡的上限需要嚴格得多(見
	// geoAttractionsIPThrottleMaxCalls 的完整說明),不能跟風險較低的
	// 查詢共用同一組規則。
	geoAttractionsIPRateLimiter *apigateway.RateLimiter
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

// geoQueryIPThrottleWindow/geoQueryIPThrottleMaxCalls 是
// geoQueryIPRateLimiter 預設的節流規則——保護 2026-10 新開放給訪客的
// /public/geo/plan-ai/place-search 與 /public/geo/plan-ai/attraction-search
// (見 throttleGeoQueryByIP 的完整說明)。沿用跟 geoQueryUserThrottleWindow/
// geoQueryUserThrottleMaxCalls 完全相同的數值(60 秒視窗內最多 300
// 次)——理由:這兩支端點本來就是同一組 handler(handlePublicGeoPlaceSearch/
// handlePublicGeoAttractionSearch),既有的 per-user 節流值已經是「2026-10
// 使用者明確要求的 200ms 一次」這個合理上限,沒有理由對訪客另外訂一組
// 更寬鬆的數字;但這裡刻意不「略嚴格一些」的理由是:以 IP 當 key 本身已經
// 比 per-user 更容易因為 NAT/公司網路/校園網路等多人共用同一對外 IP 的
// 情況而連帶影響到同一來源底下的其他訪客,維持同一組數值已經是相對保守
// 的選擇,不需要再疊加更嚴格的上限——若之後觀察到被濫用的實際數據,再
// 依據情況調整,不在這裡預先過度設計。
const geoQueryIPThrottleWindow = 60 * time.Second
const geoQueryIPThrottleMaxCalls = 300

// planAiChatRateLimitWindow/planAiChatRateLimitMaxCalls 是
// planAiChatRateLimiter 預設的節流規則——待確認的估計值:先抓「每分鐘
// 最多 10 則訊息」,比照使用者一般打字/思考的速度上限,留了不少餘裕給
// 正常使用情境(例如連續追問好幾個問題),同時擋住整個對話被腳本/重試
// 迴圈瞬間灌爆的情況。這組數字沒有實際使用量數據支撐,只是合理推測,
// 日後應依 plan_ai_chat_messages 表的實際寫入頻率重新評估調整。
const planAiChatRateLimitWindow = 60 * time.Second
const planAiChatRateLimitMaxCalls = 10

// planAiChatIPThrottleWindow/planAiChatIPThrottleMaxCalls 是
// planAiChatIPRateLimiter 預設的節流規則——沿用跟 planAiChatRateLimiter
// 相同的視窗長度(60 秒),上限值刻意比 per-user 的 10 次寬鬆一些
// (30 次):這一層保護的是「同一來源 IP 底下所有訪客的總和」,正常情境
// 下一個 IP 後面可能有多位訪客各自在對話(NAT/公司網路/校園網路),用
// 跟 per-user 完全相同的上限會讓這些正常情境下的多人同時使用被誤擋;
// 30 次仍然遠低於任何正常對話量級會觸及的程度,足以擋住「不斷清
// localStorage 換新 X-Guest-Id 繞過 per-user 節流」這種濫用路徑。
const planAiChatIPThrottleWindow = 60 * time.Second
const planAiChatIPThrottleMaxCalls = 30

// throttlePlanAiChatByIP 是 throttleGeoQueryByIP 的對應版本,保護
// 2026-10 新開放給訪客的 POST /public/plan-ai/chat 與
// POST /public/plan-ai/chat/reply(見 planAiChatIPRateLimiter 欄位的
// 完整說明)。key 同樣用 clientIP(r)(見該函式說明)。
//
// 回傳 true 代表這次請求可以繼續處理;回傳 false 代表已經寫好 429
// 回應,呼叫端應該立刻 return,不再執行任何後續邏輯。
func (s *Server) throttlePlanAiChatByIP(w http.ResponseWriter, r *http.Request) bool {
	if s.planAiChatIPRateLimiter.AllowWithLimit(clientIP(r), planAiChatIPThrottleWindow, planAiChatIPThrottleMaxCalls) {
		return true
	}
	writeErr(w, http.StatusTooManyRequests, "rate_limited", "訊息送得太快了,請稍後再試")
	return false
}

// withPlanAiChatIPThrottle 包一層 throttlePlanAiChatByIP 檢查在 next
// 前面,供 Routes 註冊 /public/plan-ai/chat* 這批公開端點時使用,寫法
// 對齊 withGeoQueryIPThrottle 的既有模式(見該函式的完整說明:節流檢查
// 是路由層的關注點,留在路由註冊處,不讓 handler 自己判斷掛在哪組
// mux 上)。
func withPlanAiChatIPThrottle(s *Server, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.throttlePlanAiChatByIP(w, r) {
			return
		}
		next(w, r)
	}
}

// geoAttractionsIPThrottleWindow/geoAttractionsIPThrottleMaxCalls 是
// geoAttractionsIPRateLimiter 預設的節流規則——保護 2026-10 新開放給
// 訪客的 GET /public/geo/attractions/nearby 與 GET /public/geo/attractions
// (見該欄位的完整說明)。這兩支都會觸發計費的 Google Places API 呼叫
// (fetchNearbyHotels,handleGeoAttractions 另外還可能觸發
// SearchCityAttractions),風險遠高於 geoQueryIPRateLimiter 保護的純查詢/
// 輕量端點(300 次/60 秒),故上限抓嚴格許多——比照同樣「會觸發昂貴
// 操作」情境下的既有先例 planAiChatIPThrottleMaxCalls(30 次/60 秒,見
// 該常數的完整說明:這一層保護的是同一來源 IP 底下所有訪客的總和,
// 需要在「擋住濫用」與「NAT/公司網路多人共用同一對外 IP 的正常情境
// 不被誤擋」之間取捨),這裡直接沿用同一個數值與理由。
const geoAttractionsIPThrottleWindow = 60 * time.Second
const geoAttractionsIPThrottleMaxCalls = 30

// throttleGeoAttractionsByIP 是 throttleGeoQueryByIP 的對應版本,保護
// 2026-10 新開放給訪客的 GET /public/geo/attractions/nearby 與
// GET /public/geo/attractions(見 geoAttractionsIPRateLimiter 欄位的完整
// 說明)。key 同樣用 clientIP(r)(見該函式說明)。
//
// 回傳 true 代表這次請求可以繼續處理;回傳 false 代表已經寫好 429
// 回應,呼叫端應該立刻 return,不再執行任何後續邏輯(含不再呼叫 handler
// 本身)。
func (s *Server) throttleGeoAttractionsByIP(w http.ResponseWriter, r *http.Request) bool {
	if s.geoAttractionsIPRateLimiter.AllowWithLimit(clientIP(r), geoAttractionsIPThrottleWindow, geoAttractionsIPThrottleMaxCalls) {
		return true
	}
	writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
	return false
}

// withGeoAttractionsIPThrottle 包一層 throttleGeoAttractionsByIP 檢查在
// next 前面,供 Routes 註冊 /public/geo/attractions* 這批新公開端點時
// 使用,寫法對齊 withGeoQueryIPThrottle 的既有模式(見該函式的完整說明:
// 節流檢查是路由層的關注點,留在路由註冊處,不讓 handler 自己判斷掛在
// 哪組 mux 上)。
func withGeoAttractionsIPThrottle(s *Server, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.throttleGeoAttractionsByIP(w, r) {
			return
		}
		next(w, r)
	}
}

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

	// blogPhotoUploader:使用者上傳部落格配圖用,見 Server struct 該欄位
	// 的完整說明。失敗時的降級理由同上面 photostorage.New 的既有慣例
	// ——這是輔助功能,不該讓整個 server 起不來。
	blogPhotoUploader, err := photoupload.New(context.Background(), os.Getenv("BLOG_PHOTO_UPLOAD_BUCKET"), os.Getenv("GCS_SERVICE_ACCOUNT_EMAIL"))
	if err != nil {
		log.Printf("!!! 建立使用者上傳圖片用的 GCS uploader 失敗,部落格配圖上傳功能將不可用: %v", err)
		blogPhotoUploader = &photoupload.SignedUploader{}
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
	// 2026-10:預設值改讀 internal/ratelimits 的登錄表(見該套件檔頭的
	// 完整說明)。這兩條規則現在也納入 geo_rate_limits 表與後台/CLI 的
	// 管理範圍——啟動時先套用登錄表的預設值,之後由
	// ApplyPlanAIRateLimits(見該方法)用資料庫的現值覆寫。
	planAiRateLimiter := apigateway.NewRateLimiter()
	for _, r := range ratelimits.OfKind(ratelimits.KindPlanAIEndpoint) {
		planAiRateLimiter.SetLimitForKey(r.Endpoint, r.DefaultWindow, r.DefaultMaxCalls)
	}

	// geoQueryUserRateLimiter:不在這裡預先呼叫 SetLimitForKey——key 是
	// 使用者 ID,數量隨使用者登入而動態出現,不像 planAiRateLimiter 只有
	// 兩個固定的 endpoint 字串可以在啟動時就設定好。改成每次請求時由
	// throttleGeoQueryByUser(見該函式的完整說明)對當下的 userID 懶惰呼叫
	// SetLimitForKey——RateLimiter.SetLimitForKey 用同一個 key 重複呼叫
	// 只是覆寫成同一組規則,不會重置該 key 已經累積的視窗計數(見該方法
	// 實作:只動 limits 表,不動 windows 表),所以每次請求都呼叫一次
	// 不會錯誤地讓使用者每次都拿到全新配額。
	geoQueryUserRateLimiter := apigateway.NewRateLimiter()

	// geoQueryIPRateLimiter:跟 geoQueryUserRateLimiter 一樣,key 是動態的
	// 來源 IP 集合,不在這裡預先設定規則——改由 throttleGeoQueryByIP
	// (見該函式的完整說明)每次請求時用 AllowWithLimit 帶入視窗與上限。
	geoQueryIPRateLimiter := apigateway.NewRateLimiter()

	// planAiChatRateLimiter:跟 geoQueryUserRateLimiter 一樣,key 是動態的
	// 使用者 ID 集合,不在這裡預先呼叫 SetLimitForKey——改由
	// handlePlanAiChat 每次請求時懶惰呼叫(理由同
	// geoQueryUserRateLimiter 的完整說明)。
	planAiChatRateLimiter := apigateway.NewRateLimiter()

	// planAiChatIPRateLimiter:跟 geoQueryIPRateLimiter 一樣,key 是動態的
	// 來源 IP 集合,不在這裡預先設定規則——改由 throttlePlanAiChatByIP
	// (見該函式的完整說明)每次請求時用 AllowWithLimit 帶入視窗與上限。
	planAiChatIPRateLimiter := apigateway.NewRateLimiter()

	// geoAttractionsIPRateLimiter:跟 geoQueryIPRateLimiter 一樣,key 是
	// 動態的來源 IP 集合,不在這裡預先設定規則——改由
	// throttleGeoAttractionsByIP(見該函式的完整說明)每次請求時用
	// AllowWithLimit 帶入視窗與上限。
	geoAttractionsIPRateLimiter := apigateway.NewRateLimiter()

	return &Server{
		store:                       st,
		signer:                      signer,
		hub:                         newHub(),
		devMode:                     devMode,
		googleClientID:              googleClientID,
		guestUser:                   model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"},
		adminBootstrapEmail:         os.Getenv("ADMIN_BOOTSTRAP_EMAIL"),
		photoCache:                  storePhotoCache{store: st},
		photoUploader:               uploader,
		blogPhotoUploader:           blogPhotoUploader,
		newGeoGeocodeClient:         geo.New,
		newPlaceDetailsClient:       geo.New,
		newMaintenancePhotoClient:   geo.New,
		planAiRateLimiter:           planAiRateLimiter,
		geoQueryUserRateLimiter:     geoQueryUserRateLimiter,
		geoQueryIPRateLimiter:       geoQueryIPRateLimiter,
		planAiChatRateLimiter:       planAiChatRateLimiter,
		planAiChatIPRateLimiter:     planAiChatIPRateLimiter,
		geoAttractionsIPRateLimiter: geoAttractionsIPRateLimiter,
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

// trustedProxyHops 是 X-Forwarded-For 由後往前數、要信任的那一筆的位置
// (1 = 最後一筆,即緊鄰本服務的那層代理所看到的連線來源)。預設 1 對應
// Cloud Run 直接面對外部流量;若前面另外接了負載平衡器,每多一層就要把
// TRUSTED_PROXY_HOPS 調高 1,否則所有訪客會被算成同一個 IP。無效值
// (非正整數)一律回到預設 1。啟動時讀一次,不隨請求變動。
var trustedProxyHops = trustedProxyHopsFromEnv(os.Getenv("TRUSTED_PROXY_HOPS"))

func trustedProxyHopsFromEnv(v string) int {
	if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n >= 1 {
		return n
	}
	return 1
}

// clientIP 從請求取出發出這次呼叫的真實來源 IP——優先看
// X-Forwarded-For 這個反向代理 header,理由是這個專案
// 部署在 Cloud Run 後面(見 cmd/server 的部署說明),所有對外流量都會先
// 經過 Google 的反向代理層再轉送進容器,這時 r.RemoteAddr 拿到的是代理
// 本身的位址,不是真正發出請求的使用者 IP——若節流直接用 r.RemoteAddr
// 當 key,所有訪客流量會共用同一個(或少數幾個)代理位址當 key,等同
// 完全沒有區分不同來源,節流形同虛設。
//
// 目前專案裡沒有其他地方已經處理過這個問題(例如還沒有既有的訪客流量
// 限流或 IP 擷取邏輯可以重用),這是第一個需要真實來源 IP 的呼叫端,
// 故在這裡新寫一個小 helper,供 throttleGeoQueryByIP 使用;之後若有其他
// 端點也需要類似的真實來源 IP,應優先重用這支函式,不要各自重新發明。
//
// 判斷順序:
//  1. X-Forwarded-For——標準反向代理 header,可能是逗號分隔的多個 IP,
//     每經過一層代理會在**尾端**追加一個(該代理看到的連線對端位址)。
//     最左邊的值是用戶端自己送的、可任意偽造,不能當 key——若取第一個,
//     呼叫端每次請求換一個假值就能讓節流永遠看不到同一個 key,繞過整層
//     保護(這支函式保護的是會消耗 Google Places 配額的端點,繞過等於
//     沒有保護)。改取「由後往前數 trustedProxyHops 個」那一筆:Cloud Run
//     直接面對外部流量時,尾端那一筆就是 Google 代理看到的真實連線來源,
//     所以預設 1;前面若多接一層自己的代理/負載平衡器,對應調高
//     TRUSTED_PROXY_HOPS。header 內的值少於 trustedProxyHops 筆時視為
//     不可信,不使用這個 header,改走下面的 fallback。
//  2. 都沒有(或不可信)時 fallback 回 r.RemoteAddr(本機開發、或沒有
//     代理的情境,這時 RemoteAddr 本身就是真實來源;header 不可信時它
//     是代理的位址,多個訪客會共用同一個 key——寧可誤擋也不讓偽造值
//     繞過節流),並去除其中的 port 後綴
//     (net.SplitHostPort)——RemoteAddr 的格式固定是 "IP:port",節流
//     只需要 IP 本身,保留 port 會讓同一個使用者每次連線用不同來源
//     port 時被誤判成不同 key,完全失去節流效果。
//
// 刻意不讀 X-Real-IP:Cloud Run 不會設定它,用戶端送什麼就是什麼,
// 只要它是 fallback 之一,攻擊者讓 X-Forwarded-For 筆數不足(例如
// TRUSTED_PROXY_HOPS 設得比實際代理層數大)或直連時,每次換一個假的
// X-Real-IP 就能讓節流永遠看不到同一個 key。X-Forwarded-For 最左邊的值
// 同樣由用戶端自行送出,不取,見上方第 1 點。這些值都不能用於任何授權
// 判斷(這裡也沒有這樣用);節流被繞過不會造成資料外洩或權限提升,但
// 會讓付費的 Google API 配額失去保護。
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.Split(fwd, ",")
		hops := make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				hops = append(hops, p)
			}
		}
		if n := len(hops); n >= trustedProxyHops {
			return hops[n-trustedProxyHops]
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

// throttleGeoQueryByIP 是 throttleGeoQueryByUser 的訪客版本——保護
// 2026-10 新開放給訪客(未登入)的 /public/geo/plan-ai/place-search 與
// /public/geo/plan-ai/attraction-search(見 Routes 內該區塊的完整說明)。
//
// 背景:這兩支端點複用既有的 handlePublicGeoPlaceSearch/
// handlePublicGeoAttractionSearch,handler 內部本來就會呼叫
// throttleGeoQueryByUser 做 per-user 節流,但訪客沒有 JWT、沒有登入
// 身份——userFor 在沒有合法 token 時一律回退成共用的 s.guestUser(ID
// 固定 "usr_me",見 userFor 的完整說明),代表所有訪客會共用同一份
// per-user 配額(60 秒內全站訪客合計最多 300 次),對任何單一訪客而言
// 幾乎等於沒有限流——這支函式在那層之外,對外部來源額外疊加一層以 IP
// 為 key 的節流,彌補這個缺口。
//
// 這兩層節流疊加的順序(見 geo_plan_ai.go 兩支 handler 呼叫處)是:先
// throttleGeoQueryByIP(這一層,只在公開路由這條路徑上執行),再進入
// handler 本身的 throttleGeoQueryByUser(兩層都通過才真的處理請求)——
// 理由同 handlePublicGeoAttractionSearch 疊加 planAiRateLimiter 與
// throttleGeoQueryByUser 兩層節流的既有慣例(見該函式說明):不同層
// 保護不同範圍,不能互相取代。
//
// key 用 clientIP(r)(見該函式說明:取 Cloud Run 反向代理追加在
// X-Forwarded-For 尾端的來源,不信任用戶端可偽造的 X-Real-IP 或最左邊
// 的值)。視窗/上限值見
// geoQueryIPThrottleWindow/geoQueryIPThrottleMaxCalls 的完整說明。
//
// 回傳 true 代表這次請求可以繼續處理;回傳 false 代表已經寫好 429
// 回應(不做任何降級,比照 throttleGeoQueryByUser 的既有行為),呼叫端
// 應該立刻 return,不再執行任何後續邏輯(含不再呼叫 handler 本身)。
func (s *Server) throttleGeoQueryByIP(w http.ResponseWriter, r *http.Request) bool {
	// 用 AllowWithLimit 而不是 SetLimitForKey + Allow:key 是外部來源 IP,
	// 數量無上限;SetLimitForKey 會把每個見過的 IP 永久寫進規則表,
	// 清理機制又不會回收規則表(見 RateLimiter.AllowWithLimit 的說明)。
	if s.geoQueryIPRateLimiter.AllowWithLimit(clientIP(r), geoQueryIPThrottleWindow, geoQueryIPThrottleMaxCalls) {
		return true
	}
	writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
	return false
}

// ApplyPlanAIRateLimits 把 plan-ai 兩支端點的限流規則換成傳入的值,供
// cmd/server 的設定重讀迴圈呼叫(見 cmd/server/geo_rate_limit.go 的
// applyRateLimitsFromStore)——對稱 geo.UpdateDefaultGatewayRateLimit
// 在 KindGoogleAPI 那一側扮演的角色。
//
// 2026-10 新增(使用者明確要求「都加進去」:把這兩條規則納入
// geo_rate_limits 表與後台/CLI 的管理範圍)。在這之前它們是
// api.New 裡的硬編碼字面值,只能改程式碼重新部署。
//
// 只接受 ratelimits 登錄表裡 KindPlanAIEndpoint 的 endpoint——其餘 key
// 直接忽略而不是寫進限流器:這個限流器只有那兩個 key 會被 Allow 查詢,
// 寫入別的 key 只會讓規則表無限增長(key 來自資料庫,內容可能有程式
// 已經移除的舊 endpoint),而且不會有任何效果。
func (s *Server) ApplyPlanAIRateLimits(limits map[string]struct {
	Window   time.Duration
	MaxCalls int
}) {
	for _, r := range ratelimits.OfKind(ratelimits.KindPlanAIEndpoint) {
		v, ok := limits[r.Endpoint]
		if !ok {
			continue
		}
		s.planAiRateLimiter.SetLimitForKey(r.Endpoint, v.Window, v.MaxCalls)
	}
}

// withGeoQueryIPThrottle 包一層 throttleGeoQueryByIP 檢查在 next 前面,
// 供 Routes 註冊 /public/geo/plan-ai/* 這批新公開端點時使用(見該處的
// 完整說明)——節流不通過時直接回 429、不呼叫 next,通過時原封不動呼叫
// next(即 handlePublicGeoPlaceSearch/handlePublicGeoAttractionSearch
// 本身,兩支 handler 內部仍會各自再跑一次 throttleGeoQueryByUser,兩層
// 節流疊加的理由見 throttleGeoQueryByIP 的完整說明)。寫成這支小 wrapper
// 而非讓這批 handler 自己判斷「這次是公開路由還是 internal 路由」,是
// 因為 handler 本身不需要、也不該知道自己被掛在哪一組 mux 上——這批節流
// 檢查是路由層的關注點,留在路由註冊處最清楚,也維持 handler 本身在這次
// 改動前後完全不變。
func withGeoQueryIPThrottle(s *Server, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.throttleGeoQueryByIP(w, r) {
			return
		}
		next(w, r)
	}
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

	// 主題介紹頁(content_page.go)公開讀取——城市主題介紹頁(九份/京都/
	// 台南等)本身的頁面會打這支,無需登入,只回傳 status=published 的
	// 內容(見 handlePublicContentPage 的完整說明)。管理端點(新增/編輯/
	// 發布)在下面 internalMux 區塊,走 /internal/maintenance/content-pages/*。
	mux.HandleFunc("GET /v1/content-pages/{slug}", s.handlePublicContentPage)

	// 部落格文章(content_page.go 的 handlePublicBlogArticle)公開讀取——
	// 跟上面 /v1/content-pages/{slug} 同一種「無需登入、只回已發布內容」
	// 的端點,但多了 handle→UserID 的解析這一步:部落格文章的 slug
	// 命名空間是「每個使用者各自的」,URL 上只有人類可讀的 handle,
	// 需要先查 blog_profiles 把 handle 解析成 UserID,才能查到正確的
	// 那一篇文章(見 handlePublicBlogArticle 的完整說明)。
	mux.HandleFunc("GET /v1/blog/{handle}/{slug}", s.handlePublicBlogArticle)

	// 範例行程(itinerary_page.go)公開讀取——「AI 排過的主題行程展示」
	// /itineraries 清單頁跟詳細頁會打這兩支,無需登入,只回傳
	// status=published 的內容,理由同上方 content-pages 公開端點。管理
	// 端點(新增/編輯/發布)在下面 internalMux 區塊,走
	// /internal/maintenance/itinerary-pages/*。
	mux.HandleFunc("GET /v1/itinerary-pages", s.handlePublicItineraryPageList)
	mux.HandleFunc("GET /v1/itinerary-pages/{slug}", s.handlePublicItineraryPage)

	// 依一批 photoId 批次查出可公開顯示的圖片資訊(blog_photo.go 的
	// handlePublicBlogPhotosByIDs 完整說明)——供前端把已發布文章內容裡
	// 存的 photoId 穩定識別碼展開成實際圖片網址。刻意掛在 /public/*
	// (而非上面的 /v1/blog/{handle}/{slug} 旁邊),不檢查登入身分:這是
	// 讀取公開已發布內容的延伸,跟下面需要登入的 /v1/blog/photos/* 系列
	// (使用者管理自己的圖片庫,含草稿/未發布圖片)服務情境完全不同。
	mux.HandleFunc("GET /public/blog/photos", s.handlePublicBlogPhotosByIDs)

	// 使用者上傳部落格配圖(blog_photo.go 的完整說明)——需要登入的一般
	// 功能,掛在 /v1/*(不是 /internal/*,那個命名空間專給 CLI 維運
	// 端點用,見 blog_photo.go 開頭的完整說明)。路徑刻意用
	// /v1/blog/photos/*(而非 /v1/blog/{handle}/photos/*)——這批端點
	// 操作的是「目前登入者自己的圖片」,身分完全來自 JWT(s.userFor),
	// 不需要也不該讓呼叫端在網址上指定 handle(那是給公開讀取端點用的
	// 人類可讀識別字,操作自己的資源不需要繞這一層)。
	mux.HandleFunc("POST /v1/blog/photos/upload-url", s.handleBlogPhotoUploadURL)
	mux.HandleFunc("GET /v1/blog/photos", s.handleBlogPhotoList)
	mux.HandleFunc("POST /v1/blog/photos/{photoId}/complete", s.handleBlogPhotoComplete)
	mux.HandleFunc("POST /v1/blog/photos/{photoId}/retry", s.handleBlogPhotoRetry)
	mux.HandleFunc("PATCH /v1/blog/photos/{photoId}/focal", s.handleBlogPhotoFocal)
	mux.HandleFunc("PATCH /v1/blog/photos/{photoId}/note", s.handleBlogPhotoNote)
	mux.HandleFunc("PATCH /v1/blog/photos/{photoId}/rating", s.handleBlogPhotoRating)
	mux.HandleFunc("DELETE /v1/blog/photos/{photoId}", s.handleBlogPhotoDelete)

	// 部落客公開身份設定(blog_profile.go 的完整說明)——查詢/設定登入者
	// 自己的 handle + 頭像網址,同樣需要登入、掛在 /v1/*。
	mux.HandleFunc("GET /v1/blog/profile", s.handleBlogProfileGet)
	mux.HandleFunc("POST /v1/blog/profile", s.handleBlogProfileSet)

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
	// 最早的三支(place-details/place-photo-assets/attractions)都有授權
	// 限制查詢範圍;2026-10 之後新增的 plan-ai 五支(place-search/
	// attraction-search/place-details-any/chat/chat-reply)沒有白名單,
	// 改靠 IP 節流把關(見各自的說明)。最早三支的限制:前兩支要求
	// placeID 必須是已建檔的 attraction 才放行,attractions 則限制在城市
	// 白名單內(見
	// publicAttractionsCityAllowlist 的完整說明)。這不是一般性「免認證」
	// 的路由群組,新增其他公開端點時應各自評估是否也需要類似的範圍限制,
	// 不能直接比照這裡的寫法就假設安全。
	//
	// 2026-09:原本這個群組還有 plan-ai 用的五支查詢端點(place-search/
	// attraction-search/place-details-any/attraction/{id}/transit-estimate)
	// ——那批沒有白名單可限制範圍(可以查任意地名/placeID),只靠拒絕型
	// 限流把關,等於讓任何訪客都能消耗 Google Places 計費配額。已全部搬到
	// 需登入的 /internal/geo/plan-ai/*(見下方 internalMux 的該區塊)。
	//
	// 2026-10:其中 place-search/attraction-search 兩支(/ai-plan 展示頁
	// 排行程的最低需求,見 web/src/planning/preview/LivePlanLayer.tsx
	// 開頭 TODO 第1項的完整說明)重新開放為公開端點——/ai-plan 展示頁
	// 讓訪客直接體驗真實 AI 對話排行程,訪客沒有 JWT,原本掛在需登入的
	// /internal/geo/plan-ai/* 會讓這兩支工具呼叫一律 401、排不出任何
	// 站點。這兩支本來就沒有白名單可限制查詢範圍(可查任意地名/
	// 座標附近),2026-09 拿掉公開版主要是因為「只靠拒絕型限流把關」不足以
	// 防濫用——這次重新開放改用 IP 為 key 的節流(withGeoQueryIPThrottle/
	// throttleGeoQueryByIP,見兩者的完整說明)疊加在 handler 本身既有的
	// per-user 節流之上,理由是訪客沒有登入身份、per-user 節流對訪客
	// 一律退化成共用同一把 s.guestUser 配額,幾乎沒有保護效果。place-
	// details-any 這一支原本也刻意只留在 /internal/geo/plan-ai/*,但實測
	// 發現 AskPage.tsx 顯示候選卡片(名稱/照片/attractionId)一定會呼叫
	// 這支端點補完整資料,不是可有可無的加值功能——判斷有誤,這其實也是
	// /ai-plan 展示頁排行程的最低需求之一(訪客呼叫 search_attraction 查
	// 到候選、open_ask_page 顯示候選卡片這整段流程缺了它就只能看到空白
	// 候選卡片)。改成比照 place-search/attraction-search 的既有做法開放
	// 為公開端點:同樣只靠拒絕型限流把關(沒有白名單可限制查詢範圍,可查
	// 任意 placeID),疊加 withGeoQueryIPThrottle。attraction/{id}/
	// transit-estimate 這兩支目前確認的展示頁流程不需要查詢,仍留在
	// /internal/geo/plan-ai/*,不一併擴大開放範圍。
	mux.HandleFunc("GET /public/geo/plan-ai/place-search", withGeoQueryIPThrottle(s, s.handlePublicGeoPlaceSearch))
	mux.HandleFunc("GET /public/geo/plan-ai/attraction-search", withGeoQueryIPThrottle(s, s.handlePublicGeoAttractionSearch))
	mux.HandleFunc("GET /public/geo/plan-ai/place-details-any", withGeoQueryIPThrottle(s, s.handlePublicGeoPlaceDetailsAny))
	// POST /public/plan-ai/chat、/public/plan-ai/chat/reply——2026-10 新增
	// (使用者明確要求「/internal/plan-ai/chat 要沒登入時也可以做」):
	// /ai-plan 展示頁(web/src/planning/preview/LivePlanLayer.tsx)讓訪客
	// 體驗真實 AI 對話排行程,訪客沒有 JWT,掛在 internalAuth 底下的
	// /internal/plan-ai/chat 會讓這支呼叫一律 401(internalAuth 本身在
	// 沒有合法 Authorization header 時就直接擋下,見該中間件的完整
	// 說明,根本不會進到 handler)。複用同一支 handlePlanAiChat/
	// handlePlanAiChatReply(見兩者開頭的完整說明,內部用 userOrGuestFor
	// 同時支援已登入使用者與帶合法格式 X-Guest-Id 的訪客),這裡只是另外
	// 掛一份不經過 internalAuth 的公開路由,疊加以來源 IP 為 key 的節流
	// (withPlanAiChatIPThrottle,見該函式的完整說明)。
	mux.HandleFunc("POST /public/plan-ai/chat", withPlanAiChatIPThrottle(s, s.handlePlanAiChat))
	mux.HandleFunc("POST /public/plan-ai/chat/reply", withPlanAiChatIPThrottle(s, s.handlePlanAiChatReply))
	mux.HandleFunc("GET /public/geo/place-details", s.handlePublicGeoPlaceDetails)
	// GET /public/geo/place-photo-assets:handlePublicGeoPlacePhotoAssets
	// 的免登入版(見該函式的完整說明)——純讀 photo_assets,不觸發點擊
	// 計數/漸進補圖決策,供前端「查完沒圖,原地重試幾次」的情境使用
	// (fetchPublicGeoPlacePhotoAssets),授權機制對齊上一行的
	// place-details。2026-09:這支路由先前漏掛,導致該重試功能在正式
	// 環境一律 404(handler 本身已實作/測試完成,只是沒有接上 mux)。
	mux.HandleFunc("GET /public/geo/place-photo-assets", s.handlePublicGeoPlacePhotoAssets)
	mux.HandleFunc("GET /public/geo/attractions", s.handlePublicGeoAttractions)
	// GET /public/geo/attraction/{id}:handlePublicGeoAttractionByID 的
	// 真正公開掛載點——2026-10 新增。這支 handler 原本只掛在
	// internalMux 的 /internal/geo/plan-ai/attraction/{id}(服務 /plan-ai
	// 試作頁的 search_attraction/add_attraction 工具,見該端點註冊處的
	// 完整說明),會走 internalAuth 中間件強制要求 JWT,即使 handler 本身
	// 命名與其舊有註解都宣稱「免登入」——這是命名與實際掛載路徑不符造成
	// 的文件債(handler 邏輯本身確實不含任何需要登入身分的操作,純查表,
	// 見 geo_plan_ai.go handlePublicGeoAttractionByID 的完整說明)。
	// web/src/itineraries/(精選行程展示頁,訪客無登入)需要依 attractionId
	// 查詢已建檔地標的 googlePhotoUrls(見 useStopAttractionDetails.ts 的
	// 完整說明,取代原本把查詢結果的照片網址寫死存進行程 content JSON 的
	// 做法),故補上這個真正公開、不需要 JWT 的掛載點,複用同一支 handler
	// 的邏輯,不重寫第二份。舊的 internalMux 掛載點維持不變,/plan-ai
	// 既有呼叫端不受影響。
	mux.HandleFunc("GET /public/geo/attraction/{id}", s.handlePublicGeoAttractionByID)

	// GET /public/geo/attractions/nearby-only、GET /public/geo/attractions/
	// nearby——2026-10 新增,複製自需登入的
	// /internal/geo/attractions/nearby-only、/internal/geo/attractions/
	// nearby(見 handleGeoAttractionsOnlyNearby/handleGeoAttractionsNearby
	// 的完整說明),複用同一支 handler,不是重寫第二份邏輯。
	//
	// 風險分級不同,故套用不同的節流:
	//   - nearby-only 只查 store.ListAttractionsNearby(人工建檔資料庫,
	//     免費,不觸發任何外部 API),是這批裡風險最低的,沿用現有的
	//     withGeoQueryIPThrottle(300 次/60 秒,見該函式與
	//     geoQueryIPThrottleMaxCalls 的完整說明),不需要另外收緊。
	//   - nearby 內部會呼叫 fetchNearbyHotels 即時查 Google Places Nearby
	//     Search(計費),風險等級對齊 plan-ai 那組會觸發計費 API 的端點,
	//     改用新增的 withGeoAttractionsIPThrottle(30 次/60 秒,見
	//     geoAttractionsIPRateLimiter 欄位的完整說明)。
	//
	// 注意:GET /public/geo/attractions 這個路徑已被上面的
	// handlePublicGeoAttractions(城市白名單限制查詢範圍,見該函式的完整
	// 說明)佔用——是完全不同的 handler,不是本次要公開的
	// handleGeoAttractions(/internal/geo/attractions 的核心邏輯,
	// city 參數任意、無白名單限制)。兩者路徑衝突,未比照這裡的模式新增
	// handleGeoAttractions 的公開掛載點,需要另外決定路徑或處理方式。
	mux.HandleFunc("GET /public/geo/attractions/nearby-only", withGeoQueryIPThrottle(s, s.handleGeoAttractionsOnlyNearby))
	mux.HandleFunc("GET /public/geo/attractions/nearby", withGeoAttractionsIPThrottle(s, s.handleGeoAttractionsNearby))

	// 註:AI 規劃時間軸的「模擬推論 WebSocket」(handlePlanSimWS)不在這個
	// 分支上——它只服務試作原型(web/src/plan-ai/AIPlanTimelinePage.tsx),
	// 不是正式功能(web/src/planning/panel/TripPlanPage.tsx)的一部分,正式功能
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
	// 完整說明),同時服務正式功能(web/src/planning/panel/TripPlanPage.tsx)與
	// 試作原型(web/src/plan-ai/AIPlanTimelinePage.tsx)——兩者共用
	// web/src/planning/conversation/tools.ts 這層 onagent 工具資料層,由它
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
	//
	// 2026-10:其中 place-search/attraction-search/place-details-any 三支
	// 後來又重新開放為公開端點(見上方 mux 區塊 /public/geo/plan-ai/* 的
	// 完整說明),這裡的 /internal/geo/plan-ai/* 版本保留給已登入使用者
	// 走(正式功能 TripPlanPage.tsx 的 ClientConfig 帶 token 時固定打
	// /internal/*,見 web/src/api.ts fetchPlanAi* 系列函式的既有模式),
	// 兩條路徑背後是同一個 handler,只是訪客/登入分流,不是重複定義。
	internalMux.HandleFunc("GET /internal/geo/plan-ai/place-search", s.handlePublicGeoPlaceSearch)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/attraction-search", s.handlePublicGeoAttractionSearch)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/place-details-any", s.handlePublicGeoPlaceDetailsAny)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/attraction/{id}", s.handlePublicGeoAttractionByID)
	internalMux.HandleFunc("GET /internal/geo/plan-ai/transit-estimate", s.handlePublicGeoTransitEstimate)
	internalMux.HandleFunc("POST /internal/plan-ai/chat", s.handlePlanAiChat)
	internalMux.HandleFunc("POST /internal/plan-ai/chat/reply", s.handlePlanAiChatReply)

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
	// rate-limits——列出/修改可設定的限流規則(見兩支 handler 的完整
	// 說明)。掛在 maintenance 命名空間:呼叫者是 tripace-cli 的
	// rate-limit 指令,不是產品前端。
	internalMux.HandleFunc("GET /internal/maintenance/rate-limits", s.handleMaintenanceRateLimitList)
	internalMux.HandleFunc("PATCH /internal/maintenance/rate-limits/{endpoint}", s.handleMaintenanceRateLimitSet)
	// field-masks——列出/修改 Google Places 查詢要取哪些欄位(見兩支
	// handler 的完整說明)。跟 rate-limits 同一個命名空間與呼叫者:
	// 兩者都是成本設定,由 tripace-cli 或後台操作,不是產品前端。
	internalMux.HandleFunc("GET /internal/maintenance/field-masks", s.handleMaintenanceFieldMaskList)
	internalMux.HandleFunc("PATCH /internal/maintenance/field-masks/{key}", s.handleMaintenanceFieldMaskSet)
	// geo-settings——列出/修改可線上調整的數值設定(照片最大張數、照片
	// 過期週期,見 maintenance_geo_settings.go)。同一個命名空間與呼叫者:
	// 成本設定,由 tripace-cli 操作,不是產品前端。
	internalMux.HandleFunc("GET /internal/maintenance/geo-settings", s.handleMaintenanceGeoSettingList)
	internalMux.HandleFunc("PATCH /internal/maintenance/geo-settings/{key}", s.handleMaintenanceGeoSettingSet)
	internalMux.HandleFunc("GET /internal/maintenance/attractions/query", s.handleMaintenanceAttractionQuery)
	internalMux.HandleFunc("DELETE /internal/maintenance/attractions/{id}", s.handleMaintenanceAttractionDelete)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/coords", s.handleMaintenanceAttractionUpdateCoords)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/field", s.handleMaintenanceAttractionUpdateField)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/place-id", s.handleMaintenanceAttractionUpdatePlaceID)
	internalMux.HandleFunc("PATCH /internal/maintenance/attractions/{id}/theme", s.handleMaintenanceAttractionUpdateTheme)
	// 主題介紹頁/部落格文章管理端點(content_page.go)——只給 tripace-cli
	// content-page 系列指令用,公開讀取在上面 mux 區塊的
	// /v1/content-pages/{slug}。這組端點依請求是否標示 official 決定
	// ownerID 用空字串(官方/城市介紹頁)還是登入者自己的 UserID(部落格
	// 發文),見 content_page.go 開頭 ownerID 身份切換的完整說明。
	internalMux.HandleFunc("POST /internal/maintenance/content-pages", s.handleMaintenanceContentPageCreate)
	internalMux.HandleFunc("GET /internal/maintenance/content-pages", s.handleMaintenanceContentPageList)
	internalMux.HandleFunc("GET /internal/maintenance/content-pages/{slug}", s.handleMaintenanceContentPageGet)
	internalMux.HandleFunc("PUT /internal/maintenance/content-pages/{slug}", s.handleMaintenanceContentPageUpdate)
	internalMux.HandleFunc("PATCH /internal/maintenance/content-pages/{slug}/publish", s.handleMaintenanceContentPagePublish)
	internalMux.HandleFunc("DELETE /internal/maintenance/content-pages/{slug}", s.handleMaintenanceContentPageDelete)
	// 範例行程管理端點(itinerary_page.go)——只給 tripace-cli
	// itinerary-page 系列指令用,公開讀取在上面 mux 區塊的
	// /v1/itinerary-pages。固定要求呼叫者是管理員(見
	// requireItineraryPageAdmin 的完整說明),沒有 content-page 那種
	// official/使用者自己雙重身份切換——範例行程目前只有官方命名空間
	// 一種情境。
	internalMux.HandleFunc("POST /internal/maintenance/itinerary-pages", s.handleMaintenanceItineraryPageCreate)
	internalMux.HandleFunc("GET /internal/maintenance/itinerary-pages", s.handleMaintenanceItineraryPageList)
	internalMux.HandleFunc("GET /internal/maintenance/itinerary-pages/{slug}", s.handleMaintenanceItineraryPageGet)
	internalMux.HandleFunc("PUT /internal/maintenance/itinerary-pages/{slug}", s.handleMaintenanceItineraryPageUpdate)
	internalMux.HandleFunc("PATCH /internal/maintenance/itinerary-pages/{slug}/publish", s.handleMaintenanceItineraryPagePublish)
	internalMux.HandleFunc("DELETE /internal/maintenance/itinerary-pages/{slug}", s.handleMaintenanceItineraryPageDelete)
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
// note})與 web/tools/clienttools.yaml 的 trip_entry_add/trip_entry_update
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
// 只更新請求帶了值的欄位,未帶到的欄位維持原值。
//
// 時間欄位直接收 ISO 8601 timestamp(而非 tripsvc.UpdateEntryInput 那套
// 給 CLI 用的「日期時刻字串」接口)——這個 handler 對應的正是
// model.Entry 本身(GET 這個資源時回的就是 startAt/endAt/tz/allDay,PATCH
// 用同一種格式回填,讀寫契約一致,前端不需要在兩種時間表示法之間轉換)。
// startAt 為 nil 時代表不更新任何時間欄位(呼應 store.EntryTimeUpdate 的
// 逐欄位語意);要更新時 startAt 必填,tz 留空由 store.UpdateEntry 呼叫端
// (這裡)決定要不要補 DefaultTimeZone()。
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
		Title    string         `json:"title"`
		StartAt  *time.Time     `json:"startAt"`
		EndAt    *time.Time     `json:"endAt"`
		TZ       string         `json:"tz"`
		AllDay   *bool          `json:"allDay"`
		Location string         `json:"location"`
		Note     string         `json:"note"`
		Kind     string         `json:"kind"`
		Detail   map[string]any `json:"detail"`
	}
	if !decode(w, r, &body) {
		return
	}

	var tu store.EntryTimeUpdate
	if body.StartAt != nil {
		tz := body.TZ
		if tz == "" {
			tz = store.DefaultTimeZone().String()
		}
		allDay := false
		if body.AllDay != nil {
			allDay = *body.AllDay
		}
		tu = store.EntryTimeUpdate{StartAt: body.StartAt, EndAt: body.EndAt, TZ: &tz, AllDay: &allDay}
	}

	if err := s.store.UpdateEntry(entryID, body.Title, tu, body.Location, body.Note, body.Kind, body.Detail); err != nil {
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
