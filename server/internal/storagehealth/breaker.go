// Package storagehealth 是照片儲存(GCS)的斷路器:儲存服務壞掉時,讓補圖在
// 花錢之前就跳過。
//
// 為什麼需要:背景補圖的順序是「打 Google places.get → 打 Google photoMedia
// 下載照片 → 上傳 GCS → 寫 photo_assets」。GCS 上傳失敗(例如專案帳單停用,
// 403 accountDisabled)時前兩步已經計費、結果被丟掉,photo_assets 沒寫入,
// 下一次請求看到照片還缺又重來——每次載入頁面都重複付費、永遠不會成功。
//
// 狀態只放記憶體:重啟或多個實例各自一份都可以接受,代價只是各自探測一次。
//
//   - unknown:剛啟動,還不知道。第一次補圖前先探測一次再決定,避免重啟後的
//     第一次補圖又白花一次錢。
//   - closed(正常):放行。連續 failureThreshold 次真實上傳失敗就轉 open。
//   - open(異常):全部跳過;到了下次探測時間,放一個請求去探測,其餘仍跳過。
//     探測失敗間隔加倍(上限 maxInterval),成功回到 closed。
//
// 只有基礎設施類錯誤才該呼叫 Failure(由呼叫端用 photostorage.IsStorageFailure
// 判斷)——單張圖片的問題不能讓全站停止補圖。
package storagehealth

import (
	"context"
	"sync"
	"time"
)

type State string

const (
	Unknown State = "unknown"
	Closed  State = "closed"
	Open    State = "open"
)

const (
	failureThreshold = 2
	minInterval      = time.Minute
	maxInterval      = 15 * time.Minute
)

// Breaker 是斷路器。零值不可用,請用 New。
type Breaker struct {
	probe func(ctx context.Context) error
	now   func() time.Time
	// OnTransition 在狀態轉換時被呼叫(不持鎖),用來寫 log。可為 nil。
	OnTransition func(from, to State, err error)

	mu        sync.Mutex
	state     State
	failures  int
	interval  time.Duration
	nextProbe time.Time
	probing   bool
	lastErr   string
	skipped   int64
}

// New 建立斷路器,probe 是實際探測 GCS 的函式。
func New(probe func(ctx context.Context) error) *Breaker {
	return &Breaker{probe: probe, now: time.Now, state: Unknown, interval: minInterval}
}

// Allow 回報這次補圖能不能進行。open 或未知狀態且需要探測時,會在這裡同步
// 探測(呼叫端本來就在背景 goroutine);同一時間只放一個探測,其餘回 false。
func (b *Breaker) Allow(ctx context.Context) bool {
	b.mu.Lock()
	switch b.state {
	case Closed:
		b.mu.Unlock()
		return true
	case Open:
		if b.probing || b.now().Before(b.nextProbe) {
			b.skipped++
			b.mu.Unlock()
			return false
		}
	case Unknown:
		if b.probing {
			b.skipped++
			b.mu.Unlock()
			return false
		}
	}
	b.probing = true
	b.mu.Unlock()

	err := b.probe(ctx)

	b.mu.Lock()
	b.probing = false
	from := b.state
	if err == nil {
		b.state, b.failures, b.interval, b.lastErr = Closed, 0, minInterval, ""
		b.mu.Unlock()
		if from != Closed {
			b.notify(from, Closed, nil)
		}
		return true
	}
	// 探測失敗:open,間隔從第二次失敗起加倍。
	if from == Open {
		b.interval *= 2
		if b.interval > maxInterval {
			b.interval = maxInterval
		}
	}
	b.state, b.lastErr = Open, err.Error()
	b.nextProbe = b.now().Add(b.interval)
	b.skipped++
	b.mu.Unlock()
	if from != Open {
		b.notify(from, Open, err)
	}
	return false
}

// Failure 記錄一次真實的儲存失敗;closed 狀態連續達門檻就轉 open。
func (b *Breaker) Failure(err error) {
	b.mu.Lock()
	b.failures++
	if err != nil {
		b.lastErr = err.Error()
	}
	if b.state == Open || b.failures < failureThreshold {
		b.mu.Unlock()
		return
	}
	from := b.state
	b.state = Open
	b.interval = minInterval
	b.nextProbe = b.now().Add(b.interval)
	b.mu.Unlock()
	b.notify(from, Open, err)
}

// Success 記錄一次真實的儲存成功,清掉連續失敗計數。
func (b *Breaker) Success() {
	b.mu.Lock()
	b.failures = 0
	b.mu.Unlock()
}

// Status 是目前狀態的快照,供 CLI/後台顯示。
type Status struct {
	State     State     `json:"state"`
	LastError string    `json:"lastError,omitempty"`
	NextProbe time.Time `json:"nextProbe,omitempty"`
	Skipped   int64     `json:"skipped"`
}

func (b *Breaker) Status() Status {
	b.mu.Lock()
	defer b.mu.Unlock()
	st := Status{State: b.state, LastError: b.lastErr, Skipped: b.skipped}
	if b.state == Open {
		st.NextProbe = b.nextProbe
	}
	return st
}

func (b *Breaker) notify(from, to State, err error) {
	if b.OnTransition != nil {
		b.OnTransition(from, to, err)
	}
}
