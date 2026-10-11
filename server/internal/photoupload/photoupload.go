// Package photoupload 負責「使用者自行上傳的部落格配圖」這條流程的
// GCS 存取邏輯——簽發 pre-signed PUT URL 讓瀏覽器端直接把原圖上傳到
// GCS(不經過我方 server 轉傳一次完整的圖片位元組)、下載已上傳的原圖
// 位元組供背景處理階段 resize、上傳 resize 完成的衍生版本、以及刪除
// 一張圖的所有物件(原圖+所有 variants)。
//
// 刻意獨立於既有 internal/photostorage 套件,不是在那裡加功能——兩者
// 職責完全不同:photostorage 是「下載一個外部網址、上傳到 GCS」(服務
// 景點照片這種「我方系統主動抓外部圖」的情境,見該套件開頭完整說明),
// 這裡是「簽發憑證讓使用者端直接上傳、之後處理使用者已經上傳好的檔案」
// (服務使用者主動上傳原創內容的情境)。兩者使用的 GCS 操作子集也不同
// (photostorage 不需要簽發 pre-signed URL,這裡不需要下載外部網址),
// 混在同一個套件只會讓兩種不相關的職責互相干擾。
//
// 風格上刻意對齊 photostorage 的既有慣例(介面抽象讓測試可以注入假
// 實作、bucket 未設定時降級而非報錯、New()/NewForTest() 兩種建構方式)
// ——這是同一個專案裡「跟 GCS 打交道」的第二個套件,維持一致的使用
// 方式讓之後的維護者不需要重新學一套新模式。
package photoupload

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"cloud.google.com/go/compute/metadata"
	credentials "cloud.google.com/go/iam/credentials/apiv1"
	"cloud.google.com/go/iam/credentials/apiv1/credentialspb"
	"cloud.google.com/go/storage"
)

// ErrNoBucket 表示呼叫端未設定 bucket——對齊 photostorage.ErrNoBucket
// 的既有降級慣例,呼叫端應視為「這個功能未啟用」,不是需要中斷主要
// 操作(例如使用者正在編輯文章)的致命錯誤。
var ErrNoBucket = errors.New("photoupload: 未設定 GCS bucket")

// objectStore 是 SignedUploader 實際需要用到的 GCS 操作子集——抽成介面
// 讓測試能注入 in-memory 假實作(見 MemoryObjectStore),不需要真的
// 連線 GCS 或 IAM Credentials API。比照 photostorage.objectStore 的既有
// 設計(見該型別的完整說明),差別是這裡多了「讀取物件內容」(背景
// resize 階段要下載原圖)與「簽發 pre-signed PUT URL」兩個操作——
// photostorage 情境下載的是外部網址,不需要簽發憑證;這裡上傳動作發生
// 在使用者瀏覽器端,server 不經手原圖位元組,所以需要能簽出一個使用者
// 端可以直接 PUT 的網址。
type objectStore interface {
	// signPutURL 簽出一個可直接 PUT 上傳到 objectName、於 expires 後失效
	// 的網址,contentType 限定這次上傳必須帶的 Content-Type header(避免
	// 簽出的 URL 被挪去上傳其他類型的內容)。
	signPutURL(objectName, contentType string, expires time.Time) (string, error)
	// readObject 讀出 objectName 的完整內容——背景處理階段下載已上傳的
	// 原圖用。
	readObject(ctx context.Context, objectName string) ([]byte, error)
	// writeObject 寫入 objectName 的完整內容(resize 完成的衍生版本
	// 上傳用)。簽章同 photostorage.objectStore.writeObject,理由相同:
	// 這裡也不需要串流讀寫以外的額外行為。
	writeObject(ctx context.Context, objectName, contentType string, data []byte) error
	// deleteObject 刪除 objectName,物件不存在時回傳
	// storage.ErrObjectNotExist(呼叫端 Delete 依這個哨兵值判斷是否視為
	// 冪等成功,見該方法的說明)——簽章與語意比照
	// photostorage.objectStore.deleteObject。
	deleteObject(ctx context.Context, objectName string) error
	// publicURL 回傳 objectName 的公開存取網址(上傳完成、提供給前端
	// 顯示用)。
	publicURL(objectName string) string
}

// gcsObjectStore 是 objectStore 的正式實作,包住 *storage.Client 與簽發
// pre-signed URL 需要的身份資訊。
type gcsObjectStore struct {
	client *storage.Client
	bucket string
	// googleAccessID 是簽發 pre-signed URL 時,GCS 用來驗證「這個簽章
	// 真的是這個服務帳號簽的」所需的服務帳號 email——見
	// resolveGoogleAccessID 的完整說明(環境變數優先、Cloud Run 環境
	// 退而求其次查 metadata server)。
	googleAccessID string
	// iamClient 是 IAM Credentials API 的客戶端,簽發 pre-signed URL 時
	// 透過它呼叫 SignBlob 完成簽章——見下方 signPutURL 的完整說明:這是
	// 整個「不依賴本機私鑰檔」設計的核心,GCS SDK 的
	// BucketHandle.SignedURL 允許傳入一個 SignBytes callback 自行決定
	// 怎麼簽,這裡就是用這個 callback 轉呼叫 IAM Credentials API 的
	// SignBlob,用目前執行身份(Cloud Run service account 或本機設定的
	// 服務帳號)的權限簽章,不需要下載、保管一份 service account JSON
	// 私鑰檔案。
	iamClient *credentials.IamCredentialsClient
}

func (s *gcsObjectStore) signPutURL(objectName, contentType string, expires time.Time) (string, error) {
	if s.iamClient == nil || s.googleAccessID == "" {
		// 沒有可用的簽章身份——理由同 resolveGoogleAccessID 的說明:
		// 本機開發環境若沒有設定 GCS_SERVICE_ACCOUNT_EMAIL、也不在
		// Cloud Run 環境下跑,就無法簽出合法的 pre-signed URL。這裡不
		// 直接 panic 或讓呼叫端收到晦澀的 GCS SDK 錯誤訊息,而是回傳
		// 一個明確指出原因的錯誤,方便本機開發時快速定位問題。
		return "", errors.New("photoupload: 缺少可用於簽發 pre-signed URL 的服務帳號身份(請設定 GCS_SERVICE_ACCOUNT_EMAIL 或在 Cloud Run 環境執行)")
	}
	opts := &storage.SignedURLOptions{
		GoogleAccessID: s.googleAccessID,
		Method:         http.MethodPut,
		Expires:        expires,
		ContentType:    contentType,
		Scheme:         storage.SigningSchemeV4,
		SignBytes: func(b []byte) ([]byte, error) {
			// 呼叫 IAM Credentials API 的 SignBlob——這一步才是真正的
			// RSA 簽章動作,底層由 Google 代管、使用目前執行身份
			// (googleAccessID 對應的服務帳號)的金鑰完成,我方程式碼
			// 全程不接觸任何私鑰內容。Name 欄位的 "projects/-/
			// serviceAccounts/{email}" 格式是 IAM Credentials API 的
			// 固定寫法,"-" 萬用字元代表「依 serviceAccounts/{email}
			// 本身決定專案」,不可替換成實際 project ID(API 文件明文
			// 要求),這裡直接寫死符合規格。
			resp, err := s.iamClient.SignBlob(context.Background(), &credentialspb.SignBlobRequest{
				Name:    fmt.Sprintf("projects/-/serviceAccounts/%s", s.googleAccessID),
				Payload: b,
			})
			if err != nil {
				return nil, fmt.Errorf("IAM Credentials SignBlob 失敗: %w", err)
			}
			return resp.SignedBlob, nil
		},
	}
	return s.client.Bucket(s.bucket).SignedURL(objectName, opts)
}

func (s *gcsObjectStore) readObject(ctx context.Context, objectName string) ([]byte, error) {
	r, err := s.client.Bucket(s.bucket).Object(objectName).NewReader(ctx)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func (s *gcsObjectStore) writeObject(ctx context.Context, objectName, contentType string, data []byte) error {
	w := s.client.Bucket(s.bucket).Object(objectName).NewWriter(ctx)
	if contentType != "" {
		w.ContentType = contentType
	}
	if _, err := w.Write(data); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

func (s *gcsObjectStore) deleteObject(ctx context.Context, objectName string) error {
	return s.client.Bucket(s.bucket).Object(objectName).Delete(ctx)
}

func (s *gcsObjectStore) publicURL(objectName string) string {
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s", s.bucket, objectName)
}

// SignedUploader 是這個套件對外曝露的主要型別——簽發 pre-signed PUT
// URL、下載/上傳/刪除使用者上傳圖片在 GCS 上的物件。
type SignedUploader struct {
	bucket string
	store  objectStore
	// uploadExpiry 是簽出的 pre-signed PUT URL 有效期限——給使用者端
	// 足夠時間完成上傳(例如網路較慢、圖片檔案較大),但不過長以避免
	// 簽出的憑證長期有效造成安全疑慮。15 分鐘是常見的上傳情境合理上限
	// (對齊一般雲端服務「上傳連結限時」的慣例數字),沒有實際使用量
	// 數據佐證,日後可依實務回報的逾時情況調整。
	uploadExpiry time.Duration
}

const defaultUploadExpiry = 15 * time.Minute

// New 建立一個 SignedUploader。bucket 為空字串時,簽發/下載/上傳/刪除
// 一律回傳 ErrNoBucket,不會嘗試建立 GCS/IAM client——對齊
// photostorage.New 在 bucket 為空時的既有降級慣例(見該函式說明),
// 讓呼叫端(API handler)不需要額外判斷「這個功能到底有沒有設定」,
// 統一用 ErrNoBucket 這個哨兵值降級處理。
//
// serviceAccountEmail 是簽發 pre-signed URL 所需的 GoogleAccessID——
// 見 resolveGoogleAccessID 的完整說明:優先採用呼叫端明確傳入的值
// (對應環境變數 GCS_SERVICE_ACCOUNT_EMAIL),傳空字串時退而求其次嘗試
// 從 Cloud Run 的 metadata server 查詢目前執行身份的 email。兩者都查
// 不到時,SignedUploader 仍會成功建立(不中斷啟動流程),但實際呼叫
// 簽發 URL 的方法會回傳明確錯誤(見 gcsObjectStore.signPutURL)——這個
// 設計讓「本機開發環境没有設定任何身份」不會讓整個 server 無法啟動,
// 只有真正使用到這個功能時才會報錯,對齊這個專案「輔助功能未設定時
// 不阻擋核心服務啟動」的一貫慣例(例如 photostorage/pexels 的 bucket/
// apiKey 未設定降級)。
func New(ctx context.Context, bucket, serviceAccountEmail string) (*SignedUploader, error) {
	if bucket == "" {
		return &SignedUploader{}, nil
	}
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("建立 GCS client 失敗: %w", err)
	}
	iamClient, err := credentials.NewIamCredentialsClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("建立 IAM Credentials client 失敗: %w", err)
	}
	accessID := resolveGoogleAccessID(ctx, serviceAccountEmail)
	return &SignedUploader{
		bucket: bucket,
		store: &gcsObjectStore{
			client:         client,
			bucket:         bucket,
			googleAccessID: accessID,
			iamClient:      iamClient,
		},
		uploadExpiry: defaultUploadExpiry,
	}, nil
}

// resolveGoogleAccessID 決定簽發 pre-signed URL 要用的服務帳號 email——
// 優先用呼叫端明確傳入的 serviceAccountEmail(本機開發環境透過
// GCS_SERVICE_ACCOUNT_EMAIL 環境變數指定,見 server/.env.example 的
// 說明),傳空字串時改查 Cloud Run 環境的 metadata server(見
// metadata.Email 的用法——Cloud Run/GCE 環境下,不帶 serviceAccount
// 參數查詢代表查「目前執行身份」自己的 email,不需要額外設定任何
// 環境變數)。兩者都失敗時回傳空字串,交由呼叫端(signPutURL)在真正
// 嘗試簽發時才報錯,不在啟動階段就讓整個 server 無法起來。
func resolveGoogleAccessID(ctx context.Context, serviceAccountEmail string) string {
	if serviceAccountEmail != "" {
		return serviceAccountEmail
	}
	if !metadata.OnGCE() {
		// 本機開發環境通常偵測不到 GCE metadata server,直接略過這次
		// 查詢嘗試(metadata.EmailWithContext 在非 GCE 環境下本來就會
		// 逾時失敗,這裡提前判斷可以避免每次啟動都白等一次逾時)。
		return ""
	}
	email, err := metadata.EmailWithContext(ctx, "")
	if err != nil {
		return ""
	}
	return email
}

// MemoryObjectStore 是 objectStore 的公開 in-memory 實作,供套件外的
// 測試(API handler 測試、CLI 測試)建立一個不需要真的連線 GCS/IAM
// Credentials API 的 *SignedUploader。比照
// photostorage.MemoryObjectStore 的既有設計(見該型別完整說明:公開
// 而非套件內部專用的理由同樣適用於這裡)。
type MemoryObjectStore struct {
	// Objects 記錄每個物件目前的內容(key 是 objectName)——
	// readObject/writeObject/deleteObject 都直接操作這個 map,供測試
	// 斷言「這次呼叫寫到了正確的物件路徑/內容」,也讓「下載剛剛上傳的
	// 內容」這種背景處理流程可以在測試裡端到端驗證。
	Objects map[string][]byte
	// SignedURLPrefix 是 signPutURL 回傳的假 pre-signed URL 前綴——
	// 測試情境下不需要真的能被瀏覽器拿去 PUT,只需要是一個可預期、
	// 包含 objectName 的字串,讓測試可以斷言「簽出的 URL 指向正確的
	// 物件路徑」。預設值見 NewMemoryObjectStore。
	SignedURLPrefix string
	// SignErr 讓測試模擬簽發失敗(例如驗證「IAM Credentials API 失敗
	// 時,API handler 該怎麼降級回應」)。
	SignErr error
	// ReadPanic 不為 nil 時,readObject 會直接 panic(值即為 panic 的
	// 參數)而非回傳錯誤——供測試模擬「背景處理 goroutine 內部發生
	// 非預期 panic」的情境(例如驗證 runPhotoProcessingInBackground 的
	// recover 保護:panic 發生時狀態確實被標成 failed,且不會讓整個
	// 測試行程崩潰),不需要真的找一個會讓底層影像函式庫 panic 的
	// 損毀輸入,行為更穩定可重現。
	ReadPanic any
	// DeleteErr 讓測試模擬 GCS 物件刪除失敗(非「物件不存在」這種視為
	// 冪等成功的情況,而是真正的刪除失敗,例如暫時性網路錯誤)——供
	// 驗證「DB 記錄已刪除、GCS 刪除失敗」情境下,API 回應是否仍然
	// 視為成功(見 handleBlogPhotoDelete 的完整說明:這個次要失敗不該
	// 影響使用者體感上的刪除結果)。套用到「每一次」deleteObject 呼叫,
	// 不分物件路徑。
	DeleteErr error
	// DeleteErrForObject 讓測試只模擬「指定物件路徑」刪除失敗,其餘
	// 物件維持正常刪除——比 DeleteErr(套用到全部物件)更精確,用於
	// 驗證 DeletePhoto 在其中一個 variant 刪除失敗時,仍會繼續嘗試
	// 刪除其餘 variant(2026-10 code review 修正的「提早 return」問題,
	// 見 DeletePhoto 的完整說明),而不是「刪除整個操作直接失敗、什麼
	// 都沒刪到」這種沒有鑑別度的測試情境。key 是 objectName。
	DeleteErrForObject map[string]error
}

// NewMemoryObjectStore 建立一個空的 MemoryObjectStore。
func NewMemoryObjectStore() *MemoryObjectStore {
	return &MemoryObjectStore{
		Objects:         make(map[string][]byte),
		SignedURLPrefix: "https://fake-signed-url.test/",
	}
}

func (m *MemoryObjectStore) signPutURL(objectName, _ string, _ time.Time) (string, error) {
	if m.SignErr != nil {
		return "", m.SignErr
	}
	return m.SignedURLPrefix + objectName, nil
}

func (m *MemoryObjectStore) readObject(_ context.Context, objectName string) ([]byte, error) {
	if m.ReadPanic != nil {
		panic(m.ReadPanic)
	}
	data, ok := m.Objects[objectName]
	if !ok {
		return nil, storage.ErrObjectNotExist
	}
	return data, nil
}

func (m *MemoryObjectStore) writeObject(_ context.Context, objectName, _ string, data []byte) error {
	// 複製一份存進 map——避免呼叫端之後修改傳入的 slice 底層陣列時,
	// 意外影響到已經「寫入」的內容(真正的 GCS 寫入也是獨立的一份
	// 資料,不會跟呼叫端共用記憶體)。
	cp := make([]byte, len(data))
	copy(cp, data)
	m.Objects[objectName] = cp
	return nil
}

func (m *MemoryObjectStore) deleteObject(_ context.Context, objectName string) error {
	if m.DeleteErr != nil {
		return m.DeleteErr
	}
	if err, ok := m.DeleteErrForObject[objectName]; ok {
		return err
	}
	if _, ok := m.Objects[objectName]; !ok {
		return storage.ErrObjectNotExist
	}
	delete(m.Objects, objectName)
	return nil
}

func (m *MemoryObjectStore) publicURL(objectName string) string {
	return "https://storage.googleapis.com/test-bucket/" + objectName
}

// NewForTest 建立一個繞過 New()(不連線真的 GCS/IAM Credentials API)、
// 以 store 為底層實作的 *SignedUploader,供套件外的測試使用。參數型別
// 固定為 *MemoryObjectStore——理由同
// photostorage.NewForTest 的既有說明:套件外無法命名未匯出的 objectStore
// 介面,直接收具體型別讓呼叫端可以正常宣告、傳遞、操作。
func NewForTest(bucket string, store *MemoryObjectStore) *SignedUploader {
	return &SignedUploader{bucket: bucket, store: store, uploadExpiry: defaultUploadExpiry}
}

// newRandomID 產生物件路徑裡使用的隨機識別字——跟 store 層
// newUploadedPhotoID 等既有 ID 產生方式一致(crypto/rand + hex),但
// 刻意不沿用 "upf_" 前綴:這裡的 ID 只是物件路徑的一部分,不是資料庫
// 主鍵,不需要背負資料庫層的命名慣例。
func newRandomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// extFromContentType 依前端傳入的 MIME type 判斷原圖物件要用的副檔名
// ——只涵蓋部落格配圖實務上會出現的幾種常見格式,查不到對應項目時
// 預設 .jpg(理由同 photostorage.extFromContentType 的既有預設值慣例:
// 不追求窮舉所有 MIME type,查不到就當 jpg 處理)。
func extFromContentType(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".jpg"
	}
}

// originalObjectName 組出原圖在 GCS 的物件路徑——user-uploads/{ownerID}/
// {隨機id}{副檔名},理由見任務規格:路徑帶 ownerID 方便之後依使用者
// 整批列出/清理物件,隨機 id 避免同一使用者連續上傳多張圖時互相覆蓋
// (不像 photostorage.Upload 用「呼叫端提供的穩定 objectKey」讓同一筆
// 資料重查會覆蓋舊物件——這裡每次上傳都是一個全新、獨立的使用者原創
// 檔案,不該有「覆蓋」語意)。
func originalObjectName(ownerID, contentType string) (objectName, randomID string) {
	randomID = newRandomID()
	return fmt.Sprintf("user-uploads/%s/%s%s", ownerID, randomID, extFromContentType(contentType)), randomID
}

// variantObjectName 組出衍生版本(thumbnail/large)在 GCS 的物件路徑——
// user-uploads/{ownerID}/{photoID}-{kind}.jpg。固定用 .jpg 副檔名——見
// resize.go 的說明:衍生版本一律輸出 JPEG 格式(不引入 CGO 相依的
// webp 編碼套件,見該檔案開頭完整說明),副檔名因此不需要依來源圖片
// 格式判斷,直接寫死。
func variantObjectName(ownerID, photoID, kind string) string {
	return fmt.Sprintf("user-uploads/%s/%s-%s.jpg", ownerID, photoID, kind)
}

// UploadURLResult 是 SignUploadURL 的回傳結果——簽出的 pre-signed PUT
// URL、使用者上傳完成後這張圖最終會落地的公開網址(建立 uploaded_photos
// 記錄時,OriginalURL 欄位就填這個值)、以及物件路徑裡用到的隨機 id
// (供呼叫端記錄用,目前的呼叫端——API handler——不需要另外使用這個欄位,
// 但保留讓之後可能的除錯/記錄情境可以取用,不需要重新從 publicURL 反解)。
type UploadURLResult struct {
	UploadURL  string
	PublicURL  string
	ObjectName string
}

// SignUploadURL 簽出一個讓使用者瀏覽器端可以直接 PUT 原圖上去的
// pre-signed URL——物件路徑用 user-uploads/{ownerID}/{隨機id}{副檔名}
// (見 originalObjectName 的完整說明)。contentType 必須是呼叫端
// (handler)已經決定好要讓這次上傳使用的 MIME type,簽出的 URL 會
// 限定上傳請求必須帶相同的 Content-Type header,避免這個 pre-signed
// URL 被挪去上傳非預期類型的內容。
//
// bucket 未設定時回傳 ErrNoBucket——呼叫端(API handler)應依既有
// 降級慣例,把這視為「圖片上傳功能未啟用」回應給使用者,而不是當成
// 伺服器內部錯誤。
func (u *SignedUploader) SignUploadURL(ownerID, contentType string) (UploadURLResult, error) {
	if u.bucket == "" {
		return UploadURLResult{}, ErrNoBucket
	}
	objectName, _ := originalObjectName(ownerID, contentType)
	expires := time.Now().Add(u.uploadExpiry)
	uploadURL, err := u.store.signPutURL(objectName, contentType, expires)
	if err != nil {
		return UploadURLResult{}, fmt.Errorf("簽發 pre-signed URL 失敗: %w", err)
	}
	return UploadURLResult{
		UploadURL:  uploadURL,
		PublicURL:  u.store.publicURL(objectName),
		ObjectName: objectName,
	}, nil
}

// DownloadOriginal 下載 originalURL 對應的原圖位元組——背景處理階段
// (API handler 的 runPhotoProcessing)呼叫,把使用者已經上傳完成的
// 原圖從 GCS 讀出來做 resize。originalURL 預期是 SignUploadURL 回傳的
// PublicURL(或等效的、屬於這個 bucket 的物件公開網址),這裡反解出
// 物件路徑再透過 objectStore 讀取。
//
// bucket 未設定時回傳 ErrNoBucket——理論上不會發生(沒有設定 bucket
// 就不會有任何成功簽發的上傳 URL、也就不會有需要下載的原圖),這裡
// 仍檢查是為了讓呼叫端的錯誤處理路徑一致,不需要特別判斷「這個方法
// 跟 SignUploadURL 是不是同一組降級邏輯」。
func (u *SignedUploader) DownloadOriginal(ctx context.Context, originalURL string) ([]byte, error) {
	if u.bucket == "" {
		return nil, ErrNoBucket
	}
	objectName, err := u.objectNameFromPublicURL(originalURL)
	if err != nil {
		return nil, err
	}
	return u.store.readObject(ctx, objectName)
}

// UploadVariant 把 resize 完成的衍生版本位元組上傳到 GCS 的
// user-uploads/{ownerID}/{photoID}-{kind}.jpg 路徑(見 variantObjectName
// 的完整說明),回傳這個 variant 的公開網址——供呼叫端寫入
// store.CreatePhotoVariant 的 url 欄位。
func (u *SignedUploader) UploadVariant(ctx context.Context, ownerID, photoID, kind string, data []byte) (string, error) {
	if u.bucket == "" {
		return "", ErrNoBucket
	}
	objectName := variantObjectName(ownerID, photoID, kind)
	if err := u.store.writeObject(ctx, objectName, "image/jpeg", data); err != nil {
		return "", fmt.Errorf("上傳衍生版本失敗: %w", err)
	}
	return u.store.publicURL(objectName), nil
}

// DeletePhoto 刪除一張原圖與它底下所有已知的衍生版本物件——比照
// photostorage.Uploader.Delete 的「物件不存在視為成功、冪等」設計(見
// 該方法完整說明):使用者可能重複觸發刪除、或某個 variant 根本還沒
// 產生出來(例如原圖還在 pending 狀態就被刪除),這些情況都不該讓整個
// 刪除操作失敗。
//
// variantKinds 由呼叫端傳入目前這張原圖實際已知的衍生版本種類(來自
// store.GetUploadedPhoto 回傳的 Variants——不是寫死 thumbnail/large
// 兩個固定字串:如果這張圖還在 pending/failed 狀態、根本沒有任何
// variant,呼叫端傳空陣列即可,這裡不會額外嘗試刪除不存在的物件路徑
// 造成困惑的「物件不存在」雜訊,雖然那本來就會被當成冪等成功吞掉,
// 但只刪實際存在過的種類語意更清楚)。
//
// 2026-10 code review 修正:原本原圖或任一 variant 刪除失敗就立即
// return,導致迴圈裡排在後面的 variant 完全沒有被嘗試刪除——例如
// thumbnail 刪除失敗時,large 根本沒機會被清掉,留下比預期更多的孤兒
// 物件。改成不論原圖/中途哪個 variant 失敗,都繼續嘗試刪除其餘物件,
// 把每個刪除動作各自的錯誤收集起來,迴圈跑完後用 errors.Join 合併成
// 單一錯誤回傳——呼叫端(handleBlogPhotoDelete)原本就只把這支函式的
// 錯誤拿去記 log、不影響 API 回應本身(DB 記錄已經刪除,使用者體感上
// 操作已成功,GCS 清理失敗只留下孤兒檔案,比死連結更安全,見該 handler
// 的完整說明),延用同樣的降級模式最合理:這裡回傳的錯誤只是让 log
// 內容完整反映「這次總共有哪些物件沒清乾淨」,不需要改變呼叫端既有的
// 錯誤處理方式。errors.Join 回傳 nil 若沒有任何錯誤(所有物件都刪除
// 成功或本來就不存在),行為對齊原本「全部成功才回 nil」的既有語意。
func (u *SignedUploader) DeletePhoto(ctx context.Context, ownerID, photoID, originalURL string, variantKinds []string) error {
	if u.bucket == "" {
		return nil
	}
	var errs []error
	if originalURL != "" {
		objectName, err := u.objectNameFromPublicURL(originalURL)
		if err == nil {
			if derr := u.deleteObjectIdempotent(ctx, objectName); derr != nil {
				errs = append(errs, derr)
			}
		}
		// originalURL 反解失敗(格式不符預期)不中斷整個刪除流程——
		// 理由同 photostorage.Delete 對「不屬於這個 bucket 的網址」的
		// 既有處理方式:視為沒有對應物件需要清,仍繼續刪除 variants。
	}
	for _, kind := range variantKinds {
		objectName := variantObjectName(ownerID, photoID, kind)
		if err := u.deleteObjectIdempotent(ctx, objectName); err != nil {
			errs = append(errs, err)
			// 刻意不 return——這裡要確保迴圈跑完全部 variant,其中一個
			// 刪除失敗不該讓排在後面的 variant 完全沒有被嘗試刪除(見
			// 本函式開頭的完整說明)。
		}
	}
	return errors.Join(errs...)
}

// deleteObjectIdempotent 是 DeletePhoto 共用的單一物件刪除邏輯——物件
// 不存在(storage.ErrObjectNotExist)視為成功,理由同 DeletePhoto 的
// 完整說明。
func (u *SignedUploader) deleteObjectIdempotent(ctx context.Context, objectName string) error {
	if err := u.store.deleteObject(ctx, objectName); err != nil {
		if errors.Is(err, storage.ErrObjectNotExist) {
			return nil
		}
		return fmt.Errorf("刪除 GCS 物件 %s 失敗: %w", objectName, err)
	}
	return nil
}

// objectNameFromPublicURL 把 publicURL(u.store.publicURL 回傳格式)反解
//回物件路徑——DownloadOriginal/DeletePhoto 都需要「給定一個先前簽發/
// 產生過的公開網址,反查出對應的 GCS 物件路徑」。
func (u *SignedUploader) objectNameFromPublicURL(publicURL string) (string, error) {
	prefix := u.store.publicURL("")
	if !strings.HasPrefix(publicURL, prefix) {
		return "", fmt.Errorf("photoupload: %q 不是這個 bucket 底下的物件網址", publicURL)
	}
	return strings.TrimPrefix(publicURL, prefix), nil
}
