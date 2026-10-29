// blog_photo.go——使用者上傳部落格配圖的完整流程(見
// handbook 構想頁 /ideas/product-direction-5-publishing-tool(原產品方向腦力激盪文件)「發文工具
// 產品線」、store.uploadedPhotoRow/photoVariantRow 的完整說明):
//
//  1. POST /v1/blog/photos/upload-url——簽發 pre-signed PUT URL,讓
//     使用者瀏覽器端直接把原圖上傳到 GCS,不經過我方 server 轉傳一次
//     完整的圖片位元組。
//  2. POST /v1/blog/photos/{photoId}/complete——使用者端確認上傳完成,
//     觸發背景處理:下載原圖、解析、產生 thumbnail/large 兩種衍生版本、
//     寫回 photo_variants,更新 Status 為 ready(失敗則 failed)。
//  3. POST /v1/blog/photos/{photoId}/retry——針對處理失敗(Status ==
//     "failed")的記錄,重新觸發跟 complete 相同的背景處理邏輯。
//  4. GET /v1/blog/photos——列出目前登入者自己上傳過的所有圖片,回應
//     前先做「惰性清理」(見 store.MarkStalePendingPhotosAsFailed)。
//  5. DELETE /v1/blog/photos/{photoId}——刪除一張圖(GCS 物件 + 資料庫
//     記錄)。
//  6. PATCH /v1/blog/photos/{photoId}/focal——設定裁切焦點。
//
// 全部掛在 /v1/*(見 api.go 路由註冊),不是 /internal/*——這是一般
// 登入使用者在網頁上編輯文章時會直接呼叫的功能,不是只給 CLI 用的
// 維運端點(對照 content_page.go 開頭「/internal/maintenance/content-pages/*
// 給 CLI、/v1/content-pages/{slug} 給一般使用者」的既有命名空間切分
// 慣例)。
//
// 這個功能不開放訪客(guestUser)使用——比照 plan_ai_chat.go 的
// isGuestUser 既有模式:雖然 /v1/* 本來就是「有 Authorization header
// 就認得出真實使用者、沒有則回退訪客」的命名空間,不像 /internal/*
// 有 internalAuth 中介層強制擋掉未帶合法 JWT 的請求,這裡每一支需要
// 身分的 handler 都要自行明確檢查 isGuestUser,不能假設呼叫端一定有
// 登入。
package api

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photoupload"
	"github.com/tim72117/tripace/internal/store"
)

// photoProcessingTimeout 是背景處理單張圖片(下載原圖+resize+上傳兩種
// 衍生版本)的逾時上限——用 context.Background() 搭配獨立逾時(對齊
// backgroundFillPlacePhoto 的既有模式,見 geo_outline.go 的完整說明:
// 背景任務不綁定原始 HTTP 請求的生命週期,但仍需要一個合理上限避免
// 單一卡住的外部呼叫讓這個 goroutine 無限期佔用資源)。30 秒是「下載
// 一張使用者上傳的圖片+兩次 resize+兩次上傳」預期遠低於這個時間的
// 保守值,沒有實際使用量數據佐證,日後可依實務回報的處理時間調整。
const photoProcessingTimeout = 30 * time.Second

// handleBlogPhotoUploadURL 處理 POST /v1/blog/photos/upload-url——
// 建立一筆 pending 狀態的原圖記錄,同時簽出讓使用者瀏覽器端可以直接
// PUT 上傳原圖的 pre-signed URL。
//
// 選填的 note 欄位(見 model.UploadedPhoto.Note 的完整說明)讓呼叫端
// 可以在上傳當下順手標記這張圖實際拍的是什麼——不需要事後再呼叫一次
// PATCH .../note(見 handleBlogPhotoNote),對批次上傳一次大量照片的
// 情境(例如 cmdBlogPhotoUpload 搭配 -skip-process 逐張上傳)特別有
// 幫助:上傳當下通常還記得每張圖是什麼,事後只剩隨機檔名反而認不出來。
func (s *Server) handleBlogPhotoUploadURL(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入才能上傳圖片")
		return
	}

	var body struct {
		ContentType string `json:"contentType"`
		Note        string `json:"note"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ContentType == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "contentType 為必填")
		return
	}

	signed, err := s.blogPhotoUploader.SignUploadURL(user.ID, body.ContentType)
	if err != nil {
		if errors.Is(err, photoupload.ErrNoBucket) {
			// 比照 photostorage.ErrNoBucket 的既有降級慣例——這是「功能
			// 未啟用」而非伺服器內部錯誤,但這支端點的核心產出就是
			// pre-signed URL 本身,沒有東西可以降級提供,只能明確告知
			// 呼叫端這個功能目前未啟用(不像景點照片落地那樣,就算
			// 落地失敗仍有「保留原始外部連結」這個可用的退路)。
			writeErr(w, http.StatusServiceUnavailable, "upload_disabled", "圖片上傳功能目前未啟用")
			return
		}
		writeErr(w, http.StatusInternalServerError, "sign_failed", err.Error())
		return
	}

	photo, err := s.store.CreateUploadedPhoto(user.ID, signed.PublicURL, body.Note)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"photoId":   photo.ID,
		"uploadUrl": signed.UploadURL,
		"publicUrl": signed.PublicURL,
	})
}

// handleBlogPhotoComplete 處理 POST /v1/blog/photos/{photoId}/complete
// ——使用者端確認原圖已經上傳完成,觸發處理(下載+resize+寫入
// variants+更新 Status)。預設立即回應,不等處理完成(對齊
// backgroundFillPlacePhoto 的既有「背景任務不阻塞 HTTP 回應」模式)——
// 除非帶 ?sync=true,見 handleBlogPhotoTriggerProcessing 的完整說明。
func (s *Server) handleBlogPhotoComplete(w http.ResponseWriter, r *http.Request) {
	s.handleBlogPhotoTriggerProcessing(w, r)
}

// handleBlogPhotoRetry 處理 POST /v1/blog/photos/{photoId}/retry——
// 跟 complete 共用同一套「驗證權限 + 觸發處理」邏輯(見任務規格:
// 這兩支端點背後的處理邏輯應該共用同一個函式,不要重複寫兩次)。
// 刻意不額外檢查「目前 Status 是否真的是 failed」才允許重試——重新
// 處理一張已經是 ready 狀態的圖片雖然多餘,但不是危險操作(resize
// 邏輯本身是幂等的,重新產生一樣內容的 variant 只是覆寫掉舊的 GCS
// 物件/資料庫記錄為同樣的結果),讓呼叫端(前端)不需要在觸發重試前
// 自行判斷目前狀態是否允許,降低介面複雜度。
func (s *Server) handleBlogPhotoRetry(w http.ResponseWriter, r *http.Request) {
	s.handleBlogPhotoTriggerProcessing(w, r)
}

// handleBlogPhotoTriggerProcessing 是 complete/retry 兩支端點共用的
// handler 本體——驗證 photoId 屬於目前登入者,觸發處理。
//
// ?sync=true(2026-10 新增,CLI tripace-cli blog-photo upload/retry 的
// -sync 旗標會帶這個查詢參數,見 cmd/cli/main.go 對應指令的完整
// 說明)——使用者明確要求的根因:Cloud Run 預設只在處理 HTTP 請求
// 期間才分配 CPU(見 runPhotoProcessingInBackground 的完整說明),但
// 原本這裡固定用 go func() 把圖片處理丟進背景 goroutine、立即回應
// "processing",使得實際耗費 CPU 的解碼/縮放工作發生在 HTTP 回應
// 已經送出、Cloud Run 可能已經收回 CPU 分配之後,導致處理卡住或
// 逾時失敗——這正是先前 PhotoManagerPage.tsx 多檔上傳需要刻意序列化
// (見該檔案 handleFileSelected 的完整說明)、CLI 需要
// -skip-process/逐張上傳這些折衷做法的根本原因,而非真正解法。
// sync=true 時改成在這支 handler 內同步呼叫 processUploadedPhoto(不
// 經過 goroutine),讓實際運算發生在「正在處理這個 HTTP 請求」的
// 期間,Cloud Run 保證這段時間有 CPU 可用——代價是呼叫端要多等一次
// round trip 的處理時間(CLI 逐張上傳模式下本來就是序列執行,這個
// 代價可以接受;前端網頁上傳介面目前仍用非同步模式,不受這個新增
// 選項影響,因為前端呼叫 complete 時不會帶這個查詢參數)。
//
// 處理失敗時(sync 模式)回傳 500 並在 body 附上實際錯誤訊息,而不是
// 比照背景模式只寫入 DB 的 failed 狀態、HTTP 層面仍回 200——呼叫端
// 既然選擇同步等待,就該透過 HTTP 狀態碼立即知道這次處理是否成功,
// 不需要再額外呼叫一次 list/get 才能確認。
func (s *Server) handleBlogPhotoTriggerProcessing(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	photoID := r.PathValue("photoId")
	photo, ok := s.loadOwnedUploadedPhoto(w, r, photoID, user.ID)
	if !ok {
		return
	}

	// 後端縮圖關閉(預設,見 Server.blogPhotoServerResize):縮圖由前端產生並先上傳,
	// 這裡只確認 thumbnail 與 large 都在了就標成 ready,不下載原圖、不 resize。
	// llm 縮圖是選填(給 LLM 推論用,缺了不影響顯示)。
	if !s.blogPhotoServerResize {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/retry") {
			writeErr(w, http.StatusConflict, "server_resize_disabled", "後端縮圖目前關閉,請重新上傳圖片")
			return
		}
		have := map[string]bool{}
		for _, v := range photo.Variants {
			have[v.Kind] = true
		}
		if !have[photoupload.VariantThumbnail] || !have[photoupload.VariantLarge] {
			writeErr(w, http.StatusConflict, "variants_missing", "請先上傳 thumbnail 與 large 縮圖")
			return
		}
		if err := s.store.SetUploadedPhotoStatus(photo.ID, "ready"); err != nil {
			writeErr(w, http.StatusInternalServerError, "status_update_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
		return
	}

	if r.URL.Query().Get("sync") == "true" {
		ctx, cancel := context.WithTimeout(r.Context(), photoProcessingTimeout)
		defer cancel()
		if err := s.processUploadedPhoto(ctx, photo); err != nil {
			log.Printf("handleBlogPhotoTriggerProcessing: 同步處理失敗 photoId=%s: %v", photo.ID, err)
			if serr := s.store.SetUploadedPhotoStatus(photo.ID, "failed"); serr != nil {
				log.Printf("handleBlogPhotoTriggerProcessing: 寫入 failed 狀態失敗 photoId=%s: %v", photo.ID, serr)
			}
			writeErr(w, http.StatusInternalServerError, "process_failed", err.Error())
			return
		}
		if err := s.store.SetUploadedPhotoStatus(photo.ID, "ready"); err != nil {
			writeErr(w, http.StatusInternalServerError, "status_update_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
		return
	}

	s.runPhotoProcessingInBackground(photo)

	writeJSON(w, http.StatusOK, map[string]string{"status": "processing"})
}

// loadOwnedUploadedPhoto 讀取一筆 uploaded_photo、檢查其 OwnerID 是否等於
// 目前登入者——handleBlogPhotoTriggerProcessing(complete/retry 共用)、
// handleBlogPhotoDelete、handleBlogPhotoFocal 三支 handler 原本各自重複
//寫了同一段邏輯,抽成這支共用 helper。
//
// 讀取失敗或 OwnerID 不符時,這個 helper 自己呼叫 writeErr 寫入 404
// 回應並回傳 false——比照這個專案 requireOwner/requireEditor/requireMember
// (見 api.go)的既有慣例:「檢查失敗寫入錯誤回應、回傳 bool 讓呼叫端用
// if 判斷要不要 return」,呼叫端不需要重複處理各種錯誤分支,寫法對齊
// 既有模式。
//
// OwnerID 不符時刻意回 404 而非 403(理由同原本三支 handler 重複寫的
// 註解):不透露「這個 ID 其實存在,只是不屬於你」這件事,降級成跟
// 「真的不存在」一樣的回應,減少可被用來列舉他人 photoId 是否存在的
// 側錄管道。
func (s *Server) loadOwnedUploadedPhoto(w http.ResponseWriter, r *http.Request, photoID, ownerID string) (model.UploadedPhoto, bool) {
	photo, err := s.store.GetUploadedPhoto(photoID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到這張圖片")
			return model.UploadedPhoto{}, false
		}
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return model.UploadedPhoto{}, false
	}
	if photo.OwnerID != ownerID {
		writeErr(w, http.StatusNotFound, "not_found", "找不到這張圖片")
		return model.UploadedPhoto{}, false
	}
	return photo, true
}

// runPhotoProcessingInBackground 背景下載原圖、解析、產生 thumbnail/
// large 兩種衍生版本、寫入 photo_variants、更新 Status——用
// go func() + context.Background()(比照 backgroundFillPlacePhoto 的
// 既有先例,見 geo_outline.go 的完整說明:背景任務不綁定原始 HTTP
// 請求的生命週期,使用者提早關閉頁面不該取消這次處理)。
//
// complete/retry 兩支端點共用這支函式——理由見兩者各自的說明。
func (s *Server) runPhotoProcessingInBackground(photo model.UploadedPhoto) {
	go func() {
		// defer+recover 包住整個函式本體(下載原圖、resize、上傳 variant、
		// 更新 DB 狀態每一步都在內),理由:這是一個完全脫離原始 HTTP
		// 請求生命週期的背景 goroutine,沒有任何上層 recover 機制保護——
		// processUploadedPhoto 內部呼叫的影像解碼/縮放邏輯(image.Decode、
		// scaleToFit 等)在面對非預期的異常輸入時有 panic 的可能(例如
		// 底層函式庫對損毀資料的防呆不足),一旦真的 panic 且沒有在這裡
		// recover,會直接讓整個 server process 崩潰,影響所有使用者,
		// 不只是這一筆圖片處理失敗而已。recover 到 panic 後,比照下方
		// processUploadedPhoto 失敗時的既有處理方式:記錄一則包含 photoId
		// 的 log 方便之後追查,並把這筆記錄標成 failed(不讓它卡在
		// pending/processing,使用者才看得到「處理失敗」並能按重試)。
		defer func() {
			if r := recover(); r != nil {
				log.Printf("runPhotoProcessingInBackground: 發生 panic photoId=%s: %v", photo.ID, r)
				if serr := s.store.SetUploadedPhotoStatus(photo.ID, "failed"); serr != nil {
					log.Printf("runPhotoProcessingInBackground: panic 後寫入 failed 狀態失敗 photoId=%s: %v", photo.ID, serr)
				}
			}
		}()

		ctx, cancel := context.WithTimeout(context.Background(), photoProcessingTimeout)
		defer cancel()

		if err := s.processUploadedPhoto(ctx, photo); err != nil {
			log.Printf("runPhotoProcessingInBackground: 處理失敗 photoId=%s: %v", photo.ID, err)
			if serr := s.store.SetUploadedPhotoStatus(photo.ID, "failed"); serr != nil {
				log.Printf("runPhotoProcessingInBackground: 寫入 failed 狀態失敗 photoId=%s: %v", photo.ID, serr)
			}
			return
		}
		if err := s.store.SetUploadedPhotoStatus(photo.ID, "ready"); err != nil {
			log.Printf("runPhotoProcessingInBackground: 寫入 ready 狀態失敗 photoId=%s: %v", photo.ID, err)
		}
	}()
}

// processUploadedPhoto 是實際的圖片處理邏輯本體——下載原圖位元組、
// 解析寬高、產生 thumbnail/large 兩種衍生版本並上傳、寫入
// photo_variants。拆成獨立函式(而非直接寫在 goroutine 裡)方便之後
// 需要時單獨測試這段邏輯本身(目前測試走 handler 端到端驗證,見
// blog_photo_test.go)。
//
// variant 已存在時(CreatePhotoVariant 回傳 ErrAlreadyExists,例如
// retry 端點重複觸發、或 complete 被意外呼叫兩次)視為該筆已完成,
// 不中斷整個流程——這裡的語意是「確保兩種 variant 都存在」,不是
// 「每次呼叫都必須是全新建立」。
func (s *Server) processUploadedPhoto(ctx context.Context, photo model.UploadedPhoto) error {
	raw, err := s.blogPhotoUploader.DownloadOriginal(ctx, photo.OriginalURL)
	if err != nil {
		return err
	}

	decoded, err := photoupload.DecodeImage(raw, "")
	if err != nil {
		return err
	}

	variants, err := photoupload.GenerateVariants(decoded)
	if err != nil {
		return err
	}

	for _, v := range variants {
		url, err := s.blogPhotoUploader.UploadVariant(ctx, photo.OwnerID, photo.ID, v.Kind, v.Data)
		if err != nil {
			return err
		}
		if _, err := s.store.CreatePhotoVariant(photo.ID, v.Kind, url, v.Width, v.Height); err != nil {
			if errors.Is(err, store.ErrAlreadyExists) {
				continue
			}
			return err
		}
	}
	return nil
}

// clientVariantMaxBytes——前端衍生圖請求內容的大小上限。thumbnail 約數十 KB、llm 約
// 100~300KB、large(最長邊 1600、品質 0.9)通常 300KB~1MB,4MB 留足餘裕又足以擋掉誤傳的原圖。
const clientVariantMaxBytes = 4 << 20

// handleBlogPhotoVariantUpload 處理 PUT /v1/blog/photos/{photoId}/variants/{kind}——
// 接收前端用 canvas 縮好的 JPEG(請求內容就是圖片位元組,Content-Type: image/jpeg),
// 存成這張圖的衍生版本。kind 只接受 thumbnail / large / llm(llm 是給 LLM 看圖推論用的
// 尺寸,見 photoupload.VariantLLM)。2026-10 起縮圖統一由前端產生,見 Server.blogPhotoServerResize。
//
// 不走 pre-signed URL:縮圖只有數十 KB~1MB,直接經過 server 比多一輪簽發/確認簡單,
// 也能在這裡解碼驗證它真的是 JPEG、寬高自己量(不信任前端回報的數字)。
// 只收 JPEG(檢查檔頭,避免把任意內容以 image/jpeg 寫進公開 bucket)。
// 同一張圖同一種 kind 已存在時回 200 status=exists,不覆寫資料庫記錄。
func (s *Server) handleBlogPhotoVariantUpload(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}
	kind := r.PathValue("kind")
	maxEdge, ok := photoupload.ClientVariantMaxEdge(kind)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid_input", "kind 必須是 thumbnail、large 或 llm")
		return
	}
	photo, ok := s.loadOwnedUploadedPhoto(w, r, r.PathValue("photoId"), user.ID)
	if !ok {
		return
	}

	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, clientVariantMaxBytes))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "too_large", "縮圖過大")
		return
	}
	if len(data) < 3 || data[0] != 0xFF || data[1] != 0xD8 || data[2] != 0xFF {
		writeErr(w, http.StatusBadRequest, "invalid_input", "縮圖必須是 JPEG")
		return
	}
	decoded, err := photoupload.DecodeImage(data, "image/jpeg")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "縮圖無法解析")
		return
	}
	if decoded.Width > maxEdge || decoded.Height > maxEdge {
		writeErr(w, http.StatusBadRequest, "invalid_input", "縮圖尺寸過大")
		return
	}

	url, err := s.blogPhotoUploader.UploadVariant(r.Context(), photo.OwnerID, photo.ID, kind, data)
	if err != nil {
		if errors.Is(err, photoupload.ErrNoBucket) {
			writeErr(w, http.StatusServiceUnavailable, "upload_disabled", "圖片上傳功能目前未啟用")
			return
		}
		writeErr(w, http.StatusInternalServerError, "upload_failed", err.Error())
		return
	}
	if _, err := s.store.CreatePhotoVariant(photo.ID, kind, url, decoded.Width, decoded.Height); err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "exists"})
			return
		}
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "created"})
}

// handleBlogPhotoList 處理 GET /v1/blog/photos——列出目前登入者自己
// 上傳過的所有圖片。回應前先呼叫 MarkStalePendingPhotosAsFailed 做
// 「惰性清理」(見該 store 方法的完整說明:沒有定時排程,改成每次查
// 列表前順便校正卡在過期 pending 狀態的記錄),確保使用者看到的狀態
// 不會是永遠卡住的「處理中」。
func (s *Server) handleBlogPhotoList(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	if _, err := s.store.MarkStalePendingPhotosAsFailed(user.ID); err != nil {
		// 清理失敗不該阻擋使用者查看列表——降級成「這次列表可能含有
		// 卡住的 pending 項目」,記一則警示 log,理由同其餘輔助性清理
		// 步驟失敗時的既有降級慣例。
		log.Printf("handleBlogPhotoList: MarkStalePendingPhotosAsFailed 失敗 ownerID=%s: %v", user.ID, err)
	}

	photos, err := s.store.ListUploadedPhotosByOwner(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos})
}

// handleBlogPhotoDelete 處理 DELETE /v1/blog/photos/{photoId}——驗證
// OwnerID 吻合後,先刪資料庫記錄、再清 GCS 物件(原圖+所有已知
// variants)。
//
// 這個順序(先 DB、後 GCS)刻意不同於原本「先 GCS、後 DB」的寫法——
// 兩種順序都無法同時保證「DB 和 GCS 永遠一致」(這本來就不是這裡在
// 用的單一事務系統能處理的範圍跨系統問題),差別在於「中途失敗時留下
// 的是哪一種不一致狀態」:
//
//   - 先 GCS 後 DB(舊寫法):GCS 刪除成功、DB 刪除失敗(例如暫時性
//     資料庫錯誤)→ 留下一筆指向已經不存在的檔案的孤兒 DB 記錄,沒有
//     任何清理機制,使用者在列表頁看到一筆連結已經失效的圖片。
//   - 先 DB 後 GCS(這裡採用的寫法):DB 刪除失敗 → GCS 物件還在,
//     使用者重新整理頁面還看得到這張圖——安全的失敗模式,沒有東西
//     遺失;DB 刪除成功、GCS 刪除失敗 → 使用者看不到這張圖了(DB 沒有
//     它的記錄),但 GCS 上留著一個沒人引用的孤兒檔案——這比「DB 記錄
//     指向不存在的檔案」更安全,孤兒檔案不會造成任何功能性問題(多佔
//     用一點儲存空間,之後可人工或排程清理),遠比「使用者點進一個
//     死連結」影響更小。
//
// 因此這裡先呼叫 DeleteUploadedPhoto,失敗就直接回應錯誤、完全不去動
// GCS;DB 刪除成功後才呼叫 DeletePhoto 清 GCS 物件,若 GCS 刪除失敗,
// 只記錄 log(包含 photoID 與已知的 variant 種類,方便之後人工/排程
// 清理孤兒檔案),不讓這個次要失敗影響 API 回應——DB 記錄已經刪除,
// 使用者體感上這個操作已經成功,不該因為背景清理的次要失敗讓使用者
// 以為刪除沒有生效。
func (s *Server) handleBlogPhotoDelete(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	photoID := r.PathValue("photoId")
	photo, ok := s.loadOwnedUploadedPhoto(w, r, photoID, user.ID)
	if !ok {
		return
	}

	if err := s.store.DeleteUploadedPhoto(photo.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到這張圖片")
			return
		}
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}

	variantKinds := make([]string, 0, len(photo.Variants))
	for _, v := range photo.Variants {
		variantKinds = append(variantKinds, v.Kind)
	}
	if err := s.blogPhotoUploader.DeletePhoto(r.Context(), photo.OwnerID, photo.ID, photo.OriginalURL, variantKinds); err != nil {
		// GCS 清理失敗不影響這次 API 回應——理由見本函式開頭完整說明:
		// DB 記錄已經刪除,使用者體感上操作已成功,這裡只留下孤兒檔案
		// (比死連結更安全的失敗模式),記錄 log 供之後人工/排程清理。
		log.Printf("handleBlogPhotoDelete: GCS 物件清理失敗 photoId=%s originalUrl=%s variantKinds=%v: %v", photo.ID, photo.OriginalURL, variantKinds, err)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleBlogPhotoFocal 處理 PATCH /v1/blog/photos/{photoId}/focal——
// 驗證 OwnerID 吻合後,更新裁切焦點(見 uploadedPhotoRow.FocalX/FocalY
// 的完整說明)。
func (s *Server) handleBlogPhotoFocal(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	photoID := r.PathValue("photoId")
	photo, ok := s.loadOwnedUploadedPhoto(w, r, photoID, user.ID)
	if !ok {
		return
	}

	var body struct {
		FocalX float64 `json:"focalX"`
		FocalY float64 `json:"focalY"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.FocalX < 0 || body.FocalX > 1 || body.FocalY < 0 || body.FocalY > 1 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "focalX/focalY 必須是 0~1 之間的相對座標")
		return
	}

	if err := s.store.SetUploadedPhotoFocal(photo.ID, body.FocalX, body.FocalY); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到這張圖片")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleBlogPhotoNote 處理 PATCH /v1/blog/photos/{photoId}/note——驗證
// OwnerID 吻合後,更新備註(見 model.UploadedPhoto.Note 的完整說明)。
// 跟 handleBlogPhotoFocal 同樣的「驗證擁有者→更新單一欄位」結構,但
// 不做值域檢查(自由文字,允許空字串清空既有備註)——這是給上傳當下
// 沒有順手標記、或想事後修改標注內容的情境用(見 cmdBlogPhotoNote)。
func (s *Server) handleBlogPhotoNote(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	photoID := r.PathValue("photoId")
	photo, ok := s.loadOwnedUploadedPhoto(w, r, photoID, user.ID)
	if !ok {
		return
	}

	var body struct {
		Note string `json:"note"`
	}
	if !decode(w, r, &body) {
		return
	}

	if err := s.store.SetUploadedPhotoNote(photo.ID, body.Note); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到這張圖片")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleBlogPhotoRating 處理 PATCH /v1/blog/photos/{photoId}/rating——
// 驗證 OwnerID 吻合後,更新品質評分(見 model.UploadedPhoto.Rating 的
// 完整說明)。body.Rating 用 *int(而非 int)接收——JSON 的 {"rating":null}
// 要能跟 {"rating":2} 區分開來,前者代表清空既有評分,後者代表設成 2 分,
// 如果用裸 int 接收,未帶欄位/帶 null/帶 0 三種輸入在解碼後會變得無法
// 區分(都是 Go 的零值 0),但 0 不是合法評分值,容易把「清空」誤判成
// 「使用者刻意輸入了不合法的 0」。non-nil 時檢查值域 1~3,nil 直接放行
// (代表清空,不需要值域檢查)。
func (s *Server) handleBlogPhotoRating(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	photoID := r.PathValue("photoId")
	photo, ok := s.loadOwnedUploadedPhoto(w, r, photoID, user.ID)
	if !ok {
		return
	}

	var body struct {
		Rating *int `json:"rating"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Rating != nil && (*body.Rating < 1 || *body.Rating > 3) {
		writeErr(w, http.StatusBadRequest, "invalid_input", "rating 必須是 1~3 之間的整數,或 null 代表清空評分")
		return
	}

	if err := s.store.SetUploadedPhotoRating(photo.ID, body.Rating); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到這張圖片")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// publicUploadedPhoto 是 handlePublicBlogPhotosByIDs 的回應形狀——刻意
// 不直接序列化 model.UploadedPhoto(那個形狀含 OwnerID,這支端點不驗證
// 任何身分、任何人帶 photoId 就能查,不該連帶洩漏這張圖屬於哪個使用者
// 帳號)。只保留前端把文章內容裡的 photoId 展開成實際可顯示圖片所需
// 的最小欄位集合:原圖網址、裁切焦點、衍生版本網址。
type publicUploadedPhoto struct {
	ID          string               `json:"id"`
	OriginalURL string               `json:"originalUrl"`
	FocalX      *float64             `json:"focalX,omitempty"`
	FocalY      *float64             `json:"focalY,omitempty"`
	Variants    []publicPhotoVariant `json:"variants,omitempty"`
}

// publicPhotoVariant 同 publicUploadedPhoto 的理由——只留前端選用對應
// 尺寸圖片需要的欄位,不含 PhotoID(呼叫端已經知道自己查的是哪個
// photoId,不需要在每個 variant 裡重複回傳同一個值)、CreatedAt(公開
// 展示用途不需要)。
type publicPhotoVariant struct {
	Kind   string `json:"kind"` // "thumbnail" | "large"
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

func toPublicUploadedPhoto(p model.UploadedPhoto) publicUploadedPhoto {
	variants := make([]publicPhotoVariant, 0, len(p.Variants))
	for _, v := range p.Variants {
		variants = append(variants, publicPhotoVariant{Kind: v.Kind, URL: v.URL, Width: v.Width, Height: v.Height})
	}
	return publicUploadedPhoto{
		ID:          p.ID,
		OriginalURL: p.OriginalURL,
		FocalX:      p.FocalX,
		FocalY:      p.FocalY,
		Variants:    variants,
	}
}

// handlePublicBlogPhotosByIDs 處理 GET /public/blog/photos?ids=a,b,c
// ——依一批 photoId 批次查出可公開顯示的圖片資訊,供前端把已發布文章
// 內容(ThemePageContent 的 ImageBlock.photoId/GalleryBlock.items[].photoId,
// 見 web/src/blog/types.ts)裡存的穩定識別碼,展開成實際可渲染的圖片
// 網址。
//
// 這支端點刻意獨立於 /v1/blog/photos 系列之外、掛在 /public/* 命名
// 空間、不檢查任何登入身分——文章一旦發布(handlePublicBlogArticle
// 只回傳 status=="published" 的內容)本來就是任何訪客都能看到裡面
// 引用的圖片,圖片網址本身不是機密;要求訪客端渲染文章前還得先登入
// 才能把 photoId 換成可顯示的網址,會讓公開文章讀取流程整個卡住。這跟
// /v1/blog/photos 系列端點(登入者管理自己上傳過的圖片庫,含草稿/
// 未發布圖片,必須驗證身分)服務的是完全不同的情境,不應該合併成同一支
// 端點用參數切換行為。
//
// 2026-10 code review 修正:雖然不檢查登入身分,但必須檢查查詢者是否
// 「有權看到這張圖」——原本的實作只要 photoId 存在於 uploaded_photos
// 表就無條件回傳,等於任何人只要知道一個 photoId(例如從某處洩漏、或
// 純粹猜測 "upf_" + hex 格式),就能拿到任何使用者草稿文章配圖的永久
// 有效 GCS 公開網址,等同可以枚舉任意使用者尚未公開、甚至永遠不會公開
// 的圖片。改成先用 FilterPhotoIDsReferencedByPublishedContent 篩掉
// 「目前沒有被任何已發布文章引用」的 ID,只對通過篩選的 ID 繼續查詢
// 圖片資訊——未發布/已刪除文章引用的圖片,或從未被任何文章引用過的
// 圖片,都視為查無此圖,跟 ID 本身不存在走同一條降級路徑(見下方)。
//
// 同時只回傳 Status=="ready" 的圖片——pending(背景處理尚未完成)或
// failed(處理失敗)的記錄雖然 OriginalURL 欄位本身有值,但這張圖片
// 還沒確認是「使用者真正想公開呈現的最終版本」,不應該讓訪客提前看到
// 處理中的中繼狀態。
//
// 查無對應記錄的 ID 直接略過——文章裡引用了一個已經被刪除的 photoId
// 時,該圖片在渲染結果裡就是不存在,前端據此呈現「圖片已移除」之類的
// 降級畫面,不是這支端點該處理的責任。
func (s *Server) handlePublicBlogPhotosByIDs(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("ids")
	if idsParam == "" {
		writeJSON(w, http.StatusOK, map[string]any{"photos": []publicUploadedPhoto{}})
		return
	}

	rawIDs := strings.Split(idsParam, ",")
	ids := make([]string, 0, len(rawIDs))
	seen := make(map[string]bool, len(rawIDs))
	for _, id := range rawIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}

	allowedIDs, err := s.store.FilterPhotoIDsReferencedByPublishedContent(ids)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	photos, err := s.store.ListUploadedPhotosByIDs(allowedIDs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	out := make([]publicUploadedPhoto, 0, len(photos))
	for _, p := range photos {
		if p.Status != "ready" {
			continue
		}
		out = append(out, toPublicUploadedPhoto(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": out})
}
