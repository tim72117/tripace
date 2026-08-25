package photostorage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"cloud.google.com/go/storage"
)

// fakeObjectStore 是 objectStore 的 in-memory 假實作——測試 Uploader 的
// 邏輯(objectName 組法、bucket 前綴判斷、錯誤處理)時不需要真的連線
// GCS,只需要驗證「Uploader 呼叫 objectStore 時傳了什麼、objectStore
// 回傳的結果 Uploader 有沒有正確處理」。
type fakeObjectStore struct {
	// written 記錄每次 writeObject 呼叫收到的完整內容,key 是 objectName
	// ——用來斷言「這次上傳寫到了正確的物件路徑、內容是預期的位元組」。
	written map[string]writtenObject
	// deleted 記錄每次成功刪除的 objectName。
	deleted []string
	// writeErr/deleteErr 讓測試模擬 GCS 端寫入/刪除失敗的情境。
	writeErr  error
	deleteErr error
}

type writtenObject struct {
	contentType string
	body        []byte
}

func newFakeObjectStore() *fakeObjectStore {
	return &fakeObjectStore{written: make(map[string]writtenObject)}
}

func (f *fakeObjectStore) writeObject(_ context.Context, objectName, contentType string, r io.Reader) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	body, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	f.written[objectName] = writtenObject{contentType: contentType, body: body}
	return nil
}

func (f *fakeObjectStore) deleteObject(_ context.Context, objectName string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.written[objectName]; !ok {
		return storage.ErrObjectNotExist
	}
	delete(f.written, objectName)
	f.deleted = append(f.deleted, objectName)
	return nil
}

// newTestUploader 建立一個繞過 New()(不連線真的 GCS)、直接注入
// fakeObjectStore 的 Uploader,供測試使用。
func newTestUploader(bucket string, store objectStore) *Uploader {
	return &Uploader{bucket: bucket, store: store}
}

func TestUpload_未設定Bucket時回傳ErrNoBucket(t *testing.T) {
	u := newTestUploader("", nil)
	_, err := u.Upload(context.Background(), "obj1", "https://example.com/photo.jpg")
	if !errors.Is(err, ErrNoBucket) {
		t.Fatalf("want ErrNoBucket, got %v", err)
	}
}

func TestUpload_下載成功後寫入正確的物件路徑與內容(t *testing.T) {
	srcServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("fake-jpeg-bytes"))
	}))
	defer srcServer.Close()

	store := newFakeObjectStore()
	u := newTestUploader("my-bucket", store)

	url, err := u.Upload(context.Background(), "attr123", srcServer.URL+"/photo.jpg")
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	wantURL := "https://storage.googleapis.com/my-bucket/attractions/attr123.jpg"
	if url != wantURL {
		t.Errorf("url = %q, want %q", url, wantURL)
	}

	obj, ok := store.written["attractions/attr123.jpg"]
	if !ok {
		t.Fatalf("expected object attractions/attr123.jpg to be written, got keys: %v", keysOf(store.written))
	}
	if string(obj.body) != "fake-jpeg-bytes" {
		t.Errorf("body = %q, want %q", obj.body, "fake-jpeg-bytes")
	}
	if obj.contentType != "image/jpeg" {
		t.Errorf("contentType = %q, want %q", obj.contentType, "image/jpeg")
	}
}

func TestUpload_來源網址下載失敗時回傳錯誤且不寫入(t *testing.T) {
	srcServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srcServer.Close()

	store := newFakeObjectStore()
	u := newTestUploader("my-bucket", store)

	_, err := u.Upload(context.Background(), "attr123", srcServer.URL+"/missing.jpg")
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if len(store.written) != 0 {
		t.Errorf("expected no object written on download failure, got %v", keysOf(store.written))
	}
}

func TestUpload_GCS寫入失敗時回傳錯誤(t *testing.T) {
	srcServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("bytes"))
	}))
	defer srcServer.Close()

	store := newFakeObjectStore()
	store.writeErr = errors.New("gcs unavailable")
	u := newTestUploader("my-bucket", store)

	_, err := u.Upload(context.Background(), "attr123", srcServer.URL+"/photo.jpg")
	if err == nil {
		t.Fatal("want error, got nil")
	}
}

func TestUploadDataURI_未設定Bucket時回傳ErrNoBucket(t *testing.T) {
	u := newTestUploader("", nil)
	_, err := u.UploadDataURI(context.Background(), "place1", "data:image/jpeg;base64,Zm9v")
	if !errors.Is(err, ErrNoBucket) {
		t.Fatalf("want ErrNoBucket, got %v", err)
	}
}

func TestUploadDataURI_解碼後寫入正確的物件路徑與內容(t *testing.T) {
	store := newFakeObjectStore()
	u := newTestUploader("my-bucket", store)

	// base64("hello-world") == "aGVsbG8td29ybGQ="
	url, err := u.UploadDataURI(context.Background(), "placeXYZ", "data:image/png;base64,aGVsbG8td29ybGQ=")
	if err != nil {
		t.Fatalf("UploadDataURI failed: %v", err)
	}

	wantURL := "https://storage.googleapis.com/my-bucket/place-details/placeXYZ.png"
	if url != wantURL {
		t.Errorf("url = %q, want %q", url, wantURL)
	}

	obj, ok := store.written["place-details/placeXYZ.png"]
	if !ok {
		t.Fatalf("expected object place-details/placeXYZ.png to be written, got keys: %v", keysOf(store.written))
	}
	if string(obj.body) != "hello-world" {
		t.Errorf("body = %q, want %q", obj.body, "hello-world")
	}
}

func TestUploadDataURI_格式錯誤時回傳錯誤(t *testing.T) {
	store := newFakeObjectStore()
	u := newTestUploader("my-bucket", store)

	cases := []struct {
		name    string
		dataURI string
	}{
		{"缺少data前綴", "notadatauri,Zm9v"},
		{"缺少逗號分隔符", "data:image/png;base64"},
		{"base64解碼失敗", "data:image/png;base64,not-valid-base64!!!"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := u.UploadDataURI(context.Background(), "place1", c.dataURI)
			if err == nil {
				t.Fatalf("want error for %q, got nil", c.dataURI)
			}
			if len(store.written) != 0 {
				t.Errorf("expected no object written on decode failure, got %v", keysOf(store.written))
			}
		})
	}
}

func TestDelete_未設定Bucket時視為無事可做(t *testing.T) {
	u := newTestUploader("", nil)
	if err := u.Delete(context.Background(), "https://storage.googleapis.com/x/y.jpg"); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

func TestDelete_不屬於這個Bucket的網址視為無事可做(t *testing.T) {
	store := newFakeObjectStore()
	store.written["attractions/other.jpg"] = writtenObject{}
	u := newTestUploader("my-bucket", store)

	// 外部連結(非我方 GCS 網址)
	if err := u.Delete(context.Background(), "https://images.pexels.com/photos/1/photo.jpg"); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if len(store.deleted) != 0 {
		t.Errorf("expected no delete call for external URL, got %v", store.deleted)
	}

	// 屬於別的 bucket 的 GCS 網址
	if err := u.Delete(context.Background(), "https://storage.googleapis.com/other-bucket/attractions/x.jpg"); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if len(store.deleted) != 0 {
		t.Errorf("expected no delete call for other bucket URL, got %v", store.deleted)
	}
}

func TestDelete_屬於這個Bucket的物件會被刪除(t *testing.T) {
	store := newFakeObjectStore()
	store.written["attractions/attr123.jpg"] = writtenObject{body: []byte("x")}
	u := newTestUploader("my-bucket", store)

	url := "https://storage.googleapis.com/my-bucket/attractions/attr123.jpg"
	if err := u.Delete(context.Background(), url); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if len(store.deleted) != 1 || store.deleted[0] != "attractions/attr123.jpg" {
		t.Errorf("deleted = %v, want [attractions/attr123.jpg]", store.deleted)
	}
}

func TestDelete_物件已不存在時視為冪等成功(t *testing.T) {
	store := newFakeObjectStore()
	u := newTestUploader("my-bucket", store)

	// 物件從未寫入過,deleteObject 會回傳 storage.ErrObjectNotExist
	url := "https://storage.googleapis.com/my-bucket/attractions/never-existed.jpg"
	if err := u.Delete(context.Background(), url); err != nil {
		t.Fatalf("want nil (idempotent success), got %v", err)
	}
}

func TestDelete_GCS刪除失敗時回傳錯誤(t *testing.T) {
	store := newFakeObjectStore()
	store.written["attractions/attr123.jpg"] = writtenObject{body: []byte("x")}
	store.deleteErr = errors.New("gcs unavailable")
	u := newTestUploader("my-bucket", store)

	url := "https://storage.googleapis.com/my-bucket/attractions/attr123.jpg"
	if err := u.Delete(context.Background(), url); err == nil {
		t.Fatal("want error, got nil")
	}
}

func TestExtFromURL(t *testing.T) {
	cases := []struct {
		url  string
		want string
	}{
		{"https://example.com/photo.jpg", ".jpg"},
		{"https://example.com/photo.png?w=800", ".png"},
		{"https://example.com/photo", ".jpg"},
		{"https://example.com/photo.verylongext", ".jpg"},
	}
	for _, c := range cases {
		if got := extFromURL(c.url); got != c.want {
			t.Errorf("extFromURL(%q) = %q, want %q", c.url, got, c.want)
		}
	}
}

func TestExtFromContentType(t *testing.T) {
	cases := []struct {
		contentType string
		want        string
	}{
		{"image/png", ".png"},
		{"image/webp", ".webp"},
		{"image/jpeg", ".jpg"},
		{"", ".jpg"},
		{"application/octet-stream", ".jpg"},
	}
	for _, c := range cases {
		if got := extFromContentType(c.contentType); got != c.want {
			t.Errorf("extFromContentType(%q) = %q, want %q", c.contentType, got, c.want)
		}
	}
}

func keysOf(m map[string]writtenObject) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
