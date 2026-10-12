package store

import (
	"sort"
	"testing"
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
