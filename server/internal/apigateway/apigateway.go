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
	"net/http"
	"sync"
	"time"
)

// HTTPDoer 是底層實際發送 HTTP 請求的介面——標準函式庫的 *http.Client 已經
// 滿足這個介面(Do 方法簽章相同),測試時可以換成假實作,不需要真的連網路。
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// CallLogger 是每次請求完成後的記錄回呼——Gateway 本身不依賴任何資料庫套件
// (維持這個元件的獨立性,理由同套件說明的第 1 點),由呼叫端(api 層)注入
// 一個把記錄寫進資料庫的實作。nil 代表不記錄,Gateway 仍正常運作。
type CallLogger interface {
	// LogCall 在請求完成(不論成功或失敗)後呼叫一次。err 不為 nil 時
	// statusCode 為 0(連線失敗、逾時等,根本沒有收到 HTTP 回應)。path 是
	// 觸發這次外部呼叫的「我方」API 路徑(如 "/internal/geo/districts/
	// nearby"),供事後查記錄時能對到「是使用者/CLI 打了我方哪一條路徑,
	// 才連帶觸發這次對 Google 的呼叫」——跟 caller(呼叫端在程式碼裡的
	// 識別字串,如 "handleGeoDistrictsNearby")是兩個獨立維度:caller
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
		doer:     doer,
		logger:   logger,
		sem:      make(chan struct{}, cfg.MaxConcurrency),
		interval: cfg.MinInterval,
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
