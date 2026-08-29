package api

// geo_outline_geocode_test.go 測 GET /internal/geo/geocode
// (handleGeoGeocode)——地理輪廓底圖三個查地點入口(城市搜尋框/地圖上方
// 類別標籤/「搜尋這個區域」按鈕)共用的後端端點,涵蓋 mode=bias 的兩階段
// 判斷邏輯(0/1/多筆各自的分支,見 handleGeoGeocode 的完整說明)與
// mode=restrict 的固定行為。
//
// 這支 handler 直接寫死呼叫 geo.New(apiKey)(真的打 Google Places API),
// 不透過任何可注入的依賴——為了讓這裡的兩階段判斷邏輯(整支流程最複雜、
// 最容易在重構時被改壞的部分)能被驗證,Server 新增了一個只服務這支
// handler 的可覆寫欄位 newGeoGeocodeClient(見 api.go 的說明),測試用
// newTestServerWithFakeGeoGateway 把它換成「內部 gateway 是假實作」的
// client,不會真的發出網路請求、不消耗 Google API 配額。
//
// fakeSearchTextGateway 依請求 body 裡是否帶 locationRestriction/
// locationBias,回傳測試預先安排好的假 JSON——藉此驅動
// handleGeoGeocode 走到 bias/restrict 各自分支、以及 bias 模式依候選
// 筆數(0/1/多筆)決定要不要進第二階段的判斷,不需要真的理解 Google 回傳
// 內容的地理意義。
import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/store"
)

// fakeSearchTextGatewayCall 記錄一次 fakeSearchTextGateway.Do 被呼叫時的
//請求內容——供測試斷言「這次呼叫實際帶了什麼 locationBias/
// locationRestriction」,不只看最終回應。fieldMask 額外記錄
// X-Goog-FieldMask header——handleGeoGeocode 的三個查詢分支都帶
// IncludePhotos: true(見 geo.Client.Search 對這個欄位的處理:field mask
// 額外加上 ",places.photos"),這個 header 實際送出的內容原本沒有被
// 斷言過,只驗證了 request body。
type fakeSearchTextGatewayCall struct {
	body      map[string]any
	fieldMask string
}

// fakeSearchTextGateway 滿足 geo 套件內部未匯出的 requestDoer 介面
// (Go 的隱式介面滿足規則允許套件外的型別滿足它,不需要能命名這個
// interface,見 geo.NewWithGateway 的說明)。responses 依呼叫順序(第一次
// 呼叫用 responses[0],第二次用 responses[1]......)回傳預先準備好的假
// Text Search JSON body,模擬 bias 模式兩階段查詢各自該收到的結果。
type fakeSearchTextGateway struct {
	responses []string
	calls     []fakeSearchTextGatewayCall
}

func (g *fakeSearchTextGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	if endpoint != "places.searchText" {
		panic("fakeSearchTextGateway 只支援 places.searchText,收到: " + endpoint)
	}
	rawBody, err := io.ReadAll(req.Body)
	if err != nil {
		panic(err)
	}
	var parsedBody map[string]any
	if err := json.Unmarshal(rawBody, &parsedBody); err != nil {
		panic(err)
	}
	g.calls = append(g.calls, fakeSearchTextGatewayCall{
		body:      parsedBody,
		fieldMask: req.Header.Get("X-Goog-FieldMask"),
	})

	idx := len(g.calls) - 1
	if idx >= len(g.responses) {
		panic("fakeSearchTextGateway 收到超出預期次數的呼叫")
	}
	respBody := g.responses[idx]
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader([]byte(respBody))),
	}, nil
}

// placesJSON 組一份 Text Search 回應 body,names 每個字串各對應一筆假
// 候選地點(座標/地址是隨便填的固定值,這裡的測試不驗證座標數值本身,
// 只驗證候選筆數與是否正確傳遞到 handleGeoGeocode 的回應)。
func placesJSON(names ...string) string {
	type place struct {
		DisplayName struct {
			Text string `json:"text"`
		} `json:"displayName"`
		FormattedAddress string `json:"formattedAddress"`
		Location         struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"location"`
		ID string `json:"id"`
	}
	places := make([]place, len(names))
	for i, name := range names {
		places[i].DisplayName.Text = name
		places[i].FormattedAddress = "测试地址"
		places[i].Location.Latitude = 35.0
		places[i].Location.Longitude = 135.76
		places[i].ID = "place_" + name
	}
	b, err := json.Marshal(map[string]any{"places": places})
	if err != nil {
		panic(err)
	}
	return string(b)
}

// newTestServerWithFakeGeoGateway 建一個 Server,把 newGeoGeocodeClient
// 換成回傳「內部 gateway 是 fakeGateway」的 geo.Client——handleGeoGeocode
// 因此可以整支被驗證(含兩階段串接判斷),不會真的打 Google API。
func newTestServerWithFakeGeoGateway(t *testing.T, fakeGateway *fakeSearchTextGateway) *Server {
	t.Helper()
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newGeoGeocodeClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	return s
}

// geoGeocodeFixture 是一組「已登入使用者 + 可打路由的 mux」,只給這個
// 檔案的測試共用(不像 newEntryFixture 需要行程,handleGeoGeocode 不檢查
// 行程成員身分,見 api.go 的 internalAuth 說明)。
type geoGeocodeFixture struct {
	routes http.Handler
	token  string
}

func newGeoGeocodeFixture(t *testing.T, fakeGateway *fakeSearchTextGateway) *geoGeocodeFixture {
	t.Helper()
	// geo.Client.Search 在 apiKey 為空字串時直接回 ErrNoKey,不會真的呼叫
	// gateway.Do——這裡的假值只需要非空,fakeSearchTextGateway 本來就不會
	// 真的驗證它,不依賴開發機是否設定過真實的 GOOGLE_PLACES_API_KEY。
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	s := newTestServerWithFakeGeoGateway(t, fakeGateway)
	user, err := s.store.CreatePasswordUser("usr_geo", "地圖測試員", "#8C7B6A", "geo@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &geoGeocodeFixture{routes: s.Routes(), token: token}
}

func (f *geoGeocodeFixture) get(t *testing.T, path string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var body map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&body)
	}
	return resp, body
}

// metersPerDegreeLatForTest 對齊 geo.RectFromCenterRadius 內部用的换算
// 常數(該常數本身未匯出,這裡各自獨立算一份——理由同該函式的說明:
// 這是標準地理座標換算,不是要重新驗證數學公式本身,是要驗證
// handleGeoGeocode 有沒有把「呼叫端傳入的中心座標/半徑」正確傳給這個
// 換算函式,故獨立算一份預期值比對,不直接呼叫 geo.RectFromCenterRadius
// 求「預期值」——那樣測試會變成恆真,測不出呼叫端傳錯參數的情況)。
const metersPerDegreeLatForTest = 111320.0

// assertLocationRestrictionRect 斷言某次 Google API 請求 body 帶的
// locationRestriction 矩形,是否對應 centerLat/centerLng/radiusMeters
// 換算出的預期值(見 geo.RectFromCenterRadius 的公式)。
func assertLocationRestrictionRect(t *testing.T, reqBody map[string]any, centerLat, centerLng, radiusMeters float64) {
	t.Helper()
	if _, hasBias := reqBody["locationBias"]; hasBias {
		t.Errorf("帶 locationRestriction 的請求不該同時帶 locationBias,實際 body = %v", reqBody)
	}
	restriction, ok := reqBody["locationRestriction"].(map[string]any)
	if !ok {
		t.Fatalf("應該帶 locationRestriction,實際請求 body = %v", reqBody)
	}
	rect, ok := restriction["rectangle"].(map[string]any)
	if !ok {
		t.Fatalf("locationRestriction 應該是 rectangle 形狀,實際 = %v", restriction)
	}
	low := rect["low"].(map[string]any)
	high := rect["high"].(map[string]any)

	deltaLat := radiusMeters / metersPerDegreeLatForTest
	deltaLng := radiusMeters / (metersPerDegreeLatForTest * math.Cos(centerLat*math.Pi/180))
	wantLowLat, wantHighLat := centerLat-deltaLat, centerLat+deltaLat
	wantLowLng, wantHighLng := centerLng-deltaLng, centerLng+deltaLng

	const eps = 0.0001
	if diff := low["latitude"].(float64) - wantLowLat; diff < -eps || diff > eps {
		t.Errorf("low.latitude = %v,期待約 %v(中心 %v、半徑 %vm)", low["latitude"], wantLowLat, centerLat, radiusMeters)
	}
	if diff := low["longitude"].(float64) - wantLowLng; diff < -eps || diff > eps {
		t.Errorf("low.longitude = %v,期待約 %v(中心 %v、半徑 %vm)", low["longitude"], wantLowLng, centerLng, radiusMeters)
	}
	if diff := high["latitude"].(float64) - wantHighLat; diff < -eps || diff > eps {
		t.Errorf("high.latitude = %v,期待約 %v(中心 %v、半徑 %vm)", high["latitude"], wantHighLat, centerLat, radiusMeters)
	}
	if diff := high["longitude"].(float64) - wantHighLng; diff < -eps || diff > eps {
		t.Errorf("high.longitude = %v,期待約 %v(中心 %v、半徑 %vm)", high["longitude"], wantHighLng, centerLng, radiusMeters)
	}
}

// TestHandleGeoGeocode_Restrict 對應類別標籤(景點/飯店/餐廳)/「搜尋這個
// 區域」按鈕的固定行為:mode=restrict 只打一次 Google API,帶
// locationRestriction(不帶 locationBias),不做兩階段判斷,矩形範圍正確
// 對應呼叫端傳入的中心座標與半徑。
func TestHandleGeoGeocode_Restrict(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON("錦市場", "京都塔")}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=景點&lat=35&lng=135.76&mode=restrict&radius=1500")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	if len(gw.calls) != 1 {
		t.Fatalf("restrict 模式應該只打一次 Google API,實際打了 %d 次", len(gw.calls))
	}
	assertLocationRestrictionRect(t, gw.calls[0].body, 35, 135.76, 1500)
	// handleGeoGeocode 呼叫 client.Search 時固定帶 IncludePhotos: true
	// (見該 handler 三個查詢分支的說明),field mask 因此該包含
	// "places.photos"——這是實際會送給 Google 的請求裡,先前只驗證了
	// request body、沒驗證過的 header 維度。
	if !strings.Contains(gw.calls[0].fieldMask, "places.photos") {
		t.Errorf("X-Goog-FieldMask = %q,應該包含 places.photos(IncludePhotos: true)", gw.calls[0].fieldMask)
	}

	candidates, ok := body["candidates"].([]any)
	if !ok || len(candidates) != 2 {
		t.Fatalf("candidates 應該有 2 筆,實際 = %v", body["candidates"])
	}
}

// TestHandleGeoGeocode_Restrict_MissingLatLng 對應 handleGeoGeocode 對
// restrict 模式的必要參數檢查:沒有 lat/lng 就該直接回錯誤,不嘗試打
// Google API(呼叫端理應保證 restrict 模式一定帶座標,但 handler 本身仍
// 須防呆)。
func TestHandleGeoGeocode_Restrict_MissingLatLng(t *testing.T) {
	gw := &fakeSearchTextGateway{}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=景點&mode=restrict")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("狀態碼 = %d,期待 400;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 0 {
		t.Fatalf("缺少 lat/lng 時不該打任何 Google API 請求,實際打了 %d 次", len(gw.calls))
	}
}

// TestHandleGeoGeocode_Bias_SingleResult 對應城市搜尋框查詢意圖明確的
// 地名(如「京都」)——bias 第一次查詢剛好回 1 筆,直接採用,不進第二階段
// (不該再打第二次 Google API)。
func TestHandleGeoGeocode_Bias_SingleResult(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON("京都")}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=%E4%BA%AC%E9%83%BD&lat=35&lng=135.76")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 1 {
		t.Fatalf("bias 模式剛好 1 筆時應該只打一次 Google API,實際打了 %d 次", len(gw.calls))
	}
	reqBody := gw.calls[0].body
	if _, hasRestriction := reqBody["locationRestriction"]; hasRestriction {
		t.Errorf("bias 模式第一次查詢不該帶 locationRestriction,實際請求 body = %v", reqBody)
	}
	if _, hasBias := reqBody["locationBias"]; !hasBias {
		t.Errorf("bias 模式第一次查詢應該帶 locationBias,實際請求 body = %v", reqBody)
	}

	candidates, ok := body["candidates"].([]any)
	if !ok || len(candidates) != 1 {
		t.Fatalf("candidates 應該有 1 筆,實際 = %v", body["candidates"])
	}
}

// TestHandleGeoGeocode_Bias_NoResult 對應 bias 第一次查詢查無結果——直接
// 回查無結果,不重試(見 handleGeoGeocode 的完整說明:locationRestriction
// 只會讓結果更少,重試沒有幫助)。
func TestHandleGeoGeocode_Bias_NoResult(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON()}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E5%9C%B0%E6%96%B9&lat=35&lng=135.76")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("狀態碼 = %d,期待 404;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 1 {
		t.Fatalf("bias 模式 0 筆時不該重試,應該只打一次 Google API,實際打了 %d 次", len(gw.calls))
	}
}

// TestHandleGeoGeocode_Bias_MultipleResults_EscalatesToRestrict 對應
// 「東京 vs 京都」這類文字意圖不明確的查詢——bias 第一次查詢回多筆候選
// 時,改用 locationRestriction 重新查一次,回傳第二次的結果(不是第一次
// 的)。這是整支 handler 最容易在重構時被改壞的分支(見這個檔案開頭的
// 說明),也是 geo_outline.go 那段「地圖在京都搜東京」設計討論實際對應
// 到的程式碼路徑。
func TestHandleGeoGeocode_Bias_MultipleResults_EscalatesToRestrict(t *testing.T) {
	gw := &fakeSearchTextGateway{
		responses: []string{
			placesJSON("甜點店A", "甜點店B", "甜點店C"), // 第一次(bias):3 筆,意圖不明確
			placesJSON("甜點店A", "甜點店B"),          // 第二次(restrict 收斂):2 筆
		},
	}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=%E7%94%9C%E9%BB%9E&lat=35&lng=135.76")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 2 {
		t.Fatalf("bias 模式多筆候選時應該打兩次 Google API(bias 一次 + restrict 收斂一次),實際打了 %d 次", len(gw.calls))
	}

	// 第一次呼叫應該是 bias(不帶 locationRestriction)。
	firstBody := gw.calls[0].body
	if _, hasRestriction := firstBody["locationRestriction"]; hasRestriction {
		t.Errorf("第一次(bias)查詢不該帶 locationRestriction,實際 = %v", firstBody)
	}

	// 第二次呼叫應該是 restrict(帶 locationRestriction,不帶
	// locationBias——見 geo.Client.Search 對兩者互斥的處理)。
	secondBody := gw.calls[1].body
	if _, hasRestriction := secondBody["locationRestriction"]; !hasRestriction {
		t.Errorf("第二次(收斂)查詢應該帶 locationRestriction,實際 = %v", secondBody)
	}
	if _, hasBias := secondBody["locationBias"]; hasBias {
		t.Errorf("第二次(收斂)查詢不該帶 locationBias,實際 = %v", secondBody)
	}

	// 兩次呼叫都該帶 places.photos(IncludePhotos: true,見
	// handleGeoGeocode bias 模式兩個分支的說明),不是只有其中一次。
	if !strings.Contains(gw.calls[0].fieldMask, "places.photos") {
		t.Errorf("第一次(bias)查詢的 X-Goog-FieldMask = %q,應該包含 places.photos", gw.calls[0].fieldMask)
	}
	if !strings.Contains(gw.calls[1].fieldMask, "places.photos") {
		t.Errorf("第二次(收斂)查詢的 X-Goog-FieldMask = %q,應該包含 places.photos", gw.calls[1].fieldMask)
	}

	// 回應內容應該是第二次(收斂後)的結果,不是第一次的 3 筆。
	candidates, ok := body["candidates"].([]any)
	if !ok || len(candidates) != 2 {
		t.Fatalf("candidates 應該是收斂後的 2 筆,實際 = %v", body["candidates"])
	}
	for _, c := range candidates {
		name, _ := c.(map[string]any)["name"].(string)
		if !strings.HasPrefix(name, "甜點店") {
			t.Errorf("候選名稱不符預期: %v", c)
		}
	}
}

// TestHandleGeoGeocode_Bias_MultipleResults_NoCenter_SkipsEscalation 對應
// 「沒有可用地圖中心座標」的情境(理論上呼叫端在地圖尚未建立完成前不該
// 觸發查詢,這裡驗證 handler 本身的防呆分支)——bias 查到多筆但沒有
// lat/lng 可組 locationRestriction 矩形,直接採用 bias 這次的結果,不
// 嘗試進第二階段。
func TestHandleGeoGeocode_Bias_MultipleResults_NoCenter_SkipsEscalation(t *testing.T) {
	gw := &fakeSearchTextGateway{
		responses: []string{placesJSON("甜點店A", "甜點店B", "甜點店C")},
	}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=%E7%94%9C%E9%BB%9E")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 1 {
		t.Fatalf("沒有可用中心座標時不該進第二階段,應該只打一次 Google API,實際打了 %d 次", len(gw.calls))
	}
	candidates, ok := body["candidates"].([]any)
	if !ok || len(candidates) != 3 {
		t.Fatalf("candidates 應該沿用第一次(bias)的 3 筆,實際 = %v", body["candidates"])
	}
}

// TestHandleGeoGeocode_Restrict_CustomRadius 對應呼叫端(目前只有
// GeoOutlineMap.tsx 的 categoryQueryRadiusMeters)明確帶 radius 參數的
// 情境——矩形範圍該隨半徑變化,不是固定套用預設值。跟
// TestHandleGeoGeocode_Restrict(1500m)刻意用不同的半徑(3000m),確保
// 這裡驗證的是「radius 參數真的有生效」,不是矩形公式本身固定不變導致
// 兩個測試巧合都通過。
func TestHandleGeoGeocode_Restrict_CustomRadius(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON("錦市場")}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=景點&lat=35&lng=135.76&mode=restrict&radius=3000")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 1 {
		t.Fatalf("應該只打一次 Google API,實際打了 %d 次", len(gw.calls))
	}
	assertLocationRestrictionRect(t, gw.calls[0].body, 35, 135.76, 3000)
}

// TestHandleGeoGeocode_Restrict_DefaultRadius 對應呼叫端省略 radius 參數
// 的情境——退回 geoGeocodeDefaultRestrictRadiusMeters(1500m,見該常數的
// 說明),不是 0 或報錯。
func TestHandleGeoGeocode_Restrict_DefaultRadius(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON("錦市場")}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=景點&lat=35&lng=135.76&mode=restrict")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	assertLocationRestrictionRect(t, gw.calls[0].body, 35, 135.76, geoGeocodeDefaultRestrictRadiusMeters)
}

// TestHandleGeoGeocode_Restrict_RadiusClampedToMax 對應呼叫端(理論上不
// 會發生,防呆用)傳入超過 maxNearbyRadiusMeters 上限的半徑——該被夾到
// 上限值,不是照單全收送給 Google API(避免查詢範圍意外擴大到整座城市
// 以外)。
func TestHandleGeoGeocode_Restrict_RadiusClampedToMax(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON("錦市場")}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=景點&lat=35&lng=135.76&mode=restrict&radius=999999")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	assertLocationRestrictionRect(t, gw.calls[0].body, 35, 135.76, maxNearbyRadiusMeters)
}

// TestHandleGeoGeocode_Restrict_NonPositiveRadiusFallsBackToDefault 對應
// radius=0 或負數這種不合理輸入——視為未提供,退回預設值,不是照字面值
// 0 組出一個沒有範圍的矩形送給 Google API。
func TestHandleGeoGeocode_Restrict_NonPositiveRadiusFallsBackToDefault(t *testing.T) {
	gw := &fakeSearchTextGateway{responses: []string{placesJSON("錦市場")}}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=景點&lat=35&lng=135.76&mode=restrict&radius=-100")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	assertLocationRestrictionRect(t, gw.calls[0].body, 35, 135.76, geoGeocodeDefaultRestrictRadiusMeters)
}

// TestHandleGeoGeocode_Bias_EscalatesToRestrict_UsesDefaultRadius_IgnoresQueryRadius
// 對應 bias 模式沒有 radius 這個查詢參數可用(見 handleGeoGeocode 開頭
// 對 mode=bias 參數的說明)——即使呼叫端在 URL 上夾帶了 radius(理論上
// 城市搜尋框呼叫端 GeoOutlinePanel.tsx 不會這麼做,這裡驗證 handler
// 本身不會誤讀這個參數),收斂階段的矩形範圍仍然固定套用
// geoGeocodeDefaultRestrictRadiusMeters,不受它影響。
func TestHandleGeoGeocode_Bias_EscalatesToRestrict_UsesDefaultRadius_IgnoresQueryRadius(t *testing.T) {
	gw := &fakeSearchTextGateway{
		responses: []string{
			placesJSON("甜點店A", "甜點店B", "甜點店C"),
			placesJSON("甜點店A", "甜點店B"),
		},
	}
	f := newGeoGeocodeFixture(t, gw)

	resp, body := f.get(t, "/internal/geo/geocode?query=%E7%94%9C%E9%BB%9E&lat=35&lng=135.76&radius=9999")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 2 {
		t.Fatalf("應該打兩次 Google API,實際打了 %d 次", len(gw.calls))
	}
	assertLocationRestrictionRect(t, gw.calls[1].body, 35, 135.76, geoGeocodeDefaultRestrictRadiusMeters)
}
