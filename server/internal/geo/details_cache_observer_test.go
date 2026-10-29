package geo

import (
	"context"
	"sync"
	"testing"
	"time"
)

// details_cache_observer_test.go 測快取查詢結果的記錄:每個查詢請求剛好一筆,
// 結果是 hit / miss / shared 其中之一;Fresh 不走快取,不記錄。

type cacheEvent struct {
	cache, caller, path, key string
	outcome                  CacheOutcome
}

type recordingObserver struct {
	mu     sync.Mutex
	events []cacheEvent
}

func (r *recordingObserver) ObserveCache(cache string, outcome CacheOutcome, caller, path, key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, cacheEvent{cache, caller, path, key, outcome})
}

func (r *recordingObserver) count(o CacheOutcome) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, e := range r.events {
		if e.outcome == o {
			n++
		}
	}
	return n
}

func useRecordingObserver(t *testing.T) *recordingObserver {
	t.Helper()
	r := &recordingObserver{}
	SetCacheObserver(r)
	t.Cleanup(func() { SetCacheObserver(nil) })
	return r
}

func TestCacheObserver_MissThenHitsAreRecordedWithCallerAndPath(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	obs := useRecordingObserver(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())

	ctx := WithPath(WithCaller(context.Background(), "handleX"), "/public/x")
	for i := 0; i < 4; i++ {
		if _, err := c.GetPlaceDetails(ctx, "p1"); err != nil {
			t.Fatal(err)
		}
	}
	if obs.count(CacheMiss) != 1 || obs.count(CacheHit) != 3 || obs.count(CacheShared) != 0 {
		t.Fatalf("4 次查詢應是 1 miss + 3 hit,實際 %+v", obs.events)
	}
	first := obs.events[0]
	if first.outcome != CacheMiss || first.cache != CacheNamePlaceDetails ||
		first.caller != "handleX" || first.path != "/public/x" || first.key != "p1" {
		t.Fatalf("第一筆內容不對: %+v", first)
	}
	// 領頭者在獨立 goroutine 執行,caller/path 仍要保留(WithoutCancel 留 value)。
	if obs.events[1].outcome != CacheHit || obs.events[1].caller != "handleX" {
		t.Fatalf("hit 的 caller 不對: %+v", obs.events[1])
	}
}

func TestCacheObserver_ExpiredEntryCountsAsMiss(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	obs := useRecordingObserver(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)

	_, _ = c.GetPlaceDetails(context.Background(), "p1")
	cache.age("p1", 48*time.Hour)
	_, _ = c.GetPlaceDetails(context.Background(), "p1")
	if obs.count(CacheMiss) != 2 || obs.count(CacheHit) != 0 {
		t.Fatalf("過期應算 miss,實際 %+v", obs.events)
	}
}

func TestCacheObserver_ConcurrentRequestsAreOneMissPlusShared(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	obs := useRecordingObserver(t)
	gw := &countingGateway{body: detailsBodyOnePhoto, started: make(chan struct{}), release: make(chan struct{})}
	c := newCachedClient(gw, newMemDetailsCache())

	const n = 6
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = c.GetPlaceDetails(context.Background(), "hot")
		}()
	}
	<-gw.started
	time.Sleep(100 * time.Millisecond)
	close(gw.release)
	wg.Wait()

	if obs.count(CacheMiss) != 1 || obs.count(CacheShared) != n-1 {
		t.Fatalf("%d 個並發請求應是 1 miss + %d shared,實際 %+v", n, n-1, obs.events)
	}
}

func TestCacheObserver_FreshIsNotACacheLookup(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	obs := useRecordingObserver(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())

	if _, err := c.GetPlaceDetailsFresh(context.Background(), "p1"); err != nil {
		t.Fatal(err)
	}
	if len(obs.events) != 0 {
		t.Fatalf("Fresh 一定打 Google、不查快取,不該記錄: %+v", obs.events)
	}
}
