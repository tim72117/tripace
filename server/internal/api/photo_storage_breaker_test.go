package api

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/photostorage"
	"github.com/tim72117/tripace/internal/storagehealth"
)

// photo_storage_breaker_test.go 測 GCS 斷路器接在背景補圖上的行為:
// 儲存服務壞掉時,補圖在花錢(Google places.get / photoMedia)之前就被跳過。

// runFill 觸發一次背景補圖並等它結束(photoFillInFlight 的標記被清掉)。
func runFill(t *testing.T, s *Server, placeID string) {
	t.Helper()
	s.backgroundFillPlacePhoto(placeID, "/test", 0, nil)
	key := fmt.Sprintf("%s#%d", placeID, 0)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, busy := s.photoFillInFlight.Load(key); !busy {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("等待背景補圖結束逾時")
}

func newBreakerFixture(t *testing.T) (*placeDetailsFixture, *fakePlaceDetailsGateway, *photostorage.MemoryObjectStore) {
	t.Helper()
	gw := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("測試地點", 1)}
	f := newPlaceDetailsFixture(t, gw)
	mem := photostorage.NewMemoryObjectStore()
	up := photostorage.NewForTest("test-bucket", mem)
	f.server.photoUploader = up
	f.server.photoStorageBreaker = storagehealth.New(up.Probe)
	return f, gw, mem
}

// 探測就失敗(GCS 壞了):補圖完全不打 Google,也不寫 photo_assets。
func TestBackgroundFill_BreakerOpenSkipsPaidCalls(t *testing.T) {
	f, gw, mem := newBreakerFixture(t)
	mem.WriteErr = errors.New("403 accountDisabled")

	runFill(t, f.server, "place_breaker_open")

	if len(gw.calls) != 0 {
		t.Fatalf("GCS 異常時不該打任何 Google API,實際 %d 次: %v", len(gw.calls), gw.calls)
	}
	if _, ok, _ := f.server.store.GetPhotoAsset("place_breaker_open", 0, "full"); ok {
		t.Fatal("不該寫入 photo_assets")
	}
	if st := f.server.photoStorageBreaker.Status(); st.State != storagehealth.Open {
		t.Fatalf("state = %s,預期 open", st.State)
	}
}

// GCS 正常:照常補圖,斷路器維持 closed。
func TestBackgroundFill_BreakerClosedFillsNormally(t *testing.T) {
	f, gw, _ := newBreakerFixture(t)

	runFill(t, f.server, "place_breaker_ok")

	if len(gw.calls) != 2 {
		t.Fatalf("應打 places.get 與 places.photoMedia 各一次,實際 %v", gw.calls)
	}
	if _, ok, _ := f.server.store.GetPhotoAsset("place_breaker_ok", 0, "full"); !ok {
		t.Fatal("應寫入 photo_assets")
	}
	if st := f.server.photoStorageBreaker.Status(); st.State != storagehealth.Closed {
		t.Fatalf("state = %s,預期 closed", st.State)
	}
}

// 探測通過之後 GCS 才壞:連續兩次真實上傳失敗(各自白付一次 Google)就跳閘,
// 第三次起不再花錢。
func TestBackgroundFill_RealUploadFailuresTripBreaker(t *testing.T) {
	f, gw, mem := newBreakerFixture(t)

	runFill(t, f.server, "place_trip_0") // 探測成功 → closed,補圖成功
	if st := f.server.photoStorageBreaker.Status(); st.State != storagehealth.Closed {
		t.Fatalf("前置:state = %s", st.State)
	}

	mem.WriteErr = errors.New("403 accountDisabled")
	before := len(gw.calls)
	runFill(t, f.server, "place_trip_1")
	runFill(t, f.server, "place_trip_2")
	if got := len(gw.calls) - before; got != 4 {
		t.Fatalf("跳閘前兩次失敗各打 get+photoMedia,共 4 次,實際 %d", got)
	}
	if st := f.server.photoStorageBreaker.Status(); st.State != storagehealth.Open {
		t.Fatalf("連續兩次儲存失敗應跳閘,state = %s", st.State)
	}

	before = len(gw.calls)
	runFill(t, f.server, "place_trip_3")
	if got := len(gw.calls) - before; got != 0 {
		t.Fatalf("跳閘後不該再打 Google,實際 %d 次", got)
	}
}

// 單張圖片的問題(不是 GCS 壞掉)不計入斷路器——這裡用壞掉的 Google 回應
// 無法觸發格式錯誤,所以直接驗證分類函式與 Failure 的接線:非儲存錯誤不會
// 呼叫 Failure(見 photostorage.TestIsStorageFailure...)。這個測試守住
// 「closed 時 Success 路徑不改變狀態」。
func TestBackgroundFill_SuccessKeepsBreakerClosed(t *testing.T) {
	f, _, _ := newBreakerFixture(t)
	for i := 0; i < 3; i++ {
		runFill(t, f.server, fmt.Sprintf("place_ok_%d", i))
	}
	if st := f.server.photoStorageBreaker.Status(); st.State != storagehealth.Closed || st.Skipped != 0 {
		t.Fatalf("status = %+v", st)
	}
}
