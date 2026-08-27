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
// 依 sub 查回同一筆使用者,且沒有 email/password(比照 Apple 使用者的
// password_hash 為 NULL)。
func TestCreateGoogleUser_ThenFindByGoogleSub(t *testing.T) {
	s := newTestStore(t)

	created, err := s.CreateGoogleUser("usr_g1", "Google 使用者", "#8C7B6A", "google-sub-1")
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
	if email != "" {
		t.Fatalf("google-only user should have no email on file, got %q", email)
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
