package store

import (
	"errors"
	"testing"
)

// TestCreateUploadedPhotoInitialState 驗證建立原圖記錄時的初始狀態:
// Status 固定為 "pending",FocalX/FocalY/Width/Height 皆尚未設定(nil)
// ——這次任務不處理真正的圖片解析/焦點設定,建立當下只代表「已上傳、
// 等待後續處理」這個狀態(見 CreateUploadedPhoto 的完整說明)。
func TestCreateUploadedPhotoInitialState(t *testing.T) {
	s := newTestStore(t)

	photo, err := s.CreateUploadedPhoto("usr_owner1", "https://storage.googleapis.com/bucket/original.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}
	if photo.ID == "" {
		t.Fatalf("CreateUploadedPhoto 回傳的 ID 為空")
	}
	if photo.Status != "pending" {
		t.Fatalf("Status = %q, want %q", photo.Status, "pending")
	}
	if photo.FocalX != nil || photo.FocalY != nil {
		t.Fatalf("FocalX/FocalY 應為 nil,實際 = %v/%v", photo.FocalX, photo.FocalY)
	}
	if photo.Width != nil || photo.Height != nil {
		t.Fatalf("Width/Height 應為 nil,實際 = %v/%v", photo.Width, photo.Height)
	}
	if len(photo.Variants) != 0 {
		t.Fatalf("Variants 應為空,實際 = %+v", photo.Variants)
	}
}

// TestGetUploadedPhotoNotFound 驗證查詢不存在的 ID 回傳 ErrNotFound。
func TestGetUploadedPhotoNotFound(t *testing.T) {
	s := newTestStore(t)

	_, err := s.GetUploadedPhoto("upf_does_not_exist")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetUploadedPhoto 不存在的 ID: err = %v, want ErrNotFound", err)
	}
}

// TestSetUploadedPhotoFocal 驗證設定裁切焦點後,再次查詢能正確讀回。
func TestSetUploadedPhotoFocal(t *testing.T) {
	s := newTestStore(t)

	photo, err := s.CreateUploadedPhoto("usr_owner1", "https://example.com/a.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}

	if err := s.SetUploadedPhotoFocal(photo.ID, 0.25, 0.75); err != nil {
		t.Fatalf("SetUploadedPhotoFocal: %v", err)
	}

	got, err := s.GetUploadedPhoto(photo.ID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if got.FocalX == nil || *got.FocalX != 0.25 {
		t.Fatalf("FocalX = %v, want 0.25", got.FocalX)
	}
	if got.FocalY == nil || *got.FocalY != 0.75 {
		t.Fatalf("FocalY = %v, want 0.75", got.FocalY)
	}
}

// TestSetUploadedPhotoFocalNotFound 驗證對不存在的 ID 設定焦點回傳 ErrNotFound。
func TestSetUploadedPhotoFocalNotFound(t *testing.T) {
	s := newTestStore(t)

	err := s.SetUploadedPhotoFocal("upf_does_not_exist", 0.5, 0.5)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("SetUploadedPhotoFocal 不存在的 ID: err = %v, want ErrNotFound", err)
	}
}

// TestSetUploadedPhotoStatus 驗證更新處理狀態後能正確讀回,
// 對不存在的 ID 回傳 ErrNotFound。
func TestSetUploadedPhotoStatus(t *testing.T) {
	s := newTestStore(t)

	photo, err := s.CreateUploadedPhoto("usr_owner1", "https://example.com/a.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}

	if err := s.SetUploadedPhotoStatus(photo.ID, "ready"); err != nil {
		t.Fatalf("SetUploadedPhotoStatus: %v", err)
	}
	got, err := s.GetUploadedPhoto(photo.ID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if got.Status != "ready" {
		t.Fatalf("Status = %q, want %q", got.Status, "ready")
	}

	if err := s.SetUploadedPhotoStatus("upf_does_not_exist", "ready"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SetUploadedPhotoStatus 不存在的 ID: err = %v, want ErrNotFound", err)
	}
}

// TestCreatePhotoVariantAndFetch 驗證建立衍生版本後,GetUploadedPhoto
// 能正確撈出對應的 Variants。
func TestCreatePhotoVariantAndFetch(t *testing.T) {
	s := newTestStore(t)

	photo, err := s.CreateUploadedPhoto("usr_owner1", "https://example.com/a.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}

	variant, err := s.CreatePhotoVariant(photo.ID, "thumbnail", "https://example.com/a_thumb.jpg", 200, 150)
	if err != nil {
		t.Fatalf("CreatePhotoVariant: %v", err)
	}
	if variant.ID == "" {
		t.Fatalf("CreatePhotoVariant 回傳的 ID 為空")
	}

	got, err := s.GetUploadedPhoto(photo.ID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if len(got.Variants) != 1 {
		t.Fatalf("Variants 長度 = %d, want 1", len(got.Variants))
	}
	if got.Variants[0].Kind != "thumbnail" || got.Variants[0].URL != "https://example.com/a_thumb.jpg" {
		t.Fatalf("Variants[0] = %+v, 不符合預期", got.Variants[0])
	}
	if got.Variants[0].Width != 200 || got.Variants[0].Height != 150 {
		t.Fatalf("Variants[0] 寬高 = %dx%d, want 200x150", got.Variants[0].Width, got.Variants[0].Height)
	}
}

// TestCreatePhotoVariantDuplicateKind 驗證同一個 (PhotoID, Kind) 重複
// 建立時,第二次回傳 ErrAlreadyExists——複合唯一索引的語意見
// photoVariantRow 的完整說明。
func TestCreatePhotoVariantDuplicateKind(t *testing.T) {
	s := newTestStore(t)

	photo, err := s.CreateUploadedPhoto("usr_owner1", "https://example.com/a.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}

	if _, err := s.CreatePhotoVariant(photo.ID, "thumbnail", "https://example.com/a_thumb.jpg", 200, 150); err != nil {
		t.Fatalf("CreatePhotoVariant (第一次): %v", err)
	}
	_, err = s.CreatePhotoVariant(photo.ID, "thumbnail", "https://example.com/a_thumb_v2.jpg", 210, 160)
	if !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("CreatePhotoVariant (重複 Kind): err = %v, want ErrAlreadyExists", err)
	}
}

// TestListUploadedPhotosByOwner 驗證依 owner 篩選、且按 CreatedAt
// 由新到舊排序。
func TestListUploadedPhotosByOwner(t *testing.T) {
	s := newTestStore(t)

	p1, err := s.CreateUploadedPhoto("usr_owner1", "https://example.com/1.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto p1: %v", err)
	}
	p2, err := s.CreateUploadedPhoto("usr_owner1", "https://example.com/2.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto p2: %v", err)
	}
	if _, err := s.CreateUploadedPhoto("usr_owner2", "https://example.com/other.jpg"); err != nil {
		t.Fatalf("CreateUploadedPhoto (other owner): %v", err)
	}

	// p1/p2 用相同的 CreatedAt 時間戳是可能發生的(測試機器時鐘粒度),
	// 這裡強制讓兩者的 created_at 有明確先後,避免排序斷言因時鐘粒度
	// 而不穩定。
	if err := s.db.Model(&uploadedPhotoRow{}).Where("id = ?", p1.ID).
		Update("created_at", now().Add(-1 * 60 * 1e9)).Error; err != nil {
		t.Fatalf("調整 p1 CreatedAt: %v", err)
	}

	list, err := s.ListUploadedPhotosByOwner("usr_owner1")
	if err != nil {
		t.Fatalf("ListUploadedPhotosByOwner: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len(list) = %d, want 2", len(list))
	}
	if list[0].ID != p2.ID || list[1].ID != p1.ID {
		t.Fatalf("排序不符預期(應由新到舊): got [%s, %s], want [%s, %s]",
			list[0].ID, list[1].ID, p2.ID, p1.ID)
	}
	for _, p := range list {
		if p.OwnerID != "usr_owner1" {
			t.Fatalf("ListUploadedPhotosByOwner 回傳了其他 owner 的資料: %+v", p)
		}
	}
}
