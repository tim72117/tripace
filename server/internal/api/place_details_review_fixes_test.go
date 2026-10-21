package api

// place_details_review_fixes_test.go——獨立審查(2026-10)確認的兩個 api 層缺陷,
// 先寫測試重現、再修:
//
//  1. (mergePhotoURLIntoPlaceDetailsCache 的缺陷已隨該函式一併移除。)
//  2. 地圖版 handleGeoPlaceDetails 判斷文字是否過期(textStale)用寫死的 24 小時
//     常數,不吃 placeDetailsCacheHours 設定:把設定調成 720 小時想省錢,命中的列
//     一超過 24 小時仍然每次重打 Google。
//
// 測試結構:隔離 → 合併。
import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

// ===== 2. 地圖版文字過期判斷吃 placeDetailsCacheHours =====

// textStaleFixture 建一個地圖版 handler 可打的環境:命中的快取列(N 小時前寫入)、
// 已有新鮮照片(避免觸發補圖——那會另外打 Google,不是這個測試要驗證的事)。
func textStaleRequest(t *testing.T, cacheHours int, rowAge time.Duration) (placesGet int) {
	t.Helper()
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("文字過期測試", 1)}
	f := newPlaceDetailsFixture(t, &fakePlaceDetailsGateway{})
	f.server.newPlaceDetailsClient = func(apiKey string) *geo.Client {
		c := geo.NewWithGateway(apiKey, gw)
		c.SetDetailsCache(NewPlaceDetailsCache(f.server.store))
		return c
	}
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })
	f.server.SetPlaceDetailsCacheHours(cacheHours)

	const placeID = "ChIJ_text_stale"
	if err := f.server.store.SetCachedPlaceDetails(placeID, "快取名稱", "快取地址", 1, 2, 4, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	f.server.store.SetCachedPlaceDetailsFetchedAtForTest(placeID, time.Now().Add(-rowAge))
	writeFreshPhotoAsset(t, f.server, placeID, 0)

	req := httptest.NewRequest(http.MethodGet, "/internal/geo/place-details?placeId="+placeID, nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	gw.waitBackgroundIdle(t)
	return gw.count("places.get")
}

func TestTextStale_Isolated_RowOlderThanTheSettingIsRefetched(t *testing.T) {
	// 設定 24 小時,列是 30 小時前的 → 過期,要重抓。
	if got := textStaleRequest(t, 24, 30*time.Hour); got != 1 {
		t.Errorf("超過有效期應重抓 1 次,實際 places.get=%d", got)
	}
}

func TestTextStale_Isolated_RowYoungerThanTheSettingIsServedFromCache(t *testing.T) {
	// 設定 48 小時,同樣是 30 小時前的列 → 仍新鮮,不該重抓(原本寫死 24 小時會重抓)。
	if got := textStaleRequest(t, 48, 30*time.Hour); got != 0 {
		t.Errorf("調成 48 小時後 30 小時前的列不該重抓,實際 places.get=%d", got)
	}
}

func TestTextStale_Isolated_ShorterSettingMakesARecentRowStale(t *testing.T) {
	// 設定 2 小時,3 小時前的列 → 過期(原本寫死 24 小時不會重抓)。
	if got := textStaleRequest(t, 2, 3*time.Hour); got != 1 {
		t.Errorf("調短到 2 小時後 3 小時前的列應重抓,實際 places.get=%d", got)
	}
}

func TestTextStale_Isolated_FreshRowIsNeverRefetched(t *testing.T) {
	if got := textStaleRequest(t, 24, time.Hour); got != 0 {
		t.Errorf("1 小時前的列在 24 小時設定下不該重抓,實際 places.get=%d", got)
	}
}

// ===== 3. 文字過期重查要順便更正已記下的照片張數 =====
//
// 審查指出:Google 某次暫時回空照片清單 → photo_count=0 → 之後不再補圖;地圖版的
// textStale 重查用 GetPlaceDetailsFresh 拿到了照片參照,卻沒更新張數,0 就此固定。

func TestTextStale_Isolated_RefetchCorrectsAPreviouslyRecordedZeroPhotoCount(t *testing.T) {
	const placeID = "ChIJ_text_stale_count"
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("張數更正", 3)}
	f := newPlaceDetailsFixture(t, &fakePlaceDetailsGateway{})
	f.server.newPlaceDetailsClient = func(apiKey string) *geo.Client {
		c := geo.NewWithGateway(apiKey, gw)
		c.SetDetailsCache(NewPlaceDetailsCache(f.server.store))
		return c
	}
	if err := f.server.store.SetCachedPlaceDetails(placeID, "名", "址", 1, 2, 4, nil); err != nil {
		t.Fatal(err)
	}
	f.server.store.SetCachedPlaceDetailsFetchedAtForTest(placeID, time.Now().Add(-30*time.Hour))
	f.server.recordPlacePhotoCount(placeID, 0)
	writeFreshPhotoAsset(t, f.server, placeID, 0)

	req := httptest.NewRequest(http.MethodGet, "/internal/geo/place-details?placeId="+placeID, nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	gw.waitBackgroundIdle(t)

	got, err := f.server.store.GetPlacePhotoCount(placeID)
	if err != nil || got == nil || *got != 3 {
		t.Errorf("重查拿到 3 張,photo_count 應更正為 3,實際 %v err=%v", func() any {
			if got == nil {
				return nil
			}
			return *got
		}(), err)
	}
}
