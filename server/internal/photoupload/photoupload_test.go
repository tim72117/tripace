package photoupload

import (
	"context"
	"errors"
	"testing"
)

// TestNew_未設定Bucket時回傳可用但功能降級的SignedUploader——對齊
// photostorage.New 在 bucket 為空時的既有測試慣例:呼叫端不該因為這個
// 功能未啟用就拿到一個 nil 或需要額外 nil 檢查的物件,所有操作方法
// 應該自己判斷 bucket 是否為空並回傳 ErrNoBucket。
func TestNew_未設定Bucket時回傳可用但功能降級的SignedUploader(t *testing.T) {
	u, err := New(context.Background(), "", "")
	if err != nil {
		t.Fatalf("New 不應該因為 bucket 為空而報錯: %v", err)
	}
	if _, err := u.SignUploadURL("usr_a", "image/jpeg"); !errors.Is(err, ErrNoBucket) {
		t.Fatalf("SignUploadURL want ErrNoBucket, got %v", err)
	}
	if _, err := u.DownloadOriginal(context.Background(), "https://storage.googleapis.com/x/y"); !errors.Is(err, ErrNoBucket) {
		t.Fatalf("DownloadOriginal want ErrNoBucket, got %v", err)
	}
	if _, err := u.UploadVariant(context.Background(), "usr_a", "upf_1", VariantThumbnail, []byte("x")); !errors.Is(err, ErrNoBucket) {
		t.Fatalf("UploadVariant want ErrNoBucket, got %v", err)
	}
	// DeletePhoto 未設定 bucket 時視為無事可做,回傳 nil——理由同
	// photostorage.Uploader.Delete 的既有降級慣例(見該方法完整說明)。
	if err := u.DeletePhoto(context.Background(), "usr_a", "upf_1", "https://x/y", nil); err != nil {
		t.Fatalf("DeletePhoto 未設定 bucket 時應視為無事可做,got %v", err)
	}
}

// TestSignUploadURL_物件路徑帶OwnerID與隨機id 驗證簽出的 URL/公開網址
// 指向 user-uploads/{ownerID}/ 底下、依 contentType 判斷副檔名的物件
// 路徑(見任務規格)。
func TestSignUploadURL_物件路徑帶OwnerID與隨機id(t *testing.T) {
	store := NewMemoryObjectStore()
	u := NewForTest("test-bucket", store)

	res, err := u.SignUploadURL("usr_abc", "image/png")
	if err != nil {
		t.Fatalf("SignUploadURL: %v", err)
	}
	wantPrefix := "user-uploads/usr_abc/"
	if got := res.ObjectName; len(got) < len(wantPrefix) || got[:len(wantPrefix)] != wantPrefix {
		t.Fatalf("ObjectName 應以 %q 開頭,got %q", wantPrefix, got)
	}
	if got := res.ObjectName[len(res.ObjectName)-4:]; got != ".png" {
		t.Fatalf("image/png 應產生 .png 副檔名,got %q(full=%s)", got, res.ObjectName)
	}
	if res.UploadURL == "" || res.PublicURL == "" {
		t.Fatalf("UploadURL/PublicURL 不應為空: %+v", res)
	}
}

// TestUploadVariant下載再讀回_端到端驗證 variant 物件路徑與可下載性——
// 上傳一份 variant 位元組後,透過 DownloadOriginal 用它的公開網址讀回
// 應該要拿到一模一樣的內容,驗證物件路徑反解(objectNameFromPublicURL)
// 邏輯正確。
func TestUploadVariant下載再讀回(t *testing.T) {
	store := NewMemoryObjectStore()
	u := NewForTest("test-bucket", store)

	data := []byte("fake-jpeg-bytes")
	url, err := u.UploadVariant(context.Background(), "usr_abc", "upf_1", VariantThumbnail, data)
	if err != nil {
		t.Fatalf("UploadVariant: %v", err)
	}
	wantObject := "user-uploads/usr_abc/upf_1-thumbnail.jpg"
	if _, ok := store.Objects[wantObject]; !ok {
		t.Fatalf("預期寫入物件路徑 %q,實際內容: %+v", wantObject, store.Objects)
	}

	got, err := u.DownloadOriginal(context.Background(), url)
	if err != nil {
		t.Fatalf("DownloadOriginal: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("讀回內容不符,got %q want %q", got, data)
	}
}

// TestDeletePhoto_刪除原圖與所有Variant且冪等 驗證 DeletePhoto 會刪除
// 原圖與呼叫端指定的所有 variant 種類,且重複呼叫(物件已不存在)不會
// 報錯——比照 photostorage.Uploader.Delete 的冪等慣例。
func TestDeletePhoto_刪除原圖與所有Variant且冪等(t *testing.T) {
	store := NewMemoryObjectStore()
	u := NewForTest("test-bucket", store)

	signRes, err := u.SignUploadURL("usr_abc", "image/jpeg")
	if err != nil {
		t.Fatalf("SignUploadURL: %v", err)
	}
	// 模擬使用者端已經把原圖上傳上去(測試直接寫入 MemoryObjectStore,
	// 不透過真正的 PUT 請求——這裡只測 DeletePhoto 的邏輯,不測上傳
	// 本身)。
	store.Objects[signRes.ObjectName] = []byte("original-bytes")

	thumbURL, err := u.UploadVariant(context.Background(), "usr_abc", "upf_1", VariantThumbnail, []byte("thumb"))
	if err != nil {
		t.Fatalf("UploadVariant thumbnail: %v", err)
	}
	_ = thumbURL
	if _, err := u.UploadVariant(context.Background(), "usr_abc", "upf_1", VariantLarge, []byte("large")); err != nil {
		t.Fatalf("UploadVariant large: %v", err)
	}

	if err := u.DeletePhoto(context.Background(), "usr_abc", "upf_1", signRes.PublicURL, []string{VariantThumbnail, VariantLarge}); err != nil {
		t.Fatalf("DeletePhoto 第一次呼叫: %v", err)
	}
	if len(store.Objects) != 0 {
		t.Fatalf("刪除後不應該還有殘留物件,got %+v", store.Objects)
	}

	// 再呼叫一次——物件都已經不存在,應視為冪等成功,不報錯。
	if err := u.DeletePhoto(context.Background(), "usr_abc", "upf_1", signRes.PublicURL, []string{VariantThumbnail, VariantLarge}); err != nil {
		t.Fatalf("DeletePhoto 重複呼叫應冪等成功,got %v", err)
	}
}

// TestDeletePhoto_其中一個Variant刪除失敗仍會嘗試刪除其餘Variant 對應
// 2026-10 code review 發現的正確性問題:DeletePhoto 原本在清理多個
// variant 的迴圈裡,一遇到第一個 GCS 刪除錯誤就立即 return,導致排在
// 後面的 variant 完全沒有被嘗試刪除。這裡模擬 thumbnail 刪除失敗、large
// 正常,驗證:
//  1. large 仍然被嘗試刪除且真的刪除成功(迴圈沒有提早中斷)。
//  2. DeletePhoto 回傳的錯誤裡包含 thumbnail 那次失敗的資訊(errors.Join
//     合併後的錯誤,呼叫端能從 log 看到完整失敗原因)。
func TestDeletePhoto_其中一個Variant刪除失敗仍會嘗試刪除其餘Variant(t *testing.T) {
	store := NewMemoryObjectStore()
	u := NewForTest("test-bucket", store)

	signRes, err := u.SignUploadURL("usr_abc", "image/jpeg")
	if err != nil {
		t.Fatalf("SignUploadURL: %v", err)
	}
	store.Objects[signRes.ObjectName] = []byte("original-bytes")

	if _, err := u.UploadVariant(context.Background(), "usr_abc", "upf_1", VariantThumbnail, []byte("thumb")); err != nil {
		t.Fatalf("UploadVariant thumbnail: %v", err)
	}
	if _, err := u.UploadVariant(context.Background(), "usr_abc", "upf_1", VariantLarge, []byte("large")); err != nil {
		t.Fatalf("UploadVariant large: %v", err)
	}

	thumbObject := "user-uploads/usr_abc/upf_1-thumbnail.jpg"
	largeObject := "user-uploads/usr_abc/upf_1-large.jpg"
	wantErr := errors.New("模擬 thumbnail 刪除失敗(暫時性網路錯誤)")
	store.DeleteErrForObject = map[string]error{thumbObject: wantErr}

	// variantKinds 的順序刻意把 thumbnail(會失敗)放在 large(會成功)
	// 前面——修復前的「提早 return」問題只有在失敗項目排在成功項目
	// 之前時才會重現,順序對調的話即使有 bug 也測不出來。
	err = u.DeletePhoto(context.Background(), "usr_abc", "upf_1", signRes.PublicURL, []string{VariantThumbnail, VariantLarge})
	if err == nil {
		t.Fatalf("預期 DeletePhoto 回傳錯誤(thumbnail 刪除失敗),卻回傳 nil")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("DeletePhoto 回傳的錯誤應該包含 thumbnail 的刪除失敗原因,got: %v", err)
	}

	// 核心斷言:large 仍然被嘗試刪除且真的刪除成功——迴圈沒有在
	// thumbnail 失敗時提早中斷。
	if _, stillThere := store.Objects[largeObject]; stillThere {
		t.Fatalf("large variant 應該仍被嘗試刪除且成功,不應該殘留在 store 裡,got: %+v", store.Objects)
	}
	// thumbnail 本身刪除失敗,物件應該仍然存在(DeleteErrForObject 模擬
	// 的是「呼叫失敗」,不是「物件真的被刪除但回報失敗」)。
	if _, stillThere := store.Objects[thumbObject]; !stillThere {
		t.Fatalf("thumbnail 刪除失敗時,物件不應該真的從 store 消失")
	}
	// 原圖本身沒有設定 DeleteErrForObject,應該正常刪除成功。
	if _, stillThere := store.Objects[signRes.ObjectName]; stillThere {
		t.Fatalf("原圖應該正常刪除成功,不應該殘留在 store 裡")
	}
}

// TestSignUploadURL_簽發失敗時回傳錯誤 驗證 MemoryObjectStore.SignErr
// 能模擬 IAM Credentials API 失敗的情境,SignedUploader 正確地把錯誤
// 往上傳遞,不會吞掉或誤判成功。
func TestSignUploadURL_簽發失敗時回傳錯誤(t *testing.T) {
	store := NewMemoryObjectStore()
	store.SignErr = errors.New("iam signblob 失敗(模擬)")
	u := NewForTest("test-bucket", store)

	if _, err := u.SignUploadURL("usr_abc", "image/jpeg"); err == nil {
		t.Fatalf("預期簽發失敗時回傳錯誤,卻成功了")
	}
}
