package store

// blog_profiles_race_test.go 驗證 CreateBlogProfile/UpdateBlogProfile
// 在併發情境下的 ErrAlreadyExists 轉換——理由同
// content_pages_race_test.go 的完整說明,這裡針對 blog_profiles.go
// 的兩個寫入方法分別驗證。
import (
	"errors"
	"sync"
	"testing"
)

// TestCreateBlogProfile_併發建立相同Handle只有一個成功 併發啟動多個
// goroutine,各自用不同 userID 但相同的 handle 呼叫 CreateBlogProfile
// ——預期剛好一個成功,其餘全部回傳 ErrAlreadyExists。
func TestCreateBlogProfile_併發建立相同Handle只有一個成功(t *testing.T) {
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
			userID := newBlogProfileID() // 借用這個 ID 產生器產生互不相同的假 userID,足夠測試使用
			_, err := s.CreateBlogProfile(userID, "race-handle", "https://example.com/a.png")
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
		t.Fatalf("併發建立同一個 handle 應剛好有 1 次成功,got %d", successCount)
	}
}

// TestUpdateBlogProfile_併發改成相同Handle只有一個成功 先建立兩個各自
// 獨立的 profile,接著併發讓兩者都想把 handle 改成同一個值——預期剛好
// 一個成功,另一個回傳 ErrAlreadyExists(驗證 UpdateBlogProfile 的
// 「先查後改」同樣有 race-safe 的最終寫入保護)。
func TestUpdateBlogProfile_併發改成相同Handle只有一個成功(t *testing.T) {
	s := OpenTest(t)

	if _, err := s.CreateBlogProfile("usr_a", "handle-a", ""); err != nil {
		t.Fatalf("CreateBlogProfile usr_a: %v", err)
	}
	if _, err := s.CreateBlogProfile("usr_b", "handle-b", ""); err != nil {
		t.Fatalf("CreateBlogProfile usr_b: %v", err)
	}

	var wg sync.WaitGroup
	var errA, errB error
	start := make(chan struct{})
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		errA = s.UpdateBlogProfile("usr_a", "shared-handle", "")
	}()
	go func() {
		defer wg.Done()
		<-start
		errB = s.UpdateBlogProfile("usr_b", "shared-handle", "")
	}()
	close(start)
	wg.Wait()

	successCount := 0
	for _, err := range []error{errA, errB} {
		if err == nil {
			successCount++
			continue
		}
		if !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("非成功的呼叫應回傳 ErrAlreadyExists,got %v", err)
		}
	}
	if successCount != 1 {
		t.Fatalf("併發改成同一個 handle 應剛好有 1 次成功,got %d", successCount)
	}
}
