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
	"net/http"
	"sync"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
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

// 新版 Places API (New) 的 Text Search 端點(POST)。
// 舊版為 maps.googleapis.com/maps/api/place/textsearch/json(GET),已於 2026 遷移至此。
const placesURL = "https://places.googleapis.com/v1/places:searchText"

// fieldMask 指定新版 API 要回傳哪些欄位(新版必填 header X-Goog-FieldMask,
// 不給會回 400)。只取目前用到的:顯示名稱、格式化地址、經緯度。
const fieldMask = "places.displayName,places.formattedAddress,places.location"

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

// districtFieldMask 供 SearchDistricts 用:額外取 addressComponents,才能從
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
	apiKey  string
	gateway requestDoer
	cache   PhotoCache
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
	PlaceID string `json:"-"`
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
	// MaxResults 最多回傳幾筆候選，預設 1，最大 5。
	MaxResults int
}

// Search 查詢地點名稱，回傳候選清單。
// opts 可傳 nil 使用預設值（只回傳第一筆，不限地區）。
func (c *Client) Search(ctx context.Context, place string, opts *SearchOptions) ([]Place, error) {
	if c.apiKey == "" {
		return nil, ErrNoKey
	}
	if place == "" {
		return nil, ErrNotFound
	}

	maxN := 1
	region := ""
	if opts != nil {
		if opts.MaxResults > 0 {
			maxN = opts.MaxResults
			if maxN > 5 {
				maxN = 5
			}
		}
		region = opts.Region
	}

	// 新版:參數放 JSON body。pageSize 對應舊版 MaxResults;
	// regionCode 對應舊版 region(新版用大寫國碼,如 "JP")。
	// languageCode 固定繁中:專案介面語言只有繁中,回傳的地名/地址盡量用中文
	// (實際仍依 Google 該地點的翻譯資料完整度而定,非所有地點都有中文譯名)。
	reqBody := map[string]any{
		"textQuery":    place,
		"pageSize":     maxN,
		"languageCode": "zh-TW",
	}
	if region != "" {
		reqBody["regionCode"] = region
	}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", placesURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)

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

	// 新版回應結構:places[].displayName.text / formattedAddress / location.{latitude,longitude}
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
		out = append(out, Place{
			Name:    p.DisplayName.Text,
			Address: p.FormattedAddress,
			Lat:     p.Location.Latitude,
			Lng:     p.Location.Longitude,
		})
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
	// 這裡在 SearchDistricts 內就同步把圖片位元組取回並編碼進來,而非
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
	// RadiusMeters 是這個區大致範圍的半徑(公尺),只有走
	// SearchKnownDistricts(手動整理的觀光慣稱分區,見
	// district_aliases.go)的結果才會有值——透過泛用
	// addressComponents 分組(SearchDistricts)算出來的分區沒有實際
	// 邊界資料可用,這個欄位固定是 0(前端據此判斷要不要畫範圍圓圈)。
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

// SearchDistricts 用一個查詢字串(通常是「{城市} 觀光景點」這類廣泛查詢)
// 取一批地點,依各自所屬的行政區/次分區分組,回傳每區的白話名稱與景點
// 座標平均值(重心)。供地理輪廓底圖(構想 6)使用:不需要 LLM,直接用
// Places API 既有的地點分布與地址結構反推城市大致分成哪幾塊。
//
// query 應包含城市名稱以提高相關性,例如「東京 觀光景點」。maxResults
// 建議 15~20(需要足夠樣本數才能形成有意義的分組,太少容易每區只有 1
// 個點、重心失去平均的意義)。
func (c *Client) SearchDistricts(ctx context.Context, query string, maxResults int) ([]District, error) {
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
		"textQuery":    query,
		"pageSize":     maxResults,
		"languageCode": "zh-TW",
	}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", placesURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", districtFieldMask)

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
		if g.landmarkPhoto != "" {
			// 圖片下載失敗(額度用盡、逾時等)不視為整體查詢失敗——
			// 這一區只是沒有地標圖可顯示,不影響其餘分區資料,故忽略
			// 錯誤、留空字串即可,呼叫端(前端)已經預期這個欄位可能
			// 不存在(見 District.LandmarkPhotoURL 的 omitempty)。
			if photoURL, err := c.fetchPhotoAsDataURI(ctx, g.landmarkPlaceID, g.landmarkPhoto, 400); err == nil {
				d.LandmarkPhotoURL = photoURL
				d.LandmarkName = g.landmarkName
			}
		}
		out = append(out, d)
	}
	return out, nil
}

// SearchKnownDistricts 是 SearchDistricts 的替代路徑:city 若命中
// district_aliases.go 手動整理的觀光慣稱分區資料,直接依該資料集逐區
// 查詢地標座標與照片,不再用 addressComponents 反推分組——後者對
// 「古城區」「尼曼區」這類非官方行政區劃的觀光慣稱完全無效(Google
// 的行政區劃資料庫沒有這種命名體系)。
//
// city 沒有命中已知城市時,回傳 (nil, false),呼叫端(handleGeoAttractions)
// 應 fallback 呼叫 SearchDistricts。
func (c *Client) SearchKnownDistricts(ctx context.Context, city string) ([]District, bool) {
	aliases, ok := lookupKnownDistricts(city)
	if !ok {
		return nil, false
	}

	out := make([]District, 0, len(aliases))
	for _, alias := range aliases {
		place, photoRef, _, summary, err := c.SearchLandmarkWithPhoto(ctx, alias.LandmarkQuery)
		if err != nil {
			// 單一分區的地標查詢失敗不影響其餘分區——例如某個地標
			// 名稱剛好在 Google 那邊查無結果,略過這一區即可,不讓
			// 整個城市的地理輪廓查詢失敗。
			continue
		}
		d := District{
			Name:         alias.Name,
			Lat:          place.Lat,
			Lng:          place.Lng,
			PlaceCount:   1,
			RadiusMeters: alias.RadiusMeters,
			Summary:      summary,
		}
		if photoRef != "" {
			if photoURL, err := c.fetchPhotoAsDataURI(ctx, place.PlaceID, photoRef, 400); err == nil {
				d.LandmarkPhotoURL = photoURL
				d.LandmarkName = place.Name
			}
		}
		out = append(out, d)
	}
	return out, true
}

// SearchLandmarkWithPhoto 查詢單一地標名稱,回傳其座標(Place)、
// 評分最高的照片 resource name(查無照片則為空字串)、其評分、與
// editorialSummary。field mask 比泛用的 Search 多取 rating/photos/
// editorialSummary(皆屬 Pro 級欄位),故不直接複用 Search。
//
// 供 SearchKnownDistricts(構想 6 過渡資料,見 district_aliases.go)當
// 該區白話簡介用,也供 cmd/cli 的 attraction-update-photo 指令(見
// cmd/cli/http.go 的 attractionUpdatePhoto)重新查詢地標圖片時使用——
// 這是套件對外的正式入口,故大寫匯出而非只服務套件內部。
func (c *Client) SearchLandmarkWithPhoto(ctx context.Context, query string) (place Place, photoRef string, rating float64, summary string, err error) {
	if c.apiKey == "" {
		return Place{}, "", 0, "", ErrNoKey
	}
	if query == "" {
		return Place{}, "", 0, "", ErrNotFound
	}

	reqBody := map[string]any{
		"textQuery":    query,
		"pageSize":     1,
		"languageCode": "zh-TW",
	}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return Place{}, "", 0, "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", placesURL, bytes.NewReader(jsonBody))
	if err != nil {
		return Place{}, "", 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", districtFieldMask)

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
	Name     string  `json:"name"`
	Address  string  `json:"address"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Rating   float64 `json:"rating,omitempty"`
	Summary  string  `json:"summary,omitempty"`
	PhotoRef string  `json:"-"` // 同 NearbyPlace.PhotoRef,呼叫端需另外呼叫 PhotoDataURI 轉成 data URI
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

	url := fmt.Sprintf("https://places.googleapis.com/v1/places/%s", placeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return PlaceDetails{}, err
	}
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", placeDetailsFieldMask)

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
		details.PhotoRef = body.Photos[0].Name
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

	url := fmt.Sprintf("https://places.googleapis.com/v1/places/%s", placeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", photoRefsFieldMask)

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
// 的網址——理由見呼叫端(SearchDistricts)的說明:圖片資料要跟著這支
// 端點本身的 JSON 回應一起送出,才能沿用前端既有的已驗證 fetch()
// 路徑,不受瀏覽器 <img> 標籤無法附加自訂 Authorization header 的限制。
// GOOGLE_PLACES_API_KEY 只在這支函式内部、伺服器對伺服器的請求裡出現,
// 不會出現在回傳給前端的任何資料裡。
func (c *Client) fetchPhotoAsDataURI(ctx context.Context, placeID, photoResourceName string, maxWidthPx int) (string, error) {
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
	// 函式說明),兩者都是 no-op,直接往下真的向 Google 查詢。
	if c.cache != nil && placeID != "" {
		if dataURI, ok := c.cache.Get(placeID, photoIndex, maxWidthPx); ok {
			return dataURI, nil
		}
	}

	dataURI, err := c.downloadPhotoBytes(ctx, photoResourceName, maxWidthPx)
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
func (c *Client) downloadPhotoBytes(ctx context.Context, photoResourceName string, maxWidthPx int) (string, error) {
	if !photosEnabled {
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

	// languageCode 固定繁中,理由同 Search()。
	reqBody := map[string]any{
		"maxResultCount": maxN,
		"languageCode":   "zh-TW",
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
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", nearbyURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	if includePhotos {
		req.Header.Set("X-Goog-FieldMask", nearbyFieldMask+",places.photos")
	} else {
		req.Header.Set("X-Goog-FieldMask", nearbyFieldMask)
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
// SearchDistricts/SearchKnownDistricts;飯店圖層(handleGeoAttractions)
// 需要在套件外對 NearbyPlace 結果做同樣的轉換,故加這層薄包裝,
// 不重複實作下載邏輯。
func (c *Client) PhotoDataURI(ctx context.Context, placeID, photoRef string, maxWidthPx int) (string, error) {
	return c.fetchPhotoAsDataURI(ctx, placeID, photoRef, maxWidthPx)
}
