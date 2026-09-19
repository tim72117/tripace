package api

// geo_outline_public_place_details_test.go 測 GET /public/geo/place-details
// (handlePublicGeoPlaceDetails)的白名單把關本身——這支端點刻意不掛
// internalAuth(見 api.go 路由註冊處的說明),供登入前的公開展示頁使用,
// publicPlaceDetailsAllowlist 是唯一的濫用防護,故這裡只驗證「白名單
// 之外一律拒絕、且不觸發任何下游查詢」與「白名單內的請求會被轉呼叫給
// handleGeoPlaceDetails」——後者完整的查詢/快取/降級行為已經在
// geo_outline_place_photo_progress_test.go 測過,這裡不重複驗證那些案例。
import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlePublicGeoPlaceDetails_NotInAllowlist_Returns403(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId=ChIJ-not-in-allowlist", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for placeId not in allowlist, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoPlaceDetails_EmptyPlaceID_Returns403(t *testing.T) {
	s := newTestServer(t)

	// 沒帶 placeId 查詢參數——publicPlaceDetailsAllowlist[""] 查無此鍵,
	// map 的零值判斷自然回傳 false,不需要另外特判空字串,但這裡明確測一次
	// 確保這個邊界情況真的落在「拒絕」分支,不會意外通過白名單檢查後才在
	// handleGeoPlaceDetails 內部才被攔下(那樣會變成 400 而非 403,語意
	// 上代表白名單這層完全沒有生效)。
	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for empty placeId, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoPlaceDetails_StripsPhotoOnlyAndTextOnlyQueryParams(t *testing.T) {
	s := newTestServer(t)

	// 這支端點的文件註解宣稱「不支援 photoOnly/textOnly 這兩種輕量
	// 模式」,但轉呼叫給 handleGeoPlaceDetails 前若沒有明確清掉這兩個
	// query 參數,呼叫端只要自行在網址後面加上 &photoOnly=1 就能繞過這個
	// 說明、實際觸發輕量模式(見 handlePublicGeoPlaceDetails 的完整
	// 說明)。用一個不存在的 name 搭配 photoOnly=1 驗證:若沒有真的被
	// 清掉,handleGeoPlaceDetails 的 photoOnly 分支會先檢查 name 是否
	// 存在(見該函式對 photoOnly 分支的說明),缺少 name 時回 400
	// invalid_input;若確實被清掉,請求會落到一般模式,不會出現這個
	// 400。用這個行為差異間接驗證參數真的被移除,不需要直接檢查
	// r.URL.RawQuery(該值在 handler 執行完後才能觀察,但這裡測的是
	// handleGeoPlaceDetails 內部依 query 參數選擇的分支)。
	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId=ChIJB_vchdMIAWARujTEUIZlr2I&photoOnly=1", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code == http.StatusBadRequest {
		t.Fatalf("photoOnly query param should have been stripped before forwarding, but got 400 (photoOnly 分支特有的錯誤): %s", rec.Body.String())
	}
}

func TestHandlePublicGeoPlaceDetails_InAllowlist_ForwardsToHandleGeoPlaceDetails(t *testing.T) {
	s := newTestServer(t)

	// 白名單內的 placeId(清水寺)——不 mock geo.Client 的 gateway,這次
	// 請求會在 handleGeoPlaceDetails 內部嘗試真的打 Google API 並失敗
	// (測試環境沒有網路/API key),但重點是驗證它有沒有被白名單擋下:
	// 只要回應不是這支端點自己組的 403 place_not_allowed,就代表白名單
	// 檢查通過、請求真的被轉呼叫給 handleGeoPlaceDetails 處理(不論該
	// handler 最終回應什麼狀態碼)。
	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details?placeId=ChIJB_vchdMIAWARujTEUIZlr2I", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetails(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("placeId in allowlist should not be rejected by the allowlist check, got 403 (body: %s)", rec.Body.String())
	}
}
