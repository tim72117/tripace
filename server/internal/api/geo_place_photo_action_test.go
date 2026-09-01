package api

// geo_place_photo_action_test.go 測 decidePlacePhotoAction——把既有兩支
// 已驗證過的純函式(shouldAddGooglePlacePhoto、resetPhotoProgressOnTargetChange，
// 見 geo_place_photos_progress_test.go)串成一支合併後的決策函式，供
// handleGeoPlaceDetails 一般模式（快取命中/未命中皆同一套邏輯）在單一
// 呼叫點決定：這次要不要重置進度、要不要觸發補圖、若觸發要補哪個
// photo_index。
//
// decidePlacePhotoAction 本身不查資料庫、不打外部 API，純粹是決策邏輯，
// 天生具備確定性，方便單點測試整個決策流程。
import "testing"

func TestDecidePlacePhotoAction_TargetUnchangedNoReset(t *testing.T) {
	// target 沒變動:不 reset，直接沿用既有 newPhotoCount 判斷是否觸發。
	// clickCount=4, newPhotoCount=1, target=5 → shouldAddGooglePlacePhoto
	// 已驗證過 (1+1)^2=4, 4%4=0 → 觸發，補 index=1(即目前 newPhotoCount)。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(4, 1, 5, 5)

	if didReset {
		t.Error("target 未變動(5→5)不該 reset")
	}
	if effectiveNewPhotoCount != 1 {
		t.Errorf("effectiveNewPhotoCount = %d, want 1（未 reset 時應維持原值）", effectiveNewPhotoCount)
	}
	if !shouldFetch {
		t.Error("clickCount=4, newPhotoCount=1 應觸發補圖（4%%4==0）")
	}
	if indexToFetch != 1 {
		t.Errorf("indexToFetch = %d, want 1（補到目前 newPhotoCount 對應的 index）", indexToFetch)
	}
}

func TestDecidePlacePhotoAction_TargetUnchangedNoTrigger(t *testing.T) {
	// target 沒變動、且這次點擊不該觸發:clickCount=2, newPhotoCount=1,
	// target=5 → 2%4=2 ≠ 0，不觸發。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(2, 1, 5, 5)

	if didReset {
		t.Error("target 未變動不該 reset")
	}
	if effectiveNewPhotoCount != 1 {
		t.Errorf("effectiveNewPhotoCount = %d, want 1", effectiveNewPhotoCount)
	}
	if shouldFetch {
		t.Error("clickCount=2, newPhotoCount=1 不該觸發補圖（2%%4==2）")
	}
	if indexToFetch != -1 {
		t.Errorf("indexToFetch = %d, want -1（不觸發時沒有要補的 index）", indexToFetch)
	}
}

func TestDecidePlacePhotoAction_TargetChangedResetsAndForcesTrigger(t *testing.T) {
	// target 從 5 變成 3:reset，newPhotoCount 歸零；歸零後任何 clickCount
	// 對 (0+1)^2=1 取餘必為 0，故這次點擊必定觸發，補 index=0。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(37, 3, 5, 3)

	if !didReset {
		t.Error("target 從 5 變成 3 應該要 reset")
	}
	if effectiveNewPhotoCount != 0 {
		t.Errorf("effectiveNewPhotoCount = %d, want 0（reset 後歸零）", effectiveNewPhotoCount)
	}
	if !shouldFetch {
		t.Error("reset 後 newPhotoCount=0，分母為 1，任何 clickCount 都應觸發")
	}
	if indexToFetch != 0 {
		t.Errorf("indexToFetch = %d, want 0（reset 後從第一張開始補）", indexToFetch)
	}
}

func TestDecidePlacePhotoAction_TargetChangedToZero(t *testing.T) {
	// target 從非 0 變成 0(Google 把這個地點的照片全數下架):reset，
	// 但 shouldAddGooglePlacePhoto 的 newPhotoCount(0) >= target(0)，
	// 不該觸發（沒有照片可補）。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(10, 2, 5, 0)

	if !didReset {
		t.Error("target 從 5 變成 0 應該要 reset")
	}
	if effectiveNewPhotoCount != 0 {
		t.Errorf("effectiveNewPhotoCount = %d, want 0", effectiveNewPhotoCount)
	}
	if shouldFetch {
		t.Error("target=0 時不該觸發（沒有照片可補）")
	}
	if indexToFetch != -1 {
		t.Errorf("indexToFetch = %d, want -1", indexToFetch)
	}
}

func TestDecidePlacePhotoAction_AlreadyAtTargetNoFetch(t *testing.T) {
	// target 未變動、newPhotoCount 已追上 target:即使 clickCount 剛好
	// 整除，也不該觸發（已經補滿）。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(16, 3, 3, 3)

	if didReset {
		t.Error("target 未變動不該 reset")
	}
	if effectiveNewPhotoCount != 3 {
		t.Errorf("effectiveNewPhotoCount = %d, want 3", effectiveNewPhotoCount)
	}
	if shouldFetch {
		t.Error("newPhotoCount(3) 已達 target(3)，不該再觸發")
	}
	if indexToFetch != -1 {
		t.Errorf("indexToFetch = %d, want -1", indexToFetch)
	}
}

func TestDecidePlacePhotoAction_FirstEverQuery(t *testing.T) {
	// 初次查詢這個地點:previousGoogleTarget=0（place_details_cache 尚
	// 不存在，IncrementPlaceClickCount 對「查無資料」回傳的零值，見該
	// 函式的說明），currentGoogleTarget 是這次真正查到的張數（假設 5）。
	// 0→5 視為 target 變動，reset（雖然本來就是 0，reset 後仍是 0，
	// 效果上不影響），接著 clickCount=1 時分母為 1，必定觸發，補
	// index=0——即「初次查詢只下載第一張」，與之後的漸進補圖走同一套
	// 邏輯，不再有「一次下載到 maxPlaceDetailPhotos 上限」的特殊路徑。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(1, 0, 0, 5)

	if !didReset {
		t.Error("previousGoogleTarget=0 → currentGoogleTarget=5 視為變動，應該 reset")
	}
	if effectiveNewPhotoCount != 0 {
		t.Errorf("effectiveNewPhotoCount = %d, want 0", effectiveNewPhotoCount)
	}
	if !shouldFetch {
		t.Error("初次查詢第一次點擊應該觸發（分母為 1）")
	}
	if indexToFetch != 0 {
		t.Errorf("indexToFetch = %d, want 0（初次查詢只下載第一張）", indexToFetch)
	}
}

func TestDecidePlacePhotoAction_FirstEverQueryNoPhotosAvailable(t *testing.T) {
	// 初次查詢，但這個地點 Google 完全沒有照片(currentGoogleTarget=0)：
	// 0→0 不算變動，不 reset；newPhotoCount(0) >= target(0)，不觸發。
	didReset, effectiveNewPhotoCount, shouldFetch, indexToFetch :=
		decidePlacePhotoAction(1, 0, 0, 0)

	if didReset {
		t.Error("0→0 不算變動，不該 reset")
	}
	if effectiveNewPhotoCount != 0 {
		t.Errorf("effectiveNewPhotoCount = %d, want 0", effectiveNewPhotoCount)
	}
	if shouldFetch {
		t.Error("target=0 時不該觸發")
	}
	if indexToFetch != -1 {
		t.Errorf("indexToFetch = %d, want -1", indexToFetch)
	}
}
