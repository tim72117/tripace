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
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"cloud.google.com/go/storage"
)

// Uploader 把外部圖片網址下載後上傳到固定的 GCS bucket。
type Uploader struct {
	bucket string
	client *storage.Client
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
	return &Uploader{bucket: bucket, client: client}, nil
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

	uctx, cancel := context.WithTimeout(ctx, uploadTimeout)
	defer cancel()
	objectName := "attractions/" + objectKey + extFromURL(sourceURL)
	w := u.client.Bucket(u.bucket).Object(objectName).NewWriter(uctx)
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.ContentType = ct
	}
	if _, err := io.Copy(w, resp.Body); err != nil {
		_ = w.Close()
		return "", fmt.Errorf("上傳 GCS 失敗: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("上傳 GCS 失敗: %w", err)
	}

	return fmt.Sprintf("https://storage.googleapis.com/%s/%s", u.bucket, objectName), nil
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
	if err := u.client.Bucket(u.bucket).Object(objectName).Delete(dctx); err != nil {
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
