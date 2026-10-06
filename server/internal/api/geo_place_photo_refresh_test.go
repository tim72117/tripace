package api

// geo_place_photo_refresh_test.go 測 photoCapForClickCount/
// decidePlacePhotoRefreshIndex——2026-10 新補圖節奏,取代舊的
// shouldAddGooglePlacePhoto/resetPhotoProgressOnTargetChange/
// decidePlacePhotoAction(見 geo_outline.go 對應函式移除時的完整說明)。
//
// 新節奏由使用者明確指定:
//   - 無圖(clickCount < 10)時,上限是 1 張——「無圖就補第一張」。
//   - clickCount 落在 [10, 100) 時,上限是 2 張。
//   - 之後每多 100 次點擊,上限 +1 張(clickCount=100 時上限 3、
//     clickCount=200 時上限 4,以此類推)。
//   - 每次點擊都重新判斷,但判斷依據是本地 photo_assets 的新鮮度狀態
//     (哪個 index 缺、哪個過期),不重新查詢 Google 實際有幾張照片——
//     掃描 [0, cap) 範圍內第一個「缺或過期」的 index 補/換掉它;若
//     cap 範圍內全部新鮮,這次點擊不做任何事。這同時解決了舊機制
//     「newPhotoCount 追上 target 後,即使照片已經過期也永遠不會重新
//     整新」的問題(見 2026-10 診斷清水寺照片全數過期卻沒有觸發補圖
//     的既有記錄)。
//
// 這兩支都是不涉及資料庫/隨機數的純函式,故直接餵固定輸入斷言輸出,
// 不需要 fake gateway/store——實際查詢 photo_assets 組出 fresh 陣列的
// 職責留給呼叫端(handleGeoPlaceDetails),不在這裡測試。
import "testing"

// TestPhotoCapForClickCount 驗證上限公式的完整分段。
func TestPhotoCapForClickCount(t *testing.T) {
	cases := []struct {
		clickCount int64
		wantCap    int
	}{
		{clickCount: 0, wantCap: 1},
		{clickCount: 1, wantCap: 1},
		{clickCount: 9, wantCap: 1},
		{clickCount: 10, wantCap: 2}, // 邊界:10-100 次中間上限 2 張,從 10 開始算。
		{clickCount: 50, wantCap: 2},
		{clickCount: 99, wantCap: 2},
		{clickCount: 100, wantCap: 3}, // 每多 100 次點擊,上限 +1。
		{clickCount: 150, wantCap: 3},
		{clickCount: 199, wantCap: 3},
		{clickCount: 200, wantCap: 4},
		{clickCount: 350, wantCap: 5},
		{clickCount: 999, wantCap: 11},
		{clickCount: 1000, wantCap: 12},
	}
	for _, c := range cases {
		got := photoCapForClickCount(c.clickCount)
		if got != c.wantCap {
			t.Errorf("photoCapForClickCount(%d) = %d, want %d", c.clickCount, got, c.wantCap)
		}
	}
}

// TestDecidePlacePhotoRefreshIndex_NoPhotoYet 對應規格「無圖就補第一張」
// ——完全沒有任何 fresh 紀錄(fresh 為空切片)時,不論 clickCount 落在
// 哪個階段,都該補 index=0。
func TestDecidePlacePhotoRefreshIndex_NoPhotoYet(t *testing.T) {
	for _, click := range []int64{0, 1, 5, 9} {
		shouldFetch, index := decidePlacePhotoRefreshIndex(click, nil)
		if !shouldFetch || index != 0 {
			t.Errorf("decidePlacePhotoRefreshIndex(%d, nil) = (%v, %d), want (true, 0)", click, shouldFetch, index)
		}
	}
}

// TestDecidePlacePhotoRefreshIndex_FirstPhotoAlreadyFreshBelowCap 驗證
// clickCount<10(cap=1)、第一張已經是新鮮的情況下,不該再觸發——已經
// 補到上限,沒有更多張可補。
func TestDecidePlacePhotoRefreshIndex_FirstPhotoAlreadyFreshBelowCap(t *testing.T) {
	shouldFetch, index := decidePlacePhotoRefreshIndex(5, []bool{true})
	if shouldFetch || index != -1 {
		t.Errorf("decidePlacePhotoRefreshIndex(5, [true]) = (%v, %d), want (false, -1)", shouldFetch, index)
	}
}

// TestDecidePlacePhotoRefreshIndex_CapGrowsOpensNewSlot 驗證 clickCount
// 跨過 10 這個邊界(cap 從 1 變 2)後,即使第一張仍然新鮮,也該補第二張
// (index=1)——cap 變動後多出來的名額要被填滿,不是只在「有東西過期」
// 時才觸發。
func TestDecidePlacePhotoRefreshIndex_CapGrowsOpensNewSlot(t *testing.T) {
	shouldFetch, index := decidePlacePhotoRefreshIndex(10, []bool{true})
	if !shouldFetch || index != 1 {
		t.Errorf("decidePlacePhotoRefreshIndex(10, [true]) = (%v, %d), want (true, 1)", shouldFetch, index)
	}
}

// TestDecidePlacePhotoRefreshIndex_AllFreshWithinCap 驗證 cap 範圍內
// 全部新鮮時,這次點擊不該做任何事——對應規格「再下一次如果沒有增加
// 上限,則不更新圖片」。
func TestDecidePlacePhotoRefreshIndex_AllFreshWithinCap(t *testing.T) {
	// clickCount=50 → cap=2,兩張都新鮮。
	shouldFetch, index := decidePlacePhotoRefreshIndex(50, []bool{true, true})
	if shouldFetch || index != -1 {
		t.Errorf("decidePlacePhotoRefreshIndex(50, [true,true]) = (%v, %d), want (false, -1)", shouldFetch, index)
	}
}

// TestDecidePlacePhotoRefreshIndex_ExpiredPhotosRefreshedOneAtATime 對應
// 使用者明確給的規格情境:上限 3 張,第一、二張過期(第三張仍新鮮)時,
// 每次點擊只換一張、依序換掉過期的——這次點擊換第一張,下次點擊才換
// 第二張,換完後(全部新鮮)下一次不再更新。
func TestDecidePlacePhotoRefreshIndex_ExpiredPhotosRefreshedOneAtATime(t *testing.T) {
	const click = 200 // cap=4,但這裡只關心前 3 個 index 的過期/新鮮狀態。

	// 第一、二張過期,第三張新鮮——這次點擊該換第一張(index=0)。
	shouldFetch, index := decidePlacePhotoRefreshIndex(click, []bool{false, false, true})
	if !shouldFetch || index != 0 {
		t.Fatalf("第一輪 decidePlacePhotoRefreshIndex = (%v, %d), want (true, 0)", shouldFetch, index)
	}

	// 換完第一張後,第二張仍過期——這次該換第二張(index=1)。
	shouldFetch, index = decidePlacePhotoRefreshIndex(click, []bool{true, false, true})
	if !shouldFetch || index != 1 {
		t.Fatalf("第二輪 decidePlacePhotoRefreshIndex = (%v, %d), want (true, 1)", shouldFetch, index)
	}

	// 三張都新鮮、cap 範圍內(cap=4)第四張(index=3)從未存在——該補
	// index=3(cap 範圍內還有名額,不是「沒有東西過期就什麼都不做」,
	// 名額本身也要填滿)。
	shouldFetch, index = decidePlacePhotoRefreshIndex(click, []bool{true, true, true})
	if !shouldFetch || index != 3 {
		t.Fatalf("第三輪 decidePlacePhotoRefreshIndex = (%v, %d), want (true, 3)(cap=4 還有第 4 張名額未填)", shouldFetch, index)
	}

	// 四張都新鮮、cap=4 已滿——這次不該再更新任何圖片。
	shouldFetch, index = decidePlacePhotoRefreshIndex(click, []bool{true, true, true, true})
	if shouldFetch || index != -1 {
		t.Fatalf("第四輪 decidePlacePhotoRefreshIndex = (%v, %d), want (false, -1)(cap 已滿且全新鮮)", shouldFetch, index)
	}
}

// TestDecidePlacePhotoRefreshIndex_MissingTreatedSameAsExpired 驗證
// fresh 切片比 cap 短時,超出切片長度的 index 視同「缺」(未新鮮),跟
// 「存在但過期」走同一套判斷,不需要呼叫端另外分辨兩種狀態。
func TestDecidePlacePhotoRefreshIndex_MissingTreatedSameAsExpired(t *testing.T) {
	// clickCount=10 → cap=2,fresh 只帶了 index0 的狀態(新鮮),index1
	// 完全沒出現在切片裡(從未查過)——視同缺,該補 index=1。
	shouldFetch, index := decidePlacePhotoRefreshIndex(10, []bool{true})
	if !shouldFetch || index != 1 {
		t.Errorf("decidePlacePhotoRefreshIndex(10, [true]) = (%v, %d), want (true, 1)", shouldFetch, index)
	}
}

// TestDecidePlacePhotoRefreshIndex_EmptyFreshAtHighCap 驗證 cap 很大時
// (clickCount 很多次),完全沒有任何 fresh 紀錄仍然只補第一張(index=0)
// ——一次點擊只補一張,不會因為 cap 很大就一次補齊多張。
func TestDecidePlacePhotoRefreshIndex_EmptyFreshAtHighCap(t *testing.T) {
	shouldFetch, index := decidePlacePhotoRefreshIndex(1000, nil)
	if !shouldFetch || index != 0 {
		t.Errorf("decidePlacePhotoRefreshIndex(1000, nil) = (%v, %d), want (true, 0)", shouldFetch, index)
	}
}
