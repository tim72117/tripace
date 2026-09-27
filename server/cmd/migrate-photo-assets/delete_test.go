package main

// delete_test.go 測 runDelete/deleteOneGooglePlacePhoto/
// deleteOneCachedPhoto——這是套件文件明確標註「不可逆」的階段(見
// runDelete 的完整說明:必須晚於 migrate、且是使用者確認遷移結果後才
// 手動觸發),測試重點是「沒有對應 photo_assets 紀錄的來源列一律跳過、
// 絕不誤刪」這條安全機制。
import (
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

func TestRunDelete_AlreadyMigrated_DeletesSourceRow(t *testing.T) {
	s := store.OpenTest(t)
	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed SetGooglePlacePhotos failed: %v", err)
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: usageFull, Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/place-1-0-full.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("seed UpsertPhotoAsset failed: %v", err)
	}

	if err := runDelete(s, false, ""); err != nil {
		t.Fatalf("runDelete failed: %v", err)
	}

	remaining, err := s.ListAllGooglePlacePhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllGooglePlacePhotos failed: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("expected source row to be deleted after successful migration, got %+v", remaining)
	}
}

func TestRunDelete_NotYetMigrated_SkipsAndKeepsSourceRow(t *testing.T) {
	s := store.OpenTest(t)
	// 刻意只 seed 來源表,不寫入對應的 photo_assets 紀錄——模擬「migrate
	// 階段還沒執行過,或這一筆遷移失敗」的情境(見 runDelete 的完整說明:
	// 這是保守處理的核心情境,絕不能因為誤判而刪掉尚未安全備份的資料)。
	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed SetGooglePlacePhotos failed: %v", err)
	}

	if err := runDelete(s, false, ""); err != nil {
		t.Fatalf("runDelete failed: %v", err)
	}

	remaining, err := s.ListAllGooglePlacePhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllGooglePlacePhotos failed: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("expected source row to be KEPT when not yet migrated, got %d rows: %+v", len(remaining), remaining)
	}
}

func TestRunDelete_PhotoCache_AlsoRequiresMigratedRecord(t *testing.T) {
	s := store.OpenTest(t)
	if err := s.SetCachedPhoto("place-1", 0, 200, "data:image/jpeg;base64,QUFB"); err != nil {
		t.Fatalf("seed SetCachedPhoto failed: %v", err)
	}
	// 沒有寫入對應 photo_assets 紀錄——理當被跳過不刪。
	if err := runDelete(s, false, ""); err != nil {
		t.Fatalf("runDelete failed: %v", err)
	}
	remaining, err := s.ListAllCachedPhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllCachedPhotos failed: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("expected photo_cache row to be kept when not migrated, got %+v", remaining)
	}

	// 補上遷移紀錄後,同一筆才應該被刪除——usage 必須是 thumb_200(見
	// usageThumb 的完整說明),用錯 usage 查詢也會被視為「未遷移」。
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: "thumb_200", Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/place-1-0-thumb_200.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("seed UpsertPhotoAsset failed: %v", err)
	}
	if err := runDelete(s, false, ""); err != nil {
		t.Fatalf("second runDelete failed: %v", err)
	}
	remaining, err = s.ListAllCachedPhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllCachedPhotos failed: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("expected photo_cache row to be deleted after migration, got %+v", remaining)
	}
}

func TestRunDelete_DryRun_DoesNotDeleteAnything(t *testing.T) {
	s := store.OpenTest(t)
	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed failed: %v", err)
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if err := s.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID: "place-1", PhotoIndex: 0, Usage: usageFull, Source: "google",
		GCSURL:    "https://storage.googleapis.com/bucket/place-1-0-full.jpg",
		FetchedAt: time.Now(), ExpiresAt: &expiresAt,
	}); err != nil {
		t.Fatalf("seed UpsertPhotoAsset failed: %v", err)
	}

	if err := runDelete(s, true, ""); err != nil {
		t.Fatalf("runDelete(dryRun=true) failed: %v", err)
	}

	remaining, err := s.ListAllGooglePlacePhotos("place-1")
	if err != nil {
		t.Fatalf("ListAllGooglePlacePhotos failed: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("expected source row to survive dry-run delete, got %+v", remaining)
	}
}

func TestRunDelete_FilterByPlaceID_OnlyProcessesMatchingRecords(t *testing.T) {
	s := store.OpenTest(t)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	for _, placeID := range []string{"place-1", "place-2"} {
		if err := s.SetGooglePlacePhotos(placeID, []string{"data:image/jpeg;base64,QUFB"}); err != nil {
			t.Fatalf("seed %s failed: %v", placeID, err)
		}
		if err := s.UpsertPhotoAsset(model.PhotoAsset{
			PlaceID: placeID, PhotoIndex: 0, Usage: usageFull, Source: "google",
			GCSURL:    "https://storage.googleapis.com/bucket/" + placeID + "-0-full.jpg",
			FetchedAt: time.Now(), ExpiresAt: &expiresAt,
		}); err != nil {
			t.Fatalf("seed photo_assets for %s failed: %v", placeID, err)
		}
	}

	if err := runDelete(s, false, "place-1"); err != nil {
		t.Fatalf("runDelete with filter failed: %v", err)
	}

	remainingPlace1, _ := s.ListAllGooglePlacePhotos("place-1")
	remainingPlace2, _ := s.ListAllGooglePlacePhotos("place-2")
	if len(remainingPlace1) != 0 {
		t.Fatalf("expected place-1 source row to be deleted, got %+v", remainingPlace1)
	}
	if len(remainingPlace2) != 1 {
		t.Fatalf("expected place-2 source row to be kept (filtered out), got %+v", remainingPlace2)
	}
}
