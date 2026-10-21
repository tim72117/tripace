package geo

// details_cache_robustness_test.go——獨立審查(2026-10)指出的三個強健性問題,
// 先寫測試重現、再修:
//
//  1. 領頭者 panic:清理(刪登錄、close done)沒放在 defer,panic 之後該
//     placeID 永久卡死(之後所有查詢都等一個永遠不會關閉的 channel,只能等自己
//     的 ctx 逾時,要重啟 process 才恢復)。net/http 會 recover handler 的 panic,
//     所以 process 不會死,但這個地點的補圖與查詢全部失效。
//  2. Fresh 加入「命中快取的領頭者」:一般查詢的領頭者在「重新檢查快取」分支命中時
//     回傳 FromCache=true、PhotoRefs=nil;若同時有 GetPlaceDetailsFresh 加入同一個
//     登錄,拿到的就是沒有照片參照的快取資料——違反 Fresh「一定打 Google」的契約,
//     補圖會因此把 photo_count 誤記成 0,之後永遠不再補圖。
//  3. 領頭者不理會自己的 ctx:同步阻塞到 Google 回來或 15 秒,AI 版 5 秒、handler
//     10 秒的逾時對領頭者形同虛設。
import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// panicOnceGateway 第一次呼叫 panic,之後正常回應。
type panicOnceGateway struct {
	calls atomic.Int64
	body  string
}

func (g *panicOnceGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	if g.calls.Add(1) == 1 {
		panic("gateway boom")
	}
	return (&countingGateway{body: g.body}).Do(ctx, req, endpoint, caller, path)
}

// ===== 1. panic 不能毒化之後的查詢 =====

func TestDetailsCache_Robust_GatewayPanicBecomesErrorAndDoesNotPoisonLaterCalls(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &panicOnceGateway{body: detailsBodyOnePhoto}
	c := NewWithGateway("test-key", gw)
	c.SetDetailsCache(newMemDetailsCache())

	ctx1, cancel1 := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel1()
	if _, err := c.GetPlaceDetails(ctx1, "p1"); err == nil {
		t.Fatal("gateway panic 應轉成錯誤回傳,不該回傳成功")
	}

	// 之後的查詢必須能正常打 Google,不能卡在永遠不會關閉的 channel 上。
	ctx2, cancel2 := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel2()
	start := time.Now()
	d, err := c.GetPlaceDetails(ctx2, "p1")
	if err != nil {
		t.Fatalf("panic 之後的查詢應成功(卡死的話會等到 ctx 逾時): %v(等了 %v)", err, time.Since(start))
	}
	if d.Name != "測試地點" {
		t.Errorf("資料不對: %+v", d)
	}
	if gw.calls.Load() != 2 {
		t.Errorf("應共打 2 次(第 1 次 panic、第 2 次成功),實際 %d", gw.calls.Load())
	}
}

func TestDetailsCache_Robust_PanicInFreshPathAlsoRecovers(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &panicOnceGateway{body: detailsBodyOnePhoto}
	c := NewWithGateway("test-key", gw)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := c.GetPlaceDetailsFresh(ctx, "p1"); err == nil {
		t.Fatal("Fresh 路徑的 panic 也應轉成錯誤")
	}
	if _, err := c.GetPlaceDetailsFresh(ctx, "p1"); err != nil {
		t.Fatalf("之後的 Fresh 查詢應成功: %v", err)
	}
}

// ===== 2. Fresh 一定打 Google,不能加入一般查詢的領頭者 =====

// stepCache:第 1 次 Get 回「沒有」(讓一般查詢進入領頭者流程);第 2 次 Get(領頭者
// 重新檢查快取)會阻塞到 release,放行後回「有」——模擬領頭者停在「命中快取」的瞬間。
type stepCache struct {
	mu      sync.Mutex
	gets    int
	entered chan struct{}
	release chan struct{}
	row     PlaceDetails
}

func (s *stepCache) Get(placeID string) (PlaceDetails, time.Time, bool) {
	s.mu.Lock()
	s.gets++
	n := s.gets
	s.mu.Unlock()
	switch n {
	case 1:
		return PlaceDetails{}, time.Time{}, false
	case 2:
		close(s.entered)
		<-s.release
	}
	return s.row, time.Now(), true
}

func (s *stepCache) Set(placeID string, d PlaceDetails) {}

func TestDetailsCache_Robust_FreshDoesNotJoinALeaderThatHitsTheCache(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := &stepCache{
		entered: make(chan struct{}),
		release: make(chan struct{}),
		row:     PlaceDetails{Name: "快取裡的名稱", Address: "快取地址"},
	}
	c := NewWithGateway("test-key", gw)
	c.SetDetailsCache(cache)

	type result struct {
		d   PlaceDetails
		err error
	}
	aDone := make(chan result, 1)
	go func() {
		d, err := c.GetPlaceDetails(context.Background(), "p1")
		aDone <- result{d, err}
	}()
	<-cache.entered // 一般查詢的領頭者已經停在「重新檢查快取」,登錄還留在 map 裡

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	fresh, err := c.GetPlaceDetailsFresh(ctx, "p1")
	if err != nil {
		t.Fatalf("GetPlaceDetailsFresh: %v", err)
	}
	if fresh.FromCache {
		t.Error("Fresh 不該拿到快取資料(它加入了命中快取的領頭者)")
	}
	if len(fresh.PhotoRefs) != 2 {
		t.Errorf("Fresh 必須帶回照片參照(補圖靠它),實際 %d 個", len(fresh.PhotoRefs))
	}
	if gw.calls.Load() != 1 {
		t.Errorf("Fresh 應自己打 1 次 Google,實際 %d", gw.calls.Load())
	}

	close(cache.release)
	a := <-aDone
	if a.err != nil || !a.d.FromCache || a.d.Name != "快取裡的名稱" {
		t.Errorf("一般查詢應命中快取並回傳快取資料,實際 %+v err=%v", a.d, a.err)
	}
}

// 反方向:一般查詢不該加入進行中的 Fresh 然後拿到過期的錯誤假設——兩者各自獨立,
// 只是並發時各打一次(Fresh 本來就要打)。
func TestDetailsCache_Robust_PlainAndFreshConcurrentlyBothSucceed(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, fresh := range []bool{false, true} {
		wg.Add(1)
		go func(fresh bool) {
			defer wg.Done()
			var err error
			if fresh {
				_, err = c.GetPlaceDetailsFresh(context.Background(), "p1")
			} else {
				_, err = c.GetPlaceDetails(context.Background(), "p1")
			}
			errs <- err
		}(fresh)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("並發的一般查詢與 Fresh 都該成功: %v", err)
		}
	}
}

// ===== 3. 領頭者要尊重自己的 context =====

func TestDetailsCache_Robust_LeaderReturnsOnItsOwnTimeoutButFollowersStillGetTheResult(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto, started: make(chan struct{}), release: make(chan struct{})}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)

	leaderCtx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	leaderDone := make(chan time.Duration, 1)
	leaderErr := make(chan error, 1)
	go func() {
		start := time.Now()
		_, err := c.GetPlaceDetails(leaderCtx, "hot")
		leaderErr <- err
		leaderDone <- time.Since(start)
	}()
	<-gw.started

	followerErr := make(chan error, 1)
	go func() {
		_, err := c.GetPlaceDetails(context.Background(), "hot")
		followerErr <- err
	}()

	// 領頭者的 150ms 逾時到了,它必須回傳,不能被拖到 Google 回來或 15 秒。
	select {
	case elapsed := <-leaderDone:
		if err := <-leaderErr; err == nil {
			t.Error("領頭者逾時應回 context 錯誤")
		}
		if elapsed > 2*time.Second {
			t.Errorf("領頭者應在自己的逾時(150ms)附近回傳,實際等了 %v", elapsed)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("領頭者沒有尊重自己的 context,3 秒後仍卡住")
	}

	close(gw.release) // Google 這時才回來:跟隨者仍要拿到結果,結果也要寫進快取
	if err := <-followerErr; err != nil {
		t.Errorf("領頭者逾時不該害到跟隨者: %v", err)
	}
	if gw.calls.Load() != 1 {
		t.Errorf("兩個請求共用 1 次 Google 呼叫,實際 %d", gw.calls.Load())
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, _, ok := cache.Get("hot"); ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Error("共用的那次呼叫完成後結果應寫進快取")
}
