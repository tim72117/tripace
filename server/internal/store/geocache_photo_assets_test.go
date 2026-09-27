package store

// geocache_photo_assets_test.go 測 photo_assets 表相關的 store 函式
// (見 photoAssetRow 的完整說明)——UpsertPhotoAsset/GetFreshPhotoAssetURL/
// ListFreshPhotoAssetURLsForPlace/GetPhotoAsset 是這張全站共通圖檔落地
// 紀錄表的核心讀寫介面,ListAllGooglePlacePhotos/ListAllCachedPhotos/
// DeleteGooglePlacePhoto/DeleteCachedPhoto 則供 cmd/migrate-photo-assets
// 一次性遷移腳本使用。用 newTestStore(見 store_test.go/testing.go 的
// OpenTest)開一個真的 SQLite 記憶體資料庫,不是 mock DB。
import (
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

func TestUpsertPhotoAsset_GetPhotoAsset_RoundTrip(t *testing.T) {
	s := newTestStore(t)
	fetchedAt := time.Now().Add(-time.Hour)
	expiresAt := time.Now().Add(6 * 24 * time.Hour)

	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/place-1-0.jpg",
		FetchedAt: fetchedAt, ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("UpsertPhotoAsset failed: %v", err)
	}

	asset, ok, err := s.GetPhotoAsset("place-1", 0, "full")
	if err != nil {
		t.Fatalf("GetPhotoAsset failed: %v", err)
	}
	if !ok {
		t.Fatal("expected ok=true, got false")
	}
	if asset.GCSURL != "https://storage.googleapis.com/bucket/place-1-0.jpg" {
		t.Fatalf("unexpected GCSURL: %q", asset.GCSURL)
	}
	if asset.Source != "google" {
		t.Fatalf("expected Source=google, got %q", asset.Source)
	}
	if asset.ExpiresAt == nil {
		t.Fatal("expected ExpiresAt to be set")
	}
}

func TestGetPhotoAsset_NotFound_ReturnsFalseNotError(t *testing.T) {
	s := newTestStore(t)

	_, ok, err := s.GetPhotoAsset("no-such-place", 0, "full")
	if err != nil {
		t.Fatalf("expected no error for missing record, got: %v", err)
	}
	if ok {
		t.Fatal("expected ok=false for missing record")
	}
}

func TestUpsertPhotoAsset_SameKeyOverwrites(t *testing.T) {
	s := newTestStore(t)
	firstExpiry := time.Now().Add(1 * time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/old.jpg",
		FetchedAt: time.Now(), ExpiresAt: &firstExpiry,
	}); err != nil {
		t.Fatalf("first UpsertPhotoAsset failed: %v", err)
	}

	// 同一組複合主鍵 (place_id, photo_index, usage) 再次寫入,理當整列
	// 覆寫(見該函式的完整說明:「重新遷移同一張圖時應該更新過期時間,
	// 不是保留舊值」),不是報錯或忽略。
	newExpiry := time.Now().Add(7 * 24 * time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/new.jpg",
		FetchedAt: time.Now(), ExpiresAt: &newExpiry,
	}); err != nil {
		t.Fatalf("second UpsertPhotoAsset failed: %v", err)
	}

	asset, ok, err := s.GetPhotoAsset("place-1", 0, "full")
	if err != nil || !ok {
		t.Fatalf("GetPhotoAsset failed: ok=%v err=%v", ok, err)
	}
	if asset.GCSURL != "https://storage.googleapis.com/bucket/new.jpg" {
		t.Fatalf("expected overwrite to new.jpg, got %q", asset.GCSURL)
	}
}

func TestGetFreshPhotoAssetURL_FreshRecord_ReturnsURL(t *testing.T) {
	s := newTestStore(t)
	expiresAt := time.Now().Add(6 * 24 * time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/place-1-0.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("UpsertPhotoAsset failed: %v", err)
	}

	url, ok, err := s.GetFreshPhotoAssetURL("place-1")
	if err != nil {
		t.Fatalf("GetFreshPhotoAssetURL failed: %v", err)
	}
	if !ok {
		t.Fatal("expected ok=true for fresh record")
	}
	if url != "https://storage.googleapis.com/bucket/place-1-0.jpg" {
		t.Fatalf("unexpected url: %q", url)
	}
}

func TestGetFreshPhotoAssetURL_ExpiredRecord_ReturnsNotOK(t *testing.T) {
	s := newTestStore(t)
	// UpsertPhotoAsset 寫入前一律轉成 UTC(見該函式的完整說明,含實測踩過
	// 的時區 bug 修正)——這裡刻意用一個已經過去的 ExpiresAt 驗證過期
	// 判斷本身是否正確生效,不是驗證時區轉換細節本身。
	expiresAt := time.Now().Add(-time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/expired.jpg",
		FetchedAt: time.Now().Add(-8 * 24 * time.Hour), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("UpsertPhotoAsset failed: %v", err)
	}

	_, ok, err := s.GetFreshPhotoAssetURL("place-1")
	if err != nil {
		t.Fatalf("GetFreshPhotoAssetURL failed: %v", err)
	}
	if ok {
		t.Fatal("expected ok=false for expired record, not回退成 stale 資料")
	}
}

func TestGetFreshPhotoAssetURL_NoExpiry_NeverConsideredStale(t *testing.T) {
	s := newTestStore(t)
	// ExpiresAt 為 nil 時(見該函式的完整說明:「expires_at 為 NULL...視為
	// 仍在有效期內」),不論 FetchedAt 多久以前都應該仍算新鮮。
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/no-expiry.jpg",
		FetchedAt: time.Now().Add(-30 * 24 * time.Hour), ExpiresAt: nil,
	}); err != nil {
		t.Fatalf("UpsertPhotoAsset failed: %v", err)
	}

	url, ok, err := s.GetFreshPhotoAssetURL("place-1")
	if err != nil {
		t.Fatalf("GetFreshPhotoAssetURL failed: %v", err)
	}
	if !ok {
		t.Fatal("expected ok=true when ExpiresAt is nil")
	}
	if url != "https://storage.googleapis.com/bucket/no-expiry.jpg" {
		t.Fatalf("unexpected url: %q", url)
	}
}

func TestGetFreshPhotoAssetURL_PrefersFullUsageOverThumb(t *testing.T) {
	s := newTestStore(t)
	expiresAt := time.Now().Add(6 * 24 * time.Hour)
	// 先寫入 thumb 規格,再寫入 full 規格(刻意反著寫,驗證排序不是單純
	// 依插入順序,而是真的照 usage 優先序挑選,見該函式的完整說明:
	// 「優先挑 usage="full"、photo_index 最小的那張」)。
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "thumb_200", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/thumb.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("seed thumb UpsertPhotoAsset failed: %v", err)
	}
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/full.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("seed full UpsertPhotoAsset failed: %v", err)
	}

	url, ok, err := s.GetFreshPhotoAssetURL("place-1")
	if err != nil || !ok {
		t.Fatalf("GetFreshPhotoAssetURL failed: ok=%v err=%v", ok, err)
	}
	if url != "https://storage.googleapis.com/bucket/full.jpg" {
		t.Fatalf("expected full usage to be preferred, got %q", url)
	}
}

func TestGetFreshPhotoAssetURL_NoRecord_ReturnsNotOKNotError(t *testing.T) {
	s := newTestStore(t)

	url, ok, err := s.GetFreshPhotoAssetURL("no-such-place")
	if err != nil {
		t.Fatalf("expected no error for missing place, got: %v", err)
	}
	if ok || url != "" {
		t.Fatalf("expected ok=false and empty url, got ok=%v url=%q", ok, url)
	}
}

func TestListFreshPhotoAssetURLsForPlace_ReturnsOnlyFullUsageOrderedByIndex(t *testing.T) {
	s := newTestStore(t)
	expiresAt := time.Now().Add(6 * 24 * time.Hour)
	// 刻意打亂插入順序,驗證回傳結果真的依 photo_index 排序,不是插入
	// 順序。也混入一筆 thumb_200 規格,驗證只回傳 usage="full" 的紀錄
	// (見該函式的完整說明)。
	seeds := []model.PhotoAsset{
		{PlaceID: "place-1", PhotoIndex: 2, Usage: "full", GCSURL: "https://x/2.jpg"},
		{PlaceID: "place-1", PhotoIndex: 0, Usage: "full", GCSURL: "https://x/0.jpg"},
		{PlaceID: "place-1", PhotoIndex: 0, Usage: "thumb_200", GCSURL: "https://x/0-thumb.jpg"},
		{PlaceID: "place-1", PhotoIndex: 1, Usage: "full", GCSURL: "https://x/1.jpg"},
	}
	for _, seed := range seeds {
		seed.Source = "google"
		seed.FetchedAt = time.Now()
		seed.ExpiresAt = &expiresAt
		if err := s.UpsertPhotoAsset(seed); err != nil {
			t.Fatalf("seed UpsertPhotoAsset(%+v) failed: %v", seed, err)
		}
	}

	urls, err := s.ListFreshPhotoAssetURLsForPlace("place-1")
	if err != nil {
		t.Fatalf("ListFreshPhotoAssetURLsForPlace failed: %v", err)
	}
	want := []string{"https://x/0.jpg", "https://x/1.jpg", "https://x/2.jpg"}
	if len(urls) != len(want) {
		t.Fatalf("expected %d urls, got %d: %+v", len(want), len(urls), urls)
	}
	for i, u := range want {
		if urls[i] != u {
			t.Fatalf("urls[%d]: expected %q, got %q (full list: %+v)", i, u, urls[i], urls)
		}
	}
}

func TestListFreshPhotoAssetURLsForPlace_ExcludesExpired(t *testing.T) {
	s := newTestStore(t)
	freshExpiry := time.Now().Add(6 * 24 * time.Hour)
	staleExpiry := time.Now().Add(-time.Hour)

	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "full", Source: "google",
		GCSURL: "https://x/fresh.jpg", FetchedAt: time.Now(), ExpiresAt: &freshExpiry,
	}); err != nil {
		t.Fatalf("seed fresh UpsertPhotoAsset failed: %v", err)
	}
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 1, Usage: "full", Source: "google",
		GCSURL: "https://x/stale.jpg", FetchedAt: time.Now().Add(-8 * 24 * time.Hour), ExpiresAt: &staleExpiry,
	}); err != nil {
		t.Fatalf("seed stale UpsertPhotoAsset failed: %v", err)
	}

	urls, err := s.ListFreshPhotoAssetURLsForPlace("place-1")
	if err != nil {
		t.Fatalf("ListFreshPhotoAssetURLsForPlace failed: %v", err)
	}
	if len(urls) != 1 || urls[0] != "https://x/fresh.jpg" {
		t.Fatalf("expected only the fresh url, got %+v", urls)
	}
}

func TestListFreshPhotoAssetURLsForPlace_NoRecords_ReturnsEmptySliceNotNil(t *testing.T) {
	s := newTestStore(t)

	urls, err := s.ListFreshPhotoAssetURLsForPlace("no-such-place")
	if err != nil {
		t.Fatalf("expected no error for missing place, got: %v", err)
	}
	if len(urls) != 0 {
		t.Fatalf("expected empty slice, got %+v", urls)
	}
}

// --- migrate-photo-assets 遷移工具使用的函式 ---

func TestListAllGooglePlacePhotos_FilterByPlaceID(t *testing.T) {
	s := newTestStore(t)
	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"}); err != nil {
		t.Fatalf("seed place-1 failed: %v", err)
	}
	if err := s.SetGooglePlacePhotos("place-2", []string{"data:image/jpeg;base64,CCC"}); err != nil {
		t.Fatalf("seed place-2 failed: %v", err)
	}

	all, err := s.ListAllGooglePlacePhotos("")
	if err != nil {
		t.Fatalf("ListAllGooglePlacePhotos(\"\") failed: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("expected 3 rows across all places, got %d: %+v", len(all), all)
	}

	filtered, err := s.ListAllGooglePlacePhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllGooglePlacePhotos(\"place-1\") failed: %v", err)
	}
	if len(filtered) != 2 {
		t.Fatalf("expected 2 rows for place-1, got %d: %+v", len(filtered), filtered)
	}
	for _, row := range filtered {
		if row.PlaceID != "place-1" {
			t.Fatalf("filter leaked other place_id: %+v", row)
		}
	}
	// 依 place_id/photo_index 排序,確認 photo_index 遞增。
	if filtered[0].PhotoIndex != 0 || filtered[1].PhotoIndex != 1 {
		t.Fatalf("expected rows ordered by photo_index, got %+v", filtered)
	}
}

func TestListAllCachedPhotos_FilterByPlaceID(t *testing.T) {
	s := newTestStore(t)
	if err := s.SetCachedPhoto("place-1", 0, 200, "data:image/jpeg;base64,AAA"); err != nil {
		t.Fatalf("seed place-1 photo 0 failed: %v", err)
	}
	if err := s.SetCachedPhoto("place-1", 1, 200, "data:image/jpeg;base64,BBB"); err != nil {
		t.Fatalf("seed place-1 photo 1 failed: %v", err)
	}
	if err := s.SetCachedPhoto("place-2", 0, 200, "data:image/jpeg;base64,CCC"); err != nil {
		t.Fatalf("seed place-2 failed: %v", err)
	}

	all, err := s.ListAllCachedPhotos("")
	if err != nil {
		t.Fatalf("ListAllCachedPhotos(\"\") failed: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("expected 3 rows across all places, got %d: %+v", len(all), all)
	}

	filtered, err := s.ListAllCachedPhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllCachedPhotos(\"place-1\") failed: %v", err)
	}
	if len(filtered) != 2 {
		t.Fatalf("expected 2 rows for place-1, got %d: %+v", len(filtered), filtered)
	}
}

func TestDeleteGooglePlacePhoto_RemovesOnlyTargetedRow(t *testing.T) {
	s := newTestStore(t)
	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"}); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	if err := s.DeleteGooglePlacePhoto("place-1", 0); err != nil {
		t.Fatalf("DeleteGooglePlacePhoto failed: %v", err)
	}

	remaining, err := s.ListAllGooglePlacePhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllGooglePlacePhotos failed: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("expected 1 row remaining, got %d: %+v", len(remaining), remaining)
	}
	if remaining[0].PhotoIndex != 1 {
		t.Fatalf("expected photo_index=1 to remain, got %+v", remaining[0])
	}
}

func TestDeleteCachedPhoto_RemovesOnlyTargetedRow(t *testing.T) {
	s := newTestStore(t)
	if err := s.SetCachedPhoto("place-1", 0, 200, "data:image/jpeg;base64,AAA"); err != nil {
		t.Fatalf("seed photo 0 failed: %v", err)
	}
	if err := s.SetCachedPhoto("place-1", 0, 400, "data:image/jpeg;base64,BBB"); err != nil {
		t.Fatalf("seed photo 0 at another width failed: %v", err)
	}

	// 只刪 (place-1, 0, 200) 這一列,同一個 photo_index 但不同 max_width_px
	// 的另一列不該受影響(見該函式的完整說明,主鍵包含 max_width_px)。
	if err := s.DeleteCachedPhoto("place-1", 0, 200); err != nil {
		t.Fatalf("DeleteCachedPhoto failed: %v", err)
	}

	remaining, err := s.ListAllCachedPhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllCachedPhotos failed: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("expected 1 row remaining, got %d: %+v", len(remaining), remaining)
	}
	if remaining[0].MaxWidthPx != 400 {
		t.Fatalf("expected max_width_px=400 to remain, got %+v", remaining[0])
	}
}
