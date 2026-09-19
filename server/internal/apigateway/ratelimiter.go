package apigateway

import (
	"sync"
	"time"
)

// RateLimiter 是一個通用的、依 key 分別維護獨立速率視窗的「拒絕型」限流
// 元件——跟 Gateway 是兩個刻意分開、行為完全不同的元件:
//
//   - Gateway(見 apigateway.go)的節流語意是「排隊等待」:超過限制的
//     請求不會被拒絕,只會被延後送出,最終一定會執行。這適合「只是想
//     壓低尖峰流量,不在乎多等一下」的情境,但無法防止「攻擊者只要
//     持續發送請求夠久,呼叫總量就沒有上限」這種情況——排隊佇列本身
//     不會拒絕任何人,只是讓大家排隊。
//   - RateLimiter 的語意是「超過上限直接拒絕」:呼叫端呼叫 Allow 之後
//     立刻得到明確的 true/false 答案,false 代表這次呼叫在視窗內已經
//     用滿額度,呼叫端不應該重試或排隊等待,而是直接放棄或走降級路徑。
//     這是給明確需要「總量真的有上限」的情境使用的元件,兩者可以同時
//     套用在同一個呼叫路徑上(見 Gateway.rateLimiter 欄位)。這是同步、
//     立即回答的呼叫,不阻塞呼叫端。
//
// 依 key 分別維護視窗:key 的粒度由呼叫端決定(例如以 Google API 的
// endpoint 字串當 key)。**只有呼叫端明確透過 SetLimitForKey 設定過規則
// 的 key 才會被限流**——見該方法與 Allow 的說明:沒有設定過的 key,
// Allow 一律直接放行、完全不計入任何視窗計數。這是刻意的設計,不是
// 「所有 key 共用一個預設規則」:這個元件的實際使用情境(見呼叫端
// geo.ConfigureDefaultGatewayRateLimit)只需要對少數幾個明確、經過評估的
// key(例如 Google Places 的 "places.get"/"places.photoMedia")套用拒絕型
// 限流,其餘 endpoint 完全不受這個元件影響、繼續走原本的機制(如 Gateway
// 的排隊節流)——若改成「沒設定的 key 套用一個全域預設規則」,等於這個
// 元件會不小心把所有呼叫端當下沒特別想到、之後才新增的 key 也拉進來
// 限流,行為變得不明確、容易在新增呼叫點時忘記考慮這個副作用。「未設定
// 的 key 不受限」讓套用範圍完全由呼叫端的 SetLimitForKey 呼叫顯式決定,
// 清楚且可預期。
//
// 每個受限的 key 各自擁有獨立的「視窗長度 + 視窗內上限次數」組合(見
// SetLimitForKey)——不是所有 key 共用同一個視窗長度:不同 endpoint 的
// 計費風險/合理呼叫頻率天差地遠(例如地點照片下載這種依張數計費的動作,
// 可能需要比地點文字資訊查詢更長的視窗、更嚴格的上限),讓呼叫端能各自
// 決定每個 key 的視窗長度與上限,不強迫所有 key 套用同一組參數。
//
// 演算法:固定視窗計數器(fixed window counter)——對每個受限的 key 記錄
// 「目前視窗的起始時間」與「這個視窗內已經放行的次數」,呼叫 Allow 時
// 若視窗已經過期就重置成一個新視窗、次數歸零。這是所有常見限流演算法
// (固定視窗/滑動視窗/token bucket)裡最簡單、最容易正確實作與測試的
// 一種,代價是視窗邊界附近可能出現「短時間內允許接近兩倍上限次數」的
// 邊緣效應(例如視窗剛好在某個請求尖峰的中間重置)——這對這裡要解決的
// 問題(避免無上限的計費呼叫)是可以接受的取捨,不需要為了消除這個邊緣
// 效應改用更複雜的滑動視窗演算法(見套件說明「簡單正確比精巧更重要」
// 的既有原則)。
type RateLimiter struct {
	// limits 是 key 對應到限流規則的設定表——只有出現在這張表裡的 key
	// 才會被 Allow 實際限流(見該方法的說明),查不到的 key 一律直接放行。
	limits map[string]rateLimit
	now    func() time.Time // 可覆寫的時間來源,見下方 now 的完整說明

	mu      sync.Mutex
	windows map[string]*rateWindow
}

// rateLimit 是單一 key 的限流規則——window 是這個 key 的速率視窗長度,
// maxCalls 是這個視窗內最多可以放行的次數。
type rateLimit struct {
	window   time.Duration
	maxCalls int
}

// rateWindow 是單一 key 目前的視窗狀態——windowStart 是這個視窗第一次
// 被建立(或被重置)的時間點,count 是這個視窗內已經被 Allow 放行的次數。
type rateWindow struct {
	windowStart time.Time
	count       int
}

// NewRateLimiter 建立一個 RateLimiter。剛建立時對任何 key 都不限流(見
// limits 的說明)——呼叫端必須之後透過 SetLimitForKey 對想要限流的 key
// 逐一設定視窗長度與上限次數,才會開始生效。
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		limits:  make(map[string]rateLimit),
		now:     time.Now,
		windows: make(map[string]*rateWindow),
	}
}

// SetLimitForKey 對指定的 key 設定「視窗長度 + 視窗內上限次數」規則,並讓
// 這個 key 從此受這個 RateLimiter 限流(見 RateLimiter 與 Allow 的說明:
// 沒被這個方法設定過的 key 不受限、Allow 一律直接放行)。
//
// window <=0 時會被夾成安全的最小值(1 秒);maxCalls <=0 時視為「明確
// 要求解除這個 key 的限流」,把它從 limits 表移除,退回未設定過的狀態
// (Allow 一律放行)——2026-09 起後台管理介面(見
// server/internal/adminconsole)可以執行期修改限流規則(見
// geo.rateLimiterFromStore 的完整說明),使用者可能把某個 key 的上限
// 次數改成 0 或負數來表達「暫時關閉這個 key 的限流」,這裡必須真的移除
// 規則才能達成,不能只是靜默不寫入(原本的行為是「不寫入」,在 SetLimitForKey
// 只會在啟動時呼叫一次的舊假設下,這兩種行為等價——反正一開始就沒有
// 任何規則;但執行期重設時,「不寫入」代表維持先前已經設定過的規則不變,
// 跟「移除限流」是兩種不同結果,必須明確區分)。
//
// window 不論在新增或移除情境都不受這個判斷影響——移除限流只看
// maxCalls,window 傳什麼值都無所謂(移除動作不會用到它)。
//
// 這支方法目前有兩種呼叫時機:啟動時對少數幾個 key 各自呼叫一次(舊有
// 唯一用法),以及執行期背景 goroutine 定期從資料庫重讀設定後呼叫(見
// geo.rateLimiterFromStore 的完整說明)——不論哪種時機呼叫頻率都遠低於
// Allow 的呼叫頻率(每次 Google API 呼叫都會呼叫 Allow),同一把 mu
// 保護已經足夠,不需要額外最佳化。
func (rl *RateLimiter) SetLimitForKey(key string, window time.Duration, maxCalls int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if maxCalls <= 0 {
		delete(rl.limits, key)
		delete(rl.windows, key)
		return
	}
	if window <= 0 {
		window = time.Second
	}
	rl.limits[key] = rateLimit{window: window, maxCalls: maxCalls}
}

// Allow 判斷 key 這次呼叫是否可以放行——若這個 key 從未透過
// SetLimitForKey 設定過限流規則,視為不受限,一律直接回傳 true,不建立
// 任何視窗狀態(見 RateLimiter 的說明,這是刻意的設計:只有明確設定過的
// key 才會被限流)。
//
// 對有設定過規則的 key:回傳 true 代表可以放行,並且已經內部記錄了這次
// 放行(同一個視窗內下次呼叫的計數會反映這次);回傳 false 代表這個 key
// 在目前視窗內已經用滿上限額度,呼叫端應該直接拒絕這次呼叫,不重試、不
// 排隊等待——這是同步、立即回答的呼叫,內部只有一個短暫持有的 mutex,
// 不會阻塞呼叫端。
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	limit, limited := rl.limits[key]
	if !limited {
		// 這個 key 沒有設定過限流規則,不受這個 RateLimiter 管轄,直接放行。
		return true
	}

	now := rl.now()
	w, ok := rl.windows[key]
	if !ok || now.Sub(w.windowStart) >= limit.window {
		// 這個 key 第一次被呼叫、或目前視窗已經過期——開一個新視窗,
		// 這次呼叫算新視窗的第一次。
		w = &rateWindow{windowStart: now, count: 0}
		rl.windows[key] = w
	}

	if w.count >= limit.maxCalls {
		return false
	}
	w.count++
	return true
}
