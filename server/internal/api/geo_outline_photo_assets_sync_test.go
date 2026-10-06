package api

// geo_outline_photo_assets_sync_test.go 測 handleGeoPlaceDetails(正式登入
// 功能用的「單點地點介紹」端點)補圖節奏觸發後,是否正確把新照片背景
// 寫入 photo_assets(見 backgroundFillPlacePhoto 的完整說明),以及顯示
// 時是否無條件以 photo_assets 的內容決定回應(查到就用、查無/過期就
// 清空,不回退 google_place_photos/place_pexels_photos 這兩張舊表——見
// applyPhotoAssetsAsSource 的完整說明,統一遵循的規則,不再有「正式
// 端點才給回退」的例外)。
//
// 測試風格延續 geo_outline_place_photo_progress_test.go 的
// newPlaceDetailsFixture 模式,額外把 s.photoUploader 換成
// photostorage.NewForTest 搭配 photostorage.NewMemoryObjectStore 建立的
// 假 Uploader——不需要真的連線 GCS,也不需要設定 GCS_PHOTO_BUCKET
// 環境變數。
import (
	"net/http"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
)

// waitForPhotoAsset 輪詢 store.GetPhotoAsset,直到 syncPhotoAssetInBackground
// 的背景 goroutine 完成寫入(或逾時)——這支函式本身是 fire-and-forget,
// 呼叫端拿到 HTTP 回應時不保證背景寫入已經完成,測試需要主動等待,而不是
// 假設寫入已經跟著請求本身同步完成。
func waitForPhotoAsset(t *testing.T, s *Server, placeID string, photoIndex int) model.PhotoAsset {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		asset, ok, err := s.store.GetPhotoAsset(placeID, photoIndex, "full")
		if err != nil {
			t.Fatalf("GetPhotoAsset failed: %v", err)
		}
		if ok {
			return asset
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("等待 photo_assets 寫入逾時: placeID=%s photoIndex=%d", placeID, photoIndex)
	return model.PhotoAsset{}
}

// TestHandleGeoPlaceDetails_CacheMiss_SyncsPhotoAsset 對應快取未命中(初次
// 查詢,fetchAndCachePlaceDetails)的情境——補到第一張 Google 照片後,應該
// background 同步一份到 photo_assets,usage=full、source=google,且
// expires_at 落在大約 7 天後(photoAssetExpiry)。
func TestHandleGeoPlaceDetails_CacheMiss_SyncsPhotoAsset(t *testing.T) {
	const placeID = "place_sync_on_cache_miss"
	gw := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("測試地點", 1)}
	f := newPlaceDetailsFixture(t, gw)

	memStore := photostorage.NewMemoryObjectStore()
	f.server.photoUploader = photostorage.NewForTest("test-bucket", memStore)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	asset := waitForPhotoAsset(t, f.server, placeID, 0)
	if asset.Source != "google" {
		t.Errorf("Source = %q, want %q", asset.Source, "google")
	}
	if asset.Usage != "full" {
		t.Errorf("Usage = %q, want %q", asset.Usage, "full")
	}
	if asset.GCSURL == "" {
		t.Error("GCSURL 不該是空字串")
	}
	if asset.ExpiresAt == nil {
		t.Fatal("ExpiresAt 不該是 nil")
	}
	wantExpiry := time.Now().Add(photoAssetExpiry)
	if diff := asset.ExpiresAt.Sub(wantExpiry); diff < -time.Minute || diff > time.Minute {
		t.Errorf("ExpiresAt = %v,期待約 %v(±1 分鐘容忍),實際差距 = %v", asset.ExpiresAt, wantExpiry, diff)
	}
}

// TestHandleGeoPlaceDetails_PhotoAssetFresh_OverridesResponse 對應
// photo_assets 已有仍在有效期內的紀錄時,顯示應該優先採用它、覆蓋
// google_place_photos/pexels 組出的照片欄位——驗證 overrideWithPhotoAssets
// 的覆蓋行為,不需要真的觸發一次補圖流程。
func TestHandleGeoPlaceDetails_PhotoAssetFresh_OverridesResponse(t *testing.T) {
	const placeID = "place_photo_asset_fresh"
	gw := &fakePlaceDetailsGateway{}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// 手動塞一筆 google_place_photos——若沒有 photo_assets 介入,回應該會
	// 採用這一筆。
	if err := f.server.store.SetGooglePlacePhotos(placeID, []string{"https://storage.googleapis.com/old-bucket/stale.jpg"}); err != nil {
		t.Fatalf("SetGooglePlacePhotos failed: %v", err)
	}
	expiresAt := time.Now().Add(24 * time.Hour)
	if err := f.server.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID:    placeID,
		PhotoIndex: 0,
		Usage:      "full",
		Source:     "google",
		GCSURL:     "https://storage.googleapis.com/test-bucket/place-details/fresh.jpg",
		FetchedAt:  time.Now(),
		ExpiresAt:  &expiresAt,
	}); err != nil {
		t.Fatalf("UpsertPhotoAsset failed: %v", err)
	}

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 0 {
		t.Fatalf("這個測試不該觸發任何 Google API 呼叫,實際打了 %d 次: %v", len(gw.calls), gw.calls)
	}

	// 2026-10:photoUrl 欄位已從回應拿掉(見 placeDetailsResponse 的完整
	// 說明),只驗證 googlePhotoUrls 是否優先採用 photo_assets 的內容。
	googlePhotos, _ := body["googlePhotoUrls"].([]any)
	if len(googlePhotos) != 1 || googlePhotos[0] != "https://storage.googleapis.com/test-bucket/place-details/fresh.jpg" {
		t.Errorf("googlePhotoUrls = %v,期待只有 photo_assets 那一筆", googlePhotos)
	}
	if _, ok := body["photoUrl"]; ok {
		t.Error("回應裡不該再出現 photoUrl 欄位(見 placeDetailsResponse 的完整說明)")
	}
}

// TestHandleGeoPlaceDetails_PhotoAssetExpired_FallsBackToGooglePlacePhotos
// 對應 photo_assets 有紀錄但已過期的情境——顯示應該退回沿用
// 期待清空成空字串,不是退回 google_place_photos 的舊內容——2026-09
// 重構(見 applyPhotoAssetsAsSource 的完整說明)拿掉了「查無/過期時回退
// 舊表資料」這個行為,所有端點統一無條件以 photo_assets 決定回應內容,
// 不再區分「這支端點是正式使用者體驗才給回退」的舊設計原則。
func TestHandleGeoPlaceDetails_PhotoAssetExpired_ClearsPhotoWithoutFallback(t *testing.T) {
	const placeID = "place_photo_asset_expired"
	gw := &fakePlaceDetailsGateway{}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	if err := f.server.store.SetGooglePlacePhotos(placeID, []string{"https://storage.googleapis.com/old-bucket/still-good.jpg"}); err != nil {
		t.Fatalf("SetGooglePlacePhotos failed: %v", err)
	}
	expiredAt := time.Now().Add(-time.Hour)
	if err := f.server.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID:    placeID,
		PhotoIndex: 0,
		Usage:      "full",
		Source:     "google",
		GCSURL:     "https://storage.googleapis.com/test-bucket/place-details/expired.jpg",
		FetchedAt:  time.Now().Add(-8 * 24 * time.Hour),
		ExpiresAt:  &expiredAt,
	}); err != nil {
		t.Fatalf("UpsertPhotoAsset failed: %v", err)
	}

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	// 2026-10:photoUrl 欄位已從回應拿掉(見 placeDetailsResponse 的完整
	// 說明),改驗證 googlePhotoUrls 清空、且回應裡完全不出現這個欄位。
	if googlePhotos, _ := body["googlePhotoUrls"].([]any); len(googlePhotos) != 0 {
		t.Errorf("googlePhotoUrls = %v,期待清空(photo_assets 已過期,不回退 google_place_photos)", googlePhotos)
	}
	if _, ok := body["photoUrl"]; ok {
		t.Error("回應裡不該再出現 photoUrl 欄位(見 placeDetailsResponse 的完整說明)")
	}
}
