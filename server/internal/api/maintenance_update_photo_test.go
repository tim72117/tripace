package api

// maintenance_update_photo_test.go 測 POST
// /internal/maintenance/attractions/{id}/update-photo
// (handleMaintenanceAttractionUpdatePhoto)——2026-10 code review 抓到
// 「補圖」與「補 place_id」兩個邏輯上獨立的操作被互相要求對方先完成
// (原本這支端點要求地標必須已經透過 attraction set-place-id 登記過
// place_id,沒有就直接 400 拒絕)。使用者明確要求「place 與 photo 就
// 分離」,改成 place_id 依優先序決定:
//  1. 呼叫端這次明確帶入的 body.PlaceID
//  2. 地標資料庫裡原本就登記的 place_id
//  3. 都沒有時,退回這次 Google 查詢(SearchLandmarkWithPhoto)命中的
//     place.PlaceID
//
// 測試風格參考 geo_outline_place_photo_progress_test.go 的
// fakePlaceDetailsGateway/newPlaceDetailsFixture 模式,但這支端點走的是
// SearchLandmarkWithPhoto("places.searchText")+PhotoDataURI
// ("places.photoMedia")這兩個 endpoint,不是 handleGeoPlaceDetails 用的
// "places.get",故另外寫一個對應的假 gateway。
import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/store"
)

// fakeMaintenancePhotoGateway 滿足 geo 套件內部未匯出的 requestDoer 介面
// (見 fakePlaceDetailsGateway 的說明,Go 隱式介面滿足規則)——固定回傳
// searchedPlaceID 當 SearchLandmarkWithPhoto 查詢命中的 place_id,固定
// 回傳一張照片的 resource name,photoMedia 分支回傳假的圖片位元組。
type fakeMaintenancePhotoGateway struct {
	searchedPlaceID string
}

func (g *fakeMaintenancePhotoGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	switch endpoint {
	case "places.searchText":
		body := map[string]any{
			"places": []map[string]any{
				{
					"id":               g.searchedPlaceID,
					"displayName":      map[string]any{"text": "測試地標"},
					"formattedAddress": "測試地址",
					"location":         map[string]any{"latitude": 35.0, "longitude": 135.76},
					"rating":           4.5,
					"photos":           []map[string]any{{"name": "places/" + g.searchedPlaceID + "/photos/photo0"}},
					"editorialSummary": map[string]any{"text": "測試簡介"},
				},
			},
		}
		b, _ := json.Marshal(body)
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(b))}, nil
	case "places.photoMedia":
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte("fake-jpeg-bytes")))}, nil
	default:
		panic("fakeMaintenancePhotoGateway 收到未預期的 endpoint: " + endpoint)
	}
}

// maintenanceUpdatePhotoFixture 是「已登入使用者 + 可打路由的 mux」,只給
// 這個檔案的測試共用,比照 placeDetailsFixture 的模式。
type maintenanceUpdatePhotoFixture struct {
	server *Server
	routes http.Handler
	token  string
}

func newMaintenanceUpdatePhotoFixture(t *testing.T, searchedPlaceID string) *maintenanceUpdatePhotoFixture {
	t.Helper()
	geo.SetPhotosEnabled(true)
	t.Cleanup(func() { geo.SetPhotosEnabled(false) })

	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newMaintenancePhotoClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, &fakeMaintenancePhotoGateway{searchedPlaceID: searchedPlaceID})
	}
	s.photoUploader = photostorage.NewForTest("test-bucket", photostorage.NewMemoryObjectStore())

	user, err := s.store.CreatePasswordUser("usr_maint_photo", "補圖測試員", "#8C7B6A", "maint-photo@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &maintenanceUpdatePhotoFixture{server: s, routes: s.Routes(), token: token}
}

func (f *maintenanceUpdatePhotoFixture) updatePhoto(t *testing.T, id string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/internal/maintenance/attractions/"+id+"/update-photo", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+f.token)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var respBody map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&respBody)
	}
	return resp, respBody
}

// TestHandleMaintenanceAttractionUpdatePhoto_NoPlaceIDRegistered_UsesSearchResult
// 驗證「place 與 photo 就分離」的核心情境:地標完全沒有登記 place_id、
// 呼叫端這次也沒有明確指定 placeId,補圖操作仍然成功,photo_assets 的 key
// 改用這次查詢命中的 place.PlaceID——不再像改動前那樣直接 400 拒絕。
func TestHandleMaintenanceAttractionUpdatePhoto_NoPlaceIDRegistered_UsesSearchResult(t *testing.T) {
	const searchedPlaceID = "place_from_search"
	f := newMaintenanceUpdatePhotoFixture(t, searchedPlaceID)

	attraction, err := f.server.store.CreateAttraction(model.Attraction{
		Name: "測試地標", CityName: "測試城市", Lat: 35.0, Lng: 135.76, Level: 3,
	})
	if err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}
	if attraction.PlaceID != nil {
		t.Fatalf("前置條件錯誤:這筆地標不該有 place_id,實際 = %v", *attraction.PlaceID)
	}

	resp, body := f.updatePhoto(t, attraction.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if got, _ := body["placeId"].(string); got != searchedPlaceID {
		t.Errorf("placeId = %q,期待退回查詢命中的 %q", got, searchedPlaceID)
	}

	asset, ok, err := f.server.store.GetPhotoAsset(searchedPlaceID, 0, "full")
	if err != nil {
		t.Fatalf("GetPhotoAsset failed: %v", err)
	}
	if !ok {
		t.Fatalf("photo_assets 應該以查詢命中的 place_id (%s) 為 key 寫入一筆", searchedPlaceID)
	}
	if asset.GCSURL == "" {
		t.Error("GCSURL 不該是空字串")
	}
}

// TestHandleMaintenanceAttractionUpdatePhoto_RegisteredPlaceID_UsedByDefault
// 驗證優先序第二順位:地標資料庫裡已經登記了 place_id、呼叫端這次沒有
// 明確指定 body.PlaceID 時,沿用地標既有登記的 place_id 當 key(對齊
// 改動前的既有行為,不是這次新增的情境,但在新的優先序邏輯下需要確認
// 沒有被破壞)。
func TestHandleMaintenanceAttractionUpdatePhoto_RegisteredPlaceID_UsedByDefault(t *testing.T) {
	const registeredPlaceID = "place_registered"
	const searchedPlaceID = "place_from_search_should_be_ignored"
	f := newMaintenanceUpdatePhotoFixture(t, searchedPlaceID)

	placeIDPtr := registeredPlaceID
	attraction, err := f.server.store.CreateAttraction(model.Attraction{
		Name: "測試地標", CityName: "測試城市", Lat: 35.0, Lng: 135.76, Level: 3,
		PlaceID: &placeIDPtr,
	})
	if err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	resp, body := f.updatePhoto(t, attraction.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if got, _ := body["placeId"].(string); got != registeredPlaceID {
		t.Errorf("placeId = %q,期待沿用地標既有登記的 %q", got, registeredPlaceID)
	}

	if _, ok, _ := f.server.store.GetPhotoAsset(registeredPlaceID, 0, "full"); !ok {
		t.Errorf("photo_assets 應該以地標既有登記的 place_id (%s) 為 key 寫入一筆", registeredPlaceID)
	}
}

// TestHandleMaintenanceAttractionUpdatePhoto_ExplicitPlaceID_OverridesRegistered
// 驗證優先序最高順位:呼叫端這次明確帶入 body.PlaceID 時,即使地標資料庫
// 裡已經登記了另一個 place_id,也以這次明確指定的為準——對應 CLI 的
// -place-id 旗標,讓使用者可以在同一次補圖操作裡覆寫要寫入哪個 key,不
// 需要先跑 attraction set-place-id 改掉地標本身的登記值。
func TestHandleMaintenanceAttractionUpdatePhoto_ExplicitPlaceID_OverridesRegistered(t *testing.T) {
	const registeredPlaceID = "place_registered_should_be_ignored"
	const explicitPlaceID = "place_explicit_override"
	const searchedPlaceID = "place_from_search_should_be_ignored"
	f := newMaintenanceUpdatePhotoFixture(t, searchedPlaceID)

	placeIDPtr := registeredPlaceID
	attraction, err := f.server.store.CreateAttraction(model.Attraction{
		Name: "測試地標", CityName: "測試城市", Lat: 35.0, Lng: 135.76, Level: 3,
		PlaceID: &placeIDPtr,
	})
	if err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	resp, body := f.updatePhoto(t, attraction.ID, map[string]any{"placeId": explicitPlaceID})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if got, _ := body["placeId"].(string); got != explicitPlaceID {
		t.Errorf("placeId = %q,期待以這次明確帶入的 %q 為準", got, explicitPlaceID)
	}

	if _, ok, _ := f.server.store.GetPhotoAsset(explicitPlaceID, 0, "full"); !ok {
		t.Errorf("photo_assets 應該以這次明確帶入的 place_id (%s) 為 key 寫入一筆", explicitPlaceID)
	}
	if _, ok, _ := f.server.store.GetPhotoAsset(registeredPlaceID, 0, "full"); ok {
		t.Error("不該誤用地標資料庫裡原本登記的 place_id 當 key")
	}
}
