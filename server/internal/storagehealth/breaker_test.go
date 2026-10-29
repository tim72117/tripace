package storagehealth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

// newTestBreaker 回傳注入了假時鐘與可控探測結果的斷路器。
func newTestBreaker(probeErr *error, probes *int) (*Breaker, *fakeClock) {
	clk := &fakeClock{t: time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)}
	b := New(func(context.Context) error {
		*probes++
		return *probeErr
	})
	b.now = clk.now
	return b, clk
}

var errBilling = errors.New("403 accountDisabled")

func TestUnknownProbesBeforeFirstUse(t *testing.T) {
	var perr error
	var probes int
	b, _ := newTestBreaker(&perr, &probes)

	if !b.Allow(context.Background()) {
		t.Fatal("探測成功應放行")
	}
	if probes != 1 || b.Status().State != Closed {
		t.Fatalf("應探測一次並轉 closed: probes=%d state=%s", probes, b.Status().State)
	}
	b.Allow(context.Background())
	if probes != 1 {
		t.Fatal("closed 之後不該再探測")
	}
}

func TestUnknownWithFailingProbeOpensAndSkips(t *testing.T) {
	perr := errBilling
	var probes int
	b, _ := newTestBreaker(&perr, &probes)

	if b.Allow(context.Background()) {
		t.Fatal("探測失敗不該放行")
	}
	st := b.Status()
	if st.State != Open || st.LastError == "" || st.NextProbe.IsZero() {
		t.Fatalf("應轉 open 並記下錯誤與下次探測時間: %+v", st)
	}
	// 間隔內不再探測,直接跳過。
	for i := 0; i < 5; i++ {
		if b.Allow(context.Background()) {
			t.Fatal("open 且未到探測時間不該放行")
		}
	}
	if probes != 1 {
		t.Fatalf("間隔內不該探測,probes=%d", probes)
	}
	if b.Status().Skipped != 6 {
		t.Fatalf("Skipped = %d,預期 6", b.Status().Skipped)
	}
}

func TestOpenRecoversWhenProbeSucceeds(t *testing.T) {
	perr := errBilling
	var probes int
	b, clk := newTestBreaker(&perr, &probes)
	var transitions []State
	b.OnTransition = func(_, to State, _ error) { transitions = append(transitions, to) }

	b.Allow(context.Background()) // → open
	perr = nil
	clk.advance(minInterval + time.Second)
	if !b.Allow(context.Background()) {
		t.Fatal("到探測時間且探測成功應放行這個請求")
	}
	if b.Status().State != Closed {
		t.Fatalf("state = %s", b.Status().State)
	}
	if len(transitions) != 2 || transitions[0] != Open || transitions[1] != Closed {
		t.Fatalf("transitions = %v", transitions)
	}
}

func TestFailedProbeBacksOffUpToCap(t *testing.T) {
	perr := errBilling
	var probes int
	b, clk := newTestBreaker(&perr, &probes)
	b.Allow(context.Background()) // open,間隔 1 分鐘

	want := []time.Duration{2 * time.Minute, 4 * time.Minute, 8 * time.Minute, maxInterval, maxInterval}
	for i, w := range want {
		prev := b.Status().NextProbe
		clk.t = prev.Add(time.Second) // 剛過探測時間
		if b.Allow(context.Background()) {
			t.Fatal("探測仍失敗不該放行")
		}
		got := b.Status().NextProbe.Sub(clk.t)
		if got != w {
			t.Fatalf("第 %d 次失敗後間隔 = %v,預期 %v", i+1, got, w)
		}
	}
}

func TestClosedTripsAfterConsecutiveRealFailures(t *testing.T) {
	var perr error
	var probes int
	b, _ := newTestBreaker(&perr, &probes)
	b.Allow(context.Background()) // closed

	b.Failure(errBilling)
	if b.Status().State != Closed {
		t.Fatal("一次失敗不該跳閘")
	}
	b.Success() // 成功會清掉連續計數
	b.Failure(errBilling)
	if b.Status().State != Closed {
		t.Fatal("成功之後重新計數,一次失敗不該跳閘")
	}
	b.Failure(errBilling)
	st := b.Status()
	if st.State != Open || st.LastError != errBilling.Error() {
		t.Fatalf("連續兩次失敗應跳閘: %+v", st)
	}
	if b.Allow(context.Background()) {
		t.Fatal("跳閘後未到探測時間不該放行")
	}
}

func TestOnlyOneProbeAtATime(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	var once sync.Once
	var mu sync.Mutex
	probes := 0
	b := New(func(context.Context) error {
		mu.Lock()
		probes++
		mu.Unlock()
		once.Do(func() { close(started) })
		<-release
		return nil
	})

	var wg sync.WaitGroup
	results := make(chan bool, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- b.Allow(context.Background())
		}()
	}
	<-started
	time.Sleep(50 * time.Millisecond) // 讓其餘 goroutine 都撞上「探測中」
	close(release)
	wg.Wait()
	close(results)

	allowed := 0
	for r := range results {
		if r {
			allowed++
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if probes != 1 {
		t.Fatalf("同時只該有一個探測,實際 %d", probes)
	}
	if allowed < 1 {
		t.Fatal("探測成功的那個請求應放行")
	}
}
