// Package geo 封裝 Google Places API (New)（Text Search），
// 輸入地點名稱，回傳候選地點清單（含經緯度）。
package geo

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/pexels"
)

// defaultGateway 是這個 process 內所有 geo.Client(除非透過 NewWithGateway
// 明確指定其他 Gateway)共用的一份請求派送器——所有對 Google Places/
// Geocoding API 的呼叫,不論來自 HTTP handler、CLI 子命令、或 LLM 工具,
// 最終都會經過同一份併發數/間隔限制,達到「整個後端對 Google 的呼叫總量
// 被夾住」的效果。這必須是單例、而非每次 geo.New() 各自建立一份——見
// apigateway 套件開頭的說明第 3 點,若每個 HTTP request 各自擁有獨立的
// 節流狀態,多個並發使用者請求之間完全不會互相排隊,達不到節流目的。
//
// 用 sync.Once 延遲建立(而非套件初始化時的全域變數),讓
// ConfigureDefaultGateway 有機會在第一次真正使用前,把讀到的環境變數設定
// 套進去——若用一般全域變數,呼叫端必須保證 ConfigureDefaultGateway 在
// 任何 geo.New() 呼叫之前執行,順序脆弱且容易在未來新增呼叫點時不小心
// 弄錯順序。
var (
	defaultGatewayOnce   sync.Once
	defaultGatewayConfig = apigateway.DefaultConfig()
	defaultGatewayLogger apigateway.CallLogger
	defaultGatewayValue  *apigateway.Gateway
)

// ConfigureDefaultGateway 設定預設 Gateway 的節流參數與記錄器——必須在
// process 內第一次呼叫 geo.New() 之前呼叫才會生效(典型用法是在
// cmd/server/main.go 開頭呼叫一次)。重複呼叫、或在 defaultGateway 已經
// 被建立之後才呼叫,不會有任何效果(sync.Once 只執行一次真正的建立動作)
// ——這是刻意的簡化,這個設定值預期是啟動時讀一次環境變數就固定下來,
// 不需要支援執行期動態調整。
func ConfigureDefaultGateway(cfg apigateway.Config, logger apigateway.CallLogger) {
	defaultGatewayConfig = cfg
	defaultGatewayLogger = logger
}

// RateLimitConfig 是 ConfigureDefaultGatewayRateLimit 的參數——只涵蓋
// "places.get"(地點資訊查詢)與 "places.photoMedia"(地點照片下載)這
// 兩個 endpoint,理由見該函式的說明:這兩個是目前唯一評估過需要拒絕型
// 限流保護的呼叫(對應「單點地點介紹」這條路徑,見
// server/internal/api/geo_outline.go 的 handleGeoPlaceDetails 一般模式)。
// "places.searchText"(城市搜尋/文字查詢)、"places.searchNearby"(附近
// 景點/飯店查詢)等其餘 endpoint 刻意不套用這個 RateLimiter,繼續只受
// Gateway 既有的排隊節流(MaxConcurrency/MinInterval)保護,不受這次改動
// 影響——這幾個 endpoint 目前沒有像「單點地點介紹」那樣被評估出明確的
// 拒絕型限流需求,不需要跟著一起被限流,避免不必要地收緊尚未出問題的
// 呼叫路徑。
type RateLimitConfig struct {
	// PlaceGetWindow/PlaceGetMaxCalls 是 "places.get"(地點資訊——對應
	// geo.Client.GetPlaceDetails 與 ListPlacePhotoRefs,見
	// placeGetEndpoint 對兩者共用同一個 endpoint 字串的說明)的視窗長度與
	// 視窗內上限次數。
	PlaceGetWindow   time.Duration
	PlaceGetMaxCalls int
	// PhotoMediaWindow/PhotoMediaMaxCalls 是 "places.photoMedia"(地點
	// 照片——Google Photo Media,依張數計費的圖片下載,對應
	// geo.Client.PhotoDataURI/PhotoDataURIUnrestricted)的視窗長度與視窗
	// 內上限次數。
	//
	// 這兩個 endpoint 各自獨立設定視窗長度(不共用同一份)——地點照片
	// 下載是依張數計費、風險最高的一種呼叫,合理的節奏遠比純文字查詢
	// 稀疏,故給它一個明顯更長的視窗搭配更少的次數(見
	// cmd/server/main.go 的預設值:地點照片 10 分鐘視窗內最多 1 次,
	// 地點資訊 10 秒視窗內最多 1 次),而不是用同一個視窗長度、只靠
	// 次數多寡拉開差異。
	PhotoMediaWindow   time.Duration
	PhotoMediaMaxCalls int
}

// placeGetEndpoint/photoMediaEndpoint 是這兩個受限 endpoint 使用的字串,
// 對齊 internal/geo/places.go 呼叫 gateway.Do 時實際傳入的字面值(見各自
// 呼叫點)——ConfigureDefaultGatewayRateLimit 用這兩個常數對 RateLimiter
// 設定專屬上限,程式碼裡只有這一處需要跟實際呼叫點的字面值保持一致,不
// 需要這個套件對外公開一份「合法 endpoint 清單」這種更重的抽象。
//
// placeGetEndpoint 同時對應 GetPlaceDetails(查名稱/地址/評分/簡介)與
// ListPlacePhotoRefs(只查 photos[] 長度,用於漸進補圖判斷是否需要重新
// 確認 target)——兩者在 internal/geo/places.go 裡呼叫 gateway.Do 時
// 都寫死傳入 "places.get"(見稽核報告
// docs/audit-place-photo-cost-control-2026-09.md 問題 1 的既有記錄)。
// 這裡刻意不為 ListPlacePhotoRefs 另外拆一個獨立的 endpoint 字串(例如
// "places.photoRefs")來精確對應「地點照片 vs 地點資訊」的語意——理由:
//  1. Google 端實際計費層級上,ListPlacePhotoRefs 走的是 Place Details
//     (Get)API,只是 field mask 縮小成只取 photos 欄位,並非 Photo
//     Media(下載圖片位元組)那個真正依張數計費的端點,它查的是「這個
//     地點的照片目錄有幾張」的中繼資料,不是圖片內容本身——語意上更
//     接近「查地點資訊(這次只挑了 photos 這個子集)」而非「下載照片」,
//     跟 places.photoMedia 混為一談反而不準確。
//  2. 改動這個字串會連動影響 apigateway.CallLogger 現有的記錄分類(見
//     CallLogger.LogCall 的 endpoint 參數,寫入 DB 供事後查記錄用)——
//     現有記錄資料與任何依 endpoint 字串做的既有查詢/報表都會被拆成
//     兩種字串,是超出這次限流任務範圍的資料結構變動,不宜順手夾帶。
//  3. 使用者要求的兩個分組是「地點資訊」vs「地點照片」,ListPlacePhotoRefs
//     歸進「地點資訊」(place.get)這組同時符合實際計費類別與現狀最小改動
//     的原則,是合理且刻意的選擇,不是因為疏漏才維持共用。
const (
	placeGetEndpoint   = "places.get"
	photoMediaEndpoint = "places.photoMedia"
)

// ConfigureDefaultGatewayRateLimit 額外設定預設 Gateway 依 endpoint 拒絕
// 超額呼叫的 RateLimiter(見 apigateway.RateLimiter 的完整說明)——獨立
// 於 ConfigureDefaultGateway 是刻意的,呼叫端(cmd/server/main.go)的
// 兩組參數(MaxConcurrency/MinInterval 排隊節流 vs. 這裡的視窗長度/上限
// 拒絕型限流)在概念上是兩件不同的事,分開設定較不容易讓呼叫端誤以為
// 兩者是同一組參數的不同表示法。同樣必須在 process 內第一次呼叫
// geo.New() 之前呼叫才會生效,理由與 ConfigureDefaultGateway 相同(底層
// 共用同一個 defaultGatewayConfig,由 defaultGateway 的 sync.Once 延遲
// 建立)。
//
// 只對 placeGetEndpoint/photoMediaEndpoint 這兩個 key 設定規則(見
// RateLimitConfig 的說明)——底層 apigateway.RateLimiter 的設計是「只有
// 明確透過 SetLimitForKey 設定過的 key 才會被限流,其餘 key 一律直接
// 放行」(見該型別的完整說明),故這裡不呼叫 SetLimitForKey 的其他
// endpoint(如 "places.searchText"/"places.searchNearby")自然完全不受
// 這個 RateLimiter 影響,繼續只受 Gateway 既有的排隊節流保護,不需要
// 額外的判斷邏輯排除它們。
func ConfigureDefaultGatewayRateLimit(cfg RateLimitConfig) {
	rl := apigateway.NewRateLimiter()
	rl.SetLimitForKey(placeGetEndpoint, cfg.PlaceGetWindow, cfg.PlaceGetMaxCalls)
	rl.SetLimitForKey(photoMediaEndpoint, cfg.PhotoMediaWindow, cfg.PhotoMediaMaxCalls)
	defaultGatewayConfig.RateLimiter = rl
}

// photosEnabled 是全域開關,控制要不要真的向 Google Photo Media API
// 下載照片(見 downloadPhotoBytes 的說明)——預設關閉(false),必須由
// 呼叫端明確呼叫 SetPhotosEnabled(true) 才會真的開始抓照片。這是刻意
// 保守的預設值:Photo Media 是計費項目,依張數計費,關閉時所有呼叫端
// (SearchAttractions/SearchNearby/SearchAttractionWithPhoto/
// GetPlaceDetails/SyncPlacePhotos)仍會正常運作、正常回傳其餘欄位,只是
// 拿不到照片,不是整個查詢失敗——理由同 c.cache 為 nil 時的既有降級
// 行為模式。已經快取過的照片不受這個開關影響,仍會照常從 photo_cache
// 讀出(見 fetchPhotoAsDataURI 的快取檢查在下載動作之前),只有「快取
// 未命中、需要真的向 Google 下載新照片」這個動作會被擋下。
var photosEnabled = false

// SetPhotosEnabled 設定 photosEnabled(見該變數的完整說明)。典型用法是
// process 啟動時讀一次環境變數(如 cmd/server/main.go 的
// GOOGLE_PLACES_FETCH_PHOTOS)呼叫一次,之後整個 process 生命週期共用
// 這個設定——跟 ConfigureDefaultGateway 是同一種「啟動時設定一次,不
// 支援執行期動態調整」的設計,理由一致。
func SetPhotosEnabled(enabled bool) {
	photosEnabled = enabled
}

// PhotosEnabled 回報目前是否已透過 SetPhotosEnabled(true) 開啟 Google
// Photo Media 下載——供其他套件(如 onagenttools 的 Pexels fallback 判斷)
// 讀取這個開關,不需要各自重複讀一次 GOOGLE_PLACES_FETCH_PHOTOS 環境變數。
func PhotosEnabled() bool {
	return photosEnabled
}

func defaultGateway() *apigateway.Gateway {
	defaultGatewayOnce.Do(func() {
		defaultGatewayValue = apigateway.New(&http.Client{Timeout: 5 * time.Second}, defaultGatewayConfig, defaultGatewayLogger)
	})
	return defaultGatewayValue
}

// callerCtxKey 是 context.WithValue 用的私有 key 型別——避免與其他套件
// 的 context key 衝突(Go 慣例:context key 用未匯出的具名型別,不要用
// string/int 這種容易撞名的裸型別)。
type callerCtxKey struct{}

// WithCaller 把「是誰觸發這次 Google API 呼叫」的識別字串放進 context,
// 供 Gateway 記錄呼叫來源用(見 apigateway.CallLogger)。呼叫端(HTTP
// handler/CLI 子命令/wanttools 工具)應該在呼叫任何 geo.Client 方法之前
// 呼叫這個函式包一次 ctx,例如
// WithCaller(ctx, "handleGeoAttractionsNearby")——建議直接用 handler/
// 子命令/工具的函式名稱當識別字串,方便日後對照程式碼找到呼叫點。
// 未呼叫過這個函式的 ctx,記錄時 caller 欄位會是 "unknown"(見
// callerFromContext),不是必填、不會因為忘記設定而導致呼叫失敗。
func WithCaller(ctx context.Context, caller string) context.Context {
	return context.WithValue(ctx, callerCtxKey{}, caller)
}

func callerFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(callerCtxKey{}).(string); ok && v != "" {
		return v
	}
	return "unknown"
}

// pathCtxKey 是 context.WithValue 用的私有 key 型別,理由同 callerCtxKey。
type pathCtxKey struct{}

// WithPath 把「觸發這次 Google API 呼叫的我方 API 路徑」放進 context,
// 供 Gateway 記錄用(見 apigateway.CallLogger 對 path 欄位的說明)——跟
// WithCaller 是兩個獨立維度:caller 是程式碼裡的識別字串(如
// "handleGeoAttractionsNearby"),path 是對外曝露的路由(如
// "/internal/geo/attractions/nearby")。HTTP handler 通常直接傳
// r.URL.Path;若該路由含路徑變數(如 {id}),應傳註冊時的 pattern 字串而
// 非字面路徑,避免同一條路由因為不同 ID 被統計成一堆各自獨立的資料列
// (見 entry_geocode.go/maintenance.go 呼叫端的說明)。未呼叫過這個函式
// 的 ctx,記錄時 path 欄位為空字串(例如 LLM 工具呼叫沒有對應的單一
// REST path,見 wanttools 呼叫端的說明)——這是刻意的,不強行湊一個
// 不準確的值。
func WithPath(ctx context.Context, path string) context.Context {
	return context.WithValue(ctx, pathCtxKey{}, path)
}

func pathFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(pathCtxKey{}).(string); ok {
		return v
	}
	return ""
}

// defaultLanguageCode 是這個套件對 Google Places API 所有請求固定使用的
// 語言——專案介面語言只有繁中,回傳的地名/地址盡量用中文(實際仍依
// Google 該地點的翻譯資料完整度而定,非所有地點都有中文譯名)。
//
// 這是單一事實來源,不要在個別函式裡直接寫死 "zh-TW" 字串——Text
// Search/Nearby Search(POST,參數放 JSON body)與 Place Details(GET,
// 沒有 body,必須放進查詢字串)兩種端點形狀不同,若各自手動組請求容易
// 漏加,先前就實際發生過 GetPlaceDetails 漏放這個參數、導致查回的名稱
// /地址一律是英文的 bug(跟其餘用 Text/Nearby Search 的端點顯示中文不
// 一致)。改用 newPlacesSearchRequest/newPlaceDetailsRequest 這兩個
// helper 組請求,由 helper 統一負責帶上這個參數,呼叫端不需要、也不應該
// 自己記得加。
const defaultLanguageCode = "zh-TW"

// 新版 Places API (New) 的 Text Search 端點(POST)。
// 舊版為 maps.googleapis.com/maps/api/place/textsearch/json(GET),已於 2026 遷移至此。
const placesURL = "https://places.googleapis.com/v1/places:searchText"

// fieldMask 指定新版 API 要回傳哪些欄位(新版必填 header X-Goog-FieldMask,
// 不給會回 400)。取顯示名稱、格式化地址、經緯度、id——id 屬於
// Essentials 級(免費,不加價),供呼叫端(handleGeoGeocode)拿去換發
// GetPlaceDetails,查詢完整資訊(含照片),理由見該函式的說明。
const fieldMask = "places.displayName,places.formattedAddress,places.location,places.id"

// nearbyURL 是 Places API (New) 的 Nearby Search 端點(POST),依座標+半徑找附近地點。
const nearbyURL = "https://places.googleapis.com/v1/places:searchNearby"

// placeDetailsFieldMask 供 GetPlaceDetails 用——跟 districtFieldMask 取同一組
// Pro 級欄位(rating/photos/editorialSummary),供「點擊 Google 原生 POI 圖標」
// 這個情境即時查單一地點的詳細資訊、填進自訂資訊欄用(見
// server/internal/api/geo_outline.go 的 handleGeoPlaceDetails)。不像
// districtFieldMask 額外取 addressComponents——這裡只查單一已知地點,不需要
// 反推它屬於哪個行政區。
const placeDetailsFieldMask = "displayName,formattedAddress,location,rating,photos,editorialSummary"

// nearbyFieldMask 只取 Essentials 級欄位(displayName/formattedAddress/location/
// primaryType),API 呼叫成本最低。rating/userRatingCount 屬 Pro 級(較貴),
// 目前不取;若之後需要依評分排序,再評估是否值得多付費升級 field mask。
const nearbyFieldMask = "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType"

// districtFieldMask 供 SearchCityAttractions 用:額外取 addressComponents,才能從
// 每筆景點結果反推它屬於哪個行政區/次分區(sublocality),藉此把一批景點
// 依所在區域分組、算出各區重心座標。rating 用來在同區內挑「最具代表性」
// 的地點當地標圖片來源;photos 取該地點的相片參考(id),供之後組
// Photo Media API 網址用;editorialSummary 是 Google 編輯過的地點介紹,
// 拿代表性地標的簡介當該區的白話簡介(不用 LLM 生成)。這幾個欄位皆屬
// Pro 級,呼叫成本高於 Search/SearchNearby 用的 Essentials 級。
const districtFieldMask = "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.rating,places.photos,places.editorialSummary"

// PhotoCache 是圖片快取的抽象介面——geo 套件本身不依賴 store(避免套件
// 邊界耦合),由呼叫端(api 層,持有 *store.Store)實作並透過 SetCache
// 注入。未注入(nil)時 fetchPhotoAsDataURI 照舊每次都直接向 Google 查詢,
// 行為與加這層快取之前完全相同——這是刻意的漸進式設計,不是每個
// geo.New() 呼叫端都需要接上快取(例如 cmd/cli 的一次性查詢、
// wanttools 的 LLM 工具呼叫,重複查詢機率低,接上快取的效益不大)。
//
// 鍵是 placeID(穩定、不會過期的地點識別碼)+ photoIndex(該地點第幾張
// 照片,0-based),不是 photo resource name(Google Maps Platform Terms
// of Service 3.2.3(b)「No Caching」明確禁止長期保存 photo name——它可能
// 過期,且條款要求每次都該從新鮮的 Details/Nearby Search/Text Search
// 回應取得,不能存起來跨請求重用)。圖片內容本身(data URI)存放不受這條
// 限制,故只把「拿來換圖片的識別字」從快取鍵徹底移除,改用 placeID 這個
// 穩定識別碼 + 自訂序數定位快取項目——fetchPhotoAsDataURI 內部依然需要
// photoRef 去跟 Google 換圖(快取未命中時),但 photoRef 只在單次請求的
// 記憶體內短暫存在,從不寫入 PhotoCache/資料庫。
//
// photoIndex 目前所有呼叫端固定傳 0(一次只取每個地點的第一張照片)——
// 機制上已經支援多張(見 server/internal/store/entity.go 的
// photoCacheRow 說明),之後要擴充成每個地點存多張,只需要呼叫端改成
// 迭代 0..N-1 呼叫,這個介面不需要再改。
//
// List/Trim 供 SyncPlacePhotos 差異比對同步邏輯使用(見該函式與
// planPhotoSync 的說明)——List 只回傳「目前快取了哪些 index、各自何時
// 抓的」,不含圖片內容本身(data URI 可能很大,同步決策階段不需要讀出
// 來);Trim 刪除超出目前 Google 清單長度的多餘 index,讓快取跟著
// Google 目前實際回傳的照片數量收斂,不留殘影。
type PhotoCache interface {
	Get(placeID string, photoIndex, maxWidthPx int) (dataURI string, ok bool)
	Set(placeID string, photoIndex, maxWidthPx int, dataURI string)
	List(placeID string, maxWidthPx int) (fetchedAt map[int]time.Time, err error)
	Trim(placeID string, maxWidthPx, fromIndex int) error
}

// requestDoer 是 Client 內部實際用來派送請求的介面——生產環境用
// defaultGateway()(見上方說明),測試/NewWithGateway 呼叫端可以換成任意
// 滿足這個介面的假實作,不需要真的發出 HTTP 請求、也不需要真的等待節流
// 間隔。apigateway.Gateway 本身就滿足這個介面,不需要額外的轉接層。
type requestDoer interface {
	Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error)
}

// Client 持有 API key，提供地點查詢。所有實際對 Google 發出的 HTTP 請求
// 都透過 gateway 派送(見 requestDoer 的說明),不再直接持有/使用
// *http.Client——這是「連線 API 的部分」被抽成獨立 apigateway 元件後的
// 直接結果:併發數限制、請求間隔節流、呼叫記錄,全部收在 gateway 這一層,
// Client 本身只負責組請求內容與解析回應。
type Client struct {
	apiKey       string
	gateway      requestDoer
	cache        PhotoCache
	pexelsClient *pexels.Client
}

// New 建立 Client,使用整個 process 共用的預設 Gateway(見 defaultGateway
// 的說明,節流參數由 ConfigureDefaultGateway 設定)；apiKey 為空時 Search
// 永遠回傳 ErrNoKey。
func New(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		gateway: defaultGateway(),
	}
}

// NewWithGateway 建立 Client 時明確指定 Gateway,不使用 process 共用的
// 預設單例——供測試注入 mock Gateway(不需要真的等待節流間隔、不需要真的
// 發送 HTTP 請求),也供極少數需要獨立節流額度的情境使用(目前沒有這種
// 呼叫端,預留這個建構子純粹是為了可測試性)。
func NewWithGateway(apiKey string, gateway requestDoer) *Client {
	return &Client{apiKey: apiKey, gateway: gateway}
}

// SetCache 注入圖片快取實作(見 PhotoCache 的說明)。供呼叫端(api 層)在
// geo.New() 之後、實際查詢之前呼叫,只有真正會大量重複查同一批照片的
// 端點(飯店/地點/附近推薦/POI 詳情,見 server/internal/api/geo_outline.go)
// 需要接上,不是每個 Client 都必須呼叫這個方法。
func (c *Client) SetCache(cache PhotoCache) {
	c.cache = cache
}

// SetPexelsClient 注入 Pexels 查詢用的 client(見 pexels.New)。供呼叫端
// (api 層)在 geo.New() 之後呼叫——只有需要「照片優先用 Pexels、查無
// 結果才 fallback 回 Google Places 真實照片」這種降低計費成本考量的
// 查詢端點需要接上(見 SearchCityAttractions 的說明,以及
// server/internal/api/geo_outline.go 的 handleGeoPlaceDetails)。不像
// apiKey 是建構 Client 時的必要參數,這裡選擇事後注入的 setter 模式
// (對齊 SetCache 的既有做法),避免 geo.New 的簽名為了這個只有少數
// 呼叫端需要的功能而變動,牽動其餘呼叫端。
func (c *Client) SetPexelsClient(client *pexels.Client) {
	c.pexelsClient = client
}

// PexelsClient 回傳目前注入的 Pexels client(見 SetPexelsClient),未注入
// 時為 nil。供套件外(api 層)在自己的照片來源優先序邏輯裡判斷是否已經
// 注入、進而直接呼叫 pexels.Client.Search——理由同 handleGeoPlaceDetails
// 的說明:該端點的照片優先序邏輯發生在拿到 GetPlaceDetails 結果之後,
// 無法完全收在 geo 套件內部一次做完(不像 SearchCityAttractions 整段
// 查詢流程都在套件內),故需要這個匯出的讀取入口。
func (c *Client) PexelsClient() *pexels.Client {
	return c.pexelsClient
}

// newPlacesSearchRequest 組一支 Places API (New) 的 POST 搜尋請求(Text
// Search/Nearby Search 共用這個形狀:JSON body + 三個固定 header)。
// body 由呼叫端準備好其餘欄位(textQuery/pageSize/locationBias 等),這裡
// 統一補上 languageCode(見 defaultLanguageCode 的說明——這是這個 helper
// 存在的主要理由,避免呼叫端各自手動組 body 時忘記加)、序列化、設定
// Content-Type/X-Goog-Api-Key/X-Goog-FieldMask 這三個新版 API 必要的
// header。呼叫端仍需自行呼叫 c.gateway.Do 派送(不同呼叫端的 endpoint
// 識別字串不同,如 "places.searchText"/"places.searchNearby",不適合
// 收進這個 helper)。
func (c *Client) newPlacesSearchRequest(ctx context.Context, url string, body map[string]any, fieldMask string) (*http.Request, error) {
	body["languageCode"] = defaultLanguageCode
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	return req, nil
}

// newPlaceDetailsRequest 組一支 Places API (New) 的 GET Place Details
// 請求(GET /v1/places/{placeID})——這支端點沒有 body,languageCode 必須
// 放進查詢字串,是先前 GetPlaceDetails 實際漏放過的參數(見
// defaultLanguageCode 的說明)。這個 helper 統一組出含 languageCode 的
// 完整 URL 並設定 X-Goog-Api-Key/X-Goog-FieldMask 這兩個必要 header,
// 讓之後新增的 GET 端點(如需要)不會重蹈同樣的疏漏。
func (c *Client) newPlaceDetailsRequest(ctx context.Context, path, fieldMask string) (*http.Request, error) {
	u := fmt.Sprintf("https://places.googleapis.com/v1/%s?languageCode=%s", path, defaultLanguageCode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	return req, nil
}

var ErrNoKey = fmt.Errorf("geo: Google Places API key 未設定")
var ErrNotFound = fmt.Errorf("geo: 找不到符合的地點")

// Place 是候選地點結果。
type Place struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	// PlaceID 是 Google 的穩定地點識別碼(不會過期,對照 PhotoRef 那種
	// 有時效性的照片資源名稱)——供 fetchPhotoAsDataURI 當快取鍵用,
	// 見 PhotoCache 介面的完整說明。查詢結果沒有解析出來時為空字串。
	//
	// 2026-09:json tag 從 "-"(不對外曝露)改成輸出 "placeId"——place_id
	// 本身是 Google 官方文件明確允許長期保存與展示的穩定識別碼,不同於
	// PhotoRef(photo resource name)那種 Google Maps Platform ToS 3.2.3(b)
	// 明文禁止長期快取、且有時效性的欄位(見 store.photoCacheRow 的完整
	// 說明),原本的「不對外洩漏」考量是針對後者這類有保存限制的欄位,
	// 不適用於 PlaceID。改動動機:CLI 的 attraction-add -place 查詢流程
	// (handleMaintenanceGeocode)需要把候選地點的 place_id 一併帶回 CLI,
	// 才能讓人工建檔的 attraction 對應到 place_id、進而使用「地點照片
	// 漸進補圖機制」(見 model.Attraction.PlaceID 的完整說明)。這個欄位
	// 曝露後,所有回傳 []Place/[]NearbyPlace 的既有回應格式都會多出一個
	// placeId 欄位——place_id 本身不敏感,多這個欄位不構成資安或商業
	// 風險,見呼叫端逐一盤點的說明(server/internal/api/geo_outline.go、
	// maintenance.go)。PhotoRef 維持 json:"-"不變,那個欄位的保存限制
	// 依然適用。
	PlaceID string `json:"placeId,omitempty"`
	// PhotoRef 是這個地點第一張照片的 Places API photo resource name,
	// 只有 SearchOptions.IncludePhotos 為 true 時才會有值——同
	// NearbyPlace.PhotoRef 的說明,內部欄位不外洩給前端,呼叫端需另外
	// 呼叫 Client.PhotoDataURI 轉成 data: URI。
	PhotoRef string `json:"-"`
}

// NearbyPlace 是 Nearby Search 的候選景點。
// 目前 fieldMask 只取 Essentials 級欄位(呼叫成本最低),不含 rating/評論數
// (屬 Pro 級,較貴);候選順序即 Places API 回傳的相關性排序。id 屬於
// Essentials 級(免費),額外請求不增加呼叫成本。
type NearbyPlace struct {
	Name        string  `json:"name"`
	Address     string  `json:"address"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	PrimaryType string  `json:"primaryType"` // 如 tourist_attraction、restaurant、museum
	// PlaceID 見 Place.PlaceID 的說明——供 fetchPhotoAsDataURI 當快取鍵。
	PlaceID string `json:"-"`
	// PhotoRef 是這個地點第一張照片的 Places API photo resource name
	// (如 "places/xxx/photos/yyy"),只有 NearbyOptions.IncludePhotos
	// 為 true 時才會有值——內部欄位,不外洩給前端(見 json:"-"),
	// API handler 層需要另外呼叫 Client.PhotoDataURI 把它轉成可直接
	// 當 <img src> 用的 data: URI,理由同 District.LandmarkPhotoURL
	// 的說明(瀏覽器 <img> 標籤無法附加自訂 Authorization header)。
	PhotoRef string `json:"-"`
}

// NearbyOptions 是 Nearby Search 的查詢選項。
type NearbyOptions struct {
	// RadiusMeters 搜尋半徑(公尺),最大 50000(50km)。未設或 <=0 時預設 1500。
	RadiusMeters float64
	// IncludedTypes 限定地點類型(Places API 的 type 字串,如 "tourist_attraction"、
	// "restaurant"、"museum")。空陣列表示不限制類型。
	IncludedTypes []string
	// MaxResults 最多回傳幾筆候選,預設 10,最大 20(Places API Nearby Search 上限)。
	MaxResults int
	// IncludePhotos 為 true 時,field mask 額外要求 photos(Pro 級欄位,
	// 呼叫成本高於預設的 Essentials 級),結果的 PhotoRef 才會有值。
	// 預設 false——大多數呼叫端(如既有的推薦景點查詢)不需要照片,
	// 沒必要多付這筆呼叫成本。
	IncludePhotos bool
}

// SearchOptions 是查詢選項。
type SearchOptions struct {
	// Region 是 ISO 3166-1 alpha-2 國家代碼（如 "jp"、"tw"、"cn"），
	// 讓結果優先偏向該國。空字串表示不限制。
	Region string
	// MaxResults 最多回傳幾筆候選，預設 1，最大 20（Places API (New)
	// Text Search 的 pageSize 官方硬性上限，見下方 Search 的說明）。
	MaxResults int
	// LocationBias 讓結果優先偏向這個座標附近——只是「偏向」不是
	// 「限制」(locationBias,不是 locationRestriction,見下方 Search
	// 的說明),對「甜點」「apple」這類沒有明確指向單一地點的泛用關鍵字
	// 查詢有實質影響(優先回傳查詢座標附近的結果,而非全球知名度最高的
	// 結果);對「京都」這類文字意圖已經很明確的地名查詢幾乎不影響
	// (Google 的文字比對信心已經夠高,不需要靠地理位置輔助判斷)。
	// nil 代表不套用任何位置偏向。
	//
	// 與 LocationRestriction 二擇一——Google API 本身規定 locationBias 與
	// locationRestriction 不能同時帶(HTTP 400)。若呼叫端不慎兩者都給,
	// Search 以 LocationRestriction 優先、忽略這個欄位(見 Search 內的
	// 說明),呼叫端仍應自行避免同時設定兩者,不要依賴這個防呆順序。
	LocationBias *LocationBias
	// LocationRestriction 讓結果被硬性限制在這個矩形範圍內(範圍外的結果
	// 完全不會出現,不只是排序上被降權)——用於「已知使用者想找的就是
	// 目前這個地圖範圍內的地點」情境(見 handleGeoGeocode 的兩階段查詢
	// 設計說明:文字意圖不明確、bias 查詢回傳多筆候選時,改用這個欄位
	// 收斂結果)。與 LocationBias 二擇一,見該欄位的說明。nil 代表不套用
	// 任何範圍限制。
	LocationRestriction *LocationRestriction
	// IncludePhotos 為 true 時,field mask 額外要求 photos(Pro 級欄位,
	// 呼叫成本高於預設的 Essentials 級 fieldMask),結果的 PhotoRef 才會
	// 有值。預設 false——理由同 NearbyOptions.IncludePhotos 的說明,大多數
	// 呼叫端(如 Lookup)不需要照片,沒必要多付這筆呼叫成本。
	IncludePhotos bool
}

// LocationBias 是一個圓形區域,供 SearchOptions.LocationBias 使用。
type LocationBias struct {
	Lat, Lng     float64
	RadiusMeters float64
}

// LatLng 是一個經緯度座標點,供 LocationRestriction 的兩個矩形角落
// 座標使用。
type LatLng struct {
	Lat, Lng float64
}

// LocationRestriction 是一個矩形區域,供 SearchOptions.LocationRestriction
// 使用——Text Search API 的 locationRestriction 只支援矩形(rectangle,由
// Low/High 兩個對角座標定義),不支援圓形(這點與 Nearby Search 的
// locationRestriction 只支援圓形恰好相反,是 Google 官方文件明確規定的
// 限制,不是這裡自行選擇的設計)。Low 是矩形西南角(緯度/經度皆較小)、
// High 是東北角(緯度/經度皆較大)。
//
// 呼叫端手上通常是「中心點座標 + 半徑(公尺)」這種圓形範圍語意(對齊
// NearbyOptions.RadiusMeters 等既有參數格式),需要換算成矩形——見
// RectFromCenterRadius 這個 helper。
type LocationRestriction struct {
	Low, High LatLng
}

// metersPerDegreeLat 是緯度方向每一度的距離(公尺)——全球固定,不隨
// 緯度變化(地球子午線周長 ≈ 40,007.86km,除以 360 度)。
const metersPerDegreeLat = 111320.0

// RectFromCenterRadius 把「中心點座標 + 半徑(公尺)」的圓形範圍語意換算
// 成 LocationRestriction 需要的矩形(兩個對角座標)——這是標準的地理座標
// 換算,放在這個套件層級(而非呼叫端 API handler)是因為這屬於「Google
// API 請求格式的實作細節」,呼叫端(前端、handler)只需要知道語意層級的
// 「中心點+半徑」,不需要知道底層 Text Search 的 locationRestriction 只
// 接受矩形這個實作限制。
//
// 換算公式:
//   - 緯度方向:1 度緯度的距離全球固定(見 metersPerDegreeLat),
//     deltaLat = radiusMeters / metersPerDegreeLat。
//   - 經度方向:1 度經度的實際距離隨緯度變化(赤道最寬、極地趨近於 0,
//     公式為 metersPerDegreeLat * cos(緯度)),deltaLng = radiusMeters /
//     (metersPerDegreeLat * cos(centerLat 轉徑度))。
//
// 換算出的矩形是「內切正方形」而非精確的圓形範圍(矩形四個角落會比圓形
// 涵蓋更大的面積)——這是可接受的近似,locationRestriction 本身的用途
// 是「收斂到目前地圖大致範圍」,不需要精確到圓形邊界。
func RectFromCenterRadius(centerLat, centerLng, radiusMeters float64) LocationRestriction {
	deltaLat := radiusMeters / metersPerDegreeLat
	deltaLng := radiusMeters / (metersPerDegreeLat * math.Cos(centerLat*math.Pi/180))
	return LocationRestriction{
		Low:  LatLng{Lat: centerLat - deltaLat, Lng: centerLng - deltaLng},
		High: LatLng{Lat: centerLat + deltaLat, Lng: centerLng + deltaLng},
	}
}

// Search 查詢地點名稱，回傳候選清單。
// opts 可傳 nil 使用預設值（只回傳第一筆，不限地區）。
//
// 20 這個上限是 Google Places API (New) Text Search 的 pageSize 官方
// 硬性上限，不是這裡自行決定的節流值——呼叫成本以「每次請求」計費，
// 不隨回傳筆數變動，故拉高 MaxResults 不影響費用,只影響單次查詢能看到
// 多少候選(見 handleGeoGeocode 的說明,用來讓使用者從更完整的候選清單
// 裡挑對的那一筆)。
func (c *Client) Search(ctx context.Context, place string, opts *SearchOptions) ([]Place, error) {
	if c.apiKey == "" {
		return nil, ErrNoKey
	}
	if place == "" {
		return nil, ErrNotFound
	}

	maxN := 1
	region := ""
	var locationBias *LocationBias
	var locationRestriction *LocationRestriction
	includePhotos := false
	if opts != nil {
		if opts.MaxResults > 0 {
			maxN = opts.MaxResults
			if maxN > 20 {
				maxN = 20
			}
		}
		region = opts.Region
		locationBias = opts.LocationBias
		locationRestriction = opts.LocationRestriction
		includePhotos = opts.IncludePhotos
	}

	// 新版:參數放 JSON body。pageSize 對應舊版 MaxResults;
	// regionCode 對應舊版 region(新版用大寫國碼,如 "JP")。languageCode
	// 由 newPlacesSearchRequest 統一補上(見 defaultLanguageCode 的說明)。
	reqBody := map[string]any{
		"textQuery": place,
		"pageSize":  maxN,
	}
	if region != "" {
		reqBody["regionCode"] = region
	}
	// locationRestriction(矩形,硬性限制)優先於 locationBias(圓形,只
	// 偏向)——Google API 本身規定兩者不能同時帶,見 SearchOptions.
	// LocationBias 的防呆順序說明。呼叫端理應只設定其中一個,這裡的
	// if/else if 只是確保萬一兩者都被設定時,行為是明確且有文件記載的
	// (優先套用限制較強的 locationRestriction),不會讓 Google API 因為
	// 同時收到兩個互斥參數而直接回錯誤。
	if locationRestriction != nil {
		reqBody["locationRestriction"] = map[string]any{
			"rectangle": map[string]any{
				"low": map[string]any{
					"latitude":  locationRestriction.Low.Lat,
					"longitude": locationRestriction.Low.Lng,
				},
				"high": map[string]any{
					"latitude":  locationRestriction.High.Lat,
					"longitude": locationRestriction.High.Lng,
				},
			},
		}
	} else if locationBias != nil {
		// locationBias——只偏向、不排除其他結果,理由見
		// SearchOptions.LocationBias 的說明。半徑未指定或超出上限時
		// 退回/夾到 50km(對齊 Nearby Search 的既有上限,見
		// NearbyOptions.RadiusMeters 的說明,Places API 的圓形區域參數兩者
		// 共用同一個官方上限)。
		radius := locationBias.RadiusMeters
		if radius <= 0 {
			radius = 50000
		}
		if radius > 50000 {
			radius = 50000
		}
		reqBody["locationBias"] = map[string]any{
			"circle": map[string]any{
				"center": map[string]any{
					"latitude":  locationBias.Lat,
					"longitude": locationBias.Lng,
				},
				"radius": radius,
			},
		}
	}

	// fieldMask 只取 Essentials 級欄位(呼叫成本最低);IncludePhotos 為
	// true 時額外要求 photos(Pro 級欄位),比照 SearchNearby 既有模式,見
	// SearchOptions.IncludePhotos 的說明。
	fm := fieldMask
	if includePhotos {
		fm = fieldMask + ",places.photos"
	}
	req, err := c.newPlacesSearchRequest(ctx, placesURL, reqBody, fm)
	if err != nil {
		return nil, err
	}

	resp, err := c.gateway.Do(ctx, req, "places.searchText", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// 新版錯誤 body 含 {"error":{"message":...}},取出便於排查(如 key 無權限、未啟用服務)。
		var errBody struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error.Message != "" {
			return nil, fmt.Errorf("geo: request failed (HTTP %d): %s", resp.StatusCode, errBody.Error.Message)
		}
		return nil, fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

	// 新版回應結構:places[].displayName.text / formattedAddress / location.{latitude,longitude} / id
	var body struct {
		Places []struct {
			DisplayName struct {
				Text string `json:"text"`
			} `json:"displayName"`
			FormattedAddress string `json:"formattedAddress"`
			Location         struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
			ID     string `json:"id"`
			Photos []struct {
				Name string `json:"name"`
			} `json:"photos"`
		} `json:"places"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("geo: decode failed: %w", err)
	}
	if len(body.Places) == 0 {
		return nil, ErrNotFound
	}

	out := make([]Place, 0, maxN)
	for i, p := range body.Places {
		if i >= maxN {
			break
		}
		place := Place{
			Name:    p.DisplayName.Text,
			Address: p.FormattedAddress,
			Lat:     p.Location.Latitude,
			Lng:     p.Location.Longitude,
			PlaceID: p.ID,
		}
		if len(p.Photos) > 0 {
			place.PhotoRef = p.Photos[0].Name
		}
		out = append(out, place)
	}
	return out, nil
}

// District 是依行政區/次分區分組後的地理輪廓結果:同一區內多筆景點座標
// 取平均當重心,District 本身不代表單一地點。
type District struct {
	Name string  `json:"name"` // 行政區/次分區白話名稱,如「淺草」「新宿」
	Lat  float64 `json:"lat"`  // 區內景點座標平均值,當重心
	Lng  float64 `json:"lng"`
	// PlaceCount 是這個區被歸入的景點數,僅供除錯/觀察分群品質參考。
	PlaceCount int `json:"placeCount"`
	// LandmarkPhotoURL 是該區評分最高地點的代表性照片,已編碼成
	// data: URI(base64,含 MIME type),可直接當 <img src> 使用。
	//
	// 這裡在 SearchCityAttractions 內就同步把圖片位元組取回並編碼進來,而非
	// 回傳一個需要前端另外發請求的網址——理由:圖片是隨這支端點本身的
	// JSON 回應一起送出,天生就走前端既有的 fetch()+Authorization
	// header 驗證路徑;若改成回傳網址讓前端用 <img src> 另外請求,
	// 瀏覽器的 <img> 標籤無法附加自訂 Authorization header,若該網址
	// 掛在需要登入驗證的路由後面,圖片永遠載不出來(這是先前踩過的
	// 實際問題)——要嘛把圖片端點做成完全不驗證,要嘛像這裡一樣把圖片
	// 資料直接內嵌進已驗證的 JSON 回應,兩者都繞開了 <img> 標籤的
	// 驗證限制,這裡選擇後者,避免额外開一個不驗證的公開端點。
	// 該區內所有地點皆無照片、或圖片下載失敗時為空字串。
	LandmarkPhotoURL string `json:"landmarkPhotoUrl,omitempty"`
	// LandmarkName 是地標圖對應的地點名稱,供圖片 alt 文字使用。
	LandmarkName string `json:"landmarkName,omitempty"`
	// Summary 是這個區的白話簡介,取自代表性地標的 Google
	// editorialSummary(編輯過的地點介紹),不是這個區本身的介紹——
	// 用「這區最具代表性的地標長什麼樣」側寫「這區大概是什麼樣的地方」,
	// 不用 LLM 生成。該地標沒有 editorialSummary 資料時為空字串
	// (Google 並非每個地點都有這欄位)。
	Summary string `json:"summary,omitempty"`
	// RadiusMeters 是這個區大致範圍的半徑(公尺)——SearchCityAttractions(依
	// addressComponents 分組)算出來的分區沒有實際邊界資料可用,這個
	// 欄位固定是 0(前端據此判斷要不要畫範圍圓圈)。原本手動整理的觀光
	// 慣稱分區路徑(SearchKnownDistricts)才會設這個值,該路徑已於
	// 2026-08 隨 district_aliases.go 一併移除(見 CHANGELOG),欄位本身
	// 保留以維持 District 回應格式穩定。
	RadiusMeters int `json:"radiusMeters,omitempty"`
}

// districtComponentTypes 依優先順序列出「適合當白話分區名稱」的
// addressComponents type——sublocality 系列(如東京的「区」下一層,
// 淺草/新宿這種街區)最貼近構想 6 要的顆粒度,查無則退而求其次用
// locality(城市本身，適合行政區劃較粗的地區)。administrative_area
// 系列刻意不用,顆粒度通常太粗(省/州級)。
var districtComponentTypes = []string{
	"sublocality_level_1",
	"sublocality",
	"neighborhood",
	"locality",
}

// pickDistrictName 從一筆地點的 addressComponents 裡,依
// districtComponentTypes 的優先順序找出第一個符合的分區名稱。
// 找不到任何符合的 component 時回傳空字串,呼叫端應略過這筆地點
// (不歸入任何分區,避免用不精確的資訊污染分群結果)。
func pickDistrictName(components []struct {
	LongText  string   `json:"longText"`
	ShortText string   `json:"shortText"`
	Types     []string `json:"types"`
}) string {
	for _, want := range districtComponentTypes {
		for _, c := range components {
			for _, t := range c.Types {
				if t == want {
					return c.LongText
				}
			}
		}
	}
	return ""
}

// SearchCityAttractions 用一個查詢字串(通常是「{城市} 觀光景點」這類
// 廣泛查詢)取一批地點,依各自所屬的行政區/次分區分組,回傳每區的白話
// 名稱與景點座標平均值(重心)。供地理輪廓底圖(構想 6)使用:不需要
// LLM,直接用 Places API 既有的地點分布與地址結構反推城市大致分成
// 哪幾塊。
//
// query 應包含城市名稱以提高相關性,例如「東京 觀光景點」。maxResults
// 建議 15~20(需要足夠樣本數才能形成有意義的分組,太少容易每區只有 1
// 個點、重心失去平均的意義)。
//
// 每區代表性照片的來源優先序:若已透過 SetPexelsClient 注入 Pexels
// client,優先用該區名稱查一張 Pexels 示意圖;查無結果、未注入、或
// 查詢失敗,才 fallback 回原本的邏輯——取該區評分最高且有照片的地點,
// 用其 Google Places 真實照片。這個順序是刻意的:Pexels 是免費/低成本
// 的關鍵字比對圖庫,Google Places Photo Media 則按張數計費,先試前者
// 能降低這支端點(每次查詢未建檔城市都會觸發)的 Google 呼叫成本,
// 只有 Pexels 找不到示意圖時才退回較準確、但要付費的 Google 照片。
func (c *Client) SearchCityAttractions(ctx context.Context, query string, maxResults int) ([]District, error) {
	if c.apiKey == "" {
		return nil, ErrNoKey
	}
	if query == "" {
		return nil, ErrNotFound
	}
	if maxResults <= 0 {
		maxResults = 20
	}
	if maxResults > 20 {
		maxResults = 20
	}

	reqBody := map[string]any{
		"textQuery": query,
		"pageSize":  maxResults,
	}
	req, err := c.newPlacesSearchRequest(ctx, placesURL, reqBody, districtFieldMask)
	if err != nil {
		return nil, err
	}

	resp, err := c.gateway.Do(ctx, req, "places.searchText", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errBody struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error.Message != "" {
			return nil, fmt.Errorf("geo: request failed (HTTP %d): %s", resp.StatusCode, errBody.Error.Message)
		}
		return nil, fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

	var body struct {
		Places []struct {
			Id          string `json:"id"`
			DisplayName struct {
				Text string `json:"text"`
			} `json:"displayName"`
			FormattedAddress string `json:"formattedAddress"`
			Location         struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
			AddressComponents []struct {
				LongText  string   `json:"longText"`
				ShortText string   `json:"shortText"`
				Types     []string `json:"types"`
			} `json:"addressComponents"`
			Rating float64 `json:"rating"`
			Photos []struct {
				Name string `json:"name"` // photo resource name,如 "places/xxx/photos/yyy"
			} `json:"photos"`
			EditorialSummary struct {
				Text string `json:"text"`
			} `json:"editorialSummary"`
		} `json:"places"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("geo: decode failed: %w", err)
	}
	if len(body.Places) == 0 {
		return nil, ErrNotFound
	}

	// 依分區名稱分組累加座標,最後取平均當重心。用 slice 而非直接對
	// map value 累加,保留「第一次出現該分區名稱」的順序,讓回傳結果
	// 順序穩定(前端依此順序排 rail/圖例時不會每次重新整理就跳動)。
	//
	// 同時在每組內追蹤「評分最高且有照片」的地點,當作該區的代表性
	// 地標圖片來源——只論評分會挑到高分但沒照片的地點,加上「有照片」
	// 這個條件才能保證能力所及範圍內一定選得出圖。評分並列時保留先
	// 出現的(維持結果穩定,避免同分之間每次重新排序造成圖片跳動)。
	type accum struct {
		name            string
		latSum          float64
		lngSum          float64
		placeCount      int
		landmarkRating  float64
		landmarkPhoto   string // photo resource name,尚未組成完整 URL
		landmarkPlaceID string // 該地標的 place id,當 PhotoCache 的快取鍵用
		landmarkName    string
		landmarkSummary string
	}
	order := make([]string, 0)
	groups := make(map[string]*accum)
	for _, p := range body.Places {
		name := pickDistrictName(p.AddressComponents)
		if name == "" {
			continue
		}
		g, ok := groups[name]
		if !ok {
			g = &accum{name: name}
			groups[name] = g
			order = append(order, name)
		}
		g.latSum += p.Location.Latitude
		g.lngSum += p.Location.Longitude
		g.placeCount++

		if len(p.Photos) > 0 && p.Rating > g.landmarkRating {
			g.landmarkRating = p.Rating
			g.landmarkPhoto = p.Photos[0].Name
			g.landmarkPlaceID = p.Id
			g.landmarkName = p.DisplayName.Text
			g.landmarkSummary = p.EditorialSummary.Text
		}
	}

	out := make([]District, 0, len(order))
	for _, name := range order {
		g := groups[name]
		d := District{
			Name:       g.name,
			Lat:        g.latSum / float64(g.placeCount),
			Lng:        g.lngSum / float64(g.placeCount),
			PlaceCount: g.placeCount,
			Summary:    g.landmarkSummary,
		}

		// 優先序見本函式開頭的說明:先試 Pexels(免費/低成本),查無
		// 結果或未注入 pexelsClient 時才 fallback 回 Google Places 該區
		// 代表性地標的真實照片。兩者皆失敗時這一區就是沒有圖可顯示,
		// 不視為整體查詢失敗——理由同下方 fetchPhotoAsDataURI 錯誤處理
		// 的既有說明,呼叫端(前端)已經預期這個欄位可能不存在(見
		// District.LandmarkPhotoURL 的 omitempty)。
		if c.pexelsClient != nil {
			if photo, ok, err := c.pexelsClient.Search(ctx, query+" "+g.name); err == nil && ok {
				d.LandmarkPhotoURL = photo.ImageURL
				d.LandmarkName = g.name
			}
		}
		if d.LandmarkPhotoURL == "" && g.landmarkPhoto != "" {
			// 圖片下載失敗(額度用盡、逾時等)不視為整體查詢失敗——
			// 這一區只是沒有地標圖可顯示,不影響其餘分區資料,故忽略
			// 錯誤、留空字串即可,呼叫端(前端)已經預期這個欄位可能
			// 不存在(見 District.LandmarkPhotoURL 的 omitempty)。
			if photoURL, err := c.fetchPhotoAsDataURI(ctx, g.landmarkPlaceID, g.landmarkPhoto, 400, false); err == nil {
				d.LandmarkPhotoURL = photoURL
				d.LandmarkName = g.landmarkName
			}
		}
		out = append(out, d)
	}
	return out, nil
}

// SearchLandmarkWithPhoto 查詢單一地標名稱,回傳其座標(Place)、
// 評分最高的照片 resource name(查無照片則為空字串)、其評分、與
// editorialSummary。field mask 比泛用的 Search 多取 rating/photos/
// editorialSummary(皆屬 Pro 級欄位),故不直接複用 Search。
//
// 供 cmd/cli 的 attraction-update-photo 指令(見 cmd/cli/http.go 的
// attractionUpdatePhoto)重新查詢地標圖片時使用——這是套件對外的正式
// 入口,故大寫匯出而非只服務套件內部。
func (c *Client) SearchLandmarkWithPhoto(ctx context.Context, query string) (place Place, photoRef string, rating float64, summary string, err error) {
	if c.apiKey == "" {
		return Place{}, "", 0, "", ErrNoKey
	}
	if query == "" {
		return Place{}, "", 0, "", ErrNotFound
	}

	reqBody := map[string]any{
		"textQuery": query,
		"pageSize":  1,
	}
	req, err := c.newPlacesSearchRequest(ctx, placesURL, reqBody, districtFieldMask)
	if err != nil {
		return Place{}, "", 0, "", err
	}

	resp, err := c.gateway.Do(ctx, req, "places.searchText", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return Place{}, "", 0, "", fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Place{}, "", 0, "", fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

	var body struct {
		Places []struct {
			Id          string `json:"id"`
			DisplayName struct {
				Text string `json:"text"`
			} `json:"displayName"`
			FormattedAddress string `json:"formattedAddress"`
			Location         struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
			Rating float64 `json:"rating"`
			Photos []struct {
				Name string `json:"name"`
			} `json:"photos"`
			EditorialSummary struct {
				Text string `json:"text"`
			} `json:"editorialSummary"`
		} `json:"places"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Place{}, "", 0, "", fmt.Errorf("geo: decode failed: %w", err)
	}
	if len(body.Places) == 0 {
		return Place{}, "", 0, "", ErrNotFound
	}

	p := body.Places[0]
	place = Place{
		Name:    p.DisplayName.Text,
		Address: p.FormattedAddress,
		Lat:     p.Location.Latitude,
		Lng:     p.Location.Longitude,
		PlaceID: p.Id,
	}
	if len(p.Photos) > 0 {
		photoRef = p.Photos[0].Name
	}
	return place, photoRef, p.Rating, p.EditorialSummary.Text, nil
}

// PlaceDetails 是單一地點的詳細資訊,供 GetPlaceDetails 用——供「點擊
// Google 原生 POI 圖標」情境即時查該地點的完整介紹,不是分區/飯店/
// 附近推薦那幾種批次查詢的結果形狀。
type PlaceDetails struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Rating  float64 `json:"rating,omitempty"`
	Summary string  `json:"summary,omitempty"`
	// PhotoRefs 是 Google 回傳 photos[] 的完整參照清單(依原始順序),
	// 供需要多張照片的呼叫端(如 handleGeoPlaceDetails 一般模式,見該
	// 函式對 Google/Pexels 照片同時並列顯示的說明)逐一呼叫 PhotoDataURI
	// 換成真正的圖片內容。每個元素是同 NearbyPlace.PhotoRef 的照片
	// resource name,呼叫端需另外呼叫 PhotoDataURI 轉成 data URI。
	PhotoRefs []string `json:"-"`
}

// GetPlaceDetails 用 Place ID 查詢單一地點的詳細資訊(Places API (New) 的
// Place Details 端點,GET /v1/places/{placeID})。供「使用者點擊地圖上
// Google 原生 POI 圖標」這個情境使用——原生 POI 點擊只會拿到一個
// placeId(見 web/src/GeoOutlineMap.tsx 的 IconMouseEvent 處理),沒有
// 附帶任何名稱/地址等資料,必須再打這支端點才查得到內容,沒有更省的
// 做法(Google 官方 Maps 網站本身點 POI 背後也是即時查一次 Place
// Details)。
func (c *Client) GetPlaceDetails(ctx context.Context, placeID string) (PlaceDetails, error) {
	if c.apiKey == "" {
		return PlaceDetails{}, ErrNoKey
	}
	if placeID == "" {
		return PlaceDetails{}, ErrNotFound
	}

	req, err := c.newPlaceDetailsRequest(ctx, "places/"+placeID, placeDetailsFieldMask)
	if err != nil {
		return PlaceDetails{}, err
	}

	resp, err := c.gateway.Do(ctx, req, "places.get", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return PlaceDetails{}, fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return PlaceDetails{}, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		var errBody struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error.Message != "" {
			return PlaceDetails{}, fmt.Errorf("geo: request failed (HTTP %d): %s", resp.StatusCode, errBody.Error.Message)
		}
		return PlaceDetails{}, fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

	var body struct {
		DisplayName struct {
			Text string `json:"text"`
		} `json:"displayName"`
		FormattedAddress string `json:"formattedAddress"`
		Location         struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"location"`
		Rating float64 `json:"rating"`
		Photos []struct {
			Name string `json:"name"`
		} `json:"photos"`
		EditorialSummary struct {
			Text string `json:"text"`
		} `json:"editorialSummary"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return PlaceDetails{}, fmt.Errorf("geo: decode failed: %w", err)
	}

	details := PlaceDetails{
		Name:    body.DisplayName.Text,
		Address: body.FormattedAddress,
		Lat:     body.Location.Latitude,
		Lng:     body.Location.Longitude,
		Rating:  body.Rating,
		Summary: body.EditorialSummary.Text,
	}
	if len(body.Photos) > 0 {
		details.PhotoRefs = make([]string, len(body.Photos))
		for i, p := range body.Photos {
			details.PhotoRefs[i] = p.Name
		}
	}
	return details, nil
}

// photoRefsFieldMask 只取 photos 這一個欄位——供 ListPlacePhotoRefs 用,
// 只是要拿到目前的 photos[] 清單(用來跟快取做差異比對),不需要名稱/
// 地址/評分等其餘欄位,遮罩越窄呼叫成本越低。
const photoRefsFieldMask = "photos"

// ListPlacePhotoRefs 查詢一個地點目前完整的 photos[] 參照清單(依 Google
// 回傳順序,即 photo resource name 陣列)——供 SyncPlacePhotos 差異比對
// 同步邏輯使用,判斷「Google 現在說這個地點有幾張照片、依序是哪幾張」。
// 這裡回傳的 photoRef 字串只在呼叫端當次同步流程的記憶體內短暫使用,
// 從不寫入快取/資料庫,理由同 fetchPhotoAsDataURI 對 photoResourceName
// 的說明(Google Maps Platform Terms of Service 3.2.3(b) 禁止長期保存)。
func (c *Client) ListPlacePhotoRefs(ctx context.Context, placeID string) ([]string, error) {
	if c.apiKey == "" {
		return nil, ErrNoKey
	}
	if placeID == "" {
		return nil, ErrNotFound
	}

	// 這裡只查 photos 欄位(不含名稱/地址等文字欄位),languageCode 對結果
	// 沒有實質影響,但仍統一走 newPlaceDetailsRequest(見該 helper 的
	// 說明)——理由是一致性,不需要為了這一支端點特別評估要不要加。
	req, err := c.newPlaceDetailsRequest(ctx, "places/"+placeID, photoRefsFieldMask)
	if err != nil {
		return nil, err
	}

	resp, err := c.gateway.Do(ctx, req, "places.get", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

	var body struct {
		Photos []struct {
			Name string `json:"name"`
		} `json:"photos"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("geo: decode failed: %w", err)
	}

	refs := make([]string, 0, len(body.Photos))
	for _, p := range body.Photos {
		refs = append(refs, p.Name)
	}
	return refs, nil
}

// fetchPhotoAsDataURI 下載 Places API (New) 的 photo resource name(如
// "places/xxx/photos/yyy")對應的圖片位元組,編碼成 data: URI(base64,
// 含 MIME type)回傳,可直接當 <img src> 使用。maxWidthPx 建議與實際
// 顯示尺寸相近即可(圓形地標圖預期顯示範圍小,不需要原始解析度),
// 避免浪費頻寬與 Google 端計費用量。
//
// placeID 只用來當 PhotoCache 的查詢/寫入鍵,不參與組 Google Photo
// Media 網址(那個網址只需要 photoResourceName)——理由見 PhotoCache
// 介面的說明:photoResourceName 依 Google Maps Platform Terms of
// Service 3.2.3(b) 不能長期快取,只能在單次請求週期內使用,故這裡只把
// 它當「這一次要跟 Google 換圖片」的憑證用完即丟,從不寫進快取層;
// placeID 才是允許持久保存、拿來定位「這是哪個地點的圖」的穩定識別碼。
// placeID 為空字串時(呼叫端沒能解析出 place id)整段快取讀寫直接跳過,
// 退化成「每次都真的向 Google 查詢」,功能仍正確、只是這一筆沒有快取
// 效益——理由同 c.cache 為 nil 時的既有降級行為。
//
// 這裡直接把圖片位元組編碼進回應,而非回傳一個「前端需要另外發請求」
// 的網址——理由見呼叫端(SearchCityAttractions)的說明:圖片資料要跟著這支
// 端點本身的 JSON 回應一起送出,才能沿用前端既有的已驗證 fetch()
// 路徑,不受瀏覽器 <img> 標籤無法附加自訂 Authorization header 的限制。
// GOOGLE_PLACES_API_KEY 只在這支函式内部、伺服器對伺服器的請求裡出現,
// 不會出現在回傳給前端的任何資料裡。
// bypassGlobalPhotosToggle:見 downloadPhotoBytes 對這個參數的完整說明——
// true 代表這次呼叫不受套件層級的 photosEnabled 全域開關限制,即使
// SetPhotosEnabled(false)(本機開發預設值),這次呼叫仍會真的向 Google
// Photo Media API 發出請求。這個參數沿著 fetchPhotoAsDataURI →
// downloadPhotoBytes 這條呼叫鏈往下傳遞,不透過修改任何套件層級或
// *Client 層級的共用狀態——理由是 photosEnabled 是套件層級的全域變數
// (不是掛在 *Client 上),若靠「暫時切換全域變數、呼叫完再切回去」實作
// 繞過,在同一個 process 內會有嚴重的並發安全問題:兩個並發請求,一個
// 要繞過、一個不要繞過,對同一個全域變數的切換動作會互相干擾,可能讓
// 不該繞過的那個請求也意外繞過(或反過來)。改成單純的參數傳遞,則每次
// 呼叫各自攜帶自己的「要不要繞過」意圖,天生就是並發安全的,不需要任何
// 鎖或協調機制。
func (c *Client) fetchPhotoAsDataURI(ctx context.Context, placeID, photoResourceName string, maxWidthPx int, bypassGlobalPhotosToggle bool) (string, error) {
	if photoResourceName == "" || c.apiKey == "" {
		return "", ErrNoKey
	}
	if maxWidthPx <= 0 {
		maxWidthPx = 400
	}
	// photoIndex 固定 0——目前每個地點只取第一張照片(見 PhotoCache 介面
	// 的說明,機制上已支援多張,之後要擴充成每個地點存多張照片時,這裡
	// 才需要接受呼叫端傳入的實際序數,不是這支函式內部自己決定的)。
	const photoIndex = 0

	// 快取命中則直接回傳,不打 Google——這是解決「同一批飯店/地點隨地圖
	// 移動被重複查詢、每次都重新下載同一張照片」問題的關鍵(見
	// server/internal/api/geo_outline.go 的 handleGeoAttractionsNearby)。
	// c.cache 為 nil、或 placeID 為空字串時都視為快取不可用(見上方
	// 函式說明),兩者都是 no-op,直接往下真的向 Google 查詢。這個快取
	// 命中判斷不受 bypassGlobalPhotosToggle 影響——不論這次呼叫是否要
	// 繞過全域開關,只要快取有資料就直接用,不需要為了「繞過開關」而
	// 連帶跳過快取重新下載一次。
	if c.cache != nil && placeID != "" {
		if dataURI, ok := c.cache.Get(placeID, photoIndex, maxWidthPx); ok {
			return dataURI, nil
		}
	}

	dataURI, err := c.downloadPhotoBytes(ctx, photoResourceName, maxWidthPx, bypassGlobalPhotosToggle)
	if err != nil {
		return "", err
	}

	if c.cache != nil && placeID != "" {
		c.cache.Set(placeID, photoIndex, maxWidthPx, dataURI)
	}
	return dataURI, nil
}

// ErrPhotosDisabled 是 photosEnabled 為 false 時,downloadPhotoBytes 拒絕
// 下載回傳的錯誤——所有呼叫端(fetchPhotoAsDataURI/SyncPlacePhotos)已經
// 把「單張照片下載失敗」當成非致命錯誤處理(略過、不影響其餘查詢結果),
// 故這裡不需要另外為這個情況新增特殊分支,直接沿用既有的錯誤處理路徑
// 即可正確降級成「沒有照片可顯示」。
var ErrPhotosDisabled = fmt.Errorf("geo: 已透過 SetPhotosEnabled(false) 關閉照片下載")

// downloadPhotoBytes 是 fetchPhotoAsDataURI 拆出來的純下載邏輯(不含
// 快取讀寫)——供 SyncPlacePhotos 差異比對同步流程使用:同步邏輯已經
// 透過 planPhotoSync 決定「這個 index 確實需要重新下載」,不需要
// downloadPhotoBytes 內部再檢查一次快取(那樣既多餘、也對不上正確的
// photoIndex,因為這支函式本身不知道呼叫端要把結果存在哪個 index)。
// 呼叫端(fetchPhotoAsDataURI/SyncPlacePhotos)各自負責在下載前後接上
// 對應的快取讀寫。
//
// photosEnabled 開關(見該變數的完整說明)在這裡檢查——這是唯一真的會
// 對 Google Photo Media API 發出請求的地方,把開關收在這一個進入點,
// 而不是分散到每個呼叫端各自判斷,確保沒有漏網之魚。
//
// bypassGlobalPhotosToggle 為 true 時,這次呼叫完全跳過上面
// photosEnabled 的檢查,即使全域開關是關閉的也會照常發出請求——這是
// 刻意的例外開口,只給明確需要繞過的呼叫端使用(見 PhotoDataURIUnrestricted
// 的完整說明:目前只有「單點地點介紹」這條路徑,因為它已經有速率限制
// (apigateway.RateLimiter)+ 同 placeID 併發丟棄(Server.placeDetailsInFlight)
// + 24 小時快取三重機制頂著成本風險,不再需要仰賴這個全域開關當唯一
// 防線;其餘呼叫端(飯店照片、附近景點候選卡片縮圖等)沒有這些額外防線,
// 必須繼續受全域開關控制,故這個參數預設(由 downloadPhotoBytes 唯一的
// 呼叫端 fetchPhotoAsDataURI 決定)是 false,只有明確傳 true 才會繞過)。
// 這個參數是單純的呼叫層級傳遞,不觸碰 photosEnabled 這個全域變數本身,
// 故多個並發呼叫各自攜帶自己的意圖,不會互相干擾(完整理由見
// fetchPhotoAsDataURI 對這個參數的說明)。
func (c *Client) downloadPhotoBytes(ctx context.Context, photoResourceName string, maxWidthPx int, bypassGlobalPhotosToggle bool) (string, error) {
	if !photosEnabled && !bypassGlobalPhotosToggle {
		return "", ErrPhotosDisabled
	}

	mediaURL := fmt.Sprintf("https://places.googleapis.com/v1/%s/media?maxWidthPx=%d&key=%s",
		photoResourceName, maxWidthPx, c.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return "", err
	}
	// Photo Media API 預設會對原始請求做 302 導向到實際圖片 CDN 網址;
	// gateway 底層的 *http.Client 預設會自動跟隨 redirect,這裡不需要
	// 額外處理。
	resp, err := c.gateway.Do(ctx, req, "places.photoMedia", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return "", fmt.Errorf("geo: photo fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("geo: photo fetch failed (HTTP %d)", resp.StatusCode)
	}

	// 限制讀取大小(5MB 上限)——地標圖是縮圖用途,正常回應遠小於此,
	// 這裡只是防止異常回應(例如被導向到非預期的大檔案)拖垮記憶體。
	limited := io.LimitReader(resp.Body, 5<<20)
	data, err := io.ReadAll(limited)
	if err != nil {
		return "", fmt.Errorf("geo: photo read failed: %w", err)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// Lookup 查詢地點名稱，回傳第一筆結果的經緯度（向下相容用）。
func (c *Client) Lookup(ctx context.Context, place string) (lat, lng float64, err error) {
	places, err := c.Search(ctx, place, nil)
	if err != nil {
		return 0, 0, err
	}
	return places[0].Lat, places[0].Lng, nil
}

// SearchNearby 依中心座標 + 半徑查詢附近地點，依 Places API 原始順序回傳
// (該端點本身即依相關性/評分排序，不再由本函式二次排序)。
// opts 可傳 nil 使用預設值(半徑 1500m、不限類型、最多 10 筆)。
func (c *Client) SearchNearby(ctx context.Context, lat, lng float64, opts *NearbyOptions) ([]NearbyPlace, error) {
	if c.apiKey == "" {
		return nil, ErrNoKey
	}

	radius := 1500.0
	maxN := 10
	var includedTypes []string
	includePhotos := false
	if opts != nil {
		if opts.RadiusMeters > 0 {
			radius = opts.RadiusMeters
			if radius > 50000 {
				radius = 50000
			}
		}
		if opts.MaxResults > 0 {
			maxN = opts.MaxResults
			if maxN > 20 {
				maxN = 20
			}
		}
		includedTypes = opts.IncludedTypes
		includePhotos = opts.IncludePhotos
	}

	reqBody := map[string]any{
		"maxResultCount": maxN,
		"locationRestriction": map[string]any{
			"circle": map[string]any{
				"center": map[string]any{
					"latitude":  lat,
					"longitude": lng,
				},
				"radius": radius,
			},
		},
	}
	if len(includedTypes) > 0 {
		reqBody["includedTypes"] = includedTypes
	}
	fm := nearbyFieldMask
	if includePhotos {
		fm = nearbyFieldMask + ",places.photos"
	}
	req, err := c.newPlacesSearchRequest(ctx, nearbyURL, reqBody, fm)
	if err != nil {
		return nil, err
	}

	resp, err := c.gateway.Do(ctx, req, "places.searchNearby", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errBody struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error.Message != "" {
			return nil, fmt.Errorf("geo: request failed (HTTP %d): %s", resp.StatusCode, errBody.Error.Message)
		}
		return nil, fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

	var body struct {
		Places []struct {
			Id          string `json:"id"`
			DisplayName struct {
				Text string `json:"text"`
			} `json:"displayName"`
			FormattedAddress string `json:"formattedAddress"`
			Location         struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
			PrimaryType string `json:"primaryType"`
			Photos      []struct {
				Name string `json:"name"`
			} `json:"photos"`
		} `json:"places"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("geo: decode failed: %w", err)
	}
	if len(body.Places) == 0 {
		return nil, ErrNotFound
	}

	out := make([]NearbyPlace, 0, len(body.Places))
	for _, p := range body.Places {
		np := NearbyPlace{
			Name:        p.DisplayName.Text,
			Address:     p.FormattedAddress,
			Lat:         p.Location.Latitude,
			Lng:         p.Location.Longitude,
			PrimaryType: p.PrimaryType,
			PlaceID:     p.Id,
		}
		if len(p.Photos) > 0 {
			np.PhotoRef = p.Photos[0].Name
		}
		out = append(out, np)
	}
	return out, nil
}

// PhotoDataURI 是 fetchPhotoAsDataURI 的匯出包裝,供套件外(api 層)
// 把 NearbyPlace.PhotoRef 轉成可直接當 <img src> 用的 data: URI。
// fetchPhotoAsDataURI 本身未匯出,是因為它原本只服務套件內部的
// SearchCityAttractions;飯店圖層(handleGeoAttractions)需要在套件外對
// NearbyPlace 結果做同樣的轉換,故加這層薄包裝,
// 不重複實作下載邏輯。
func (c *Client) PhotoDataURI(ctx context.Context, placeID, photoRef string, maxWidthPx int) (string, error) {
	return c.fetchPhotoAsDataURI(ctx, placeID, photoRef, maxWidthPx, false)
}

// PhotoDataURIUnrestricted 是 PhotoDataURI 的變體——行為完全相同,唯一
// 差異是這次呼叫不受套件層級的 photosEnabled 全域開關限制(見
// downloadPhotoBytes 對 bypassGlobalPhotosToggle 參數的完整說明),即使
// process 啟動時透過 SetPhotosEnabled(false) 關閉了 Google Photo Media
// 下載(本機開發的預設值),呼叫這個方法仍會真的向 Google 發出請求。
//
// 只給明確需要繞過的呼叫端使用——目前唯一的使用情境是「單點地點介紹」
// (server/internal/api/geo_outline.go 的 handleGeoPlaceDetails 一般模式,
// 含 fetchAndCachePlaceDetails 與快取命中分支裡觸發漸進補圖那段)。這條
// 路徑之所以不該再受這個全域開關控制,是因為它現在已經疊了三層獨立的
// 成本防線:
//
//  1. apigateway.RateLimiter 依 endpoint("places.photoMedia")的拒絕型
//     速率限制,超過視窗內上限直接拒絕,不會無上限累積呼叫。
//  2. Server.placeDetailsInFlight 的同 placeID 併發丟棄機制——同一時間
//     對同一個地點的重複請求不會疊加觸發下載。
//  3. place_details_cache/google_place_photos 的每日快取(見
//     placeDetailsCacheMaxAge/漸進補圖節奏機制),同一地點短期內反覆
//     點擊不會反覆下載。
//
// 換句話說,「全域開關關閉」原本是唯一的成本防線(本機/測試環境預設
// 關閉,避免不小心在開發時就產生真實計費呼叫);但單點地點介紹這條路徑
// 已經有更精細、更即時的防線頂著,繼續讓它被這個全域粗粒度開關擋住,
// 只會讓開發者必須手動開啟 GOOGLE_PLACES_FETCH_PHOTOS 才能測試/使用這個
// 功能,體驗上不必要,故明確讓這條路徑繞過。
//
// 其餘所有呼叫 PhotoDataURI(飯店照片查詢、附近景點候選卡片縮圖、
// handleMaintenanceAttractionUpdatePhoto 等)必須維持原樣、繼續受全域
// 開關控制——這些路徑沒有上述三層防線,全域開關仍是它們唯一的成本
// 控制手段,不能因為這次改動意外讓它們也繞過去。呼叫端務必只在明確
// 理解「這裡有其他機制頂著」的情況下才改用這個方法,不要因為想跳過
// 開關方便本機測試就隨意套用。
func (c *Client) PhotoDataURIUnrestricted(ctx context.Context, placeID, photoRef string, maxWidthPx int) (string, error) {
	return c.fetchPhotoAsDataURI(ctx, placeID, photoRef, maxWidthPx, true)
}
