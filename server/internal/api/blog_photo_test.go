package api

// blog_photo_test.go 測使用者上傳部落格配圖的主要端點(見 blog_photo.go
// 開頭的完整說明)。
//
// 刻意透過 s.Routes() 打完整的 mux(對齊 content_page_test.go/entry_test.go
// 的既有理由),不直接呼叫 handler 函式——驗證路由字串本身是否正確
// 註冊。
//
// 測試用 photoupload.NewForTest + photoupload.NewMemoryObjectStore 注入
// 一份不需要真的連線 GCS/IAM Credentials API 的假 SignedUploader(比照
// geo_outline_place_photo_progress_test.go 對 photostorage.NewForTest 的
// 既有注入模式)。
import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/photoupload"
	"github.com/tim72117/tripace/internal/store"
)

// blogPhotoFixture 是「已登入使用者 + 注入假 SignedUploader」的測試
// 環境,供各測試共用。
type blogPhotoFixture struct {
	srv    *Server
	routes http.Handler
	token  string
	userID string
	store  *photoupload.MemoryObjectStore
}

func newBlogPhotoFixture(t *testing.T) *blogPhotoFixture {
	t.Helper()
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", time.Hour)
	s := New(st, signer, true, "test-google-client-id")

	memStore := photoupload.NewMemoryObjectStore()
	s.blogPhotoUploader = photoupload.NewForTest("test-bucket", memStore)

	user, err := s.store.CreatePasswordUser("usr_blogger", "部落客測試員", "#8C7B6A", "blogger@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &blogPhotoFixture{
		srv: s, routes: s.Routes(),
		token: token, userID: user.ID, store: memStore,
	}
}

func (f *blogPhotoFixture) do(t *testing.T, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	return doRequest(t, f.routes, method, path, body, f.token, wantStatus)
}

func (f *blogPhotoFixture) doNoAuth(t *testing.T, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	return doRequest(t, f.routes, method, path, body, "", wantStatus)
}

// doRequest 是本檔測試共用的底層請求輔助函式——token 為空字串時不帶
// Authorization header(模擬未登入/訪客請求)。
func doRequest(t *testing.T, routes http.Handler, method, path string, body any, token string, wantStatus int) map[string]any {
	t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, r)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Fatalf("%s %s → %d，預期 %d（body: %s）", method, path, rec.Code, wantStatus, rec.Body.String())
	}
	if rec.Body.Len() == 0 {
		return nil
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("回應不是合法 JSON object: %v（body: %s）", err, rec.Body.String())
	}
	return got
}

// TestBlogPhotoUploadURL_未登入被拒絕 驗證這個功能不開放訪客使用。
func TestBlogPhotoUploadURL_未登入被拒絕(t *testing.T) {
	f := newBlogPhotoFixture(t)
	f.doNoAuth(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusUnauthorized)
}

// TestBlogPhotoUploadURL_已刪除使用者的合法JWT被拒絕 對應 2026-10 code
// review 發現的身份衝突漏洞(見 internal/api/auth.go requireRealUser 的
// 完整說明):JWT 簽章合法,但 claims.Sub 對應的使用者已不存在於資料庫
// ——userFor/userFromToken 會悄悄回退成共用的 s.guestUser(ID 固定
// "usr_me")。如果這裡沒有正確擋下來,兩個「使用者已被刪除、JWT 還沒
// 過期」的呼叫端會被當成同一個 ownerID,互相讀寫到對方建立的上傳記錄。
// 這裡驗證 handleBlogPhotoUploadURL 既有的 isGuestUser 檢查(邏輯上
// 等價於 requireRealUser)確實擋下這個情境。
func TestBlogPhotoUploadURL_已刪除使用者的合法JWT被拒絕(t *testing.T) {
	f := newBlogPhotoFixture(t)
	ghostToken, err := f.srv.signer.Sign("usr_ghost_photo", "ghost")
	if err != nil {
		t.Fatalf("簽 ghost token: %v", err)
	}
	doRequest(t, f.routes, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, ghostToken, http.StatusUnauthorized)
}

// TestBlogPhotoUploadURL_登入後成功建立pending記錄 驗證登入後呼叫
// upload-url 成功建立 pending 記錄並回傳預期格式(photoId/uploadUrl/
// publicUrl)。
func TestBlogPhotoUploadURL_登入後成功建立pending記錄(t *testing.T) {
	f := newBlogPhotoFixture(t)
	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)

	photoID, _ := got["photoId"].(string)
	if photoID == "" {
		t.Fatalf("回應應包含 photoId,got %v", got)
	}
	if uploadURL, _ := got["uploadUrl"].(string); uploadURL == "" {
		t.Fatalf("回應應包含 uploadUrl,got %v", got)
	}
	if publicURL, _ := got["publicUrl"].(string); publicURL == "" {
		t.Fatalf("回應應包含 publicUrl,got %v", got)
	}

	photo, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if photo.OwnerID != f.userID {
		t.Fatalf("OwnerID 不符,got %q want %q", photo.OwnerID, f.userID)
	}
	if photo.Status != "pending" {
		t.Fatalf("初始 Status 應為 pending,got %q", photo.Status)
	}
}

// TestBlogPhotoComplete_不屬於自己的photoId回傳權限錯誤 驗證 complete
// 端點對不屬於自己的 photoId 回傳權限錯誤(這裡以 404 呈現,見
// blog_photo.go 的完整說明:刻意不透露「這個 ID 其實存在」)。
func TestBlogPhotoComplete_不屬於自己的photoId回傳權限錯誤(t *testing.T) {
	f := newBlogPhotoFixture(t)

	// 用 store 直接建一筆屬於另一個使用者的原圖記錄。
	otherPhoto, err := f.srv.store.CreateUploadedPhoto("usr_someone_else", "https://storage.googleapis.com/test-bucket/user-uploads/usr_someone_else/abc.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}

	f.do(t, "POST", "/v1/blog/photos/"+otherPhoto.ID+"/complete", nil, http.StatusNotFound)
}

// TestBlogPhotoComplete_成功處理產生兩種Variant 端到端驗證 complete
// 端點觸發的背景處理:下載原圖、resize、寫入 photo_variants、更新
// Status 為 ready。背景處理是 goroutine,測試用輪詢等待其完成(對齊
// 背景任務測試的一般寫法:沒有同步訊號可用時,短輪詢直到狀態符合
// 預期或逾時)。
func TestBlogPhotoComplete_成功處理產生兩種Variant(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	// 模擬使用者端已經把原圖 PUT 上去——直接寫入 MemoryObjectStore
	// (測試不需要真的發一個 PUT 請求到假的 pre-signed URL,那只是
	// 字串,見 MemoryObjectStore.signPutURL 的說明)。
	photo, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	objectName := publicURLToObjectName(t, photo.OriginalURL)
	f.store.Objects[objectName] = makeTestJPEGBytes(t, 800, 600)

	completeResp := f.do(t, "POST", "/v1/blog/photos/"+photoID+"/complete", nil, http.StatusOK)
	if completeResp["status"] != "processing" {
		t.Fatalf("complete 應立即回應 processing,got %v", completeResp)
	}

	waitForPhotoStatus(t, f.srv, photoID, "ready")

	final, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if len(final.Variants) != 2 {
		t.Fatalf("預期產生 2 個 variant,got %d: %+v", len(final.Variants), final.Variants)
	}
}

// TestBlogPhotoRetry_未登入被拒絕 驗證未帶 Authorization header 呼叫
// retry 端點時,跟其他需要身分的 blog photo 端點一致地回 401(見
// handleBlogPhotoTriggerProcessing 開頭的 isGuestUser 檢查)。
func TestBlogPhotoRetry_未登入被拒絕(t *testing.T) {
	f := newBlogPhotoFixture(t)
	f.doNoAuth(t, "POST", "/v1/blog/photos/some-id/retry", nil, http.StatusUnauthorized)
}

// TestBlogPhotoRetry_不屬於自己的photoId回傳權限錯誤 對照既有的
// TestBlogPhotoComplete_不屬於自己的photoId回傳權限錯誤——retry 與
// complete 共用同一套 handleBlogPhotoTriggerProcessing,對不屬於自己
// 的 photoId 一樣刻意回 404(不洩漏「這個 ID 其實存在,只是不屬於你」)。
func TestBlogPhotoRetry_不屬於自己的photoId回傳權限錯誤(t *testing.T) {
	f := newBlogPhotoFixture(t)

	otherPhoto, err := f.srv.store.CreateUploadedPhoto("usr_someone_else", "https://storage.googleapis.com/test-bucket/user-uploads/usr_someone_else/abc.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}

	f.do(t, "POST", "/v1/blog/photos/"+otherPhoto.ID+"/retry", nil, http.StatusNotFound)
}

// TestBlogPhotoRetry_對failed記錄重新觸發處理成功 驗證對一筆已經是
// failed 狀態的記錄呼叫 retry,會重新觸發背景處理並把 Status 校正為
// ready——retry 刻意不檢查呼叫當下的狀態是否真的是 failed(見
// handleBlogPhotoTriggerProcessing 的完整說明,與 complete 共用同一套
// 邏輯),這裡用一筆 failed 記錄驗證「重新處理」這個典型使用情境真的
// 有效,驗證手法(輪詢 waitForPhotoStatus)對照既有的
// TestBlogPhotoComplete_成功處理產生兩種Variant。
func TestBlogPhotoRetry_對failed記錄重新觸發處理成功(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	photo, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	objectName := publicURLToObjectName(t, photo.OriginalURL)
	f.store.Objects[objectName] = makeTestJPEGBytes(t, 800, 600)

	// 先把這筆記錄標成 failed,模擬「第一次處理失敗過」的情境。
	if err := f.srv.store.SetUploadedPhotoStatus(photoID, "failed"); err != nil {
		t.Fatalf("SetUploadedPhotoStatus: %v", err)
	}

	retryResp := f.do(t, "POST", "/v1/blog/photos/"+photoID+"/retry", nil, http.StatusOK)
	if retryResp["status"] != "processing" {
		t.Fatalf("retry 應立即回應 processing,got %v", retryResp)
	}

	waitForPhotoStatus(t, f.srv, photoID, "ready")

	final, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if len(final.Variants) != 2 {
		t.Fatalf("預期產生 2 個 variant,got %d: %+v", len(final.Variants), final.Variants)
	}
}

// TestBlogPhotoFocal_成功更新 驗證 focal 端點成功更新裁切焦點。
func TestBlogPhotoFocal_成功更新(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	resp := f.do(t, "PATCH", "/v1/blog/photos/"+photoID+"/focal", map[string]any{"focalX": 0.3, "focalY": 0.7}, http.StatusOK)
	if resp["status"] != "updated" {
		t.Fatalf("預期 status=updated,got %v", resp)
	}

	photo, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	if photo.FocalX == nil || *photo.FocalX != 0.3 {
		t.Fatalf("FocalX 未正確更新,got %v", photo.FocalX)
	}
	if photo.FocalY == nil || *photo.FocalY != 0.7 {
		t.Fatalf("FocalY 未正確更新,got %v", photo.FocalY)
	}
}

// TestBlogPhotoDelete_成功刪除後查不到 驗證 delete 端點成功刪除後,
// GetUploadedPhoto 查不到這筆記錄。
func TestBlogPhotoDelete_成功刪除後查不到(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	resp := f.do(t, "DELETE", "/v1/blog/photos/"+photoID, nil, http.StatusOK)
	if resp["status"] != "deleted" {
		t.Fatalf("預期 status=deleted,got %v", resp)
	}

	if _, err := f.srv.store.GetUploadedPhoto(photoID); err != store.ErrNotFound {
		t.Fatalf("刪除後應查不到這筆記錄,got err=%v", err)
	}
}

// TestBlogPhotoDelete_DB刪除成功GCS刪除失敗時仍回應成功且留下孤兒物件
// 驗證 handleBlogPhotoDelete 的「先刪 DB、再刪 GCS」順序(見該函式開頭
// 完整說明):GCS 刪除失敗是次要失敗,不該影響 API 回應——DB 記錄已經
// 刪除,使用者體感上操作已成功,GCS 上留下的孤兒檔案之後可人工/排程
// 清理,比「DB 記錄指向不存在的檔案」這種舊順序下的失敗模式更安全。
func TestBlogPhotoDelete_DB刪除成功GCS刪除失敗時仍回應成功且留下孤兒物件(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	photo, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	objectName := publicURLToObjectName(t, photo.OriginalURL)
	f.store.Objects[objectName] = makeTestJPEGBytes(t, 800, 600)

	// 模擬 GCS 刪除失敗(暫時性錯誤,不是「物件不存在」那種視為冪等
	// 成功的情況)。
	f.store.DeleteErr = errTestGCSDeleteFailed

	resp := f.do(t, "DELETE", "/v1/blog/photos/"+photoID, nil, http.StatusOK)
	if resp["status"] != "deleted" {
		t.Fatalf("GCS 刪除失敗不該影響 API 回應,預期 status=deleted,got %v", resp)
	}

	// DB 記錄應該已經刪除(先刪 DB 的順序下,DB 刪除本身並未受 GCS
	// 刪除失敗影響)。
	if _, err := f.srv.store.GetUploadedPhoto(photoID); err != store.ErrNotFound {
		t.Fatalf("DB 記錄應已刪除,got err=%v", err)
	}
	// GCS 物件應該仍然留著(變成孤兒檔案,這是刻意接受的次要失敗後果)。
	if _, ok := f.store.Objects[objectName]; !ok {
		t.Fatalf("GCS 刪除失敗時,物件應該仍留在 store 裡(孤兒檔案),但已經不見了")
	}
}

// errTestGCSDeleteFailed 是測試專用的固定錯誤值,模擬 GCS 刪除失敗。
var errTestGCSDeleteFailed = fmt.Errorf("模擬的 GCS 刪除失敗")

// TestBlogPhotoDelete_DB刪除失敗時GCS物件不會被動到 驗證
// handleBlogPhotoDelete 在 DB 刪除本身失敗時(這裡用「photoId 不存在」
// 模擬——實際情境是暫時性資料庫錯誤,但效果等價:DeleteUploadedPhoto
// 回傳非 nil 錯誤),完全不會呼叫到 GCS 刪除——先刪 DB 的順序下,DB
// 失敗應該直接中斷、不觸碰 GCS,確保「DB 刪除失敗、GCS 物件還在」這個
// 安全的失敗模式(見 handleBlogPhotoDelete 開頭完整說明)。
func TestBlogPhotoDelete_DB刪除失敗時GCS物件不會被動到(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	photo, err := f.srv.store.GetUploadedPhoto(photoID)
	if err != nil {
		t.Fatalf("GetUploadedPhoto: %v", err)
	}
	objectName := publicURLToObjectName(t, photo.OriginalURL)
	f.store.Objects[objectName] = makeTestJPEGBytes(t, 800, 600)

	// 搶在 API 呼叫之前,直接用 store 把這筆記錄刪掉——模擬「DB 層
	// 這次刪除會失敗」的效果(呼叫端拿到的仍是 DeleteUploadedPhoto
	// 回傳非 nil 錯誤,這裡用 ErrNotFound 達到同樣的程式路徑驗證
	// 目的,不需要額外構造一個真正的暫時性資料庫錯誤)。
	if err := f.srv.store.DeleteUploadedPhoto(photoID); err != nil {
		t.Fatalf("預先刪除失敗: %v", err)
	}

	f.do(t, "DELETE", "/v1/blog/photos/"+photoID, nil, http.StatusNotFound)

	// GCS 物件應該完全沒有被動到——DB 刪除失敗時直接回應錯誤,不會
	// 走到呼叫 GCS 刪除那一步。
	if _, ok := f.store.Objects[objectName]; !ok {
		t.Fatalf("DB 刪除失敗時不該呼叫 GCS 刪除,但物件已經不見了")
	}
}

// TestBlogPhotoList_惰性清理把過期pending標記為failed 驗證
// GET /v1/blog/photos 回應前,會把建立時間超過門檻、仍是 pending 的
// 記錄校正成 failed。
func TestBlogPhotoList_惰性清理把過期pending標記為failed(t *testing.T) {
	f := newBlogPhotoFixture(t)

	photo, err := f.srv.store.CreateUploadedPhoto(f.userID, "https://storage.googleapis.com/test-bucket/user-uploads/"+f.userID+"/stale.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto: %v", err)
	}
	// 直接改資料庫的 created_at 讓這筆記錄「看起來」是 2 小時前建立的
	// ——店式地模擬「背景處理一直沒有完成」的情境,不需要真的等 1 小時。
	// 用 UTC——store 層的 now()/MarkStalePendingPhotosAsFailed 一律用
	// UTC 時間比較(見 store.go 的 now() 說明),傳本地時間會讓
	// SQLite 文字型態的時間比較因時區偏移未對齊而判斷錯誤。
	if err := f.srv.store.TestSetUploadedPhotoCreatedAt(photo.ID, time.Now().UTC().Add(-2*time.Hour)); err != nil {
		t.Fatalf("TestSetUploadedPhotoCreatedAt: %v", err)
	}

	resp := f.do(t, "GET", "/v1/blog/photos", nil, http.StatusOK)
	photos, ok := resp["photos"].([]any)
	if !ok || len(photos) != 1 {
		t.Fatalf("預期列表有 1 筆,got %v", resp)
	}
	entry := photos[0].(map[string]any)
	if entry["status"] != "failed" {
		t.Fatalf("過期的 pending 記錄應被惰性清理為 failed,got %v", entry["status"])
	}
}

// TestBlogPhotoComplete_背景處理panic時狀態被標記為failed 驗證
// runPhotoProcessingInBackground 的 recover 保護:背景處理過程中若
// 發生 panic(這裡透過 MemoryObjectStore.ReadPanic 注入,模擬底層
// 影像處理邏輯對非預期輸入 panic 的情境),不會讓整個測試行程(對應
// 正式環境的整個 server process)崩潰,且這筆記錄的 Status 最終會被
// 正確標記為 failed——讓使用者在列表頁看得到「處理失敗」並能按重試,
// 而不是永遠卡在 pending/processing。
func TestBlogPhotoComplete_背景處理panic時狀態被標記為failed(t *testing.T) {
	f := newBlogPhotoFixture(t)

	got := f.do(t, "POST", "/v1/blog/photos/upload-url", map[string]any{"contentType": "image/jpeg"}, http.StatusOK)
	photoID := got["photoId"].(string)

	// 讓這次背景處理一讀原圖就 panic——不需要真的構造一個會讓
	// image.Decode/resize 邏輯 panic 的輸入,直接在測試層注入即可,
	// 行為更穩定可重現(見 MemoryObjectStore.ReadPanic 的完整說明)。
	f.store.ReadPanic = "模擬非預期的 panic"

	completeResp := f.do(t, "POST", "/v1/blog/photos/"+photoID+"/complete", nil, http.StatusOK)
	if completeResp["status"] != "processing" {
		t.Fatalf("complete 應立即回應 processing,got %v", completeResp)
	}

	// 測試本身能跑到這裡、沒有讓整個測試行程崩潰,已經是 recover 生效
	// 的直接證明;再進一步確認狀態確實被校正為 failed。
	waitForPhotoStatus(t, f.srv, photoID, "failed")
}

// makeTestJPEGBytes 產生一張測試用 JPEG 位元組,供模擬「使用者已經
// 上傳完成的原圖」使用。
func makeTestJPEGBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

// publicURLToObjectName 把 MemoryObjectStore.publicURL 產生的網址反解
// 回物件路徑——寫死前綴 "https://storage.googleapis.com/test-bucket/"
// 對齊 photoupload.MemoryObjectStore.publicURL 的固定格式。
func publicURLToObjectName(t *testing.T, publicURL string) string {
	t.Helper()
	const prefix = "https://storage.googleapis.com/test-bucket/"
	if len(publicURL) <= len(prefix) || publicURL[:len(prefix)] != prefix {
		t.Fatalf("publicURL 格式不符預期: %q", publicURL)
	}
	return publicURL[len(prefix):]
}

// TestPublicBlogPhotosByIDs_只回傳已發布文章引用且ready的圖片 驗證
// 2026-10 code review 修正的核心授權邏輯(見 handlePublicBlogPhotosByIDs
// 的完整說明):這支端點不檢查登入身分,但必須只回傳「目前被已發布
// 文章引用、且處理完成(status=="ready")」的圖片,否則任何人只要知道
// 一個 photoId 就能拿到其他使用者草稿配圖的永久有效網址,或看到還在
// 處理中/失敗的中繼狀態圖片。
func TestPublicBlogPhotosByIDs_只回傳已發布文章引用且ready的圖片(t *testing.T) {
	f := newBlogPhotoFixture(t)

	// 一張已處理完成、被已發布文章引用的圖片——應該通過。
	readyPhoto, err := f.srv.store.CreateUploadedPhoto(f.userID, "https://example.com/ready.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto(ready): %v", err)
	}
	if err := f.srv.store.SetUploadedPhotoStatus(readyPhoto.ID, "ready"); err != nil {
		t.Fatalf("SetUploadedPhotoStatus(ready): %v", err)
	}
	if _, err := f.srv.store.CreateContentPage(f.userID, "published-with-photo",
		`{"title":"t","blocks":[{"id":"p1","kind":"image","photoId":"`+readyPhoto.ID+`"}]}`, f.userID); err != nil {
		t.Fatalf("CreateContentPage: %v", err)
	}
	if err := f.srv.store.SetContentPageStatus(f.userID, "published-with-photo", "published"); err != nil {
		t.Fatalf("SetContentPageStatus(published): %v", err)
	}

	// 一張同樣 ready、但只被草稿文章引用的圖片——不應該通過。
	draftPhoto, err := f.srv.store.CreateUploadedPhoto(f.userID, "https://example.com/draft.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto(draft): %v", err)
	}
	if err := f.srv.store.SetUploadedPhotoStatus(draftPhoto.ID, "ready"); err != nil {
		t.Fatalf("SetUploadedPhotoStatus(draft, ready): %v", err)
	}
	if _, err := f.srv.store.CreateContentPage(f.userID, "draft-with-photo",
		`{"title":"t","blocks":[{"id":"p1","kind":"image","photoId":"`+draftPhoto.ID+`"}]}`, f.userID); err != nil {
		t.Fatalf("CreateContentPage(draft): %v", err)
	}
	// 刻意不發布這篇。

	// 一張被已發布文章引用、但還在處理中(pending)的圖片——不應該通過
	// (見 handlePublicBlogPhotosByIDs 對 Status 的完整說明)。
	pendingPhoto, err := f.srv.store.CreateUploadedPhoto(f.userID, "https://example.com/pending.jpg")
	if err != nil {
		t.Fatalf("CreateUploadedPhoto(pending): %v", err)
	}
	// 刻意不呼叫 SetUploadedPhotoStatus,維持建立時的預設 "pending"。
	if _, err := f.srv.store.CreateContentPage(f.userID, "published-with-pending-photo",
		`{"title":"t","blocks":[{"id":"p1","kind":"image","photoId":"`+pendingPhoto.ID+`"}]}`, f.userID); err != nil {
		t.Fatalf("CreateContentPage(pending): %v", err)
	}
	if err := f.srv.store.SetContentPageStatus(f.userID, "published-with-pending-photo", "published"); err != nil {
		t.Fatalf("SetContentPageStatus(pending article, published): %v", err)
	}

	ids := readyPhoto.ID + "," + draftPhoto.ID + "," + pendingPhoto.ID + ",upf_doesnotexist"
	got := f.doNoAuth(t, "GET", "/public/blog/photos?ids="+ids, nil, http.StatusOK)

	photos, ok := got["photos"].([]any)
	if !ok {
		t.Fatalf("回應格式不符預期: %+v", got)
	}
	if len(photos) != 1 {
		t.Fatalf("應該只回傳 1 張圖片(已發布文章引用且 ready),got %d: %+v", len(photos), photos)
	}
	first, ok := photos[0].(map[string]any)
	if !ok || first["id"] != readyPhoto.ID {
		t.Fatalf("回傳的圖片應該是 readyPhoto(%s),got %+v", readyPhoto.ID, photos[0])
	}
}

// waitForPhotoStatus 輪詢等待背景處理 goroutine 把 Status 改成
// wantStatus——背景處理沒有提供同步完成訊號給測試,用短輪詢是這個
// 專案裡驗證背景任務最終結果的既有務實做法(理由同其餘背景任務測試
// 的輪詢慣例)。
func waitForPhotoStatus(t *testing.T, s *Server, photoID, wantStatus string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		photo, err := s.store.GetUploadedPhoto(photoID)
		if err != nil {
			t.Fatalf("GetUploadedPhoto: %v", err)
		}
		if photo.Status == wantStatus {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("等待 Status 變成 %q 逾時", wantStatus)
}
