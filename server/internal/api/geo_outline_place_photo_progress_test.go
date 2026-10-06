package api

// geo_outline_place_photo_progress_test.go 測 GET /internal/geo/place-details
// (handleGeoPlaceDetails)一般模式的補圖主流程串接——驗證
// IncrementPlaceClickCount/photoCapForClickCount/decidePlacePhotoRefreshIndex
// 是否真的被 handler 正確串起來(純函式本身的邏輯已經在
// geo_place_photo_refresh_test.go 驗證過,這裡不重複測那些案例,只驗證
// handler 有沒有正確呼叫這些元件、正確把決策結果寫回 photo_assets、
// 正確回報 photoRefreshPending 旗標)。
//
// 2026-10 新補圖節奏(取代舊的 shouldAddGooglePlacePhoto/
// resetPhotoProgressOnTargetChange/decidePlacePhotoAction,見
// geo_place_photo_refresh_test.go 檔頭的完整說明)——三條路徑:
//
//  1. 快取未命中:同步呼叫 GetPlaceDetails(拿文字資料+PhotoRefs)寫入
//     place_details_cache,用本地 photo_assets 新鮮度判斷這次要不要
//     補圖,先回傳(body 帶 photoRefreshPending),背景非同步下載該
//     index 的照片(不需要再打一次 Google,PhotoRefs 已經拿到了)。
//  2. 快取命中、判斷不需要補圖:完全不打任何 Google API(零成本),
//     直接回傳 photoRefreshPending=false。
//  3. 快取命中、判斷需要補圖:先回傳 photoRefreshPending=true,背景
//     非同步呼叫 GetPlaceDetails(不是舊的窄 ListPlacePhotoRefs——
//     同一個 Enterprise 計費等級,但順便更新 place_details_cache 的
//     文字欄位)拿到 PhotoRefs 後下載該 index 照片。
//
// 不再有「點擊節奏」或「7 天時間」這兩個獨立觸發條件——新機制「過期
// 即視為需要補」已經涵蓋原本時間觸發想解決的問題(照片會過期,需要
// 有人重新確認),不需要額外的時間節流規則。
//
// 測試風格參考 geo_outline_geocode_test.go 的
// fakeSearchTextGateway/newTestServerWithFakeGeoGateway 模式(見該檔案
// 開頭的完整說明)。這裡的假 gateway 需要處理兩種 endpoint:
//
//   - "places.get":對應 geo.Client.GetPlaceDetails——2026-10 新節奏下
//     快取未命中與快取命中需要補圖這兩條路徑都呼叫這支(field mask
//     都是完整的 placeDetailsFieldMask,不再有只查 "photos" 的窄
//     ListPlacePhotoRefs 變體,見檔頭的完整說明),故 fakeGateway 不需要
//     再依 field mask 內容區分兩種回應,固定回傳 detailsBody 即可。
//   - "places.photoMedia":對應 geo.Client.PhotoDataURI(內部呼叫
//     downloadPhotoBytes)下載單張照片位元組。
import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/store"
)

// placeDetailsGatewayCall 記錄一次 fakePlaceDetailsGateway.Do 被呼叫時的
// endpoint 與 field mask,供測試斷言「這次點擊實際打了哪些 Google API」。
type placeDetailsGatewayCall struct {
	endpoint  string
	fieldMask string
}

// fakePlaceDetailsGateway 滿足 geo 套件內部未匯出的 requestDoer 介面
// (見 fakeSearchTextGateway 的說明,Go 隱式介面滿足規則)。
//
//   - detailsBody:GetPlaceDetails 該回傳的假 JSON,模擬 Google 目前這個
//     地點的 photos[] 完整清單——2026-10 新節奏下,快取未命中與快取
//     命中需要補圖這兩條路徑都是呼叫這支、回傳同一種格式,不再需要
//     像舊版 photoRefsBody 那樣另外準備一份窄 field mask 的回應。
//   - photoMediaEnabled:對應 geo.SetPhotosEnabled(true) 的全域開關,
//     這個套件層級開關預設 false,測試需要真的驗證下載流程時必須手動
//     開啟(見 newPlaceDetailsFixture 的說明)。
type fakePlaceDetailsGateway struct {
	detailsBody string
	calls       []placeDetailsGatewayCall
}

func (g *fakePlaceDetailsGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	fieldMask := req.Header.Get("X-Goog-FieldMask")
	g.calls = append(g.calls, placeDetailsGatewayCall{endpoint: endpoint, fieldMask: fieldMask})

	switch endpoint {
	case "places.get":
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte(g.detailsBody)))}, nil
	case "places.photoMedia":
		// downloadPhotoBytes 直接讀 response body 當圖片位元組使用(見
		// 該函式的說明,不解析 JSON),回傳一小段假的圖片位元組即可。
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte("fake-jpeg-bytes")))}, nil
	default:
		panic("fakePlaceDetailsGateway 收到未預期的 endpoint: " + endpoint)
	}
}

// placeDetailsJSON 組一份 Place Details 假回應 body——photoCount 張
// 照片,每張 resource name 依序編號,方便測試斷言下載的是第幾張。
func placeDetailsJSON(name string, photoCount int) string {
	type photo struct {
		Name string `json:"name"`
	}
	photos := make([]photo, photoCount)
	for i := range photos {
		photos[i].Name = "places/test-place/photos/photo" + string(rune('a'+i))
	}
	body := map[string]any{
		"displayName":      map[string]any{"text": name},
		"formattedAddress": "測試地址",
		"location":         map[string]any{"latitude": 35.0, "longitude": 135.76},
		"rating":           4.5,
		"photos":           photos,
		"editorialSummary": map[string]any{"text": "測試簡介"},
	}
	b, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// placeDetailsFixture 是「已登入使用者 + 可打路由的 mux」,只給這個檔案
// 的測試共用(比照 geoGeocodeFixture 的模式)。
type placeDetailsFixture struct {
	server *Server
	routes http.Handler
	token  string
}

// newPlaceDetailsFixture 建一個 Server,把 newPlaceDetailsClient 換成
// 「內部 gateway 是 fakeGateway」的 geo.Client——handleGeoPlaceDetails
// 一般模式因此可以整支被驗證,不會真的打 Google API。
//
// 這裡呼叫 geo.SetPhotosEnabled(true)(套件層級全域開關,見該函式的
// 說明)——預設 false 時 downloadPhotoBytes 會直接回 ErrPhotosDisabled,
// 讓所有照片下載都失敗,測試將永遠驗證不到「有沒有真的下載到照片」這件
// 事。這是套件全域狀態,測試結束後用 t.Cleanup 還原成關閉,避免影響
// 同一個測試二進位檔內其他套件測試(這些測試預設假設關閉)。
func newPlaceDetailsFixture(t *testing.T, fakeGateway *fakePlaceDetailsGateway) *placeDetailsFixture {
	t.Helper()
	geo.SetPhotosEnabled(true)
	t.Cleanup(func() { geo.SetPhotosEnabled(false) })

	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newPlaceDetailsClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	// backgroundFillPlacePhoto(2026-10 新補圖節奏)寫入 photo_assets 前
	// 一定要先成功上傳 GCS(不像舊版 landmarkPhotoURLFromDataURI 那樣
	// upload 失敗還能退回原始 dataURI 當 fallback),故這裡必須換成能
	// 真的「成功」的假 Uploader,否則所有背景補圖測試都會卡在
	// ErrNoBucket、photo_assets 永遠寫不進去——理由同
	// geo_outline_photo_assets_sync_test.go 既有的 fixture 設定。
	s.photoUploader = photostorage.NewForTest("test-bucket", photostorage.NewMemoryObjectStore())

	user, err := s.store.CreatePasswordUser("usr_geo_photo", "地點照片測試員", "#8C7B6A", "geo-photo@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &placeDetailsFixture{server: s, routes: s.Routes(), token: token}
}

func (f *placeDetailsFixture) get(t *testing.T, placeID string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/geo/place-details?placeId="+placeID, nil)
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

// placeDetailsFieldMaskForTest 對齊 geo.Client.GetPlaceDetails 實際使用的
// field mask(該常數未匯出,geo 套件外部無法直接引用,見該檔案
// placeDetailsFieldMask 的定義)——這裡只是把字面值抄一份供測試斷言
// 「背景補圖呼叫的是完整 GetPlaceDetails,不是只查 photos 的窄 field
// mask」,字面值變動時這裡要跟著同步更新。
const placeDetailsFieldMaskForTest = "displayName,formattedAddress,location,rating,photos,editorialSummary"

// writeFreshPhotoAsset 直接寫入一筆「現在仍在有效期內」的 photo_assets
// 紀錄,供測試準備「這個 index 目前是新鮮的」這個前置狀態,不需要真的
// 走一次補圖流程。
func writeFreshPhotoAsset(t *testing.T, s *Server, placeID string, photoIndex int) {
	t.Helper()
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: placeID, PhotoIndex: photoIndex, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/test-bucket/fresh.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("writeFreshPhotoAsset: UpsertPhotoAsset failed: %v", err)
	}
}

// writeExpiredPhotoAsset 直接寫入一筆已經過期的 photo_assets 紀錄,供
// 測試準備「這個 index 存在但已過期,該被換新」這個前置狀態。
func writeExpiredPhotoAsset(t *testing.T, s *Server, placeID string, photoIndex int) {
	t.Helper()
	expiresAt := time.Now().Add(-time.Hour)
	if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: placeID, PhotoIndex: photoIndex, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/test-bucket/expired.jpg",
		FetchedAt: time.Now().Add(-8 * 24 * time.Hour), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("writeExpiredPhotoAsset: UpsertPhotoAsset failed: %v", err)
	}
}

// TestHandleGeoPlaceDetails_CacheMiss_RespondsPendingAndDownloadsFirstPhoto
// 對應路徑 1(快取未命中):驗證同步回應不帶照片、photoRefreshPending
// 為 true,背景完成後 photo_assets 有 index=0 這一筆。
func TestHandleGeoPlaceDetails_CacheMiss_RespondsPendingAndDownloadsFirstPhoto(t *testing.T) {
	const placeID = "place_first_visit"
	// Google 這個地點目前實際有 3 張照片,但初次查詢應該只下載第一張
	// (photoCapForClickCount(1)==1,見 geo_place_photo_refresh_test.go)。
	gw := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("測試地點", 3)}
	f := newPlaceDetailsFixture(t, gw)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	googlePhotos, _ := body["googlePhotoUrls"].([]any)
	if len(googlePhotos) != 0 {
		t.Fatalf("這次同步回應不該帶照片(下載已改背景執行),實際 = %d 張(%v)", len(googlePhotos), googlePhotos)
	}
	pending, _ := body["photoRefreshPending"].(bool)
	if !pending {
		t.Error("快取未命中且觸發補圖時,photoRefreshPending 應該是 true")
	}

	asset := waitForPhotoAsset(t, f.server, placeID, 0)
	if asset.GCSURL == "" {
		t.Error("背景補圖完成後 GCSURL 不該是空字串")
	}
}

// TestHandleGeoPlaceDetails_CacheHit_NothingStaleWithinCap_SkipsGoogleCall
// 對應路徑 2(快取命中、不需要補圖):cap 範圍內已經全部新鮮,完全不該
// 打任何 Google API(零成本路徑),photoRefreshPending 回傳 false。
func TestHandleGeoPlaceDetails_CacheHit_NothingStaleWithinCap_SkipsGoogleCall(t *testing.T) {
	const placeID = "place_cache_hit_no_trigger"
	gw := &fakePlaceDetailsGateway{}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// 墊 9 次點擊(click_count 之後會變成 10 次之前都是 cap=1,見
	// photoCapForClickCount)——這裡刻意停在 9,讓接下來 f.get 這次點擊
	// 累積到 click_count=10(cap 從 1 變成 2),但 index=0 已經是新鮮
	// 紀錄,index=1 這個新名額本來會觸發——為了單純驗證「零觸發」這個
	// 分支,改停在 click_count=8(這次點擊後為 9,cap 仍是 1),只需要
	// index=0 新鮮即可。
	for i := 0; i < 8; i++ {
		if _, err := f.server.store.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount failed: %v", err)
		}
	}
	writeFreshPhotoAsset(t, f.server, placeID, 0)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 0 {
		t.Fatalf("cap 範圍內已全部新鮮時不該呼叫任何 Google API,實際打了 %d 次: %v", len(gw.calls), gw.calls)
	}
	pending, hasPending := body["photoRefreshPending"].(bool)
	if !hasPending || pending {
		t.Errorf("不需要補圖時 photoRefreshPending 應該是 false,實際 = %v(存在=%v)", pending, hasPending)
	}
}

// TestHandleGeoPlaceDetails_CacheHit_CapGrowsOpensNewSlot_TriggersRefresh
// 對應路徑 3(快取命中、需要補圖)其中一種成因:click_count 跨過 10 這
// 個邊界,cap 從 1 變成 2,多出來的名額(index=1)觸發背景補圖——驗證
// 背景呼叫的是完整的 GetPlaceDetails(field mask 含 displayName 等
// 文字欄位,不是舊版窄 field mask 的 ListPlacePhotoRefs),且
// place_details_cache 的文字欄位有被一併更新。
func TestHandleGeoPlaceDetails_CacheHit_CapGrowsOpensNewSlot_TriggersRefresh(t *testing.T) {
	const placeID = "place_cache_hit_cap_grows"
	gw := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("重新查到的名稱", 5)}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "舊名稱", "舊地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// 墊到 click_count=9,這次 f.get 會讓 click_count 變成 10(cap 從
	// photoCapForClickCount(9)=1 變成 photoCapForClickCount(10)=2)。
	for i := 0; i < 9; i++ {
		if _, err := f.server.store.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount failed: %v", err)
		}
	}
	writeFreshPhotoAsset(t, f.server, placeID, 0)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	pending, _ := body["photoRefreshPending"].(bool)
	if !pending {
		t.Error("cap 擴大開出新名額時,photoRefreshPending 應該是 true")
	}

	asset := waitForPhotoAsset(t, f.server, placeID, 1)
	if asset.GCSURL == "" {
		t.Error("背景補圖完成後 index=1 的 GCSURL 不該是空字串")
	}

	foundFullDetailsCall := false
	for _, c := range gw.calls {
		if c.endpoint == "places.get" && c.fieldMask == placeDetailsFieldMaskForTest {
			foundFullDetailsCall = true
		}
	}
	if !foundFullDetailsCall {
		t.Fatalf("背景補圖應該呼叫完整 field mask 的 GetPlaceDetails(field mask=%q),實際呼叫紀錄 = %v", placeDetailsFieldMaskForTest, gw.calls)
	}

	// 背景的 GetPlaceDetails 順便更新了 place_details_cache 的文字欄位
	// (見 handleGeoPlaceDetails 路徑 3 的完整說明:同一次查詢同時扮演
	// 「補圖」與「刷新文字快取」兩個角色,不需要再靠獨立的 24 小時
	// textStale 機制另外重查一次)。
	deadline := time.Now().Add(2 * time.Second)
	row, ok, err := f.server.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	for (err == nil && ok && row.Name != "重新查到的名稱") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
		row, ok, err = f.server.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	}
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok || row.Name != "重新查到的名稱" {
		t.Errorf("place_details_cache 的 name 應該被背景查詢更新成「重新查到的名稱」,實際 = %q(ok=%v)", row.Name, ok)
	}
}

// TestHandleGeoPlaceDetails_CacheHit_ExpiredPhotoWithinCap_TriggersRefresh
// 對應路徑 3 的另一種成因、也是 2026-10 診斷清水寺照片全數過期卻沒有
// 觸發補圖那次要修正的核心案例:cap 範圍內有一張已過期的照片,即使
// click_count 沒有跨過任何 cap 邊界,也該觸發補圖換掉它。
func TestHandleGeoPlaceDetails_CacheHit_ExpiredPhotoWithinCap_TriggersRefresh(t *testing.T) {
	const placeID = "place_cache_hit_expired_photo"
	gw := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("", 1)}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	for i := 0; i < 8; i++ {
		if _, err := f.server.store.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount failed: %v", err)
		}
	}
	// index=0 存在,但已經過期——cap=1(click_count 這次點擊後是 9)時,
	// 這是 cap 範圍內唯一的 index,過期就該觸發補圖換掉它。
	writeExpiredPhotoAsset(t, f.server, placeID, 0)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	pending, _ := body["photoRefreshPending"].(bool)
	if !pending {
		t.Error("cap 範圍內有過期照片時,photoRefreshPending 應該是 true")
	}

	// 等待背景把 index=0 換成新鮮紀錄(FetchedAt 比呼叫前新)。
	before := time.Now()
	deadline := before.Add(2 * time.Second)
	for time.Now().Before(deadline) {
		asset, ok, err := f.server.store.GetPhotoAsset(placeID, 0, "full")
		if err != nil {
			t.Fatalf("GetPhotoAsset failed: %v", err)
		}
		if ok && asset.FetchedAt.After(before.Add(-time.Second)) && asset.ExpiresAt != nil && asset.ExpiresAt.After(time.Now()) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("等待過期照片被背景換成新鮮紀錄逾時")
}
