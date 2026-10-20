package main

// http.go 走 /internal/ API 的實作，供連接遠端或本地 server 使用。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/tripsvc"
)

type httpClient struct {
	base string // e.g. http://localhost:8080
}

func newHTTPClient(base string) *httpClient {
	return &httpClient{base: base}
}

func (c *httpClient) do(method, path string, body any) (map[string]any, error) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, r)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// /internal/* 現在需要有效的 JWT(見 server internalAuth middleware),
	// 讀本機登入時存下的 token(見 token.go)。讀不到就代表還沒登入——
	// 明確失敗、給出清楚的下一步,不要靜默送出沒有驗證的請求(那樣只會換來一個
	// 難懂的 401,而且掩蓋了「其實只是還沒登入」這個真正原因)。
	token, err := loadToken(c.base)
	if err != nil {
		return nil, fmt.Errorf("尚未登入,請先針對 %s 執行 `tripace-cli login --web -api %s` 登入: %w", c.base, c.base, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("server error %d: %v", resp.StatusCode, result)
	}
	return result, nil
}

func (c *httpClient) listTrips() (any, error) {
	return c.do("GET", "/internal/trips", nil)
}

// tripEntries 列出某個行程的所有 entry。
func (c *httpClient) tripEntries(tripID string) (any, error) {
	return c.do("GET", "/internal/trips/"+tripID+"/entries", nil)
}

// createTrip 走 /v1/trips(不是 /internal/):建立行程天生就需要一個
// 「以誰的身分當 owner」,/internal/ 底下的其餘端點都刻意不涉及這個問題
// (直接對已存在的 tripID/entryID 操作),但 /v1/trips 本來就是設計成
// 用呼叫端的已驗證身分(userFor)當 owner,CLI 登入後拿到的就是這樣一把
// token,直接打這條路徑即可,不需要另外在 /internal/ 底下重造一份。
func (c *httpClient) createTrip(name string) (any, error) {
	return c.do("POST", "/v1/trips", map[string]any{"name": name})
}

func (c *httpClient) record(tripID, title, start, startTime, end, endTime, location string) (any, error) {
	return c.do("POST", "/internal/trips/"+tripID+"/entries", map[string]any{
		"title": title, "start": start, "startTime": startTime,
		"end": end, "endTime": endTime, "location": location,
	})
}

func (c *httpClient) updateEntry(in tripsvc.UpdateEntryInput) error {
	_, err := c.do("PATCH", "/internal/entries/"+in.ID, map[string]any{
		"title": in.Title, "start": in.Start, "end": in.End,
		"location": in.Location, "note": in.Note,
		"kind": in.Kind, "detail": in.Detail,
	})
	return err
}

// setEntryLatLng 供 geocode -entry 把查到的座標寫回 entry。刻意走 do()
// 而不是自己組 request:認證(Authorization: Bearer)只在 do() 裡設定一次,
// 這樣 /internal/* 的認證機制再改版時不會又有呼叫端被漏改。
func (c *httpClient) setEntryLatLng(entryID string, lat, lng float64) error {
	_, err := c.do("PATCH", "/internal/entries/"+entryID+"/latlng", map[string]any{
		"lat": lat, "lng": lng,
	})
	return err
}

func (c *httpClient) deleteEntry(entryID string) error {
	_, err := c.do("DELETE", "/internal/entries/"+entryID, nil)
	return err
}

func (c *httpClient) reset(tripID string) error {
	_, err := c.do("DELETE", "/internal/trips/"+tripID+"/entries", nil)
	return err
}

// attractionUpdatePhoto 對齊 POST /internal/maintenance/attractions/{id}/
// update-photo(見 server/internal/api/maintenance.go)。固定走 Google
// Places 查詢——2026-10 已移除 Pexels 來源這個選項。
//
// placeID:2026-10 新增,選填——明確指定這次要寫入 photo_assets 的
// place_id,不依賴這筆地標是否已經透過 attraction set-place-id 登記過
// place_id(見後端 handler 開頭「2026-10 再次修正」的完整說明:「補圖」
// 跟「補 place_id」是兩個獨立操作,使用者明確要求分離,不該互相要求
// 對方先完成)。留空時後端依序退回地標資料庫裡原本登記的 place_id、
// 或這次查詢意外命中的 place_id。
func (c *httpClient) attractionUpdatePhoto(id, query, placeID string) (any, error) {
	body := map[string]any{}
	if query != "" {
		body["query"] = query
	}
	if placeID != "" {
		body["placeId"] = placeID
	}
	return c.do("POST", "/internal/maintenance/attractions/"+id+"/update-photo", body)
}

// attractionAdd/attractionList/attractionCities/attractionDelete 對齊
// POST/GET/DELETE /internal/maintenance/attractions(見
// server/internal/api/maintenance.go)。CLI 不提供 -photo-url 旗標,
// 建檔不帶照片(見 handleMaintenanceAttractionAdd)。
func (c *httpClient) attractionAdd(in model.Attraction) (any, error) {
	return c.do("POST", "/internal/maintenance/attractions", in)
}

func (c *httpClient) attractionList(city string) (any, error) {
	return c.do("GET", "/internal/maintenance/attractions?city="+url.QueryEscape(city), nil)
}

func (c *httpClient) attractionCities() (any, error) {
	return c.do("GET", "/internal/maintenance/attractions/cities", nil)
}

// attractionQuery 對齊 GET /internal/maintenance/attractions/query(見
// server/internal/api/maintenance.go 的 handleMaintenanceAttractionQuery)
// ——通用的景點區域狀態查詢,status 挑選要查哪種狀態(目前只有
// "no-google-photo"),city 選填,空字串代表不篩選城市。
func (c *httpClient) attractionQuery(status, city string) (any, error) {
	q := url.Values{}
	q.Set("status", status)
	if city != "" {
		q.Set("city", city)
	}
	return c.do("GET", "/internal/maintenance/attractions/query?"+q.Encode(), nil)
}

func (c *httpClient) attractionDelete(id string) error {
	_, err := c.do("DELETE", "/internal/maintenance/attractions/"+id, nil)
	return err
}

// attractionUpdateCoords 對齊 PATCH /internal/maintenance/attractions/{id}/
// coords(見 server/internal/api/maintenance.go)——修正建檔時輸入錯誤的
// 座標,供 attraction-update 子命令使用。
func (c *httpClient) attractionUpdateCoords(id string, lat, lng float64) (any, error) {
	return c.do("PATCH", "/internal/maintenance/attractions/"+id+"/coords", map[string]any{"lat": lat, "lng": lng})
}

// attractionUpdateField 對齊 PATCH /internal/maintenance/attractions/
// {id}/field(見 server/internal/api/maintenance.go)——通用的單一字串
// 欄位更新,取代原本各自獨立的 attractionUpdateName/attractionUpdateSummary,
// 供 attraction-update -field -value 子命令使用。可更新的欄位由後端白
// 名單控制(見 store.attractionUpdatableFields),field 不在白名單時後端
// 回 400。
func (c *httpClient) attractionUpdateField(id, field, value string) (any, error) {
	return c.do("PATCH", "/internal/maintenance/attractions/"+id+"/field", map[string]any{"field": field, "value": value})
}

// attractionUpdatePlaceID 對齊 PATCH /internal/maintenance/attractions/
// {id}/place-id(見 server/internal/api/maintenance.go)——供既有已建檔的
// attraction 事後補上(或清空,placeID 傳空字串)對應的 Google place_id,
// 供 attraction-set-place-id 子命令使用。
func (c *httpClient) attractionUpdatePlaceID(id, placeID string) (any, error) {
	return c.do("PATCH", "/internal/maintenance/attractions/"+id+"/place-id", map[string]any{"placeId": placeID})
}

// attractionUpdateTheme 對齊 PATCH /internal/maintenance/attractions/
// {id}/theme(見 server/internal/api/maintenance.go)——事後補上(或改回)
// 一筆既有景點區域是否為「主題點」(散策羅盤用語,見
// model.Attraction.IsTheme 欄位註解),供 attraction-set-theme 子命令
// 使用。
func (c *httpClient) attractionUpdateTheme(id string, isTheme bool) (any, error) {
	return c.do("PATCH", "/internal/maintenance/attractions/"+id+"/theme", map[string]any{"isTheme": isTheme})
}

// contentPageCreate/List/Get/Update/Publish/Delete 對齊
// POST/GET/PUT/PATCH/DELETE /internal/maintenance/content-pages(見
// server/internal/api/content_page.go)。content 收 map[string]any(已經
// 解析過的 JSON 物件,不是字串)——跟 do() 把 request body 整個
// json.Marshal 一次送出的既有慣例一致,呼叫端(main.go 的
// cmdContentPage*)負責把 -content-file 讀到的 JSON 文字先
// json.Unmarshal 成 map,不在這裡做字串轉換。
//
// official 參數(2026-10 新增)對齊後端 content_page.go 的 ownerID 身份
// 切換設計:true 時讓後端用空字串當 ownerID(官方/城市介紹頁命名空間),
// false 時讓後端用登入者自己的 UserID(部落格發文)。有 request body 的
// 動詞(create/update/publish)把 official 放進 body(跟 content/
// updatedBy 等既有參數一起送出,理由見 content_page.go 開頭的完整
// 說明);沒有 body 的動詞(get/delete 是 GET/DELETE)改放進 query
// string 的 official=true 參數,由後端 handler 讀取(見
// handleMaintenanceContentPageGet/Delete)。list 不需要 official——
// ListContentPages 本來就是「列出全部,不分 ownerID」的既有語意,見
// 後端 handleMaintenanceContentPageList 的完整說明。
func (c *httpClient) contentPageCreate(slug string, content map[string]any, updatedBy string, official bool) (any, error) {
	return c.do("POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": slug, "content": content, "updatedBy": updatedBy, "official": official,
	})
}

func (c *httpClient) contentPageList() (any, error) {
	return c.do("GET", "/internal/maintenance/content-pages", nil)
}

func (c *httpClient) contentPageGet(slug string, official bool) (any, error) {
	path := "/internal/maintenance/content-pages/" + url.PathEscape(slug)
	if official {
		path += "?official=true"
	}
	return c.do("GET", path, nil)
}

func (c *httpClient) contentPageUpdate(slug string, content map[string]any, updatedBy string, official bool) (any, error) {
	return c.do("PUT", "/internal/maintenance/content-pages/"+url.PathEscape(slug), map[string]any{
		"content": content, "updatedBy": updatedBy, "official": official,
	})
}

func (c *httpClient) contentPagePublish(slug string, published, official bool) (any, error) {
	return c.do("PATCH", "/internal/maintenance/content-pages/"+url.PathEscape(slug)+"/publish", map[string]any{
		"published": published, "official": official,
	})
}

func (c *httpClient) contentPageDelete(slug string, official bool) error {
	path := "/internal/maintenance/content-pages/" + url.PathEscape(slug)
	if official {
		path += "?official=true"
	}
	_, err := c.do("DELETE", path, nil)
	return err
}

// itineraryPageCreate/List/Get/Update/Publish/Delete 對齊
// /internal/maintenance/itinerary-pages* 系列端點(見
// server/internal/api/itinerary_page.go)——寫法比照上方 contentPage*
// 系列,差異只在沒有 official 參數(範例行程固定寫入官方命名空間,見
// itinerary-page 資源註冊處的完整說明),不需要在 body/query string
// 帶這個欄位。
func (c *httpClient) itineraryPageCreate(slug string, content map[string]any, updatedBy string) (any, error) {
	return c.do("POST", "/internal/maintenance/itinerary-pages", map[string]any{
		"slug": slug, "content": content, "updatedBy": updatedBy,
	})
}

func (c *httpClient) itineraryPageList() (any, error) {
	return c.do("GET", "/internal/maintenance/itinerary-pages", nil)
}

func (c *httpClient) itineraryPageGet(slug string) (any, error) {
	return c.do("GET", "/internal/maintenance/itinerary-pages/"+url.PathEscape(slug), nil)
}

func (c *httpClient) itineraryPageUpdate(slug string, content map[string]any, updatedBy string) (any, error) {
	return c.do("PUT", "/internal/maintenance/itinerary-pages/"+url.PathEscape(slug), map[string]any{
		"content": content, "updatedBy": updatedBy,
	})
}

func (c *httpClient) itineraryPagePublish(slug string, published bool) (any, error) {
	return c.do("PATCH", "/internal/maintenance/itinerary-pages/"+url.PathEscape(slug)+"/publish", map[string]any{
		"published": published,
	})
}

func (c *httpClient) itineraryPageDelete(slug string) error {
	_, err := c.do("DELETE", "/internal/maintenance/itinerary-pages/"+url.PathEscape(slug), nil)
	return err
}

// blogProfileSet/blogProfileGet 對齊 POST/GET /v1/blog/profile(見
// server/internal/api/blog_profile.go)——身份完全來自呼叫端的 JWT
// (s.userFor(r)),不需要像 content-page 系列那樣額外帶 ownerID/official
// 參數,CLI 這裡單純把使用者輸入原樣轉發即可。avatarUrl 即使是空字串
// 也照常帶進 body——後端收到空字串視為「不設定頭像」,不是「保留原值
// 不動」(整份覆寫語意,對齊 content-page set 的「整份覆寫」既有慣例,
// 見 handleBlogProfileSet 的完整說明)。
func (c *httpClient) blogProfileSet(handle, avatarURL string) (any, error) {
	return c.do("POST", "/v1/blog/profile", map[string]any{
		"handle": handle, "avatarUrl": avatarURL,
	})
}

func (c *httpClient) blogProfileGet() (any, error) {
	return c.do("GET", "/v1/blog/profile", nil)
}

// blogPhotoUploadURL/Complete/Retry/List/Focal/Delete 對齊
// POST/GET/PATCH/DELETE /v1/blog/photos(見
// server/internal/api/blog_photo.go)。這組指令刻意不走
// /internal/maintenance/*——跟 content-page 系列不同,圖片上傳本來就是
// 一般登入使用者在網頁上編輯文章時會呼叫的功能,身份固定是「登入者
// 自己」,不支援、也不需要 content-page 系列的 -official 身份切換。
// note 是選填的上傳當下備註(見 server/internal/api/blog_photo.go
// handleBlogPhotoUploadURL 的完整說明),空字串代表不設定。
func (c *httpClient) blogPhotoUploadURL(contentType, note string) (any, error) {
	return c.do("POST", "/v1/blog/photos/upload-url", map[string]any{
		"contentType": contentType,
		"note":        note,
	})
}

// sync(2026-10 新增,見 server/internal/api/blog_photo.go
// handleBlogPhotoTriggerProcessing 的完整說明)——true 時帶
// ?sync=true,讓 server 端同步(在這次 HTTP 請求處理期間)完成圖片
// 處理再回應,不是丟進背景 goroutine 立即回應 "processing"。根因是
// Cloud Run 只在處理 HTTP 請求期間分配 CPU,背景處理容易因為 CPU
// 被收回而卡住/逾時——CLI 的 -sync 旗標(見 main.go
// cmdBlogPhotoUpload/cmdBlogPhotoRetry 的完整說明)讓呼叫端可以選擇
// 多等一次 round trip,換取處理期間確實有 CPU 可用、也能直接從 HTTP
// 狀態碼知道這次處理是否成功,不需要再額外呼叫 list/get 確認。
func (c *httpClient) blogPhotoComplete(photoID string, sync bool) (any, error) {
	path := "/v1/blog/photos/" + url.PathEscape(photoID) + "/complete"
	if sync {
		path += "?sync=true"
	}
	return c.do("POST", path, nil)
}

func (c *httpClient) blogPhotoRetry(photoID string, sync bool) (any, error) {
	path := "/v1/blog/photos/" + url.PathEscape(photoID) + "/retry"
	if sync {
		path += "?sync=true"
	}
	return c.do("POST", path, nil)
}

func (c *httpClient) blogPhotoList() (any, error) {
	return c.do("GET", "/v1/blog/photos", nil)
}

func (c *httpClient) blogPhotoFocal(photoID string, focalX, focalY float64) (any, error) {
	return c.do("PATCH", "/v1/blog/photos/"+url.PathEscape(photoID)+"/focal", map[string]any{
		"focalX": focalX, "focalY": focalY,
	})
}

func (c *httpClient) blogPhotoNote(photoID, note string) (any, error) {
	return c.do("PATCH", "/v1/blog/photos/"+url.PathEscape(photoID)+"/note", map[string]any{
		"note": note,
	})
}

// rating 用 *int——nil 代表清空既有評分(對應 JSON {"rating":null}),
// 理由同後端 handleBlogPhotoRating 的完整說明。
func (c *httpClient) blogPhotoRating(photoID string, rating *int) (any, error) {
	return c.do("PATCH", "/v1/blog/photos/"+url.PathEscape(photoID)+"/rating", map[string]any{
		"rating": rating,
	})
}

func (c *httpClient) blogPhotoDelete(photoID string) error {
	_, err := c.do("DELETE", "/v1/blog/photos/"+url.PathEscape(photoID), nil)
	return err
}

// blogPhotoPutFile 把本機檔案直接 PUT 到 pre-signed URL(uploadUrl)——
// 不是走 c.do(),理由:pre-signed URL 本身已經在簽章裡編碼了授權資訊
// (GCS IAM Credentials API SignBlob),不需要、也不應該額外帶我方的
// Authorization: Bearer JWT header(GCS 看不懂、也不需要這個 header);
// c.do() 強制加 JWT header 的設計是給打我方 /internal/、/v1 API 用的,
// 這裡上傳目的地是 GCS,是完全不同的對象。Content-Type 必須與
// blogPhotoUploadURL 簽發時傳入的 contentType 一致,否則 GCS 會拒絕
// (pre-signed URL 的簽章通常綁定了 Content-Type)。
func blogPhotoPutFile(uploadURL, contentType, filePath string) error {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("讀取檔案失敗: %w", err)
	}
	req, err := http.NewRequest(http.MethodPut, uploadURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("上傳失敗,GCS 回應 %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// rateLimitList 對齊 GET /internal/maintenance/rate-limits(見
// server/internal/api/maintenance.go 的 handleMaintenanceRateLimitList)
// ——列出全部可設定的限流規則:登錄表的靜態定義配上資料庫現值。
func (c *httpClient) rateLimitList() (any, error) {
	return c.do("GET", "/internal/maintenance/rate-limits", nil)
}

// rateLimitSet 對齊 PATCH /internal/maintenance/rate-limits/{endpoint}
// ——只送出有指定的欄位(nil 代表不改,維持目前值),理由同該 handler
// 的完整說明:沒帶的欄位不該被零值覆寫成「不限制」。
func (c *httpClient) rateLimitSet(endpoint string, windowSec, windowMs, maxCalls, dailyMax *int) (any, error) {
	body := map[string]any{}
	if windowSec != nil {
		body["windowSec"] = *windowSec
	}
	if windowMs != nil {
		body["windowMs"] = *windowMs
	}
	if maxCalls != nil {
		body["maxCalls"] = *maxCalls
	}
	if dailyMax != nil {
		body["dailyMax"] = *dailyMax
	}
	return c.do("PATCH", "/internal/maintenance/rate-limits/"+url.PathEscape(endpoint), body)
}

// fieldMaskList 對齊 GET /internal/maintenance/field-masks(見
// server/internal/api/maintenance.go 的 handleMaintenanceFieldMaskList)。
func (c *httpClient) fieldMaskList() (any, error) {
	return c.do("GET", "/internal/maintenance/field-masks", nil)
}

// fieldMaskSet 對齊 PATCH /internal/maintenance/field-masks/{key}——
// fields 是不含前綴的欄位名稱清單,前綴由後端依情境自己加上(見
// fieldmasks.Scenario.Mask 的完整說明)。
func (c *httpClient) fieldMaskSet(key string, fields []string) (any, error) {
	return c.do("PATCH", "/internal/maintenance/field-masks/"+url.PathEscape(key),
		map[string]any{"fields": fields})
}
