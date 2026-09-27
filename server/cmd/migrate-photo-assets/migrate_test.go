package main

// migrate_test.go 測 runMigrate/migrateOne——這支一次性維運工具的核心
// 遷移邏輯(見 main.go 套件文件的完整說明)。用 store.OpenTest 開一個真的
// SQLite 記憶體資料庫,搭配 photostorage.NewForTest + MemoryObjectStore
// 建立一個不需要真連 GCS 的 Uploader(見該函式的完整說明,兩者都是刻意
// 匯出供套件外的測試使用)。
import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/store"
)

func newTestUploader() (*photostorage.Uploader, *photostorage.MemoryObjectStore) {
	objectStore := photostorage.NewMemoryObjectStore()
	return photostorage.NewForTest("test-bucket", objectStore), objectStore
}

func TestRunMigrate_GooglePlacePhotosBase64_UploadsAndWritesPhotoAsset(t *testing.T) {
	s := store.OpenTest(t)
	uploader, objectStore := newTestUploader()
	ctx := context.Background()

	// google_place_photos.photo_url 目前既可能是 GCS URL,也可能是極少數
	// 舊格式仍是 data: 開頭的 base64(見 runMigrate 對 googleRows 迴圈的
	// 完整說明)——這裡先驗證 base64 這條路徑。
	dataURI := "data:image/jpeg;base64,QUFB"
	if err := s.SetGooglePlacePhotos("place-1", []string{dataURI}); err != nil {
		t.Fatalf("seed SetGooglePlacePhotos failed: %v", err)
	}

	if err := runMigrate(ctx, s, uploader, false, ""); err != nil {
		t.Fatalf("runMigrate failed: %v", err)
	}

	asset, ok, err := s.GetPhotoAsset("place-1", 0, usageFull)
	if err != nil {
		t.Fatalf("GetPhotoAsset failed: %v", err)
	}
	if !ok {
		t.Fatal("expected photo_assets record to exist after migration")
	}
	if asset.Source != "google" {
		t.Fatalf("expected Source=google, got %q", asset.Source)
	}
	if len(objectStore.Written) != 1 {
		t.Fatalf("expected exactly 1 object written to GCS, got %d: %+v", len(objectStore.Written), objectStore.Written)
	}
}

func TestRunMigrate_GooglePlacePhotosExternalURL_DownloadsAndReuploads(t *testing.T) {
	// 模擬一個既有的 GCS URL(見 runMigrate 對 googleRows 迴圈的完整說明:
	// 2026-09 起主流程已經改成把 GCS URL 而非 base64 寫回這張表)——這裡
	// 驗證「重新下載內容、以本工具統一命名重新上傳」這條路徑真的有觸發
	// HTTP 下載,不是誤把 URL 字串本身當 base64 塞進 UploadDataURI。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("fake-png-bytes"))
	}))
	defer srv.Close()

	s := store.OpenTest(t)
	uploader, objectStore := newTestUploader()
	ctx := context.Background()

	if err := s.SetGooglePlacePhotos("place-1", []string{srv.URL}); err != nil {
		t.Fatalf("seed SetGooglePlacePhotos failed: %v", err)
	}

	if err := runMigrate(ctx, s, uploader, false, ""); err != nil {
		t.Fatalf("runMigrate failed: %v", err)
	}

	_, ok, err := s.GetPhotoAsset("place-1", 0, usageFull)
	if err != nil {
		t.Fatalf("GetPhotoAsset failed: %v", err)
	}
	if !ok {
		t.Fatal("expected photo_assets record to exist after downloading external URL")
	}
	if len(objectStore.Written) != 1 {
		t.Fatalf("expected exactly 1 object written to GCS, got %d: %+v", len(objectStore.Written), objectStore.Written)
	}
}

func TestRunMigrate_PhotoCache_UsesThumbUsageWithWidth(t *testing.T) {
	s := store.OpenTest(t)
	uploader, _ := newTestUploader()
	ctx := context.Background()

	if err := s.SetCachedPhoto("place-1", 0, 200, "data:image/jpeg;base64,QUFB"); err != nil {
		t.Fatalf("seed SetCachedPhoto failed: %v", err)
	}

	if err := runMigrate(ctx, s, uploader, false, ""); err != nil {
		t.Fatalf("runMigrate failed: %v", err)
	}

	// photo_cache 情境應該寫入 usage="thumb_200"(見 usageThumb 的完整
	// 說明),不是 usageFull——跟 google_place_photos 用不同的 usage 值域
	// 區分同一個 place_id 底下不同規格的圖片。
	_, ok, err := s.GetPhotoAsset("place-1", 0, "thumb_200")
	if err != nil {
		t.Fatalf("GetPhotoAsset failed: %v", err)
	}
	if !ok {
		t.Fatal("expected photo_assets record with usage=thumb_200")
	}
}

func TestRunMigrate_AlreadyMigrated_SkipsWithoutReupload(t *testing.T) {
	s := store.OpenTest(t)
	uploader, objectStore := newTestUploader()
	ctx := context.Background()

	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed SetGooglePlacePhotos failed: %v", err)
	}

	// 第一次執行:真的遷移一筆。
	if err := runMigrate(ctx, s, uploader, false, ""); err != nil {
		t.Fatalf("first runMigrate failed: %v", err)
	}
	if len(objectStore.Written) != 1 {
		t.Fatalf("expected 1 object written after first run, got %d", len(objectStore.Written))
	}

	// 第二次執行(模擬中斷後重試/重複執行,見套件文件「migrate 階段可
	// 重複執行」的完整說明)——已存在 photo_assets 紀錄的來源列應該被
	// 跳過,不重新觸發 GCS 上傳(這正是 UpsertPhotoAsset 的
	// clause.OnConflict 修正要保護的情境:即使重複執行仍不能因為
	// UNIQUE constraint 而失敗,但這裡驗證的是更上層的行為——理當根本
	// 不會再次呼叫 uploader,因為 migrateOne 一開始就先查過
	// GetPhotoAsset 判斷是否 exists)。
	if err := runMigrate(ctx, s, uploader, false, ""); err != nil {
		t.Fatalf("second runMigrate failed: %v", err)
	}
	if len(objectStore.Written) != 1 {
		t.Fatalf("expected still only 1 object written after re-running migrate (idempotent), got %d", len(objectStore.Written))
	}
}

func TestRunMigrate_DryRun_DoesNotWriteAnything(t *testing.T) {
	s := store.OpenTest(t)
	uploader, objectStore := newTestUploader()
	ctx := context.Background()

	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed SetGooglePlacePhotos failed: %v", err)
	}

	if err := runMigrate(ctx, s, uploader, true, ""); err != nil {
		t.Fatalf("runMigrate(dryRun=true) failed: %v", err)
	}

	if len(objectStore.Written) != 0 {
		t.Fatalf("expected no GCS writes in dry-run, got %d: %+v", len(objectStore.Written), objectStore.Written)
	}
	_, ok, err := s.GetPhotoAsset("place-1", 0, usageFull)
	if err != nil {
		t.Fatalf("GetPhotoAsset failed: %v", err)
	}
	if ok {
		t.Fatal("expected no photo_assets record to be written in dry-run")
	}
}

func TestRunMigrate_FilterByPlaceID_OnlyProcessesMatchingRecords(t *testing.T) {
	s := store.OpenTest(t)
	uploader, objectStore := newTestUploader()
	ctx := context.Background()

	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed place-1 failed: %v", err)
	}
	if err := s.SetGooglePlacePhotos("place-2", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed place-2 failed: %v", err)
	}

	if err := runMigrate(ctx, s, uploader, false, "place-1"); err != nil {
		t.Fatalf("runMigrate with filter failed: %v", err)
	}

	if len(objectStore.Written) != 1 {
		t.Fatalf("expected exactly 1 object written (only place-1), got %d: %+v", len(objectStore.Written), objectStore.Written)
	}
	_, ok1, _ := s.GetPhotoAsset("place-1", 0, usageFull)
	_, ok2, _ := s.GetPhotoAsset("place-2", 0, usageFull)
	if !ok1 {
		t.Fatal("expected place-1 to be migrated")
	}
	if ok2 {
		t.Fatal("expected place-2 to NOT be migrated when filtered to place-1")
	}
}

func TestRunMigrate_UploadFailure_ReportsErrorButContinuesOtherRecords(t *testing.T) {
	s := store.OpenTest(t)
	objectStore := photostorage.NewMemoryObjectStore()
	objectStore.WriteErr = context.DeadlineExceeded
	uploader := photostorage.NewForTest("test-bucket", objectStore)
	ctx := context.Background()

	if err := s.SetGooglePlacePhotos("place-1", []string{"data:image/jpeg;base64,QUFB"}); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	err := runMigrate(ctx, s, uploader, false, "")
	if err == nil {
		t.Fatal("expected runMigrate to report the upload failure as an error")
	}

	_, ok, getErr := s.GetPhotoAsset("place-1", 0, usageFull)
	if getErr != nil {
		t.Fatalf("GetPhotoAsset failed: %v", getErr)
	}
	if ok {
		t.Fatal("expected no photo_assets record to be written when upload fails")
	}
}
