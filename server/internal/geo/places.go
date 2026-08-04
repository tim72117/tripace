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
	"time"
)

// 新版 Places API (New) 的 Text Search 端點(POST)。
// 舊版為 maps.googleapis.com/maps/api/place/textsearch/json(GET),已於 2026 遷移至此。
const placesURL = "https://places.googleapis.com/v1/places:searchText"

// fieldMask 指定新版 API 要回傳哪些欄位(新版必填 header X-Goog-FieldMask,
// 不給會回 400)。只取目前用到的:顯示名稱、格式化地址、經緯度。
const fieldMask = "places.displayName,places.formattedAddress,places.location"

// nearbyURL 是 Places API (New) 的 Nearby Search 端點(POST),依座標+半徑找附近地點。
const nearbyURL = "https://places.googleapis.com/v1/places:searchNearby"

// nearbyFieldMask 只取 Essentials 級欄位(displayName/formattedAddress/location/
// primaryType),API 呼叫成本最低。rating/userRatingCount 屬 Pro 級(較貴),
// 目前不取;若之後需要依評分排序,再評估是否值得多付費升級 field mask。
const nearbyFieldMask = "places.displayName,places.formattedAddress,places.location,places.primaryType"

// districtFieldMask 供 SearchDistricts 用:額外取 addressComponents,才能從
// 每筆景點結果反推它屬於哪個行政區/次分區(sublocality),藉此把一批景點
// 依所在區域分組、算出各區重心座標。rating 用來在同區內挑「最具代表性」
// 的地點當地標圖片來源;photos 取該地點的相片參考(id),供之後組
// Photo Media API 網址用;editorialSummary 是 Google 編輯過的地點介紹,
// 拿代表性地標的簡介當該區的白話簡介(不用 LLM 生成)。這幾個欄位皆屬
// Pro 級,呼叫成本高於 Search/SearchNearby 用的 Essentials 級。
const districtFieldMask = "places.displayName,places.formattedAddress,places.location,places.addressComponents,places.rating,places.photos,places.editorialSummary"

// Client 持有 API key，提供地點查詢。
type Client struct {
	apiKey string
	http   *http.Client
}

// New 建立 Client；apiKey 為空時 Search 永遠回傳 ErrNoKey。
func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 5 * time.Second},
	}
}

var ErrNoKey = fmt.Errorf("geo: Google Places API key 未設定")
var ErrNotFound = fmt.Errorf("geo: 找不到符合的地點")

// Place 是候選地點結果。
type Place struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

// NearbyPlace 是 Nearby Search 的候選景點。
// 目前 fieldMask 只取 Essentials 級欄位(呼叫成本最低),不含 rating/評論數
// (屬 Pro 級,較貴);候選順序即 Places API 回傳的相關性排序。
type NearbyPlace struct {
	Name        string  `json:"name"`
	Address     string  `json:"address"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	PrimaryType string  `json:"primaryType"` // 如 tourist_attraction、restaurant、museum
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

	resp, err := c.http.Do(req)
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

	resp, err := c.http.Do(req)
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
			if photoURL, err := c.fetchPhotoAsDataURI(ctx, g.landmarkPhoto, 400); err == nil {
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
// city 沒有命中已知城市時,回傳 (nil, false),呼叫端(handleGeoDistricts)
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
			if photoURL, err := c.fetchPhotoAsDataURI(ctx, photoRef, 400); err == nil {
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
// 該區白話簡介用,也供 cmd/cli 的 landmark-update-photo 指令(見
// cmd/cli/db.go 的 landmarkUpdatePhoto)重新查詢地標圖片時使用——
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

	resp, err := c.http.Do(req)
	if err != nil {
		return Place{}, "", 0, "", fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Place{}, "", 0, "", fmt.Errorf("geo: request failed (HTTP %d)", resp.StatusCode)
	}

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
	}
	if len(p.Photos) > 0 {
		photoRef = p.Photos[0].Name
	}
	return place, photoRef, p.Rating, p.EditorialSummary.Text, nil
}

// fetchPhotoAsDataURI 下載 Places API (New) 的 photo resource name(如
// "places/xxx/photos/yyy")對應的圖片位元組,編碼成 data: URI(base64,
// 含 MIME type)回傳,可直接當 <img src> 使用。maxWidthPx 建議與實際
// 顯示尺寸相近即可(圓形地標圖預期顯示範圍小,不需要原始解析度),
// 避免浪費頻寬與 Google 端計費用量。
//
// 這裡直接把圖片位元組編碼進回應,而非回傳一個「前端需要另外發請求」
// 的網址——理由見呼叫端(SearchDistricts)的說明:圖片資料要跟著這支
// 端點本身的 JSON 回應一起送出,才能沿用前端既有的已驗證 fetch()
// 路徑,不受瀏覽器 <img> 標籤無法附加自訂 Authorization header 的限制。
// GOOGLE_PLACES_API_KEY 只在這支函式内部、伺服器對伺服器的請求裡出現,
// 不會出現在回傳給前端的任何資料裡。
func (c *Client) fetchPhotoAsDataURI(ctx context.Context, photoResourceName string, maxWidthPx int) (string, error) {
	if photoResourceName == "" || c.apiKey == "" {
		return "", ErrNoKey
	}
	if maxWidthPx <= 0 {
		maxWidthPx = 400
	}
	mediaURL := fmt.Sprintf("https://places.googleapis.com/v1/%s/media?maxWidthPx=%d&key=%s",
		photoResourceName, maxWidthPx, c.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return "", err
	}
	// Photo Media API 預設會對原始請求做 302 導向到實際圖片 CDN 網址;
	// http.Client 預設會自動跟隨 redirect,這裡不需要額外處理。
	resp, err := c.http.Do(req)
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

	resp, err := c.http.Do(req)
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
// SearchDistricts/SearchKnownDistricts;飯店圖層(handleGeoDistricts)
// 需要在套件外對 NearbyPlace 結果做同樣的轉換,故加這層薄包裝,
// 不重複實作下載邏輯。
func (c *Client) PhotoDataURI(ctx context.Context, photoRef string, maxWidthPx int) (string, error) {
	return c.fetchPhotoAsDataURI(ctx, photoRef, maxWidthPx)
}
