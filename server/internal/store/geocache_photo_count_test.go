package store

// geocache_photo_count_test.go 測 place_details_cache.photo_count——記錄
// 「這個地點在 Google 上實際有幾張照片」(2026-10)。
//
// 為什麼需要:補圖判斷(internal/api 的 decidePlacePhotoRefreshIndex)只看
// 「上限範圍內每個索引有沒有新鮮的 photo_assets」,地點實際照片數少於上限
// 時,多出來的索引永遠沒有紀錄、永遠被判成「缺」,每次請求都白打一次
// places.get。記下實際張數,判斷時把上限截到這個數字,就不會再追一個
// 不存在的索引。
//
// NULL 與 0 的語意不同:NULL=還沒查過、不知道;0=查過,確認這個地點沒有照片。
import "testing"

func TestGetPlacePhotoCount_UnknownByDefault(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetCachedPlaceDetails("place-a", "地點", "地址", 1, 2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}

	got, err := s.GetPlacePhotoCount("place-a")
	if err != nil {
		t.Fatalf("GetPlacePhotoCount: %v", err)
	}
	if got != nil {
		t.Fatalf("尚未記錄過張數時應為 nil(不知道),實際 %d", *got)
	}
}

func TestGetPlacePhotoCount_MissingRow_ReturnsNilNoError(t *testing.T) {
	s := OpenTest(t)
	got, err := s.GetPlacePhotoCount("never-seen")
	if err != nil {
		t.Fatalf("查無資料列不該回錯誤: %v", err)
	}
	if got != nil {
		t.Fatalf("查無資料列應為 nil,實際 %d", *got)
	}
}

func TestSetPlacePhotoCount_RoundTrip(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetCachedPlaceDetails("place-a", "地點", "地址", 1, 2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	if err := s.SetPlacePhotoCount("place-a", 3); err != nil {
		t.Fatalf("SetPlacePhotoCount: %v", err)
	}

	got, err := s.GetPlacePhotoCount("place-a")
	if err != nil || got == nil || *got != 3 {
		t.Fatalf("期望讀回 3,實際 got=%v err=%v", got, err)
	}
}

// 0 必須能跟「不知道」區分開——地點真的沒有照片是有效資訊,要記起來,
// 之後才不會每次請求都去問 Google「有沒有照片」。
func TestSetPlacePhotoCount_ZeroIsDistinctFromUnknown(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetCachedPlaceDetails("place-a", "地點", "地址", 1, 2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	if err := s.SetPlacePhotoCount("place-a", 0); err != nil {
		t.Fatalf("SetPlacePhotoCount: %v", err)
	}

	got, err := s.GetPlacePhotoCount("place-a")
	if err != nil {
		t.Fatalf("GetPlacePhotoCount: %v", err)
	}
	if got == nil {
		t.Fatal("寫入 0 之後讀回應為 0,不是 nil(0=確認沒有照片,nil=不知道)")
	}
	if *got != 0 {
		t.Fatalf("期望 0,實際 %d", *got)
	}
}

func TestSetPlacePhotoCount_OverwritesPreviousValue(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetCachedPlaceDetails("place-a", "地點", "地址", 1, 2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	_ = s.SetPlacePhotoCount("place-a", 1)
	if err := s.SetPlacePhotoCount("place-a", 5); err != nil {
		t.Fatalf("SetPlacePhotoCount: %v", err)
	}
	got, _ := s.GetPlacePhotoCount("place-a")
	if got == nil || *got != 5 {
		t.Fatalf("照片後來變多時要能更新成新的張數,期望 5,實際 %v", got)
	}
}

// 資料列不存在時寫入不該報錯、也不該憑空建出一列——跟
// IncrementPlaceClickCount 對不存在的列的處理一致(交由呼叫端走一般
// 查詢流程建列)。
func TestSetPlacePhotoCount_MissingRow_NoErrorNoRowCreated(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetPlacePhotoCount("never-seen", 2); err != nil {
		t.Fatalf("對不存在的列寫入不該報錯: %v", err)
	}
	if _, ok, _ := s.GetCachedPlaceDetails("never-seen", 999999*3600*1e9); ok {
		t.Fatal("不該憑空建出一列快取")
	}
}

// SetCachedPlaceDetails 每次拿到新的 Place Details 都會被呼叫(補圖背景
// 任務、同步查詢、已建檔景點分支每次請求都會呼叫)。它用 OnConflict
// DoUpdates 明確列出要更新的欄位——photo_count 若被誤列進去(或改回整列
// 覆寫),每次請求都會把累積記下的張數洗回 NULL,等於這個機制白做。
// 同一個道理見 TestSetCachedPlaceDetails_RepeatedCallsPreserveClickCount。
func TestSetCachedPlaceDetails_RepeatedCallsPreservePhotoCount(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetCachedPlaceDetails("place-a", "地點", "地址", 1, 2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	if err := s.SetPlacePhotoCount("place-a", 4); err != nil {
		t.Fatalf("SetPlacePhotoCount: %v", err)
	}

	for i := 0; i < 3; i++ {
		if err := s.SetCachedPlaceDetails("place-a", "新名稱", "新地址", 3, 4, 4.5, nil); err != nil {
			t.Fatalf("SetCachedPlaceDetails #%d: %v", i, err)
		}
	}

	got, err := s.GetPlacePhotoCount("place-a")
	if err != nil || got == nil || *got != 4 {
		t.Fatalf("SetCachedPlaceDetails 不該洗掉 photo_count,期望 4,實際 got=%v err=%v", got, err)
	}
}
