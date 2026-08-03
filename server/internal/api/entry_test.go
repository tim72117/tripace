package api

// entry_test.go 測 entry 的 CRUD 端點,/v1 與 /internal 兩套並行。
//
// 為什麼兩套都測:它們是刻意分開的兩條路徑,信任邊界不同——/v1 給前端(帶
// 使用者身分,走 requireEditor 檢查是不是這個行程的 editor),/internal 給
// CLI 與 LLM 後端(只驗 internalAuth 那把 JWT 的簽章,不做行程成員檢查)。
// 兩邊各有一組 handler,漏測任一邊都可能出現「一邊能用、另一邊壞掉」。
//
// 這裡刻意透過 s.Routes() 打完整的 mux,而不是直接呼叫 handler 函式:
// 路由字串本身就是會出錯的地方(先前有過 CLI 打 /internal/trips/{id}、
// server 端從未註冊過這條路由的情況),繞過 mux 就等於繞過了這個檢查。
// cmd/cli 那側的 http_test.go 斷言 CLI 送出的路徑,這裡斷言 server 認得
// 這些路徑,兩邊夾出這條接縫。
//
// 只寫 happy path。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// testFixture 是一組「已登入使用者 + 他擁有的行程」,供各測試共用。
type testFixture struct {
	srv    *Server
	routes http.Handler
	token  string
	trip   string
}

// newEntryFixture 建立使用者、以他為 owner 開一個行程,並簽一把可用的 token。
//
// 使用者一定要真的寫進資料庫:userFromToken 會拿 claims.Sub 回查資料庫,查無
// 此人一律回退成訪客(見 auth_test.go 的 TestUserFromToken_DeletedUser),
// 那樣 requireEditor 就會擋下來,測試會在 403 而非預期的 200 上失敗。
func newEntryFixture(t *testing.T) *testFixture {
	t.Helper()
	s := newTestServer(t)

	user, err := s.store.CreatePasswordUser("usr_owner", "擁有者", "#8C7B6A", "owner@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	tr, err := s.store.CreateTrip("tr_test", "花蓮三日", user)
	if err != nil {
		t.Fatalf("建立行程: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &testFixture{
		srv: s, routes: s.Routes(),
		token: token, trip: tr.ID,
	}
}

// do 帶著 token 發一個請求,斷言狀態碼符合預期,回傳解析後的 JSON body。
func (f *testFixture) do(t *testing.T, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Authorization", "Bearer "+f.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Fatalf("%s %s → %d，預期 %d（body: %s）", method, path, rec.Code, wantStatus, rec.Body.String())
	}
	if rec.Body.Len() == 0 {
		return nil
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("回應不是合法 JSON object: %v（body: %s）", err, rec.Body.String())
	}
	return got
}

// createEntry 用 /internal 端點建一筆 entry,回傳 entryID。
// 供需要「先有一筆資料」的更新/刪除測試當前置。
func (f *testFixture) createEntry(t *testing.T, title string) string {
	t.Helper()
	got := f.do(t, "POST", "/internal/trips/"+f.trip+"/entries",
		map[string]any{"title": title, "start": "2026-03-01", "startTime": "09:00"},
		http.StatusCreated)
	id, _ := got["entryID"].(string)
	if id == "" {
		t.Fatalf("建立 entry 沒回傳 entryID: %v", got)
	}
	return id
}

// ---- /internal/*：CLI 與 LLM 後端走的路徑 ----

func TestInternalCreateEntry(t *testing.T) {
	f := newEntryFixture(t)

	got := f.do(t, "POST", "/internal/trips/"+f.trip+"/entries",
		map[string]any{
			"title": "光復糖廠", "start": "2026-03-01", "startTime": "09:00",
			"end": "2026-03-01", "endTime": "10:30", "location": "花蓮縣光復鄉",
		}, http.StatusCreated)

	if got["entryID"] == "" || got["entryID"] == nil {
		t.Fatalf("回應缺少 entryID: %v", got)
	}

	// 確認真的寫進資料庫,而不只是 handler 回了一個看起來對的 JSON。
	entries, err := f.srv.store.ListEntriesByTrip(f.trip)
	if err != nil {
		t.Fatalf("列出 entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("資料庫裡有 %d 筆 entry，預期 1 筆", len(entries))
	}
	if entries[0].Title != "光復糖廠" {
		t.Errorf("entry Title = %q，預期 光復糖廠", entries[0].Title)
	}
}

func TestInternalListEntries(t *testing.T) {
	f := newEntryFixture(t)
	f.createEntry(t, "光復糖廠")
	f.createEntry(t, "大農大富平地森林園區停車場")

	got := f.do(t, "GET", "/internal/trips/"+f.trip+"/entries", nil, http.StatusOK)

	entries, ok := got["entries"].([]any)
	if !ok {
		t.Fatalf("回應的 entries 不是陣列: %v", got["entries"])
	}
	if len(entries) != 2 {
		t.Fatalf("回傳 %d 筆 entry，預期 2 筆", len(entries))
	}
}

// TestInternalUpdateEntry 一併涵蓋 detail 欄位——先前有過 detail 寫不進去的
// bug(GORM 的 serializer:json 標籤只在具名 struct 更新時生效,走
// Updates(map) 會被繞過),所以這裡特地帶 detail 並回查驗證。
func TestInternalUpdateEntry(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createEntry(t, "光復糖廠")

	f.do(t, "PATCH", "/internal/entries/"+id, map[string]any{
		"title": "光復糖廠（起點）",
		"kind":  "activity",
		"note":  "集合點",
		"detail": map[string]any{
			"distanceKm": 12.5,
		},
	}, http.StatusOK)

	entry, err := f.srv.store.GetEntry(id)
	if err != nil {
		t.Fatalf("取回 entry: %v", err)
	}
	if entry.Title != "光復糖廠（起點）" {
		t.Errorf("Title = %q，預期 光復糖廠（起點）", entry.Title)
	}
	if deref(entry.Kind) != "activity" {
		t.Errorf("Kind = %q，預期 activity", deref(entry.Kind))
	}
	if deref(entry.Note) != "集合點" {
		t.Errorf("Note = %q，預期 集合點", deref(entry.Note))
	}
	if entry.Detail["distanceKm"] != 12.5 {
		t.Errorf("Detail[distanceKm] = %v，預期 12.5", entry.Detail["distanceKm"])
	}
}

// TestInternalSetLatLng 對應 geocode -entry 把查到的座標寫回 entry 的路徑。
func TestInternalSetLatLng(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createEntry(t, "光復糖廠")

	f.do(t, "PATCH", "/internal/entries/"+id+"/latlng",
		map[string]any{"lat": 23.6697, "lng": 121.4218}, http.StatusOK)

	entry, err := f.srv.store.GetEntry(id)
	if err != nil {
		t.Fatalf("取回 entry: %v", err)
	}
	if entry.Lat == nil || entry.Lng == nil {
		t.Fatalf("Lat/Lng 仍為 nil，座標沒寫進去")
	}
	if *entry.Lat != 23.6697 || *entry.Lng != 121.4218 {
		t.Errorf("Lat/Lng = %v/%v，預期 23.6697/121.4218", *entry.Lat, *entry.Lng)
	}
}

func TestInternalDeleteEntry(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createEntry(t, "光復糖廠")

	f.do(t, "DELETE", "/internal/entries/"+id, nil, http.StatusOK)

	entries, err := f.srv.store.ListEntriesByTrip(f.trip)
	if err != nil {
		t.Fatalf("列出 entries: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("刪除後仍有 %d 筆 entry", len(entries))
	}
}

func TestInternalReset(t *testing.T) {
	f := newEntryFixture(t)
	f.createEntry(t, "光復糖廠")
	f.createEntry(t, "大農大富平地森林園區停車場")

	f.do(t, "DELETE", "/internal/trips/"+f.trip+"/entries", nil, http.StatusOK)

	entries, err := f.srv.store.ListEntriesByTrip(f.trip)
	if err != nil {
		t.Fatalf("列出 entries: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("reset 後仍有 %d 筆 entry", len(entries))
	}
}

// ---- /v1/*：前端走的路徑（帶使用者身分，需 editor 權限）----

func TestV1CreateEntry(t *testing.T) {
	f := newEntryFixture(t)

	got := f.do(t, "POST", "/v1/trips/"+f.trip+"/entries", map[string]any{
		"title": "光復糖廠", "date": "2026-03-01", "time": "09:00", "note": "集合點",
	}, http.StatusCreated)

	id, _ := got["id"].(string)
	if id == "" {
		t.Fatalf("回應缺少 id: %v", got)
	}

	entry, err := f.srv.store.GetEntry(id)
	if err != nil {
		t.Fatalf("取回 entry: %v", err)
	}
	if entry.Title != "光復糖廠" {
		t.Errorf("Title = %q，預期 光復糖廠", entry.Title)
	}
	// note 走的是「先 Record、再 UpdateEntry 補上」的兩段式寫入
	// (RecordInput 沒有 Note 欄位),值得確認第二段真的有執行。
	if deref(entry.Note) != "集合點" {
		t.Errorf("Note = %q，預期 集合點", deref(entry.Note))
	}
}

func TestV1ListEntries(t *testing.T) {
	f := newEntryFixture(t)
	f.createEntry(t, "光復糖廠")

	got := f.do(t, "GET", "/v1/trips/"+f.trip+"/entries", nil, http.StatusOK)

	entries, ok := got["entries"].([]any)
	if !ok {
		t.Fatalf("回應的 entries 不是陣列: %v", got["entries"])
	}
	if len(entries) != 1 {
		t.Fatalf("回傳 %d 筆 entry，預期 1 筆", len(entries))
	}
}

func TestV1UpdateTripEntry(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createEntry(t, "光復糖廠")

	f.do(t, "PUT", "/v1/trips/"+f.trip+"/entries/"+id, map[string]any{
		"title": "光復糖廠（起點）", "date": "2026-03-02", "time": "08:30", "note": "改集合時間",
	}, http.StatusOK)

	entry, err := f.srv.store.GetEntry(id)
	if err != nil {
		t.Fatalf("取回 entry: %v", err)
	}
	if entry.Title != "光復糖廠（起點）" {
		t.Errorf("Title = %q，預期 光復糖廠（起點）", entry.Title)
	}
	if deref(entry.Note) != "改集合時間" {
		t.Errorf("Note = %q，預期 改集合時間", deref(entry.Note))
	}
}

// TestV1PatchEntry 測 PATCH /v1/entries/{id}——路徑上不帶 tripID,由
// handler 自己回查 entry 所屬行程再判斷權限,與上面那條 PUT 是不同的 handler。
func TestV1PatchEntry(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createEntry(t, "光復糖廠")

	f.do(t, "PATCH", "/v1/entries/"+id, map[string]any{
		"title": "光復糖廠（起點）", "location": "花蓮縣光復鄉",
	}, http.StatusOK)

	entry, err := f.srv.store.GetEntry(id)
	if err != nil {
		t.Fatalf("取回 entry: %v", err)
	}
	if entry.Title != "光復糖廠（起點）" {
		t.Errorf("Title = %q，預期 光復糖廠（起點）", entry.Title)
	}
	if entry.Location != "花蓮縣光復鄉" {
		t.Errorf("Location = %q，預期 花蓮縣光復鄉", entry.Location)
	}
}

func TestV1DeleteTripEntry(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createEntry(t, "光復糖廠")

	f.do(t, "DELETE", "/v1/trips/"+f.trip+"/entries/"+id, nil, http.StatusOK)

	if _, err := f.srv.store.GetEntry(id); err == nil {
		t.Fatal("刪除後仍查得到這筆 entry")
	}
}

func TestV1ResetTripData(t *testing.T) {
	f := newEntryFixture(t)
	f.createEntry(t, "光復糖廠")

	f.do(t, "DELETE", "/v1/trips/"+f.trip+"/entries", nil, http.StatusOK)

	entries, err := f.srv.store.ListEntriesByTrip(f.trip)
	if err != nil {
		t.Fatalf("列出 entries: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("reset 後仍有 %d 筆 entry", len(entries))
	}
}

// deref 把 model.Entry 上的選填字串欄位(*string)解成可直接比較的字串,
// nil 視為空字串。這些欄位用指標是為了區分「沒帶這個欄位」與「帶了空字串」,
// 但 happy path 的斷言只關心最終值是什麼。
func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
