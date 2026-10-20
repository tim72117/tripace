package main

import (
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/ratelimits"
)

// windowSecForStore 的回歸測試——見該函式的完整說明。
//
// 這是 review 抓到的靜默錯誤:原本 int(window/time.Second) 對不滿一秒的
// 視窗截斷成 0,而登錄表裡真的有一條 500ms 的規則。0 不會讓限流失效
// (RateLimiter 會夾成 1 秒),但會讓資料庫與 CLI 顯示一個誤導的 0,
// 且實際生效值偏離設計值。
func TestWindowSecForStore(t *testing.T) {
	cases := []struct {
		name   string
		window time.Duration
		want   int
	}{
		{"整秒原樣", 60 * time.Second, 60},
		{"十秒原樣", 10 * time.Second, 10},
		{"不滿一秒進位成 1", 500 * time.Millisecond, 1},
		{"極小值也進位成 1", 1 * time.Millisecond, 1},
		// 0 是「沒有設定」而非「不滿一秒」,保持 0 讓呼叫端的既有
		// 驗證/夾取邏輯處理,不要在這裡擅自變成 1。
		{"零維持零", 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := windowSecForStore(c.window); got != c.want {
				t.Errorf("windowSecForStore(%v) = %d, 想要 %d", c.window, got, c.want)
			}
		})
	}
}

// 登錄表裡每一條規則的預設視窗,都必須能被存進 geo_rate_limits 表而不
// 變成 0——否則該條規則在全新環境 seeding 之後,資料庫與 CLI 會顯示
// 「視窗 0 秒」(看起來像沒有限制),實際生效值也會偏離設計值。
//
// 這個測試不要求預設值一定是整秒(500ms 那條是刻意的),只要求轉換後
// 不是 0。
func TestRegistryDefaultWindowsSurviveStoreRoundTrip(t *testing.T) {
	for _, r := range ratelimits.Registry {
		if got := windowSecForStore(r.DefaultWindow); got <= 0 {
			t.Errorf("%s 的 DefaultWindow %v 存進資料表會變成 %d,會被顯示成「沒有限制」",
				r.Endpoint, r.DefaultWindow, got)
		}
	}
}

// effectiveFallback 的 flag 優先序——這是「現有部署的設定被靜默忽略」
// 那條風險(review 指出原本完全沒有測試守住)。
//
// Google API 那五條必須回 geo.RateLimitConfig(來自 CLI flag/環境變數)
// 的值,不是登錄表預設值;plan-ai 那兩條沒有 flag 管道,回登錄表預設值。
// 若有人把某個 case 手滑寫成 return r.DefaultWindow,這支測試會紅。
func TestEffectiveFallbackPrefersFlagsForGoogleAPI(t *testing.T) {
	// 刻意用一組跟登錄表預設值完全不同的數字,才分得出回的是哪一邊。
	fallback := geo.RateLimitConfig{
		PlaceGetWindow: 11 * time.Second, PlaceGetMaxCalls: 111,
		PhotoMediaWindow: 22 * time.Second, PhotoMediaMaxCalls: 222,
		SearchTextWindow: 33 * time.Second, SearchTextMaxCalls: 333,
		SearchNearbyWindow: 44 * time.Second, SearchNearbyMaxCalls: 444,
		GeocodeWindow: 55 * time.Second, GeocodeMaxCalls: 555,
	}
	want := map[string]struct {
		window   time.Duration
		maxCalls int
	}{
		ratelimits.EndpointPlaceGet:     {11 * time.Second, 111},
		ratelimits.EndpointPhotoMedia:   {22 * time.Second, 222},
		ratelimits.EndpointSearchText:   {33 * time.Second, 333},
		ratelimits.EndpointSearchNearby: {44 * time.Second, 444},
		ratelimits.EndpointGeocode:      {55 * time.Second, 555},
	}

	for _, r := range ratelimits.Registry {
		gotWindow, gotMax := effectiveFallback(r, fallback, 0)
		if exp, ok := want[r.Endpoint]; ok {
			if gotWindow != exp.window || gotMax != exp.maxCalls {
				t.Errorf("%s 應以 flag 為準,得到 %v/%d,想要 %v/%d",
					r.Endpoint, gotWindow, gotMax, exp.window, exp.maxCalls)
			}
			continue
		}
		// 不在 want 裡的就是 plan-ai 那兩條——應回登錄表預設值。
		if gotWindow != r.DefaultWindow || gotMax != r.DefaultMaxCalls {
			t.Errorf("%s 應回登錄表預設值,得到 %v/%d,想要 %v/%d",
				r.Endpoint, gotWindow, gotMax, r.DefaultWindow, r.DefaultMaxCalls)
		}
	}
}

// 每條 Google API 規則都必須被 effectiveFallback 明確處理(而不是掉進
// default 分支拿登錄表預設值)——新增一條 Google 規則卻忘記在
// effectiveFallback 補 case 時,這支測試會紅。
//
// 偵測方式:給一組 flag 值全部不同於登錄表預設值的 config,若某條
// KindGoogleAPI 規則回的是登錄表預設值,就代表它掉進 default 了。
func TestEveryGoogleAPIRuleIsWiredToFlags(t *testing.T) {
	fallback := geo.RateLimitConfig{
		PlaceGetWindow: 11 * time.Second, PlaceGetMaxCalls: 111,
		PhotoMediaWindow: 22 * time.Second, PhotoMediaMaxCalls: 222,
		SearchTextWindow: 33 * time.Second, SearchTextMaxCalls: 333,
		SearchNearbyWindow: 44 * time.Second, SearchNearbyMaxCalls: 444,
		GeocodeWindow: 55 * time.Second, GeocodeMaxCalls: 555,
	}
	for _, r := range ratelimits.OfKind(ratelimits.KindGoogleAPI) {
		gotWindow, gotMax := effectiveFallback(r, fallback, 0)
		if gotWindow == r.DefaultWindow && gotMax == r.DefaultMaxCalls {
			t.Errorf("%s 回的是登錄表預設值 %v/%d——看起來掉進了 effectiveFallback 的 default 分支,"+
				"代表它的 flag 設定會被靜默忽略", r.Endpoint, gotWindow, gotMax)
		}
	}
}

// round-trip 不變性:登錄表預設值 → seeding 寫入資料表 → 讀回 →
// 套進 RateLimiter 之後實際生效的視窗,應該等於原始預設值。
//
// 這是最能抓到單位轉換 bug 的測試形狀。review 指出的那個 bug
// (500ms 被 int(window/time.Second) 截斷成 0、再被 SetLimitForKey 夾成
// 1 秒)正好違反它——所以這支測試對 500ms 那條規則刻意放寬成「不得
// 變成 0,且與資料表能表達的精度一致」,而不是要求完全相等:資料表只
// 存整數秒,500ms 本來就無法原樣往返,那是已知且有記 log 的限制。
func TestSeedRoundTripDoesNotLoseTheWindow(t *testing.T) {
	for _, r := range ratelimits.Registry {
		storedSec := windowSecForStore(r.DefaultWindow)
		if storedSec <= 0 {
			t.Errorf("%s 的 DefaultWindow %v 存進資料表變成 %d 秒——會被顯示成「沒有限制」,"+
				"且讀回後會被 SetLimitForKey 夾成 1 秒", r.Endpoint, r.DefaultWindow, storedSec)
			continue
		}
		readBack := time.Duration(storedSec) * time.Second
		// 不滿一秒的規則:進位後必須仍在同一個數量級,不能變成 0 或
		// 跳到遠大於原值。
		if r.DefaultWindow < time.Second {
			if readBack != time.Second {
				t.Errorf("%s 的 %v 進位後應是 1 秒,得到 %v", r.Endpoint, r.DefaultWindow, readBack)
			}
			continue
		}
		if readBack != r.DefaultWindow {
			t.Errorf("%s 的視窗 round-trip 不一致:%v → 存 %d 秒 → 讀回 %v",
				r.Endpoint, r.DefaultWindow, storedSec, readBack)
		}
	}
}
