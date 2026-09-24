package main

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/store"
)

// usageFull/usageThumbPrefix 對應 photoAssetRow.Usage 的既有值域(見該
// 欄位的完整說明)——"full" 服務 google_place_photos 情境(單一原始尺寸),
// "thumb_{maxWidthPx}" 服務 photo_cache 情境(依寬度分列的多種縮圖規格)。
const usageFull = "full"

func usageThumb(maxWidthPx int) string {
	return "thumb_" + strconv.Itoa(maxWidthPx)
}

// runMigrate 掃描 google_place_photos/photo_cache 兩張來源表,逐筆把
// base64 內容上傳到 GCS、寫入 photo_assets(見 photoAssetRow 的完整
// 說明)。不動來源表任何資料——理由見本檔案套件文件的「分兩階段」說明。
//
// 已經在 photo_assets 存在對應紀錄(place_id/photo_index/usage 皆相同)
// 的來源列會被跳過,不重新上傳——讓這個子命令可以安全地重複執行/中斷
// 後重試,不會因為重跑而對同一張圖重複觸發 GCS 上傳。
//
// filterPlaceID 非空時只處理這一個 place_id 底下的紀錄(見 main.go
// -place-id 旗標的完整說明),供正式環境第一次執行前先用小範圍驗證。
func runMigrate(ctx context.Context, st *store.Store, uploader *photostorage.Uploader, dryRun bool, filterPlaceID string) error {
	googleRows, err := st.ListAllGooglePlacePhotos(filterPlaceID)
	if err != nil {
		return fmt.Errorf("讀取 google_place_photos 失敗: %w", err)
	}
	cacheRows, err := st.ListAllCachedPhotos(filterPlaceID)
	if err != nil {
		return fmt.Errorf("讀取 photo_cache 失敗: %w", err)
	}

	fmt.Printf("google_place_photos: %d 筆, photo_cache: %d 筆\n", len(googleRows), len(cacheRows))

	migrated, skipped, failed := 0, 0, 0

	for _, r := range googleRows {
		ok, err := migrateOne(ctx, st, uploader, migrateInput{
			PlaceID:    r.PlaceID,
			PhotoIndex: r.PhotoIndex,
			Usage:      usageFull,
			Source:     "google",
			DataURI:    r.PhotoURL,
			ObjectKey:  fmt.Sprintf("%s-%d-%s", r.PlaceID, r.PhotoIndex, usageFull),
		}, dryRun)
		if err != nil {
			failed++
			fmt.Printf("[失敗] google_place_photos place_id=%s photo_index=%d: %v\n", r.PlaceID, r.PhotoIndex, err)
			continue
		}
		if ok {
			migrated++
		} else {
			skipped++
		}
	}

	for _, r := range cacheRows {
		usage := usageThumb(r.MaxWidthPx)
		ok, err := migrateOne(ctx, st, uploader, migrateInput{
			PlaceID:    r.PlaceID,
			PhotoIndex: r.PhotoIndex,
			Usage:      usage,
			Source:     "google",
			DataURI:    r.DataURI,
			ObjectKey:  fmt.Sprintf("%s-%d-%s", r.PlaceID, r.PhotoIndex, usage),
		}, dryRun)
		if err != nil {
			failed++
			fmt.Printf("[失敗] photo_cache place_id=%s photo_index=%d max_width_px=%d: %v\n", r.PlaceID, r.PhotoIndex, r.MaxWidthPx, err)
			continue
		}
		if ok {
			migrated++
		} else {
			skipped++
		}
	}

	fmt.Printf("完成: 遷移 %d 筆, 略過(已存在) %d 筆, 失敗 %d 筆\n", migrated, skipped, failed)
	if failed > 0 {
		return fmt.Errorf("%d 筆遷移失敗,請檢查上方個別錯誤訊息", failed)
	}
	return nil
}

// migrateInput 是 migrateOne 需要的單筆輸入,收斂 google_place_photos/
// photo_cache 兩種來源表不同的欄位形狀成同一組參數,呼叫端(runMigrate)
// 只需要組好這個結構,migrateOne 本身不需要知道資料原本來自哪張表。
type migrateInput struct {
	PlaceID    string
	PhotoIndex int
	Usage      string
	Source     string
	DataURI    string
	ObjectKey  string
}

// migrateOne 處理單一筆圖片的遷移:已存在對應 photo_assets 紀錄則跳過
// (回傳 ok=false),否則上傳 GCS 並 upsert 寫入 photo_assets(回傳
// ok=true)。dry-run 時只印出將執行的動作,不實際呼叫 GCS/寫入資料庫。
func migrateOne(ctx context.Context, st *store.Store, uploader *photostorage.Uploader, in migrateInput, dryRun bool) (ok bool, err error) {
	_, exists, err := st.GetPhotoAsset(in.PlaceID, in.PhotoIndex, in.Usage)
	if err != nil {
		return false, fmt.Errorf("查詢既有 photo_assets 紀錄失敗: %w", err)
	}
	if exists {
		return false, nil
	}

	if dryRun {
		fmt.Printf("[dry-run] 將上傳 place_id=%s photo_index=%d usage=%s (dataURI 長度 %d)\n", in.PlaceID, in.PhotoIndex, in.Usage, len(in.DataURI))
		return true, nil
	}

	gcsURL, err := uploader.UploadDataURI(ctx, in.ObjectKey, in.DataURI)
	if err != nil {
		return false, fmt.Errorf("上傳 GCS 失敗: %w", err)
	}

	fetchedAt := time.Now()
	expiresAt := fetchedAt.Add(photoAssetExpiry)
	if err := st.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID:    in.PlaceID,
		PhotoIndex: in.PhotoIndex,
		Usage:      in.Usage,
		Source:     in.Source,
		GCSURL:     gcsURL,
		FetchedAt:  fetchedAt,
		ExpiresAt:  &expiresAt,
	}); err != nil {
		return false, fmt.Errorf("寫入 photo_assets 失敗: %w", err)
	}

	fmt.Printf("[完成] place_id=%s photo_index=%d usage=%s -> %s\n", in.PlaceID, in.PhotoIndex, in.Usage, gcsURL)
	return true, nil
}
