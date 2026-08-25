// Package photostorage 把外部圖片網址(Pexels 查詢結果、使用者手動填的
// -photo-url)下載後上傳到 GCS,回傳我方 bucket 底下的公開 URL——取代
// 原本直接把外部連結存進 attractions.photo_url 的做法。
//
// 動機:外部圖床連結的長期可用性不受我方控制(圖被刪除、服務下線、URL
// 改版),景點區域資料是人工建檔、預期長期存在的內容,不該依賴第三方
// 網址一直有效。上傳到自己的 GCS bucket 後,即使來源網址失效,資料庫
// 存的 photo_url 依然可用。
//
// 這個套件只負責「下載一個 URL、上傳到 GCS、回傳新網址」這件事,不關心
// 圖片來源是誰(Google Photo Media API 已經回傳 data: URI,不經過這裡;
// Pexels 與使用者指定的外部連結才需要這道落地手續)。
package photostorage

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"cloud.google.com/go/storage"
)

// objectStore 是 Uploader 實際需要用到的 GCS 操作子集(寫入一個物件、
// 刪除一個物件)——抽成介面讓測試能注入一份 in-memory 假實作
// (見 photostorage_test.go 的 fakeObjectStore),不需要真的連線 GCS 或
// 依賴 STORAGE_EMULATOR_HOST 這類外部環境。gcsObjectStore(下方)是唯一
// 的正式實作,包住 *storage.Client 對應的呼叫。
type objectStore interface {
	// writeObject 寫入 objectName 的完整內容(bucket 已經由實作內部固定
	// 住,呼叫端不需要重複傳)。
	writeObject(ctx context.Context, objectName, contentType string, r io.Reader) error
	// deleteObject 刪除 objectName,物件不存在時回傳 storage.ErrObjectNotExist
	// (呼叫端 Delete 依這個哨兵值判斷是否視為冪等成功,見該函式的說明)。
	deleteObject(ctx context.Context, objectName string) error
}

// gcsObjectStore 是 objectStore 的正式實作,包住 *storage.Client。
type gcsObjectStore struct {
	client *storage.Client
	bucket string
}

func (s *gcsObjectStore) writeObject(ctx context.Context, objectName, contentType string, r io.Reader) error {
	w := s.client.Bucket(s.bucket).Object(objectName).NewWriter(ctx)
	if contentType != "" {
		w.ContentType = contentType
	}
	if _, err := io.Copy(w, r); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

func (s *gcsObjectStore) deleteObject(ctx context.Context, objectName string) error {
	return s.client.Bucket(s.bucket).Object(objectName).Delete(ctx)
}

// Uploader 把外部圖片網址下載後上傳到固定的 GCS bucket。
type Uploader struct {
	bucket string
	store  objectStore
}

// New 建立一個 Uploader。bucket 為空字串時,Upload 會直接回傳
// ErrNoBucket,不會嘗試建立 GCS client——對齊 pexels.Client 在
// apiKey 為空時的既有降級慣例(見該套件的 New 說明),讓呼叫端不需要
// 額外判斷「這個功能到底有沒有設定」。
func New(ctx context.Context, bucket string) (*Uploader, error) {
	if bucket == "" {
		return &Uploader{}, nil
	}
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("建立 GCS client 失敗: %w", err)
	}
	return &Uploader{bucket: bucket, store: &gcsObjectStore{client: client, bucket: bucket}}, nil
}

// ErrNoBucket 表示呼叫端未設定 bucket(對齊 pexels.ErrNoAPIKey 的既有
// 降級慣例)——呼叫端應視為「這個功能未啟用」,不是真正的錯誤,不需要
// 因此中斷主要操作(建檔/更新照片)。
var ErrNoBucket = fmt.Errorf("photostorage: 未設定 GCS bucket")

// downloadTimeout/uploadTimeout 分開設定,理由同 pexels.Client 對外部
// 服務逐一設定合理逾時的既有慣例——下載對象是任意外部圖床(可能較慢),
// 上傳對象是我方自己的 GCS(通常很快),不該共用同一個寬鬆逾時互相影響。
const (
	downloadTimeout = 15 * time.Second
	uploadTimeout   = 10 * time.Second
)

// Upload 下載 sourceURL 指向的圖片,上傳到 GCS 的
// attractions/{objectKey}{ext} 路徑(副檔名依 sourceURL 判斷,查不到則
// 預設 .jpg),回傳公開存取 URL(https://storage.googleapis.com/...)。
//
// objectKey 由呼叫端決定(通常是 attraction 的 ID)——用穩定、可重現的
// 值當物件路徑,同一筆 attraction 重新查一次照片會覆蓋舊物件,不會在
// bucket 裡累積孤兒檔案。
//
// bucket 未設定時回傳 ErrNoBucket;下載/上傳失敗回傳對應的 error。呼叫端
// 依既有的「照片是輔助欄位」降級慣例決定如何處理失敗(見
// server/internal/api/maintenance.go 的呼叫端說明)。
func (u *Uploader) Upload(ctx context.Context, objectKey, sourceURL string) (string, error) {
	if u.bucket == "" {
		return "", ErrNoBucket
	}

	dctx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(dctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return "", fmt.Errorf("組建下載請求失敗: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("下載圖片失敗: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下載圖片失敗: HTTP %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	objectName := "attractions/" + objectKey + extFromURL(sourceURL)
	return u.uploadBytes(ctx, objectName, contentType, resp.Body)
}

// UploadDataURI 把一個 data: URI(base64,含 MIME type——例如
// geo.Client.PhotoDataURI/fetchPhotoAsDataURI 已組好的 Google Photo
// Media 圖片)解碼後上傳到 GCS 的 place-details/{objectKey}{ext} 路徑,
// 回傳公開存取 URL。跟 Upload(下載外部網址)是同一組落地機制的兩個
// 入口,差別只在來源已經是本機記憶體裡的 base64 資料、不需要另外發
// HTTP 請求下載——見 handleGeoPlaceDetails 的呼叫端說明:地圖上點選
// 任意地點查到的 Google 照片是這種格式,不像 Pexels 查詢結果本身就是
// 一個外部網址(走 Upload)。
//
// objectKey 用呼叫端的穩定識別碼(通常是 Google placeId,同一地點重查
// 會覆蓋舊物件,不會在 bucket 裡累積孤兒檔案)——理由同 Upload 的
// objectKey 說明,只是這裡的物件前綴改用 place-details/,跟景點區域
// 建檔用的 attractions/ 前綴分開,避免兩種不同性質的資料(人工建檔 vs
// 使用者即時查詢)混在同一個前綴下。
//
// dataURI 格式不符預期(缺少 "data:" 前綴或 "," 分隔符、base64 解碼
// 失敗)時回傳錯誤,呼叫端應比照 Upload 失敗的既有降級慣例處理(保留
// 原始來源,不阻擋主要查詢流程)。
func (u *Uploader) UploadDataURI(ctx context.Context, objectKey, dataURI string) (string, error) {
	if u.bucket == "" {
		return "", ErrNoBucket
	}

	contentType, payload, err := decodeDataURI(dataURI)
	if err != nil {
		return "", err
	}

	ext := extFromContentType(contentType)
	objectName := "place-details/" + objectKey + ext
	return u.uploadBytes(ctx, objectName, contentType, strings.NewReader(payload))
}

// uploadBytes 是 Upload/UploadDataURI 共用的實際 GCS 寫入邏輯,理由同
// downloadPhotoBytes 拆出來供 geo.Client 多個呼叫端共用的既有慣例——
// 兩種上層入口只是取得圖片位元組的方式不同(下載 vs. base64 解碼),
// 寫入 GCS 這一步完全相同,不該各自重複實作一份。
func (u *Uploader) uploadBytes(ctx context.Context, objectName, contentType string, r io.Reader) (string, error) {
	uctx, cancel := context.WithTimeout(ctx, uploadTimeout)
	defer cancel()
	if err := u.store.writeObject(uctx, objectName, contentType, r); err != nil {
		return "", fmt.Errorf("上傳 GCS 失敗: %w", err)
	}

	return fmt.Sprintf("https://storage.googleapis.com/%s/%s", u.bucket, objectName), nil
}

// decodeDataURI 解析 "data:{contentType};base64,{payload}" 格式的字串,
// 回傳 MIME type 與解碼後的原始位元組(以 string 形式回傳,供
// strings.NewReader 直接使用,避免多一次 []byte→string 轉換)。
func decodeDataURI(dataURI string) (contentType, payload string, err error) {
	const prefix = "data:"
	if !strings.HasPrefix(dataURI, prefix) {
		return "", "", fmt.Errorf("photostorage: 不是有效的 data URI")
	}
	rest := dataURI[len(prefix):]
	commaIdx := strings.Index(rest, ",")
	if commaIdx == -1 {
		return "", "", fmt.Errorf("photostorage: data URI 缺少 ',' 分隔符")
	}
	meta := rest[:commaIdx]
	encoded := rest[commaIdx+1:]
	contentType = strings.TrimSuffix(meta, ";base64")
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", "", fmt.Errorf("photostorage: base64 解碼失敗: %w", err)
	}
	return contentType, string(decoded), nil
}

// extFromContentType 依 MIME type 猜副檔名,查不到對應項目時預設 .jpg
// (理由同 extFromURL 的既有預設值)——Google Photo Media 回傳的
// Content-Type 目前實務上只會是 image/jpeg 或 image/png,這裡只涵蓋
// 這兩種常見情況,其餘一律當 jpg 處理,不追求窮舉所有 MIME type。
func extFromContentType(contentType string) string {
	switch contentType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

// publicURLPrefix 回傳這個 bucket 的公開 URL 前綴,供 Delete 判斷一個
// photo_url 是不是我方上傳的 GCS 物件(而非使用者填的外部連結、或
// Upload 失敗時保留的原始外部連結)。
func (u *Uploader) publicURLPrefix() string {
	return fmt.Sprintf("https://storage.googleapis.com/%s/", u.bucket)
}

// Delete 刪除 photoURL 對應的 GCS 物件——僅在 photoURL 確實屬於這個
// Uploader 的 bucket 時才會發出刪除請求,否則直接視為成功並回傳 nil
// (不是錯誤:代表這筆資料的照片本來就不是我方 GCS 物件,例如使用者填的
// 外部連結、或當初上傳失敗時保留的原始外部連結,沒有東西需要清)。這個
// 判斷避免呼叫端(attraction-delete)不小心對任意外部 URL 發出刪除嘗試,
// 也避免刪錯不屬於這個 bucket 的物件。
//
// bucket 未設定時(ErrNoBucket 情境)一律視為無事可做,回傳 nil——刪除
// 一筆連 GCS 落地都沒啟用的資料時,不該因為這個輔助清理步驟而報錯。
func (u *Uploader) Delete(ctx context.Context, photoURL string) error {
	if u.bucket == "" || photoURL == "" {
		return nil
	}
	prefix := u.publicURLPrefix()
	if !strings.HasPrefix(photoURL, prefix) {
		return nil
	}
	objectName := strings.TrimPrefix(photoURL, prefix)

	dctx, cancel := context.WithTimeout(ctx, uploadTimeout)
	defer cancel()
	if err := u.store.deleteObject(dctx, objectName); err != nil {
		// 物件本來就不存在(ErrObjectNotExist)不視為錯誤——刪除操作本身
		// 是冪等的,重複呼叫或物件已經被清過都應該視為「這筆照片現在確實
		// 不在 bucket 裡」這個目標已達成,不該讓呼叫端(attraction-delete)
		// 因此整個操作失敗。
		if err == storage.ErrObjectNotExist {
			return nil
		}
		return fmt.Errorf("刪除 GCS 物件失敗: %w", err)
	}
	return nil
}

// extFromURL 從圖片網址取副檔名,查不到(或帶查詢字串等雜訊導致長度
// 異常)時預設 .jpg——同一套判斷邏輯先前已在一次性遷移腳本驗證過,68
// 筆既有 Pexels 圖片全數正確判斷。
func extFromURL(u string) string {
	clean := u
	if idx := strings.Index(clean, "?"); idx != -1 {
		clean = clean[:idx]
	}
	ext := path.Ext(clean)
	if ext == "" || len(ext) > 5 {
		return ".jpg"
	}
	return ext
}
