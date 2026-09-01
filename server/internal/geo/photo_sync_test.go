package geo

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---- planPhotoSync:純函式,不需要任何 fake,直接餵資料驗證輸出 ----

func TestPlanPhotoSync(t *testing.T) {
	now := time.Now()
	fresh := now.Add(-1 * time.Hour)       // 遠小於 maxAge,視為新鮮
	stale := now.Add(-30 * 24 * time.Hour) // 遠大於 maxAge(7 天),視為過期
	const maxAge = 7 * 24 * time.Hour

	tests := []struct {
		name         string
		cachedAt     map[int]time.Time
		newCount     int
		wantToFetch  []int
		wantTrimFrom int
	}{
		{
			name:         "空快取,3 張全部要補上",
			cachedAt:     map[int]time.Time{},
			newCount:     3,
			wantToFetch:  []int{0, 1, 2},
			wantTrimFrom: -1,
		},
		{
			name:         "全部新鮮且數量相同,不做任何事",
			cachedAt:     map[int]time.Time{0: fresh, 1: fresh, 2: fresh},
			newCount:     3,
			wantToFetch:  nil,
			wantTrimFrom: -1,
		},
		{
			name:         "部分過期,只重抓過期的那幾張",
			cachedAt:     map[int]time.Time{0: fresh, 1: stale, 2: fresh},
			newCount:     3,
			wantToFetch:  []int{1},
			wantTrimFrom: -1,
		},
		{
			name:         "少的補上:Google 現在有 3 張,快取只有 1 張",
			cachedAt:     map[int]time.Time{0: fresh},
			newCount:     3,
			wantToFetch:  []int{1, 2},
			wantTrimFrom: -1,
		},
		{
			name:         "多的移除:Google 現在只有 1 張,快取有 3 張",
			cachedAt:     map[int]time.Time{0: fresh, 1: fresh, 2: fresh},
			newCount:     1,
			wantToFetch:  nil,
			wantTrimFrom: 1,
		},
		{
			name:         "同時有缺少、過期、多餘",
			cachedAt:     map[int]time.Time{0: fresh, 1: stale, 3: fresh, 4: fresh},
			newCount:     3,
			wantToFetch:  []int{1, 2},
			wantTrimFrom: 3,
		},
		{
			name:         "Google 現在完全沒有照片,快取原本有,全部清空",
			cachedAt:     map[int]time.Time{0: fresh, 1: fresh},
			newCount:     0,
			wantToFetch:  nil,
			wantTrimFrom: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotFetch, gotTrim := planPhotoSync(tt.cachedAt, tt.newCount, maxAge, now)
			if !intSlicesEqual(gotFetch, tt.wantToFetch) {
				t.Errorf("toFetch = %v, want %v", gotFetch, tt.wantToFetch)
			}
			if gotTrim != tt.wantTrimFrom {
				t.Errorf("trimFrom = %d, want %d", gotTrim, tt.wantTrimFrom)
			}
		})
	}
}

func intSlicesEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ---- SyncPlacePhotos:驗證整條流程真的照 planPhotoSync 的決策執行 I/O ----

// fakeCache 是 PhotoCache 的記憶體假實作,供測試用,不連真的資料庫。
type fakeCache struct {
	mu   sync.Mutex
	data map[string]map[int]string // placeID -> photoIndex -> dataURI
	at   map[string]map[int]time.Time
}

func newFakeCache() *fakeCache {
	return &fakeCache{
		data: make(map[string]map[int]string),
		at:   make(map[string]map[int]time.Time),
	}
}

func (f *fakeCache) Get(placeID string, photoIndex, maxWidthPx int) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.data[placeID][photoIndex]
	return v, ok
}

func (f *fakeCache) Set(placeID string, photoIndex, maxWidthPx int, dataURI string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.data[placeID] == nil {
		f.data[placeID] = make(map[int]string)
		f.at[placeID] = make(map[int]time.Time)
	}
	f.data[placeID][photoIndex] = dataURI
	f.at[placeID][photoIndex] = time.Now()
}

// seed 直接灌一筆快取資料並指定 fetchedAt,不透過 Set(那樣一律蓋成
// time.Now(),測試需要能模擬「很久以前抓的」這種過期情境)。
func (f *fakeCache) seed(placeID string, photoIndex int, dataURI string, fetchedAt time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.data[placeID] == nil {
		f.data[placeID] = make(map[int]string)
		f.at[placeID] = make(map[int]time.Time)
	}
	f.data[placeID][photoIndex] = dataURI
	f.at[placeID][photoIndex] = fetchedAt
}

func (f *fakeCache) List(placeID string, maxWidthPx int) (map[int]time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[int]time.Time, len(f.at[placeID]))
	for idx, t := range f.at[placeID] {
		out[idx] = t
	}
	return out, nil
}

func (f *fakeCache) Trim(placeID string, maxWidthPx, fromIndex int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for idx := range f.data[placeID] {
		if idx >= fromIndex {
			delete(f.data[placeID], idx)
			delete(f.at[placeID], idx)
		}
	}
	return nil
}

// fakeSyncDoer 是 requestDoer 的假實作:依請求路徑分辨這次是「查詢
// photos[] 清單」(Place Details)還是「下載某張照片」(Photo Media),
// 回傳對應的假回應,不真的連網路。
type fakeSyncDoer struct {
	mu         sync.Mutex
	photoRefs  []string // ListPlacePhotoRefs 應該回傳的清單
	photoCalls []string // 依序記錄實際被下載的 photoRef,供測試斷言
}

func (d *fakeSyncDoer) Do(_ context.Context, req *http.Request, _, _, _ string) (*http.Response, error) {
	if strings.Contains(req.URL.Path, "/media") {
		d.mu.Lock()
		// req.URL.Path 形如 "/v1/places/PLACE/photos/REF/media",取出中間的
		// photoRef 部分(去掉開頭 "/v1/"、結尾 "/media")供測試比對。
		ref := strings.TrimSuffix(strings.TrimPrefix(req.URL.Path, "/v1/"), "/media")
		d.photoCalls = append(d.photoCalls, ref)
		d.mu.Unlock()
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
			Body:       io.NopCloser(strings.NewReader("fake-bytes")),
		}, nil
	}

	// Place Details(photos 欄位遮罩)回應。
	var sb strings.Builder
	sb.WriteString(`{"photos":[`)
	d.mu.Lock()
	for i, ref := range d.photoRefs {
		if i > 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `{"name":%q}`, ref)
	}
	d.mu.Unlock()
	sb.WriteString(`]}`)
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(sb.String())),
	}, nil
}

func TestSyncPlacePhotos_FetchesMissingSkipsFreshTrimsExtra(t *testing.T) {
	// photosEnabled 預設關閉(見 places.go 的說明),這個測試需要驗證
	// 真的有下載動作發生,故明確開啟;測試結束後還原,避免影響其他
	// 依賴預設值的測試(同一個 package 的測試在同一個 process 內依序
	// 執行,photosEnabled 是套件層級的共用狀態)。
	SetPhotosEnabled(true)
	defer SetPhotosEnabled(false)

	const placeID = "place_test"
	const maxWidthPx = 400
	const maxAge = 7 * 24 * time.Hour

	doer := &fakeSyncDoer{
		photoRefs: []string{"places/x/photos/ref0", "places/x/photos/ref1"},
	}
	cache := newFakeCache()
	// index 0:很久以前抓過(過期),應該被重新下載。
	cache.seed(placeID, 0, "old-data", time.Now().Add(-30*24*time.Hour))
	// index 1 缺少,不在快取裡,應該被下載補上。
	// index 2:快取裡有,但這次 Google 只回傳 2 張(index 0、1),應該被移除。
	cache.seed(placeID, 2, "stale-extra", time.Now())

	client := NewWithGateway("test-key", doer)
	client.SetCache(cache)

	if err := client.SyncPlacePhotos(context.Background(), placeID, maxWidthPx, maxAge); err != nil {
		t.Fatalf("SyncPlacePhotos: %v", err)
	}

	// index 0(過期)與 index 1(缺少)都應該被下載,index 2 不該有下載
	// 動作(它是要被刪除的多餘項,不是要重抓的)。
	wantCalls := []string{"places/x/photos/ref0", "places/x/photos/ref1"}
	if !stringSlicesEqual(doer.photoCalls, wantCalls) {
		t.Errorf("photoCalls = %v, want %v", doer.photoCalls, wantCalls)
	}

	// 驗證最終快取狀態:index 0/1 存在(新內容),index 2 已被清除。
	at, err := cache.List(placeID, maxWidthPx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if _, ok := at[0]; !ok {
		t.Error("index 0 應該存在(已重新下載)")
	}
	if _, ok := at[1]; !ok {
		t.Error("index 1 應該存在(補上缺少的)")
	}
	if _, ok := at[2]; ok {
		t.Error("index 2 應該已被 Trim 移除,不該還存在")
	}
}

func TestSyncPlacePhotos_AllFreshSkipsAllDownloads(t *testing.T) {
	// 明確開啟(見 TestSyncPlacePhotos_FetchesMissingSkipsFreshTrimsExtra
	// 的說明)——這個測試要驗證的是「全部新鮮時,同步邏輯自己判斷不需要
	// 下載」,不該跟 photosEnabled 這個無關的全域開關混在一起,否則測試
	// 意圖不清楚(到底是邏輯正確跳過,還是被開關擋下來的)。
	SetPhotosEnabled(true)
	defer SetPhotosEnabled(false)

	const placeID = "place_fresh"
	const maxWidthPx = 400
	const maxAge = 7 * 24 * time.Hour

	doer := &fakeSyncDoer{
		photoRefs: []string{"places/x/photos/ref0", "places/x/photos/ref1"},
	}
	cache := newFakeCache()
	cache.seed(placeID, 0, "fresh0", time.Now())
	cache.seed(placeID, 1, "fresh1", time.Now())

	client := NewWithGateway("test-key", doer)
	client.SetCache(cache)

	if err := client.SyncPlacePhotos(context.Background(), placeID, maxWidthPx, maxAge); err != nil {
		t.Fatalf("SyncPlacePhotos: %v", err)
	}

	if len(doer.photoCalls) != 0 {
		t.Errorf("全部新鮮時不該有任何 Photo Media 下載,實際呼叫了 %v", doer.photoCalls)
	}
}

func TestSyncPlacePhotos_NilCacheIsNoop(t *testing.T) {
	doer := &fakeSyncDoer{photoRefs: []string{"places/x/photos/ref0"}}
	client := NewWithGateway("test-key", doer)
	// 不呼叫 SetCache——client.cache 維持 nil。

	if err := client.SyncPlacePhotos(context.Background(), "place_x", 400, time.Hour); err != nil {
		t.Fatalf("SyncPlacePhotos 在沒有快取層時應該直接回傳 nil,got err: %v", err)
	}
	if len(doer.photoCalls) != 0 {
		t.Errorf("沒有快取層時不該發出任何請求,實際呼叫了 %v", doer.photoCalls)
	}
}

// TestPhotosEnabled_DefaultsToDisabled 驗證 photosEnabled 的預設值,以及
// 關閉時 downloadPhotoBytes 確實完全不發出 HTTP 請求(降級成回傳
// ErrPhotosDisabled,不是靜默成功回傳空字串——呼叫端才能正確分辨「這是
// 開關關閉」還是「查無照片」,雖然目前所有呼叫端對兩者的處理方式相同,
// 但錯誤本身仍應該誠實反映實際狀況)。
func TestPhotosEnabled_DefaultsToDisabled(t *testing.T) {
	// 不呼叫 SetPhotosEnabled——驗證套件層級的預設值。
	doer := &fakeSyncDoer{photoRefs: []string{"places/x/photos/ref0"}}
	client := NewWithGateway("test-key", doer)

	_, err := client.downloadPhotoBytes(context.Background(), "places/x/photos/ref0", 400, false)
	if err != ErrPhotosDisabled {
		t.Errorf("預設狀態下 downloadPhotoBytes 應該回傳 ErrPhotosDisabled,got %v", err)
	}
	if len(doer.photoCalls) != 0 {
		t.Errorf("photosEnabled 預設關閉時不該發出任何請求,實際呼叫了 %v", doer.photoCalls)
	}
}

func TestPhotosEnabled_TrueAllowsDownload(t *testing.T) {
	SetPhotosEnabled(true)
	defer SetPhotosEnabled(false)

	doer := &fakeSyncDoer{photoRefs: []string{"places/x/photos/ref0"}}
	client := NewWithGateway("test-key", doer)

	dataURI, err := client.downloadPhotoBytes(context.Background(), "places/x/photos/ref0", 400, false)
	if err != nil {
		t.Fatalf("開啟後應該能正常下載,got err: %v", err)
	}
	if dataURI == "" {
		t.Error("開啟後下載結果不該是空字串")
	}
	if len(doer.photoCalls) != 1 {
		t.Errorf("開啟後應該發出 1 次下載請求,實際 %v", doer.photoCalls)
	}
}

func stringSlicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
