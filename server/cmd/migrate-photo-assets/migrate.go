package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
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
		// PhotoURL 這個欄位名稱是歷史遺留——2026-09 起,主流程
		// (downloadGooglePlacePhotoInBackground,見 server/internal/api/
		// geo_outline.go)已經改成直接把下載到的圖片上傳到 GCS 後,把
		// 「GCS URL」而非「base64 data URI」寫回這張表,故這裡實際讀到的
		// 值通常是 https:// 開頭的既有 GCS 物件網址,不是 data: 開頭的
		// base64——用 IsExternalURL 標記讓 migrateOne 走「下載該 URL 內容
		// 後以本工具統一的新命名重新上傳」這條路徑(見下方
		// downloadURLAsDataURI 的完整說明),而不是誤當 base64 塞進
		// UploadDataURI 直接失敗。
		// 極少數在這輪重構前就已經寫入、格式仍是 data: 開頭的舊列(理論上
		// 資料庫裡不該再有,但保留相容)則自動退回原本的 base64 解碼路徑。
		ok, err := migrateOne(ctx, st, uploader, migrateInput{
			PlaceID:       r.PlaceID,
			PhotoIndex:    r.PhotoIndex,
			Usage:         usageFull,
			Source:        "google",
			Content:       r.PhotoURL,
			IsExternalURL: strings.HasPrefix(r.PhotoURL, "http://") || strings.HasPrefix(r.PhotoURL, "https://"),
			ObjectKey:     fmt.Sprintf("%s-%d-%s", r.PlaceID, r.PhotoIndex, usageFull),
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
		// photo_cache.data_uri 目前確認仍是 base64 data URI 格式(跟
		// google_place_photos 不同,見上方 googleRows 迴圈的完整說明)——
		// IsExternalURL 固定 false,走既有的 UploadDataURI 路徑。
		ok, err := migrateOne(ctx, st, uploader, migrateInput{
			PlaceID:       r.PlaceID,
			PhotoIndex:    r.PhotoIndex,
			Usage:         usage,
			Source:        "google",
			Content:       r.DataURI,
			IsExternalURL: false,
			ObjectKey:     fmt.Sprintf("%s-%d-%s", r.PlaceID, r.PhotoIndex, usage),
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
	// Content:圖片內容本身,依 IsExternalURL 決定怎麼解讀——true 時是
	// 一個要下載的 https:// URL(見 downloadURLAsDataURI),false 時是
	// 現成的 base64 data URI,直接交給 UploadDataURI。
	Content       string
	IsExternalURL bool
	ObjectKey     string
}

// migrateOne 處理單一筆圖片的遷移:已存在對應 photo_assets 紀錄則跳過
// (回傳 ok=false),否則上傳 GCS 並 upsert 寫入 photo_assets(回傳
// ok=true)。dry-run 時只印出將執行的動作,不實際呼叫 GCS/資料庫/發出
// 任何 HTTP 請求。
//
// 使用者明確要求:即使來源(Content)已經是一個現成可用的 GCS URL,也
// 要「重新下載內容並以新命名上傳」,不是直接把既有 URL 原樣複製進
// photo_assets——理由是這支工具產生的物件命名慣例統一帶 usage 段
// (place-details/{placeID}-{photoIndex}-{usage}{ext},見 objectKey 的
// 組成),直接複製既有 URL 會讓 google 來源的檔名(主流程既有的
// place-details/{placeID}-{photoIndex}.jpg,不含 usage 段)跟這裡
// 的命名規則不一致,之後在 bucket 裡混雜兩種命名慣例。
func migrateOne(ctx context.Context, st *store.Store, uploader *photostorage.Uploader, in migrateInput, dryRun bool) (ok bool, err error) {
	_, exists, err := st.GetPhotoAsset(in.PlaceID, in.PhotoIndex, in.Usage)
	if err != nil {
		return false, fmt.Errorf("查詢既有 photo_assets 紀錄失敗: %w", err)
	}
	if exists {
		return false, nil
	}

	if dryRun {
		if in.IsExternalURL {
			fmt.Printf("[dry-run] 將下載 %s 並以新命名重新上傳 place_id=%s photo_index=%d usage=%s\n", in.Content, in.PlaceID, in.PhotoIndex, in.Usage)
		} else {
			fmt.Printf("[dry-run] 將上傳 place_id=%s photo_index=%d usage=%s (dataURI 長度 %d)\n", in.PlaceID, in.PhotoIndex, in.Usage, len(in.Content))
		}
		return true, nil
	}

	content := in.Content
	if in.IsExternalURL {
		content, err = downloadURLAsDataURI(ctx, in.Content)
		if err != nil {
			return false, fmt.Errorf("下載既有 GCS 圖片失敗: %w", err)
		}
	}

	gcsURL, err := uploader.UploadDataURI(ctx, in.ObjectKey, content)
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

// downloadURLAsDataURI 下載一個既有的公開 URL(這支工具目前唯一的用途
// 是 google_place_photos.photo_url 已經是 GCS URL 的情況,見呼叫端
// googleRows 迴圈的完整說明),組成 UploadDataURI 需要的 "data:{content
// type};base64,{payload}" 字串——讓「來源已經是 URL」跟「來源本來就是
// base64」這兩種輸入,共用同一段 UploadDataURI 上傳邏輯,不需要另外寫
// 一份繞過 base64 編碼的上傳路徑。
//
// Content-Type 優先採用回應標頭,標頭缺漏時退回 image/jpeg(這批既有
// 物件實際上都是 .jpg,見主流程 googlePlacePhotoObjectKey 固定副檔名的
// 既有慣例)。
func downloadURLAsDataURI(ctx context.Context, sourceURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return "", fmt.Errorf("組建下載請求失敗: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("下載失敗: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下載失敗: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("讀取回應內容失敗: %w", err)
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(body), nil
}
