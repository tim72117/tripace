package store

import (
	"sort"
	"testing"
	"time"
)

// TestFilterPhotoIDsReferencedByPublishedContent 驗證 2026-10 code
// review 修正的核心邏輯(見該方法與 handlePublicBlogPhotosByIDs 的完整
// 說明):只有「目前至少被一篇 status='published' 文章引用」的 photoId
// 才會通過篩選,草稿文章引用的、或完全沒被任何文章引用過的 photoId
// 都要被濾掉——這是防止任何人只要知道一個 photoId 就能枚舉其他使用者
// 草稿配圖的授權檢查,不能遺漏任何一種情況。
func TestFilterPhotoIDsReferencedByPublishedContent(t *testing.T) {
	s := newTestStore(t)

	// 已發布文章,引用 upf_published1。
	if _, err := s.CreateContentPage("usr_a", "published-article",
		`{"title":"t","blocks":[{"id":"p1","kind":"image","photoId":"upf_published1"}]}`, "usr_a"); err != nil {
		t.Fatalf("CreateContentPage(published-article): %v", err)
	}
	if err := s.SetContentPageStatus("usr_a", "published-article", "published"); err != nil {
		t.Fatalf("SetContentPageStatus(published-article): %v", err)
	}

	// 草稿文章,引用 upf_draftonly——不應該通過篩選。
	if _, err := s.CreateContentPage("usr_a", "draft-article",
		`{"title":"t","blocks":[{"id":"p1","kind":"image","photoId":"upf_draftonly"}]}`, "usr_a"); err != nil {
		t.Fatalf("CreateContentPage(draft-article): %v", err)
	}
	// 刻意不呼叫 SetContentPageStatus,維持預設的 "draft"。

	// upf_neverused:完全沒有被任何文章引用過。

	got, err := s.FilterPhotoIDsReferencedByPublishedContent([]string{
		"upf_published1", "upf_draftonly", "upf_neverused",
	})
	if err != nil {
		t.Fatalf("FilterPhotoIDsReferencedByPublishedContent: %v", err)
	}
	sort.Strings(got)
	want := []string{"upf_published1"}
	if len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("got = %v, want = %v（草稿/從未引用過的 photoId 不應該通過篩選）", got, want)
	}
}

// TestFilterPhotoIDsReferencedByPublishedContentEmptyInput 驗證空輸入
// 直接回傳空結果,不觸發查詢(對齊 ListUploadedPhotosByIDs 對空輸入的
// 既有處理慣例)。
func TestFilterPhotoIDsReferencedByPublishedContentEmptyInput(t *testing.T) {
	s := newTestStore(t)

	got, err := s.FilterPhotoIDsReferencedByPublishedContent(nil)
	if err != nil {
		t.Fatalf("FilterPhotoIDsReferencedByPublishedContent(nil): %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got = %v, want 空結果", got)
	}
}

// TestFilterPhotoIDsReferencedByPublishedContentUnpublishedLater 驗證
// 文章被取消發布(unpublish)後,原本引用的 photoId 不再通過篩選——
// 授權檢查要反映文章「目前」的發布狀態,不是曾經發布過就永久放行。
func TestFilterPhotoIDsReferencedByPublishedContentUnpublishedLater(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.CreateContentPage("usr_a", "toggle-article",
		`{"title":"t","blocks":[{"id":"p1","kind":"image","photoId":"upf_toggle"}]}`, "usr_a"); err != nil {
		t.Fatalf("CreateContentPage: %v", err)
	}
	if err := s.SetContentPageStatus("usr_a", "toggle-article", "published"); err != nil {
		t.Fatalf("SetContentPageStatus(published): %v", err)
	}

	got, err := s.FilterPhotoIDsReferencedByPublishedContent([]string{"upf_toggle"})
	if err != nil {
		t.Fatalf("FilterPhotoIDsReferencedByPublishedContent: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("發布中應該通過篩選: got = %v", got)
	}

	if err := s.SetContentPageStatus("usr_a", "toggle-article", "draft"); err != nil {
		t.Fatalf("SetContentPageStatus(draft): %v", err)
	}

	got, err = s.FilterPhotoIDsReferencedByPublishedContent([]string{"upf_toggle"})
	if err != nil {
		t.Fatalf("FilterPhotoIDsReferencedByPublishedContent: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("取消發布後不應該通過篩選: got = %v", got)
	}
}

// TestSetContentPageStatus_PublishedAt 驗證 published_at 規則:第一次發布
// 才設值,重複發布不更新,改回草稿不清除。
func TestSetContentPageStatus_PublishedAt(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.CreateContentPage("usr_a", "p", `{"title":"t"}`, "usr_a"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetContentPageBySlug("usr_a", "p")
	if got.PublishedAt != nil {
		t.Fatalf("草稿 published_at 應為 nil,got %v", got.PublishedAt)
	}
	if !got.EffectivePublishedAt().Equal(got.CreatedAt) {
		t.Fatalf("未發布時應退回 CreatedAt")
	}

	if err := s.SetContentPageStatus("usr_a", "p", "published"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetContentPageBySlug("usr_a", "p")
	if got.PublishedAt == nil {
		t.Fatal("發布後 published_at 應有值")
	}
	first := *got.PublishedAt

	// 先把時間改成過去的固定值,再重複發布,應維持不變。
	past := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	s.SetContentPagePublishedAtForTest("usr_a", "p", &past)
	if err := s.SetContentPageStatus("usr_a", "p", "published"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetContentPageBySlug("usr_a", "p")
	if got.PublishedAt == nil || !got.PublishedAt.Equal(past) {
		t.Fatalf("重複發布不該更新 published_at,got %v want %v (first=%v)", got.PublishedAt, past, first)
	}

	// 改回草稿不清除。
	if err := s.SetContentPageStatus("usr_a", "p", "draft"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetContentPageBySlug("usr_a", "p")
	if got.PublishedAt == nil || !got.PublishedAt.Equal(past) {
		t.Fatalf("改回草稿不該清除 published_at,got %v", got.PublishedAt)
	}
}

// TestListPublishedBlogContentPages 驗證首頁查詢:只含已發布、owner 有
// profile 的文章,依發布時間新到舊,舊資料(null)以 created_at 排序,
// 並套用 limit。
func TestListPublishedBlogContentPages(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.CreateBlogProfile("usr_a", "alice", ""); err != nil {
		t.Fatal(err)
	}
	mk := func(owner, slug string, publish bool) {
		t.Helper()
		if _, err := s.CreateContentPage(owner, slug, `{"title":"t"}`, owner); err != nil {
			t.Fatal(err)
		}
		if publish {
			if err := s.SetContentPageStatus(owner, slug, "published"); err != nil {
				t.Fatal(err)
			}
		}
	}
	mk("usr_a", "old", true)
	mk("usr_a", "new", true)
	mk("usr_a", "draft", false)
	mk("usr_noprofile", "orphan", true) // 沒有 profile 的 owner 不出現
	mk("", "city", true)                // 系統帳號的城市介紹頁不出現

	t1 := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	s.SetContentPagePublishedAtForTest("usr_a", "old", &t1)
	s.SetContentPagePublishedAtForTest("usr_a", "new", &t2)

	got, err := s.ListPublishedBlogContentPages(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Slug != "new" || got[1].Slug != "old" {
		t.Fatalf("應為 [new old],got %+v", got)
	}
	got, _ = s.ListPublishedBlogContentPages(1)
	if len(got) != 1 || got[0].Slug != "new" {
		t.Fatalf("limit=1 應只回 new,got %+v", got)
	}

	// 舊資料:published_at 為 null,以 created_at(剛建立,比 2025 新)排序。
	s.SetContentPagePublishedAtForTest("usr_a", "old", nil)
	got, _ = s.ListPublishedBlogContentPages(10)
	if got[0].Slug != "old" {
		t.Fatalf("null 退回 created_at(較新)後 old 應排第一,got %+v", got)
	}
}
