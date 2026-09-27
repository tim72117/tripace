package main

import (
	"fmt"

	"github.com/tim72117/tripace/internal/store"
)

// runDelete 掃描 google_place_photos/photo_cache 兩張來源表,對每一筆
// 確認 photo_assets 裡已經有對應的成功遷移結果(相同
// place_id/photo_index/usage),才把來源表那一列整列刪除——理由見本
// 套件文件的「分兩階段」說明:這是不可逆操作,必須晚於 migrate 階段、
// 且是使用者確認過遷移結果後才手動觸發的獨立步驟。
//
// 沒有對應 photo_assets 紀錄的來源列會被跳過、不刪除,並印出警告——這
// 代表該筆尚未成功遷移(可能 migrate 階段失敗或根本沒執行過),刪除會
// 造成資料遺失,故意保守處理。
//
// filterPlaceID 非空時只處理這一個 place_id(見 main.go -place-id 旗標
// 的完整說明),理由同 runMigrate 的同名參數。
func runDelete(st *store.Store, dryRun bool, filterPlaceID string) error {
	googleRows, err := st.ListAllGooglePlacePhotos(filterPlaceID)
	if err != nil {
		return fmt.Errorf("讀取 google_place_photos 失敗: %w", err)
	}
	cacheRows, err := st.ListAllCachedPhotos(filterPlaceID)
	if err != nil {
		return fmt.Errorf("讀取 photo_cache 失敗: %w", err)
	}

	deleted, skipped := 0, 0

	for _, r := range googleRows {
		ok, err := deleteOneGooglePlacePhoto(st, r.PlaceID, r.PhotoIndex, dryRun)
		if err != nil {
			return fmt.Errorf("刪除 google_place_photos place_id=%s photo_index=%d 失敗: %w", r.PlaceID, r.PhotoIndex, err)
		}
		if ok {
			deleted++
		} else {
			skipped++
		}
	}

	for _, r := range cacheRows {
		usage := usageThumb(r.MaxWidthPx)
		ok, err := deleteOneCachedPhoto(st, r.PlaceID, r.PhotoIndex, r.MaxWidthPx, usage, dryRun)
		if err != nil {
			return fmt.Errorf("刪除 photo_cache place_id=%s photo_index=%d max_width_px=%d 失敗: %w", r.PlaceID, r.PhotoIndex, r.MaxWidthPx, err)
		}
		if ok {
			deleted++
		} else {
			skipped++
		}
	}

	fmt.Printf("完成: 刪除 %d 筆, 略過(尚未遷移) %d 筆\n", deleted, skipped)
	return nil
}

func deleteOneGooglePlacePhoto(st *store.Store, placeID string, photoIndex int, dryRun bool) (ok bool, err error) {
	_, exists, err := st.GetPhotoAsset(placeID, photoIndex, usageFull)
	if err != nil {
		return false, fmt.Errorf("查詢 photo_assets 失敗: %w", err)
	}
	if !exists {
		fmt.Printf("[略過] google_place_photos place_id=%s photo_index=%d 尚未遷移,不刪除\n", placeID, photoIndex)
		return false, nil
	}
	if dryRun {
		fmt.Printf("[dry-run] 將刪除 google_place_photos place_id=%s photo_index=%d\n", placeID, photoIndex)
		return true, nil
	}
	if err := st.DeleteGooglePlacePhoto(placeID, photoIndex); err != nil {
		return false, err
	}
	fmt.Printf("[完成] 已刪除 google_place_photos place_id=%s photo_index=%d\n", placeID, photoIndex)
	return true, nil
}

func deleteOneCachedPhoto(st *store.Store, placeID string, photoIndex, maxWidthPx int, usage string, dryRun bool) (ok bool, err error) {
	_, exists, err := st.GetPhotoAsset(placeID, photoIndex, usage)
	if err != nil {
		return false, fmt.Errorf("查詢 photo_assets 失敗: %w", err)
	}
	if !exists {
		fmt.Printf("[略過] photo_cache place_id=%s photo_index=%d max_width_px=%d 尚未遷移,不刪除\n", placeID, photoIndex, maxWidthPx)
		return false, nil
	}
	if dryRun {
		fmt.Printf("[dry-run] 將刪除 photo_cache place_id=%s photo_index=%d max_width_px=%d\n", placeID, photoIndex, maxWidthPx)
		return true, nil
	}
	if err := st.DeleteCachedPhoto(placeID, photoIndex, maxWidthPx); err != nil {
		return false, err
	}
	fmt.Printf("[完成] 已刪除 photo_cache place_id=%s photo_index=%d max_width_px=%d\n", placeID, photoIndex, maxWidthPx)
	return true, nil
}
