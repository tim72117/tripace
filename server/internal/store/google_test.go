package store

import "testing"

// TestFindUserByGoogleSub_NotFound 驗證找不到對應使用者時回傳 ErrNotFound,
// 呼叫端(handleGoogleAuth)據此判斷要不要進一步嘗試依 email 合併/建立新帳號。
func TestFindUserByGoogleSub_NotFound(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.FindUserByGoogleSub("sub-does-not-exist"); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

// TestCreateGoogleUser_ThenFindByGoogleSub 驗證建立 Google 使用者後,可以
// 依 sub 查回同一筆使用者,且 email 正確落地存進資料庫(密碼仍是 NULL,
// 比照 Apple 使用者的 password_hash 為 NULL)。
//
// 2026-10 修正:原本這裡斷言「google-only 使用者應該沒有 email」——這其實
// 是在斷言一個 bug(CreateGoogleUser 當時完全沒有寫入 email 參數,見該函式
// 的完整說明),不是刻意的設計。修好 bug 後反過來驗證 email 真的有存進去。
func TestCreateGoogleUser_ThenFindByGoogleSub(t *testing.T) {
	s := newTestStore(t)

	created, err := s.CreateGoogleUser("usr_g1", "Google 使用者", "#8C7B6A", "google-sub-1", "g1@example.com")
	if err != nil {
		t.Fatalf("create google user: %v", err)
	}
	if created.ID != "usr_g1" || created.Name != "Google 使用者" {
		t.Fatalf("unexpected created user: %+v", created)
	}

	found, err := s.FindUserByGoogleSub("google-sub-1")
	if err != nil {
		t.Fatalf("find by google sub: %v", err)
	}
	if found.ID != created.ID {
		t.Fatalf("want %q, got %q", created.ID, found.ID)
	}

	email, err := s.GetUserEmail(found.ID)
	if err != nil {
		t.Fatalf("get user email: %v", err)
	}
	if email != "g1@example.com" {
		t.Fatalf("want email g1@example.com, got %q", email)
	}
}

// TestCreateGoogleUser_EmptyEmail 驗證 email 傳空字串時(例如身分驗證沒拿到
// email 的邊界情況)不會把空字串當成「有效 email」寫入——strPtr("") 回傳
// nil,行為等同完全沒傳 email,GetUserEmail 應回傳空字串而非真的存了一個
// 空字串進資料庫。
func TestCreateGoogleUser_EmptyEmail(t *testing.T) {
	s := newTestStore(t)

	created, err := s.CreateGoogleUser("usr_g2", "Google 使用者", "#8C7B6A", "google-sub-2", "")
	if err != nil {
		t.Fatalf("create google user: %v", err)
	}

	email, err := s.GetUserEmail(created.ID)
	if err != nil {
		t.Fatalf("get user email: %v", err)
	}
	if email != "" {
		t.Fatalf("want empty email, got %q", email)
	}
}

// TestBackfillUserEmailIfMissing_FillsWhenNull 驗證既有使用者 email 為 NULL
// 時,補齊邏輯會把傳入的 email 寫進去——對應既有使用者(建檔於修這個 bug
// 之前)重新登入時自然修復資料的情境,見 BackfillUserEmailIfMissing 的
// 完整說明。
func TestBackfillUserEmailIfMissing_FillsWhenNull(t *testing.T) {
	s := newTestStore(t)
	created, err := s.CreateGoogleUser("usr_g3", "Google 使用者", "#8C7B6A", "google-sub-3", "")
	if err != nil {
		t.Fatalf("create google user: %v", err)
	}

	if err := s.BackfillUserEmailIfMissing(created.ID, "g3@example.com"); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	email, err := s.GetUserEmail(created.ID)
	if err != nil {
		t.Fatalf("get user email: %v", err)
	}
	if email != "g3@example.com" {
		t.Fatalf("want email g3@example.com, got %q", email)
	}
}

// TestBackfillUserEmailIfMissing_DoesNotOverwriteExisting 驗證 email 已經有
// 值時,不會被後續呼叫覆寫——避免意外蓋掉使用者透過其他管道(例如帳密註冊
// 合併帳號)已經設定好的正確 email。
func TestBackfillUserEmailIfMissing_DoesNotOverwriteExisting(t *testing.T) {
	s := newTestStore(t)
	created, err := s.CreateGoogleUser("usr_g4", "Google 使用者", "#8C7B6A", "google-sub-4", "original@example.com")
	if err != nil {
		t.Fatalf("create google user: %v", err)
	}

	if err := s.BackfillUserEmailIfMissing(created.ID, "different@example.com"); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	email, err := s.GetUserEmail(created.ID)
	if err != nil {
		t.Fatalf("get user email: %v", err)
	}
	if email != "original@example.com" {
		t.Fatalf("want original email preserved, got %q", email)
	}
}

// TestBackfillUserEmailIfMissing_NoopWhenEmailEmpty 驗證傳入空字串時是
// no-op,不會把既有 NULL 覆寫成空字串(這樣之後再有真正的 email 時,
// `email IS NULL` 條件才還能命中、繼續嘗試補齊)。
func TestBackfillUserEmailIfMissing_NoopWhenEmailEmpty(t *testing.T) {
	s := newTestStore(t)
	created, err := s.CreateGoogleUser("usr_g5", "Google 使用者", "#8C7B6A", "google-sub-5", "")
	if err != nil {
		t.Fatalf("create google user: %v", err)
	}

	if err := s.BackfillUserEmailIfMissing(created.ID, ""); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	// 仍應是 NULL(no-op),之後呼叫端拿到真正的 email 時還能命中
	// `email IS NULL` 條件補齊。
	if err := s.BackfillUserEmailIfMissing(created.ID, "later@example.com"); err != nil {
		t.Fatalf("backfill after noop: %v", err)
	}
	email, err := s.GetUserEmail(created.ID)
	if err != nil {
		t.Fatalf("get user email: %v", err)
	}
	if email != "later@example.com" {
		t.Fatalf("want email later@example.com, got %q", email)
	}
}

// TestLinkGoogleSubByEmail_ExistingPasswordUser 驗證「Google 登入時 email
// 已存在於既有帳密使用者」的情境:應該把 google_sub 補到既有帳號,而不是
// 建立新帳號——之後不論用帳密或 Google 登入,都應該落到同一個使用者 ID。
func TestLinkGoogleSubByEmail_ExistingPasswordUser(t *testing.T) {
	s := newTestStore(t)

	pw, err := s.CreatePasswordUser("usr_p1", "小明", "#8C7B6A", "ming@example.com", "hashed")
	if err != nil {
		t.Fatalf("create password user: %v", err)
	}

	linked, err := s.LinkGoogleSubByEmail("ming@example.com", "google-sub-ming")
	if err != nil {
		t.Fatalf("link google sub by email: %v", err)
	}
	if linked.ID != pw.ID {
		t.Fatalf("linking should reuse existing user id %q, got %q", pw.ID, linked.ID)
	}

	found, err := s.FindUserByGoogleSub("google-sub-ming")
	if err != nil {
		t.Fatalf("find by google sub after link: %v", err)
	}
	if found.ID != pw.ID {
		t.Fatalf("want %q, got %q", pw.ID, found.ID)
	}

	// email/password 仍應可正常查得到(合併不破壞既有登入方式)。
	_, hash, err := s.FindUserByEmail("ming@example.com")
	if err != nil {
		t.Fatalf("find by email after link: %v", err)
	}
	if hash != "hashed" {
		t.Fatalf("existing password hash should be preserved, got %q", hash)
	}
}

// TestLinkGoogleSubByEmail_NoSuchEmail 驗證 email 不存在既有帳號時回傳
// ErrNotFound,呼叫端據此改建立新使用者(見 handleGoogleAuth)。
func TestLinkGoogleSubByEmail_NoSuchEmail(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.LinkGoogleSubByEmail("nobody@example.com", "google-sub-x"); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}
