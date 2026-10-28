package api

// maintenance_partner_grant_test.go 測 POST /internal/maintenance/partners:
// email 必填、name 選填(沒給用 email)、已是業主回 409、查無使用者回 404。

import "testing"

func TestPartnerGrant(t *testing.T) {
	f := newGeoSettingsFixture(t)
	if _, err := f.server.store.CreatePasswordUser("usr_pg_1", "甲", "#8C7B6A", "a@example.com", "hash"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.server.store.CreatePasswordUser("usr_pg_2", "乙", "#8C7B6A", "b@example.com", "hash"); err != nil {
		t.Fatal(err)
	}
	do := func(body string) (int, map[string]any) {
		return f.do(t, "POST", "/internal/maintenance/partners", f.userToken, body)
	}

	// 沒給 name:用 email 當顯示名稱
	code, res := do(`{"email":"a@example.com"}`)
	if code != 201 || res["name"] != "a@example.com" || res["userID"] != "usr_pg_1" {
		t.Fatalf("不給 name: %d %v", code, res)
	}
	// 有給 name:用給的
	code, res = do(`{"email":"b@example.com","name":"乙公司"}`)
	if code != 201 || res["name"] != "乙公司" {
		t.Fatalf("給 name: %d %v", code, res)
	}
	// 重複開通
	if code, _ = do(`{"email":"a@example.com"}`); code != 409 {
		t.Fatalf("重複開通 = %d,應為 409", code)
	}
	// 查無使用者
	if code, _ = do(`{"email":"nobody@example.com"}`); code != 404 {
		t.Fatalf("查無使用者 = %d,應為 404", code)
	}
	// email 必填
	if code, _ = do(`{"name":"x"}`); code != 400 {
		t.Fatalf("缺 email = %d,應為 400", code)
	}
}
