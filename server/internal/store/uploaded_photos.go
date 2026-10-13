// uploaded_photos.go——「使用者上傳圖片」(部落客發文用,見
// uploadedPhotoRow/photoVariantRow 的完整說明)的 CRUD。這次任務只做
// 資料層:建立原圖記錄、查詢、設定裁切焦點/處理狀態、新增衍生版本,
// 不處理真正的上傳接收、pre-signed URL 簽發、圖片解析/縮放邏輯——
// 那些都是呼叫這些 store 方法的上層(API handler、非同步處理
// goroutine)之後才會實作的部分,目前還在跟使用者討論設計。
package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// newUploadedPhotoID 產生原圖記錄 ID(對齊既有 cpg_/bpf_ 風格,見
// newContentPageID/newBlogProfileID)。
func newUploadedPhotoID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "upf_" + hex.EncodeToString(b)
}

// newPhotoVariantID 產生衍生版本記錄 ID,風格同上。
func newPhotoVariantID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "pvr_" + hex.EncodeToString(b)
}

func toUploadedPhoto(r uploadedPhotoRow) model.UploadedPhoto {
	return model.UploadedPhoto{
		ID:          r.ID,
		OwnerID:     r.OwnerID,
		OriginalURL: r.OriginalURL,
		Status:      r.Status,
		FocalX:      r.FocalX,
		FocalY:      r.FocalY,
		Width:       r.Width,
		Height:      r.Height,
		Note:        r.Note,
		Rating:      r.Rating,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func toPhotoVariant(r photoVariantRow) model.PhotoVariant {
	return model.PhotoVariant{
		ID:        r.ID,
		PhotoID:   r.PhotoID,
		Kind:      r.Kind,
		URL:       r.URL,
		Width:     r.Width,
		Height:    r.Height,
		CreatedAt: r.CreatedAt,
	}
}

// CreateUploadedPhoto 建立一筆原圖記錄——這次任務不處理真正的圖片
// 接收/解析,呼叫這支方法時只代表「這張圖已經上傳、等待後續非同步
// 處理」,故初始 Status 固定為 "pending",FocalX/FocalY/Width/Height
// 一律留空(NULL):焦點要等使用者之後在裁切編輯器裡設定(見
// SetUploadedPhotoFocal),寬高要等之後的圖片解析階段才會知道,兩者
// 都不是這個建立時間點能提供的資訊。
//
// note 是選填的上傳當下備註(見 model.UploadedPhoto.Note 的完整
// 說明)——呼叫端(cmdBlogPhotoUpload)可以在上傳同時順手標記這張圖
// 實際拍的是什麼,不需要事後再呼叫一次 SetUploadedPhotoNote;傳空
// 字串代表不設定,不是刻意清空(這個時間點本來就還沒有舊值可清)。
func (s *Store) CreateUploadedPhoto(ownerID, originalURL, note string) (model.UploadedPhoto, error) {
	r := uploadedPhotoRow{
		ID:          newUploadedPhotoID(),
		OwnerID:     ownerID,
		OriginalURL: originalURL,
		Status:      "pending",
		Note:        note,
		CreatedAt:   now(),
		UpdatedAt:   now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.UploadedPhoto{}, err
	}
	return toUploadedPhoto(r), nil
}

// GetUploadedPhoto 依 ID 查詢單筆原圖記錄,連同其所有衍生版本
// (photo_variants)一併查出組成完整的 model.UploadedPhoto。
//
// 這裡刻意用「查完 uploaded_photos 再查一次 photo_variants、手動組
// 起來」的兩次查詢寫法,而不是改用 GORM 的 has-many 關聯 + Preload——
// 這個專案目前唯一的 gorm 關聯先例是 userRow.Trips/tripRow.Members
// 的 many2many(透過 members 中介表,見 entity.go 的完整說明),沒有
// 任何一對多(has-many)關聯的既有寫法可以照抄;貿然在這裡率先引入
// 一種全新的關聯模式,會讓這張表的查詢方式跟其餘 store 檔案(blog_
// profiles.go、content_pages.go 等)風格不一致。兩次明確查詢的寫法雖然
// 多一次 round trip,但跟既有慣例一致、容易理解維護,這張表的查詢頻率
// 也不是效能熱點,不需要為了省一次查詢引入新模式。
func (s *Store) GetUploadedPhoto(id string) (model.UploadedPhoto, error) {
	var r uploadedPhotoRow
	if err := s.db.Where("id = ?", id).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.UploadedPhoto{}, ErrNotFound
		}
		return model.UploadedPhoto{}, err
	}
	variants, err := s.listPhotoVariantsByPhotoID(r.ID)
	if err != nil {
		return model.UploadedPhoto{}, err
	}
	out := toUploadedPhoto(r)
	out.Variants = variants
	return out, nil
}

// listPhotoVariantsByPhotoID 是 GetUploadedPhoto/ListUploadedPhotosByOwner
// 共用的內部查詢——依 PhotoID 撈出所有衍生版本,不額外排序(目前
// 只有 thumbnail/large 兩種 Kind,呼叫端不需要特定順序)。
func (s *Store) listPhotoVariantsByPhotoID(photoID string) ([]model.PhotoVariant, error) {
	var rows []photoVariantRow
	if err := s.db.Where("photo_id = ?", photoID).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.PhotoVariant, 0, len(rows))
	for _, r := range rows {
		out = append(out, toPhotoVariant(r))
	}
	return out, nil
}

// uploadedPhotoPendingTimeout 是「pending 狀態視為卡死、應該被動轉成
// failed」的時間門檻——見 MarkStalePendingPhotosAsFailed 的完整說明:
// 這不是真正的逾時偵測機制(沒有背景排程主動掃描),而是在使用者下次
// 查詢自己上傳過的圖片列表時,順便做的「惰性清理」判斷。1 小時是
// 「正常上傳+背景處理流程不可能耗時這麼久」的保守估計(正常情況下
// 從上傳完成到 thumbnail/large 產生完畢是秒級的操作),超過這個時間
// 仍停在 pending,幾乎可以肯定是背景處理 goroutine 因故中斷(例如
// server 重啟、未預期的 panic)而永遠不會再被標記為 ready/failed——
// 讓使用者在列表頁看到一直轉圈圈、卻永遠不會改變的「處理中」狀態,
// 比直接告知「失敗、請重新上傳或重試」的體驗更差。
const uploadedPhotoPendingTimeout = time.Hour

// MarkStalePendingPhotosAsFailed 把「建立時間超過 uploadedPhotoPendingTimeout
// 、狀態仍是 pending」的記錄主動改成 failed——見上方常數說明:這是
// 「惰性清理」而非定時排程,預期呼叫端(ListUploadedPhotosByOwner 的
// 呼叫端,也就是 API handler 的列表端點)在每次回應列表前先呼叫這支
// 方法,讓使用者看到的列表狀態是「校正過的」,而不是直接回傳
// ListUploadedPhotosByOwner 原始、可能卡在過期 pending 狀態的資料。
//
// 回傳值是實際被轉換的筆數,供呼叫端需要時記錄/除錯;呼叫端目前的
// 用法不需要用到這個數字,只需要確保转换已經發生在查詢列表之前。
//
// 刻意用一條 UPDATE ... WHERE 陳述式一次處理所有符合條件的記錄,而非
// 先查出清單再逐筆呼叫 SetUploadedPhotoStatus——這裡的呼叫情境是
// 「查詢列表前的前置清理」,預期符合條件的筆數通常是 0 或少數幾筆,
// 單一陳述式比「查詢+迴圈逐筆更新」更簡單、也不會在筆數較多時產生
// N+1 次資料庫往返。
func (s *Store) MarkStalePendingPhotosAsFailed(ownerID string) (int64, error) {
	cutoff := now().Add(-uploadedPhotoPendingTimeout)
	res := s.db.Model(&uploadedPhotoRow{}).
		Where("owner_id = ? AND status = ? AND created_at < ?", ownerID, "pending", cutoff).
		Updates(map[string]any{"status": "failed", "updated_at": now()})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// ListUploadedPhotosByOwner 列出某個使用者上傳過的所有圖片(含各自的
// Variants),依 CreatedAt 由新到舊排序——供之後「網頁上部落客管理
// 自己上傳過的圖片」頁面使用(該頁面本身不在本次任務範圍內)。
//
// 這裡刻意不像 GetUploadedPhoto 那樣對每一筆各自呼叫
// listPhotoVariantsByPhotoID——那是單筆查詢(查一張圖片+其
// variants),只需要一次額外查詢,不存在效能疑慮;這裡是多筆查詢,
// 對每一筆都各自查一次 photo_variants 會是 N+1 次查詢(1 次查
// uploaded_photos + N 次查 photo_variants,N 是這個 owner 底下的圖片
// 數),筆數一多會造成不必要的資料庫往返次數。改成「先撈出這個 owner
// 底下所有 uploaded_photo 的 ID,再用 WHERE photo_id IN (...) 一次查出
// 所有相關的 photo_variants,在記憶體裡依 PhotoID 分組組裝」,把
// 1+N 次查詢降成固定的 2 次查詢,不受筆數影響。
func (s *Store) ListUploadedPhotosByOwner(ownerID string) ([]model.UploadedPhoto, error) {
	var rows []uploadedPhotoRow
	if err := s.db.Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return s.attachPhotoVariants(rows)
}

// ListUploadedPhotosByIDs 依一批 ID 查出對應的原圖記錄(含衍生版本)
// ——供公開端點(見 handlePublicBlogPhotosByIDs)把文章內容裡引用的
// photoId 展開成實際可顯示的 URL 使用。查不到的 ID 直接略過、不報錯
// (對齊 GetUploadedPhoto 對「單筆查無」的既有處理哲學:呼叫端可能
// 傳入一個已經被刪除的舊 photoId,這種情況下該圖片在文章裡顯示不出來
// 是合理的降級結果,不該讓整批查詢因為其中一個 ID 失效就整個失敗)。
// 空輸入直接回傳空結果,不觸發查詢——避免 IN () 這種空集合查詢在
// 不同資料庫 driver 下的邊界行為差異。
//
// 這支方法只依 ID 查詢,不檢查圖片目前的 Status、也不檢查是否被任何
// 已發布文章引用——呼叫端(handlePublicBlogPhotosByIDs)必須自己做這層
// 授權檢查,不能把這份查詢結果直接當成「可公開顯示」的清單(見該
// handler 的完整說明:只回傳 ready 狀態、且被已發布文章引用的那些)。
func (s *Store) ListUploadedPhotosByIDs(ids []string) ([]model.UploadedPhoto, error) {
	if len(ids) == 0 {
		return []model.UploadedPhoto{}, nil
	}
	var rows []uploadedPhotoRow
	if err := s.db.Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	return s.attachPhotoVariants(rows)
}

// attachPhotoVariants 是 ListUploadedPhotosByOwner/ListUploadedPhotosByIDs
// 共用的「批次查衍生版本、記憶體組裝」尾段(2026-10 抽出,原本兩份各自
// 逐行重複同一套邏輯,改動時容易漏改其中一處造成行為分岔)。
//
// 刻意不像 GetUploadedPhoto 那樣對每一筆各自呼叫
// listPhotoVariantsByPhotoID——那是單筆查詢,只需要一次額外查詢,不存在
// 效能疑慮;這裡是多筆查詢,對每一筆都各自查一次 photo_variants 會是
// N+1 次查詢,改成「先撈出所有 uploaded_photo 的 ID,再用 WHERE photo_id
// IN (...) 一次查出所有相關的 photo_variants,在記憶體裡依 PhotoID
// 分組組裝」,把 1+N 次查詢降成固定的 2 次查詢,不受筆數影響。
func (s *Store) attachPhotoVariants(rows []uploadedPhotoRow) ([]model.UploadedPhoto, error) {
	if len(rows) == 0 {
		return []model.UploadedPhoto{}, nil
	}

	photoIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		photoIDs = append(photoIDs, r.ID)
	}
	var variantRows []photoVariantRow
	if err := s.db.Where("photo_id IN ?", photoIDs).Find(&variantRows).Error; err != nil {
		return nil, err
	}
	variantsByPhotoID := make(map[string][]model.PhotoVariant, len(rows))
	for _, vr := range variantRows {
		variantsByPhotoID[vr.PhotoID] = append(variantsByPhotoID[vr.PhotoID], toPhotoVariant(vr))
	}

	out := make([]model.UploadedPhoto, 0, len(rows))
	for _, r := range rows {
		up := toUploadedPhoto(r)
		up.Variants = variantsByPhotoID[r.ID]
		out = append(out, up)
	}
	return out, nil
}

// SetUploadedPhotoFocal 更新一張原圖的裁切焦點(0~1 相對座標,見
// uploadedPhotoRow.FocalX/FocalY 的完整說明)。比照
// UpdateContentPageContent 的 RowsAffected 檢查慣例——GORM 的 Updates()
// 在 WHERE 條件沒有命中任何列時 Error 仍是 nil,不額外檢查
// RowsAffected 會把「ID 不存在」誤判成「更新成功」。
func (s *Store) SetUploadedPhotoFocal(id string, focalX, focalY float64) error {
	res := s.db.Model(&uploadedPhotoRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"focal_x": focalX, "focal_y": focalY, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetUploadedPhotoNote 更新一張原圖的備註(見 model.UploadedPhoto.Note
// 的完整說明)——供上傳當下沒有順手標記、或想事後修改標注內容時單獨
// 呼叫(見 cmdBlogPhotoNote)。允許傳空字串清空既有備註,不像
// SetUploadedPhotoFocal 的 focalX/focalY 有 0~1 範圍檢查——備註是自由
// 文字,沒有格式限制。RowsAffected 檢查慣例同 SetUploadedPhotoFocal。
func (s *Store) SetUploadedPhotoNote(id, note string) error {
	res := s.db.Model(&uploadedPhotoRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"note": note, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetUploadedPhotoRating 更新一張原圖的品質評分(見
// model.UploadedPhoto.Rating 的完整說明)——rating 傳 nil 代表清空既有
// 評分(回到「尚未評分」狀態),這裡不做值域檢查(1~3 的範圍檢查由呼叫端
// handleBlogPhotoRating 負責,對齊 handleBlogPhotoFocal 檢查 focalX/
// focalY 範圍的既有分工:store 層只負責寫入,輸入驗證是 API handler 的
// 責任)。RowsAffected 檢查慣例同 SetUploadedPhotoFocal。
func (s *Store) SetUploadedPhotoRating(id string, rating *int) error {
	res := s.db.Model(&uploadedPhotoRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"rating": rating, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetUploadedPhotoStatus 更新一張原圖的處理狀態("pending"/"ready"/
// "failed")——供之後的非同步圖片處理流程呼叫(該流程本身不在本次
// 任務範圍內),這裡只負責提供寫入方法。RowsAffected 檢查慣例同
// SetUploadedPhotoFocal。
func (s *Store) SetUploadedPhotoStatus(id, status string) error {
	res := s.db.Model(&uploadedPhotoRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"status": status, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUploadedPhoto 刪除一筆原圖記錄,連同它底下所有的衍生版本
// (photo_variants)——呼叫端(API handler 的刪除端點)應先呼叫
// photoupload.SignedUploader 清掉 GCS 上對應的物件,再呼叫這支方法清
// 資料庫記錄,避免先刪資料庫、GCS 物件卻因故刪除失敗而變成孤兒檔案
// (資料庫裡已經查不到、無法再被這張表的任何方法找到去清理)。
//
// 先刪 photo_variants 再刪 uploaded_photos——理由同 GetUploadedPhoto
// 一節說明的「這張表沒有採用 gorm 的 has-many 關聯」:沒有關聯層級的
// cascade delete 可用,必須手動依外鍵方向(variant 依附 photo,不是
// 反過來)依序刪除,否則會在 photo 已刪除、variant 仍指著一個不存在
// 的 PhotoID 的中間狀態留下孤兒列(雖然這張表沒有設定外鍵約束強制
// 拒絕,但留著指向不存在記錄的 variant 列本身就是資料不一致)。
//
// ID 不存在時回傳 ErrNotFound——比照 SetUploadedPhotoFocal/
// SetUploadedPhotoStatus 檢查 RowsAffected 的既有慣例,避免呼叫端誤判
// 「刪除一筆不存在的記錄」為成功。
func (s *Store) DeleteUploadedPhoto(id string) error {
	if err := s.db.Where("photo_id = ?", id).Delete(&photoVariantRow{}).Error; err != nil {
		return err
	}
	res := s.db.Where("id = ?", id).Delete(&uploadedPhotoRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// CreatePhotoVariant 新增一筆衍生版本記錄。複合唯一索引 (PhotoID,
// Kind) 不允許重複——同一張原圖的同一種尺寸只會有一筆記錄(見
// photoVariantRow 的完整說明)。已存在時回傳 ErrAlreadyExists,採用
// 「先查後建」的既有模式(對齊 CreateContentPage/CreateBlogProfile 的
// 完整說明:不依賴解析 driver 專屬的唯一約束錯誤字串,跨 SQLite/
// Postgres 一致、容易理解維護)。
func (s *Store) CreatePhotoVariant(photoID, kind, url string, width, height int) (model.PhotoVariant, error) {
	var existing photoVariantRow
	err := s.db.Where("photo_id = ? AND kind = ?", photoID, kind).First(&existing).Error
	if err == nil {
		return model.PhotoVariant{}, ErrAlreadyExists
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.PhotoVariant{}, err
	}
	r := photoVariantRow{
		ID:        newPhotoVariantID(),
		PhotoID:   photoID,
		Kind:      kind,
		URL:       url,
		Width:     width,
		Height:    height,
		CreatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.PhotoVariant{}, err
	}
	return toPhotoVariant(r), nil
}
