package geo

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// details_cache.go——地點詳情(Place Details,places.get)的快取與並發去重
// (2026-10)。
//
// # 為什麼在 geo 層
//
// 原本「先讀快取再決定要不要打 Google」寫在 api 層的 handleGeoPlaceDetails,
// 其他 handler 各自決定要不要讀。AI 版 handlePublicGeoPlaceDetailsAny 重用
// fetchAndCachePlaceDetails 時只拿了「未命中」那一半,於是每個請求都打一次
// places.get(帳單上 GetPlace 與請求數 1:1,用 mock 與實機都重現過)。把讀
// 快取下沉到 Client,並提供行程內預設快取(SetDefaultDetailsCache)讓
// geo.New() 自動帶上,任何呼叫者都不可能跳過。照片的 PhotoCache 是同一個模式。
//
// # 快取什麼、不快取什麼
//
// 只快取文字欄位(名稱/地址/座標/評分/簡介)。照片參照(PhotoRefs)是有時效
// 的 resource name,不能長期保存,所以不快取:命中時 PhotoRefs 為 nil,需要
// 參照的呼叫端(背景補圖)走 GetPlaceDetailsFresh。找不到(ErrNotFound)與
// 失敗都不寫快取。
//
// # 並發去重
//
// 同一個 placeID 同時有多個未命中請求時只打一次 Google,其餘等待共用結果
// (前端對同一地點請求兩次、多個使用者同時點同一處,都是真實發生過的情境)。
// 設計重點(都是獨立審查指出、用測試重現過的問題):
//
//   - 領頭者在獨立的 goroutine 執行,內含 recover 與 defer 清理:領頭者 panic
//     (gateway 或解析出錯)會轉成錯誤回傳,而且一定會刪登錄、關 channel——
//     不然該 placeID 之後所有查詢都會等一個永遠不關的 channel,要重啟才恢復。
//   - 所有請求者(包含觸發這次呼叫的那個)都等結果並各自尊重自己的 context:
//     AI 版 5 秒、handler 10 秒的逾時不會被拉長到共用呼叫的 15 秒。共用呼叫本身
//     用 context.WithoutCancel 脫離任何一個請求者的取消訊號,所以領頭者逾時離開
//     不會害到其他人,結果仍會寫進快取。
//   - GetPlaceDetailsFresh 與一般查詢用不同的登記 key:Fresh 的契約是「一定打
//     Google、帶回照片參照」,不能加入一個可能「命中快取、沒有照片參照」的一般
//     查詢(補圖會因此把實際張數誤記成 0,之後永遠不補圖)。代價是兩者並發時
//     各打一次 Google,可接受(Fresh 本來就要打)。

// PlaceDetailsCache 是地點詳情文字快取的實作介面(見 api 層的
// NewPlaceDetailsCache,背後是 place_details_cache 表)。
type PlaceDetailsCache interface {
	// Get 回傳快取的文字資料與它的寫入時間。新鮮度由 geo 層用
	// DetailsCacheMaxAge 判斷,實作端只負責如實回報「什麼時候寫的」。
	Get(placeID string) (details PlaceDetails, fetchedAt time.Time, ok bool)
	// Set 寫入(或覆蓋)一筆文字資料。實作端不得寫入 PhotoRefs。
	Set(placeID string, details PlaceDetails)
}

const defaultDetailsCacheMaxAge = 24 * time.Hour

var (
	detailsCacheMaxAgeNs atomic.Int64 // 0 代表尚未設定,使用預設值
	defaultCacheMu       sync.RWMutex
	defaultCache         PlaceDetailsCache
)

// DetailsCacheMaxAge 回傳地點詳情快取的有效期(預設 24 小時,對齊地圖版
// 原本的文字新鮮度規則)。由 geo-setting 的 placeDetailsCacheHours 調整。
func DetailsCacheMaxAge() time.Duration {
	if ns := detailsCacheMaxAgeNs.Load(); ns > 0 {
		return time.Duration(ns)
	}
	return defaultDetailsCacheMaxAge
}

// SetDetailsCacheMaxAge 設定快取有效期。0 或負數一律忽略——0 會讓所有快取
// 立刻過期,等於把快取關掉卻看起來像有開。這是 process 層級的全域值(統一
// 快取要讓所有 geo.New() 建出來的 client 共用同一個有效期),同一個 process
// 內若有多個 Server 實例,後設定的會覆蓋先設定的。
func SetDetailsCacheMaxAge(d time.Duration) {
	if d <= 0 {
		return
	}
	detailsCacheMaxAgeNs.Store(int64(d))
}

// SetDefaultDetailsCache 設定整個 process 共用的預設快取,之後 geo.New() 建
// 出來的 client 都會自動帶上。cmd/server 啟動時呼叫一次。傳 nil 代表不預設
// 快取(測試用)。NewWithGateway 刻意不吃這個全域預設,避免測試之間靠全域
// 狀態互相影響,要快取請明確 SetDetailsCache。
func SetDefaultDetailsCache(c PlaceDetailsCache) {
	defaultCacheMu.Lock()
	defer defaultCacheMu.Unlock()
	defaultCache = c
}

func defaultDetailsCache() PlaceDetailsCache {
	defaultCacheMu.RLock()
	defer defaultCacheMu.RUnlock()
	return defaultCache
}

// SetDetailsCache 為這個 client 明確指定快取(覆寫預設)。
func (c *Client) SetDetailsCache(cache PlaceDetailsCache) {
	c.detailsCache = cache
}

// cachedDetails 讀快取並判斷是否仍在有效期內。命中時一律標示 FromCache、
// 清掉 PhotoRefs(快取不存照片參照)。
func (c *Client) cachedDetails(placeID string) (PlaceDetails, bool) {
	if c.detailsCache == nil {
		return PlaceDetails{}, false
	}
	d, at, ok := c.detailsCache.Get(placeID)
	if !ok || time.Since(at) > DetailsCacheMaxAge() {
		return PlaceDetails{}, false
	}
	d.FromCache = true
	d.PhotoRefs = nil
	return d, true
}

// GetPlaceDetails 查詢地點詳情:先讀快取,新鮮就直接回(FromCache=true,
// PhotoRefs 為 nil),否則打 Google 並寫回快取。沒掛快取的 client 每次都打。
func (c *Client) GetPlaceDetails(ctx context.Context, placeID string) (PlaceDetails, error) {
	if c.apiKey == "" {
		return PlaceDetails{}, ErrNoKey
	}
	if placeID == "" {
		return PlaceDetails{}, ErrNotFound
	}
	if d, ok := c.cachedDetails(placeID); ok {
		return d, nil
	}
	return c.fetchPlaceDetailsShared(ctx, placeID, true)
}

// GetPlaceDetailsFresh 一定打 Google(繞過讀取),帶回照片參照,結果仍寫回快取。
// 用在兩種情況:補圖需要最新的照片參照、文字資料已經過期要重抓。
func (c *Client) GetPlaceDetailsFresh(ctx context.Context, placeID string) (PlaceDetails, error) {
	if c.apiKey == "" {
		return PlaceDetails{}, ErrNoKey
	}
	if placeID == "" {
		return PlaceDetails{}, ErrNotFound
	}
	return c.fetchPlaceDetailsShared(ctx, placeID, false)
}

// ----- 並發去重(自己寫一個小的 singleflight,避免為了這一處把 golang.org/x/sync
// 從 indirect 升成直接依賴)-----

type detailsFlightCall struct {
	done chan struct{}
	val  PlaceDetails
	err  error
}

// 登記表是 process 全域的:key 只有 placeID(加上一般/Fresh 的區分),不分 client、
// gateway、apiKey——同一個地點的並發查詢本來就該共用,包含沒掛快取的 client。
var detailsFlight = struct {
	mu sync.Mutex
	m  map[string]*detailsFlightCall
}{m: map[string]*detailsFlightCall{}}

// detailsFlightTimeout 是共用那次 Google 呼叫的逾時;各請求者另外受自己的
// context 限制。
const detailsFlightTimeout = 15 * time.Second

// fetchPlaceDetailsShared:useCache 為 true(一般查詢)時,領頭者在真正打 Google
// 之前會再檢查一次快取——「查快取沒命中」與「登記成領頭者」之間有一段空窗,別的
// 請求可能剛好在這段時間完成並刪掉登記,不再檢查就會多打一次 Google(並發測試
// 實測:6 個並發請求打了 3 次)。Fresh(useCache=false)本來就要打,不檢查。
func (c *Client) fetchPlaceDetailsShared(ctx context.Context, placeID string, useCache bool) (PlaceDetails, error) {
	key := placeID
	if !useCache {
		key = placeID + "|fresh"
	}

	detailsFlight.mu.Lock()
	call, joined := detailsFlight.m[key]
	if !joined {
		call = &detailsFlightCall{done: make(chan struct{})}
		detailsFlight.m[key] = call
		// 脫離這個請求者的取消訊號(保留 value:caller/path 標籤),逾時由
		// detailsFlightTimeout 統一負責。
		flightCtx := context.WithoutCancel(ctx)
		go c.runDetailsFlight(flightCtx, key, placeID, useCache, call)
	}
	detailsFlight.mu.Unlock()

	// 觸發者與跟隨者都一樣:等結果,但各自尊重自己的 context。
	select {
	case <-call.done:
		return call.val, call.err
	case <-ctx.Done():
		return PlaceDetails{}, ctx.Err()
	}
}

func (c *Client) runDetailsFlight(ctx context.Context, key, placeID string, useCache bool, call *detailsFlightCall) {
	// 清理必須在 defer 裡:任何路徑(包含 panic)都要刪登錄並關 channel,否則
	// 之後所有對這個 key 的查詢都會等一個永遠不會關閉的 channel。recover 把
	// panic 轉成錯誤——這是獨立的 goroutine,沒有人會替它 recover,不處理會讓
	// 整個 process 結束。
	defer func() {
		if r := recover(); r != nil {
			call.val = PlaceDetails{}
			call.err = fmt.Errorf("geo: place details panic: %v", r)
		}
		detailsFlight.mu.Lock()
		delete(detailsFlight.m, key)
		detailsFlight.mu.Unlock()
		close(call.done)
	}()

	if useCache {
		if d, ok := c.cachedDetails(placeID); ok {
			call.val = d
			return
		}
	}

	fctx, cancel := context.WithTimeout(ctx, detailsFlightTimeout)
	defer cancel()
	call.val, call.err = c.fetchPlaceDetails(fctx, placeID)
	if call.err == nil && c.detailsCache != nil {
		cached := call.val
		cached.PhotoRefs = nil // 照片參照有時效,不進快取
		cached.FromCache = false
		c.detailsCache.Set(placeID, cached)
	}
}
