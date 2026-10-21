package api

// geo_place_photo_expiry_test.go 測「照片過期週期可設定」(2026-10)。
//
// 照片資產寫入 photo_assets 時 expires_at = 寫入當下 + 設定的天數(預設 7,
// 原本寫死,見 photoAssetExpiry)。注意語意:這個設定只影響「之後寫入」的
// 資產;已經存在的資產保留自己當時算好的 expires_at(讀取端的新鮮度判斷看的
// 是那個欄位,不會因為設定改變而回頭重算)。
//
// 測試結構(使用者要求「各個參數都先隔離測試,然後再合併測試」):
//
//	隔離:預設值 / 不同天數 / 非法值被忽略 / 不回溯既有資產 / CLI 補圖端點
//	合併:跟「照片最大張數」一起設定、設定中途變更、過期換新時用目前設定
import (
	"fmt"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

func assertAssetExpiresInDays(t *testing.T, s *Server, placeID string, index, days int) {
	t.Helper()
	asset, ok, err := s.store.GetPhotoAsset(placeID, index, "full")
	if err != nil || !ok {
		t.Fatalf("GetPhotoAsset(%s,%d) ok=%v err=%v", placeID, index, ok, err)
	}
	if asset.ExpiresAt == nil {
		t.Fatalf("index %d 的 ExpiresAt 不該是 nil", index)
	}
	want := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	if diff := asset.ExpiresAt.Sub(want); diff < -time.Minute || diff > time.Minute {
		t.Errorf("index %d 應約 %d 天後過期(%v),實際 %v,差距 %v", index, days, want, *asset.ExpiresAt, diff)
	}
}

// ===== 隔離 =====

func TestPhotoExpiry_Isolated_DefaultIsSevenDays(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	if got := s.PhotoExpiryDays(); got != 7 {
		t.Errorf("預設應為 7 天,實際 %d", got)
	}
	if got := s.PhotoAssetExpiry(); got != 7*24*time.Hour {
		t.Errorf("PhotoAssetExpiry 預設應為 7*24h,實際 %v", got)
	}
}

func TestPhotoExpiry_Isolated_NewAssetExpiresAfterConfiguredDays(t *testing.T) {
	for _, days := range []int{1, 2, 7, 14, 30} {
		t.Run(fmt.Sprintf("%d天", days), func(t *testing.T) {
			gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("過期週期測試", 1)}
			placeID := fmt.Sprintf("ChIJ_expiry_%d", days)
			s := newPhotoCountServer(t, gw, placeID, 0)
			s.SetPhotoExpiryDays(days)

			hitPlaceDetailsAny(t, s, gw, placeID)

			assertAssetExpiresInDays(t, s, placeID, 0, days)
		})
	}
}

func TestPhotoExpiry_Isolated_InvalidValuesAreIgnored(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	s.SetPhotoExpiryDays(5)
	for _, bad := range []int{0, -1, -7, 31, 1000} {
		s.SetPhotoExpiryDays(bad)
		if got := s.PhotoExpiryDays(); got != 5 {
			t.Errorf("SetPhotoExpiryDays(%d) 不該生效(0 會讓照片一寫入就過期),目前 %d", bad, got)
		}
	}
}

// 已存在的資產保留寫入當時算好的 expires_at,改設定不回溯。
func TestPhotoExpiry_Isolated_ChangingSettingDoesNotRewriteExistingAssets(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("既有資產", 1)}
	placeID := "ChIJ_expiry_existing"
	s := newPhotoCountServer(t, gw, placeID, 0)
	writeFreshPhotoAsset(t, s, placeID, 0) // 7 天後過期

	s.SetPhotoExpiryDays(2)

	assertAssetExpiresInDays(t, s, placeID, 0, 7)
}

// CLI 的「重新補圖」維運端點是另一個寫入 photo_assets 的地方,也要用設定值,
// 否則兩個寫入點的過期週期會不一致。
func TestPhotoExpiry_Isolated_MaintenanceUpdatePhotoUsesTheSetting(t *testing.T) {
	const searchedPlaceID = "place_expiry_maintenance"
	f := newMaintenanceUpdatePhotoFixture(t, searchedPlaceID)
	f.server.SetPhotoExpiryDays(3)

	attraction, err := f.server.store.CreateAttraction(model.Attraction{
		Name: "測試地標", CityName: "測試城市", Lat: 35.0, Lng: 135.76, Level: 3,
	})
	if err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}
	resp, body := f.updatePhoto(t, attraction.ID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("狀態碼 = %d;body=%v", resp.StatusCode, body)
	}

	assertAssetExpiresInDays(t, f.server, searchedPlaceID, 0, 3)
}

// ===== 合併 =====

// 同時設定「最大張數 2」與「過期 3 天」:只補 2 張,而且兩張都在 3 天後過期。
func TestPhotoExpiry_Combined_WithMaxCount(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("五張照片", 5)}
	placeID := "ChIJ_expiry_with_max"
	s := newPhotoCountServer(t, gw, placeID, 99) // 點擊上限 3
	s.SetPhotoMaxCount(2)
	s.SetPhotoExpiryDays(3)

	for i := 0; i < 4; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if got := gw.count("places.photoMedia"); got != 2 {
		t.Fatalf("最大張數 2,應只補 2 張,實際 photoMedia=%d", got)
	}
	assertAssetExpiresInDays(t, s, placeID, 0, 3)
	assertAssetExpiresInDays(t, s, placeID, 1, 3)
	if _, ok, _ := s.store.GetPhotoAsset(placeID, 2, "full"); ok {
		t.Error("index 2 超過最大張數,不該被補")
	}
}

// 設定中途變更:每張照片用「它被寫入當下」的設定,先補的不受後來的改動影響。
func TestPhotoExpiry_Combined_ChangeBetweenFills_EachAssetUsesSettingAtWriteTime(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("三張照片", 3)}
	placeID := "ChIJ_expiry_between"
	s := newPhotoCountServer(t, gw, placeID, 99) // 點擊上限 3
	s.SetPhotoMaxCount(2)
	s.SetPhotoExpiryDays(3)

	hitPlaceDetailsAny(t, s, gw, placeID) // 補 index 0(3 天)
	s.SetPhotoExpiryDays(10)
	hitPlaceDetailsAny(t, s, gw, placeID) // 補 index 1(10 天)

	assertAssetExpiresInDays(t, s, placeID, 0, 3)
	assertAssetExpiresInDays(t, s, placeID, 1, 10)
}

// 過期換新:index 過期後重補,新的 expires_at 依「目前」的設定。補完之後
// 不再重讀(實際張數 1 已記下、已到達上限)。
func TestPhotoExpiry_Combined_RefreshAfterExpiryUsesCurrentSetting(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("一張照片", 1)}
	placeID := "ChIJ_expiry_refresh"
	s := newPhotoCountServer(t, gw, placeID, 0)
	_ = s.store.SetPlacePhotoCount(placeID, 1)
	writeExpiredPhotoAsset(t, s, placeID, 0)
	s.SetPhotoExpiryDays(4)

	hitPlaceDetailsAny(t, s, gw, placeID)
	assertAssetExpiresInDays(t, s, placeID, 0, 4)

	getsAfterRefresh := gw.count("places.get")
	for i := 0; i < 3; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := gw.count("places.get"); got != getsAfterRefresh {
		t.Errorf("換新完成後不該再重讀地點資訊:places.get %d → %d", getsAfterRefresh, got)
	}
}
