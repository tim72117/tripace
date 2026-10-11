package store

// content_pages_race_test.go 驗證 CreateContentPage 在併發情境下的
// ErrAlreadyExists 轉換(見該方法「最終寫入失敗」那段的完整說明:
// 「先查後建」本身無法防止兩個併發請求都通過檢查、其中一個最終撞上
// 資料庫唯一索引的情境,這裡要驗證那次撞上的失敗,確實會被轉換成
// ErrAlreadyExists,而不是把 driver 原始錯誤原封不動往外傳)。
import (
	"errors"
	"sync"
	"testing"
)

// TestCreateContentPage_併發建立相同OwnerSlug只有一個成功 併發啟動多個
// goroutine,對同一組 (ownerID, slug) 呼叫 CreateContentPage——預期
// 剛好一個成功,其餘全部回傳 ErrAlreadyExists(不是通用的 500 等級
// 錯誤),驗證 isUniqueConstraintViolation 轉換邏輯在真正的併發壓力下
// 也能正確運作。
func TestCreateContentPage_併發建立相同OwnerSlug只有一個成功(t *testing.T) {
	s := OpenTest(t)

	const n = 20
	var wg sync.WaitGroup
	results := make([]error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, err := s.CreateContentPage("usr_owner", "race-slug", "content", "usr_owner")
			results[i] = err
		}(i)
	}
	close(start)
	wg.Wait()

	successCount := 0
	for _, err := range results {
		if err == nil {
			successCount++
			continue
		}
		if !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("非成功的呼叫應回傳 ErrAlreadyExists,got %v", err)
		}
	}
	if successCount != 1 {
		t.Fatalf("併發建立同一組 (ownerID, slug) 應剛好有 1 次成功,got %d", successCount)
	}

	// 最終資料庫裡也應該真的只有一筆記錄,沒有因為競態寫入重複資料。
	page, err := s.GetContentPageBySlug("usr_owner", "race-slug")
	if err != nil {
		t.Fatalf("GetContentPageBySlug: %v", err)
	}
	if page.Slug != "race-slug" {
		t.Fatalf("意外的記錄: %+v", page)
	}
}
