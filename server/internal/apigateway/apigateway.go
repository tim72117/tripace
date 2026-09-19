// Package apigateway 提供一個通用的、可設定併發數與請求間隔的 HTTP 請求
// 派送元件——「連線外部 API」這件事從各個呼叫端(目前是 geo.Client)抽出來
// 獨立成這個元件,理由:
//
//  1. 排隊/節流邏輯本身是通用的,不該跟「這是在打 Google Places API」這件事
//     綁死——之後若有其他外部 API 也需要同一套保護機制,可以直接重用這個
//     套件,不需要重新實作一次。
//  2. 可以 mock:所有依賴 Gateway 的呼叫端(geo.Client)測試時只需要注入一個
//     假的 Doer,不需要真的發 HTTP 請求、也不需要真的等待節流間隔。
//  3. 併發數與間隔必須是「整個 process 共用一份限制」,不能是「每次呼叫端
//     各自建立一份」——例如 server 每個 HTTP 請求進來都會呼叫
//     geo.New(apiKey) 建立新的 Client,若限流狀態附著在 Client 上,等於
//     每個 request 各自擁有一份獨立的節流器,多個並發的使用者請求之間完全
//     不會互相排隊,達不到「整個後端對 Google 的呼叫總量被夾住」的效果。
//     故 Gateway 是設計成長壽的單例,由呼叫端在啟動時建立一次、之後長期
//     共用同一個實例。
package apigateway

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

// ErrRateLimited 是 Gateway.Do 在 RateLimiter 拒絕這次呼叫時回傳的
// sentinel error——export 出去讓呼叫端能用 errors.Is(err,
// apigateway.ErrRateLimited) 判斷「這次失敗是因為被限流拒絕」,藉此
// 跟其他失敗原因(連線逾時、HTTP 錯誤狀態碼等)區分開來,才能決定要不要
// 走降級路徑(例如 server/internal/api/geo_outline.go 的
// handleGeoPlaceDetails 收到這個 error 時不當作一般錯誤處理,而是改讀
// 現有快取降級回應)。
var ErrRateLimited = errors.New("apigateway: rate limited")

// HTTPDoer 是底層實際發送 HTTP 請求的介面——標準函式庫的 *http.Client 已經
// 滿足這個介面(Do 方法簽章相同),測試時可以換成假實作,不需要真的連網路。
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// ErrDailyQuotaExceeded 是 Gateway.Do 在 DailyQuotaChecker 回報這次呼叫
// 已超過每日額度時回傳的 sentinel error——理由與用法對稱 ErrRateLimited
// (見該變數的完整說明),呼叫端一樣可用 errors.Is 判斷、走降級路徑。
// 獨立於 ErrRateLimited 是刻意的:兩者是不同層級的限制(視窗速率 vs.
// 每日總量),呼叫端事後從記錄/監控判讀「這次拒絕的原因」時,兩種
// sentinel error 讓這個區分不需要額外解析錯誤訊息字串。
var ErrDailyQuotaExceeded = errors.New("apigateway: daily quota exceeded")

// DailyQuotaChecker 是選填的每日額度檢查回呼——跟 RateLimiter(process
// 內記憶體、視窗式)是刻意分開的獨立機制:RateLimiter 解決的是「短時間
// 內呼叫太密集」,DailyQuotaChecker 解決的是「這一整天總共呼叫了幾次」
// 這種計費語意的總量上限,且必須跨多個 process/實例真正共用同一份
// 計數(見 store.IncrementGeoRateLimitDailyUsage 的完整說明:這是為什麼
// 這裡設計成介面注入、而不是像 RateLimiter 一樣直接內建成 Gateway 的
// 記憶體狀態——Gateway 本身不依賴任何資料庫套件,理由同 CallLogger 的
// 說明,由呼叫端(geo 套件)注入一個把計數存進資料庫的實作)。
type DailyQuotaChecker interface {
	// AllowDaily 在這次呼叫即將真正送出前呼叫一次,回傳 true 代表這次
	// 呼叫算進今天的額度且未超過上限、可以放行;false 代表已經超過今天
	// 的額度上限,這次呼叫應該被拒絕。err 不為 nil 時(例如底層資料庫
	// 呼叫失敗)視同「無法判斷」,呼叫端(Gateway.Do)採取的策略是放行
	// (fail open)而非拒絕(fail closed)——理由同 RateLimiter「查不到
	// 規則的 key 一律放行」的既有設計哲學:這是輔助性的成本控管機制,
	// 底層儲存暫時不可用不該連帶讓核心功能(查詢地點資訊)整個不可用,
	// 寧可在這種罕見情況下暫時失去每日額度保護,也不要讓資料庫的暫時性
	// 問題放大成使用者可見的功能中斷。
	AllowDaily(endpoint string) (allowed bool, err error)
}

// CallLogger 是每次請求完成後的記錄回呼——Gateway 本身不依賴任何資料庫套件
// (維持這個元件的獨立性,理由同套件說明的第 1 點),由呼叫端(api 層)注入
// 一個把記錄寫進資料庫的實作。nil 代表不記錄,Gateway 仍正常運作。
type CallLogger interface {
	// LogCall 在請求完成(不論成功或失敗)後呼叫一次。err 不為 nil 時
	// statusCode 為 0(連線失敗、逾時等,根本沒有收到 HTTP 回應)。path 是
	// 觸發這次外部呼叫的「我方」API 路徑(如 "/internal/geo/attractions/
	// nearby"),供事後查記錄時能對到「是使用者/CLI 打了我方哪一條路徑,
	// 才連帶觸發這次對 Google 的呼叫」——跟 caller(呼叫端在程式碼裡的
	// 識別字串,如 "handleGeoAttractionsNearby")是兩個獨立維度:caller
	// 指向程式碼位置,path 指向對外曝露的路由,兩者通常一一對應但不保證
	// (例如 LLM 工具呼叫沒有對應的單一 REST path,這時 path 傳空字串)。
	LogCall(endpoint, caller, path string, statusCode int, durationMs int64, err error)
}

// Config 是 Gateway 的節流設定。
type Config struct {
	// MaxConcurrency 是同時可以在飛行中(已送出、尚未收到回應)的最大請求
	// 數——超過這個數量的請求會排隊等待有空位才送出。至少為 1(<=0 時
	// New 會夾成 1,總不能設定成完全不能發送請求)。
	MaxConcurrency int
	// MinInterval 是連續兩次請求「送出」之間至少要間隔多久——這是全域的
	// 節流閥,跟 MaxConcurrency 是兩個獨立的限制條件,兩者都必須滿足才能
	// 送出下一個請求(見 Gateway.Do 的說明)。<=0 時 New 會夾成 0(不限制
	// 間隔,只受 MaxConcurrency 限制)。
	MinInterval time.Duration

	// RateLimiter 是選填的拒絕型限流器(見 RateLimiter 的完整說明)——
	// nil 時代表不啟用,Gateway 維持原本「排隊等待、最終一定送出」的
	// 行為,完全向後相容,現有呼叫端不受影響。非 nil 時,Gateway.Do 會
	// 在原本的排隊邏輯之前先呼叫 RateLimiter.Allow(endpoint),若被拒絕
	// 就直接回傳 ErrRateLimited,完全不進入排隊、不送出任何 HTTP 請求。
	RateLimiter *RateLimiter

	// DailyQuotaChecker 是選填的每日額度檢查器(見該介面的完整說明)——
	// nil 時代表不啟用每日額度限制。非 nil 時,Gateway.Do 在 RateLimiter
	// 檢查通過之後(見 Do 的說明:兩者都要通過才會真正送出,RateLimiter
	// 先判斷是因為它是純記憶體運算、成本更低,能更快拒絕明顯超速的呼叫,
	// 不需要每次都多打一次資料庫)呼叫 AllowDaily(endpoint),被拒絕就
	// 直接回傳 ErrDailyQuotaExceeded,同樣不進入排隊、不送出任何 HTTP
	// 請求。
	DailyQuotaChecker DailyQuotaChecker
}

// DefaultConfig 是使用者確認過的預設值:同時最多 1 個請求在飛行中、
// 連續請求至少間隔 2 秒(等於「每秒最多 0.5 次請求」)——這是相對保守的
// 節流設定,目的是避免任何單一功能(例如地圖被高頻拖曳觸發的附近搜尋)
// 短時間內對 Google API 發出大量請求,產生非預期的計費/額度消耗。
func DefaultConfig() Config {
	return Config{MaxConcurrency: 1, MinInterval: 2 * time.Second}
}

// Gateway 是排隊/節流之後才轉發給底層 Doer 的請求派送器。零值不可用,
// 必須透過 New 建立。
type Gateway struct {
	doer   HTTPDoer
	logger CallLogger

	sem      chan struct{} // 併發數限制:容量等於 MaxConcurrency 的信號量
	interval time.Duration

	mu       sync.Mutex // 保護 nextSlot,序列化「取得下一個可送出時間點」的判斷
	nextSlot time.Time

	// rateLimiter 見 Config.RateLimiter 的說明,nil 時不啟用。
	rateLimiter *RateLimiter
	// dailyQuotaChecker 見 Config.DailyQuotaChecker 的說明,nil 時不啟用。
	dailyQuotaChecker DailyQuotaChecker
}

// New 建立 Gateway。logger 可傳 nil(不記錄)。
func New(doer HTTPDoer, cfg Config, logger CallLogger) *Gateway {
	if cfg.MaxConcurrency <= 0 {
		cfg.MaxConcurrency = 1
	}
	if cfg.MinInterval < 0 {
		cfg.MinInterval = 0
	}
	return &Gateway{
		doer:              doer,
		logger:            logger,
		sem:               make(chan struct{}, cfg.MaxConcurrency),
		interval:          cfg.MinInterval,
		rateLimiter:       cfg.RateLimiter,
		dailyQuotaChecker: cfg.DailyQuotaChecker,
	}
}

// Do 派送一個請求,依序滿足兩個節流條件才會真正送出:
//
//  1. 併發數限制:目前飛行中的請求數 < MaxConcurrency 才能送出,否則排隊
//     等待有請求完成釋出名額。
//  2. 間隔限制:距離上一次「送出」至少經過 MinInterval,否則排隊等到時間到。
//
// 兩個限制各自維護獨立的等待佇列(Go channel 的信號量、mutex 保護的
// nextSlot 時間戳),呼叫順序不保證嚴格的先到先服務(FIFO)公平性——多個
// goroutine 同時卡在其中一個限制上時,實際被放行的順序由 Go runtime 的
// channel/mutex 排程決定,不是這個元件刻意打亂順序,只是沒有另外花成本
// 維護一個嚴格公平的佇列資料結構。對這裡要解決的問題(整體流量夾住上限)
// 而言,近似公平已經足夠,不需要嚴格保證。
//
// endpoint/caller/path 只用於記錄(見 CallLogger),不影響節流行為本身——
// 目前是「整個 Gateway 共用一份節流額度」,不是依 endpoint/caller/path
// 分開算,這是刻意的簡化:這次要解決的是「整個後端對 Google 的呼叫
// 總量」,不是「個別端點各自的獨立配額」。
func (g *Gateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	// RateLimiter 檢查必須在排隊邏輯(g.sem/waitForSlot)之前——這是
	// 拒絕型限流跟下面排隊型節流的根本差異:一旦進入排隊,這次呼叫就已經
	// 確定最終會被送出,只是延後,不會被拒絕。若被 RateLimiter 拒絕,
	// 直接回傳 ErrRateLimited,不佔用併發名額、不等待間隔、不送出任何
	// HTTP 請求,是同步立即回答,不阻塞呼叫端(見 RateLimiter.Allow 的
	// 說明)。
	if g.rateLimiter != nil && !g.rateLimiter.Allow(endpoint) {
		return nil, ErrRateLimited
	}
	// DailyQuotaChecker 檢查同樣在排隊邏輯之前、且刻意排在 RateLimiter
	// 之後(見 Config.DailyQuotaChecker 的完整說明)——AllowDaily 通常會
	// 打一次資料庫,讓 RateLimiter 先擋掉明顯超速的呼叫,能減少不必要的
	// 資料庫往返。
	if g.dailyQuotaChecker != nil {
		if allowed, err := g.dailyQuotaChecker.AllowDaily(endpoint); err == nil && !allowed {
			return nil, ErrDailyQuotaExceeded
		}
		// err != nil:fail open,見 DailyQuotaChecker.AllowDaily 的完整
		// 說明,不擋下這次呼叫。
	}

	select {
	case g.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-g.sem }()

	if err := g.waitForSlot(ctx); err != nil {
		return nil, err
	}

	start := time.Now()
	resp, err := g.doer.Do(req)
	duration := time.Since(start)

	if g.logger != nil {
		statusCode := 0
		if resp != nil {
			statusCode = resp.StatusCode
		}
		go g.logger.LogCall(endpoint, caller, path, statusCode, duration.Milliseconds(), err)
	}
	return resp, err
}

// waitForSlot 阻塞到「下一個允許送出請求的時間點」——用一個共用的
// nextSlot 時間戳實作全域節流:每次呼叫都把 nextSlot 往後推進
// interval,自己等到(推進前的)那個時間點才返回。interval 為 0 時
// 直接返回,不限制間隔。
func (g *Gateway) waitForSlot(ctx context.Context) error {
	if g.interval <= 0 {
		return nil
	}

	g.mu.Lock()
	now := time.Now()
	slot := g.nextSlot
	if slot.Before(now) {
		slot = now
	}
	g.nextSlot = slot.Add(g.interval)
	g.mu.Unlock()

	wait := time.Until(slot)
	if wait <= 0 {
		return nil
	}
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
