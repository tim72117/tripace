package api

// geo_place_photos_progress_test.go 測 shouldAddGooglePlacePhoto/
// resetPhotoProgressOnTargetChange——handleGeoPlaceDetails 一般模式用
// 「點擊次數的漸進補圖」機制決定要不要對某個地點多下載一張 Google
// 照片(見兩支函式的完整說明)。這兩支都是不涉及資料庫/隨機數的純函式,
// 故直接餵固定輸入斷言輸出,不需要 fake gateway/store。
import "testing"

func TestShouldAddGooglePlacePhoto(t *testing.T) {
	// 模擬從 clickCount=1 開始累積、googlePhotoTargetCount=5 的完整
	// 觸發序列——對照規格模擬:第 1、4、9 次點擊各觸發一次(依序補到
	// newPhotoCount=1、2、3),其餘次數不觸發。
	cases := []struct {
		clickCount     int64
		newPhotoCount  int
		targetCount    int
		wantShouldAdd  bool
	}{
		{clickCount: 1, newPhotoCount: 0, targetCount: 5, wantShouldAdd: true},  // (0+1)^2=1，1%1=0
		{clickCount: 2, newPhotoCount: 1, targetCount: 5, wantShouldAdd: false}, // (1+1)^2=4，2%4=2
		{clickCount: 3, newPhotoCount: 1, targetCount: 5, wantShouldAdd: false}, // 3%4=3
		{clickCount: 4, newPhotoCount: 1, targetCount: 5, wantShouldAdd: true},  // 4%4=0
		{clickCount: 5, newPhotoCount: 2, targetCount: 5, wantShouldAdd: false}, // (2+1)^2=9，5%9=5
		{clickCount: 8, newPhotoCount: 2, targetCount: 5, wantShouldAdd: false}, // 8%9=8
		{clickCount: 9, newPhotoCount: 2, targetCount: 5, wantShouldAdd: true},  // 9%9=0
	}
	for _, c := range cases {
		got := shouldAddGooglePlacePhoto(c.clickCount, c.newPhotoCount, c.targetCount)
		if got != c.wantShouldAdd {
			t.Errorf("shouldAddGooglePlacePhoto(click=%d, new=%d, target=%d) = %v, want %v",
				c.clickCount, c.newPhotoCount, c.targetCount, got, c.wantShouldAdd)
		}
	}
}

// TestShouldAddGooglePlacePhoto_ZeroPhotosAlwaysTriggers 驗證 0 張照片
// 時分母是 1、任何 clickCount 都會觸發(對應規格「完全沒有圖片時 100%
// 機率要取用照片」)。
func TestShouldAddGooglePlacePhoto_ZeroPhotosAlwaysTriggers(t *testing.T) {
	for _, click := range []int64{1, 2, 3, 100, 999} {
		if !shouldAddGooglePlacePhoto(click, 0, 5) {
			t.Errorf("shouldAddGooglePlacePhoto(click=%d, new=0, target=5) = false, want true (0 張應永遠觸發)", click)
		}
	}
}

// TestShouldAddGooglePlacePhoto_StopsAtTarget 驗證 newPhotoCount 追上
// googlePhotoTargetCount 後,即使 clickCount 剛好整除也不再觸發——沒有
// 更多張可補了。
func TestShouldAddGooglePlacePhoto_StopsAtTarget(t *testing.T) {
	// newPhotoCount == targetCount == 3 時,不論 clickCount 為何都不該
	// 觸發,即使 clickCount % (3+1)^2 == 0(例如 clickCount=16)。
	if shouldAddGooglePlacePhoto(16, 3, 3) {
		t.Error("shouldAddGooglePlacePhoto(click=16, new=3, target=3) = true, want false（newPhotoCount 已達 target，不該再觸發）")
	}
	// target=0(這個地點 Google 完全沒有照片)時同理,不論 clickCount
	// 為何都不觸發。
	if shouldAddGooglePlacePhoto(1, 0, 0) {
		t.Error("shouldAddGooglePlacePhoto(click=1, new=0, target=0) = true, want false（target=0 沒有照片可補）")
	}
}

// TestShouldAddGooglePlacePhoto_FullSimulationToClick10 模擬 clickCount
// 從 1 累積到 10、googlePhotoTargetCount=5(不變)的完整觸發序列,逐步
// 更新 newPhotoCount(觸發後 +1),驗證累積終態與觸發次數——對照規格
// 模擬的表格。
func TestShouldAddGooglePlacePhoto_FullSimulationToClick10(t *testing.T) {
	const targetCount = 5
	newPhotoCount := 0
	triggeredAt := make([]int64, 0)

	for click := int64(1); click <= 10; click++ {
		if shouldAddGooglePlacePhoto(click, newPhotoCount, targetCount) {
			triggeredAt = append(triggeredAt, click)
			newPhotoCount++
		}
	}

	wantTriggeredAt := []int64{1, 4, 9}
	if len(triggeredAt) != len(wantTriggeredAt) {
		t.Fatalf("觸發次數 = %v, want %v", triggeredAt, wantTriggeredAt)
	}
	for i, click := range triggeredAt {
		if click != wantTriggeredAt[i] {
			t.Errorf("第 %d 次觸發於 click=%d, want click=%d", i+1, click, wantTriggeredAt[i])
		}
	}
	if newPhotoCount != 3 {
		t.Errorf("累積張數 = %d, want 3", newPhotoCount)
	}
}

// TestShouldAddGooglePlacePhoto_TargetChangeMidwaySimulation 模擬規格
// 討論過的邊界情境:累積到 newPhotoCount=3(googlePhotoTargetCount=5)
// 之後,Google 這次查詢改回 3 張(target 從 5 變 3)——resetPhotoProgressOnTargetChange
// 回報要歸零,newPhotoCount 重置為 0,同一次點擊(click=10)因為歸零後
// 分母變成 1,必定觸發;之後依新 target=3 繼續遞增,直到 newPhotoCount
// 追上 target=3(click=18)後不再觸發。
func TestShouldAddGooglePlacePhoto_TargetChangeMidwaySimulation(t *testing.T) {
	targetCount := 5
	newPhotoCount := 3
	click := int64(9) // 前 9 次點擊已經把 newPhotoCount 累積到 3(見上一個測試)

	// 第 10 次點擊,同時發生 target 從 5 變成 3。
	click++ // click=10
	newTarget := 3
	if resetPhotoProgressOnTargetChange(targetCount, newTarget) {
		newPhotoCount = 0
	}
	targetCount = newTarget

	triggeredAt := make([]int64, 0)
	if shouldAddGooglePlacePhoto(click, newPhotoCount, targetCount) {
		triggeredAt = append(triggeredAt, click)
		newPhotoCount++
	}
	// click=10, newPhotoCount 歸零後為 0,分母 (0+1)^2=1,10%1=0,必定觸發。
	if len(triggeredAt) != 1 || triggeredAt[0] != 10 {
		t.Fatalf("target 變動當次觸發序列 = %v, want [10]", triggeredAt)
	}
	if newPhotoCount != 1 {
		t.Fatalf("target 變動當次觸發後 newPhotoCount = %d, want 1", newPhotoCount)
	}

	// 繼續點擊到 click=18,依規格模擬應在 click=12、18 各觸發一次,
	// newPhotoCount 最終追上 target=3 後停止觸發。
	for ; click < 20; click++ {
		if shouldAddGooglePlacePhoto(click, newPhotoCount, targetCount) {
			triggeredAt = append(triggeredAt, click)
			newPhotoCount++
		}
	}
	wantTriggeredAt := []int64{10, 12, 18}
	if len(triggeredAt) != len(wantTriggeredAt) {
		t.Fatalf("完整觸發序列 = %v, want %v", triggeredAt, wantTriggeredAt)
	}
	for i, c := range triggeredAt {
		if c != wantTriggeredAt[i] {
			t.Errorf("第 %d 次觸發於 click=%d, want click=%d", i+1, c, wantTriggeredAt[i])
		}
	}
	if newPhotoCount != targetCount {
		t.Errorf("最終 newPhotoCount = %d, want 追上 targetCount = %d", newPhotoCount, targetCount)
	}
	// 追上後即使繼續點擊到 click=30,也不該再觸發。
	for ; click <= 30; click++ {
		if shouldAddGooglePlacePhoto(click, newPhotoCount, targetCount) {
			t.Fatalf("newPhotoCount 已追上 targetCount=%d,click=%d 不該再觸發", targetCount, click)
		}
	}
}

// TestShouldAddGooglePlacePhoto_TargetGrowsMidwaySimulation 補上「target
// 放大」的完整觸發序列模擬(TargetChangeMidwaySimulation 只測過縮小的
// 情境)——累積到 newPhotoCount=2(target=3)後,Google 這次改回報 8 張
// (target 從 3 變 8),newPhotoCount 歸零重新累積,驗證放大後的觸發序列
// 同樣遵循 1、4、9、16...這組間隔規則,不會因為「原本已經有進度」而
// 有任何特殊待遇——resetPhotoProgressOnTargetChange 回報要歸零時,不論
// target 是變大或變小,newPhotoCount 一律砍到 0 重新算,這支測試專門
// 驗證放大這個方向沒有被遺漏處理。
func TestShouldAddGooglePlacePhoto_TargetGrowsMidwaySimulation(t *testing.T) {
	targetCount := 3
	newPhotoCount := 2
	click := int64(5) // 假設前 5 次點擊已經把 newPhotoCount 累積到 2

	click++ // click=6，這次 target 從 3 放大到 8
	newTarget := 8
	if !resetPhotoProgressOnTargetChange(targetCount, newTarget) {
		t.Fatal("target 從 3 放大到 8，resetPhotoProgressOnTargetChange 應回傳 true")
	}
	newPhotoCount = 0
	targetCount = newTarget

	triggeredAt := make([]int64, 0)
	for ; click <= 20; click++ {
		if shouldAddGooglePlacePhoto(click, newPhotoCount, targetCount) {
			triggeredAt = append(triggeredAt, click)
			newPhotoCount++
		}
	}
	// 從 click=6 起、newPhotoCount 從 0 重新累積:
	//   newPhotoCount=0 時分母 1，click=6 立即觸發（歸零當次必觸發）
	//   newPhotoCount=1 時分母 4，下個 4 的倍數是 click=8 觸發
	//   newPhotoCount=2 時分母 9，下個 9 的倍數是 click=9 觸發
	//   newPhotoCount=3 時分母 16，下個 16 的倍數是 click=16 觸發
	wantTriggeredAt := []int64{6, 8, 9, 16}
	if len(triggeredAt) != len(wantTriggeredAt) {
		t.Fatalf("target 放大後觸發序列 = %v, want %v", triggeredAt, wantTriggeredAt)
	}
	for i, c := range triggeredAt {
		if c != wantTriggeredAt[i] {
			t.Errorf("第 %d 次觸發於 click=%d, want click=%d", i+1, c, wantTriggeredAt[i])
		}
	}
	if newPhotoCount != 4 {
		t.Errorf("累積張數 = %d, want 4（尚未追上 target=8，屬預期中的漸進進度）", newPhotoCount)
	}
}

// TestShouldAddGooglePlacePhoto_NewPhotoCountExceedsTarget 驗證防禦性
// 邊界:若因競態或髒資料導致 newPhotoCount 大於 googlePhotoTargetCount
// (正常流程不該發生，但資料庫層若曾經寫入錯誤值，這裡不該因此 panic
// 或誤觸發)，函式應比照「已達 target」同樣回傳 false，不觸發。
func TestShouldAddGooglePlacePhoto_NewPhotoCountExceedsTarget(t *testing.T) {
	if shouldAddGooglePlacePhoto(1, 5, 3) {
		t.Error("newPhotoCount(5) > targetCount(3) 時不該觸發（防禦性邊界，理論上不該發生但不該誤觸發）")
	}
}

// TestShouldAddGooglePlacePhoto_NegativeNewPhotoCount 驗證另一側的髒
// 資料防禦:newPhotoCount 為負數時,newPhotoCount+1 可能算出 0,若沒有
// 提前擋下會讓 n*n 當除數觸發 integer divide by zero panic。函式應
// 直接回傳 false,不崩潰。
func TestShouldAddGooglePlacePhoto_NegativeNewPhotoCount(t *testing.T) {
	if shouldAddGooglePlacePhoto(1, -1, 5) {
		t.Error("newPhotoCount=-1 時應回傳 false（防禦性邊界，避免 n=0 除以零 panic）")
	}
	if shouldAddGooglePlacePhoto(100, -5, 5) {
		t.Error("newPhotoCount=-5 時應回傳 false（防禦性邊界）")
	}
}

func TestResetPhotoProgressOnTargetChange(t *testing.T) {
	if resetPhotoProgressOnTargetChange(5, 5) {
		t.Error("target 未變動時不該要求歸零")
	}
	if !resetPhotoProgressOnTargetChange(5, 3) {
		t.Error("target 縮小時應該要求歸零")
	}
	if !resetPhotoProgressOnTargetChange(3, 5) {
		t.Error("target 放大時應該要求歸零")
	}
	if !resetPhotoProgressOnTargetChange(0, 5) {
		t.Error("target 從 0 變為非 0 時應該要求歸零")
	}
	if !resetPhotoProgressOnTargetChange(5, 0) {
		t.Error("target 從非 0 變為 0 時應該要求歸零（例如 Google 把這個地點的照片全數下架）")
	}
}
