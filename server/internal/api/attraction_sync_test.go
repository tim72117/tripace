package api

// attraction_sync_test.go 定義景點資料同步機制新增的 /internal/maintenance/
// sync/* 端點預期行為（見 docs/ATTRACTION_SYNC_DESIGN.md）。這些端點與
// handler 尚未實作——先寫測試定義路由字串、request/response 形狀，等
// 實作完成後這些測試應該轉綠。
//
// 比照 entry_test.go 的模式：透過 s.Routes() 打完整的 mux，而非直接呼叫
// handler 函式，讓路由字串本身的錯誤（漏註冊、拼錯）也在這裡被夾出來。
//
// 只寫 happy path + 幾個明確在設計文件裡討論過的邊界情況，不窮舉每個
// error code。

import (
	"encoding/json"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"
)

// withSyncTokenDir 讓 saveSyncToken/loadSyncToken(見 synctoken.go)讀寫
// 落在這次測試的暫存目錄,不寫到開發者本機真實的
// os.UserConfigDir()/tripace/sync-token——比照 cmd/cli/http_test.go 的
// setUserConfigDirEnv 同款修正:os.UserConfigDir() 在 Darwin 上固定回傳
// $HOME/Library/Application Support,完全不讀 XDG_CONFIG_HOME,曾經因為
// 誤以為「非 Windows 就是讀 XDG_CONFIG_HOME」導致測試寫壞開發者真實的
// token 檔案(見該檔案開頭的事故說明)。這裡獨立在 api 套件內重新實作
// 一份,而非跨套件匯入 cmd/cli 的測試 helper——兩個套件的測試不應該互相
// 依賴對方的內部測試工具。
func withSyncTokenDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	switch runtime.GOOS {
	case "windows":
		t.Setenv("AppData", dir)
	case "darwin":
		t.Setenv("HOME", dir)
	default:
		t.Setenv("XDG_CONFIG_HOME", dir)
	}
	path, err := syncTokenPath()
	if err != nil {
		t.Fatalf("syncTokenPath: %v", err)
	}
	if !strings.HasPrefix(path, dir) {
		t.Fatalf("syncTokenPath 指向 %q,不在這次測試的暫存目錄 %q 底下(環境變數沒有生效)", path, dir)
	}
	return dir
}

// ---- Schema 查詢端點（見設計文件「零、前置檢查」）----

// TestHandleMaintenanceAttractionSchema_ReturnsFieldList 對應設計文件：
// 「Schema 查詢端點：供『零、前置檢查』查詢對方 attractions 表的欄位/
// 型別結構」。回應形狀（欄位名稱 + 型別的清單）供發起方跟自己的 schema
// 逐項比對。
func TestHandleMaintenanceAttractionSchema_ReturnsFieldList(t *testing.T) {
	f := newEntryFixture(t)

	got := f.do(t, "GET", "/internal/maintenance/sync/attractions/schema", nil, 200)

	fields, ok := got["fields"].([]any)
	if !ok || len(fields) == 0 {
		t.Fatalf("回應應含非空的 fields 陣列，得到 %v", got)
	}
	// attractionRow 的欄位集合（見 server/internal/store/entity.go:66-85），
	// 逐一確認都出現在回傳的欄位清單裡，而不是只檢查陣列非空。
	wantCols := []string{"id", "name", "city_name", "lat", "lng", "level", "radius_meters", "summary", "photo_url", "updated_at"}
	gotCols := map[string]bool{}
	for _, f := range fields {
		m, ok := f.(map[string]any)
		if !ok {
			t.Fatalf("fields 陣列裡的元素應是物件（含 name/type），得到 %v", f)
		}
		name, _ := m["name"].(string)
		gotCols[name] = true
		if _, hasType := m["type"]; !hasType {
			t.Errorf("欄位 %q 缺少 type", name)
		}
	}
	for _, want := range wantCols {
		if !gotCols[want] {
			t.Errorf("回傳的欄位清單缺少 %q", want)
		}
	}
}

// ---- 伺服器時間查詢端點（見設計文件「零、前置檢查」的時鐘偏移檢查）----

func TestHandleMaintenanceServerTime_ReturnsCurrentTime(t *testing.T) {
	f := newEntryFixture(t)

	got := f.do(t, "GET", "/internal/maintenance/sync/server-time", nil, 200)

	if _, ok := got["serverTime"]; !ok {
		t.Fatalf("回應應含 serverTime 欄位，得到 %v", got)
	}
}

// ---- 第零層探測端點（見設計文件「二、傳輸流程」）----

// TestHandleMaintenanceAttractionFreshness_EmptyStore 是尚未有任何景點
// 資料時的邊界情況：count=0，且不該回傳一個假造的 UpdatedAt/ID。
func TestHandleMaintenanceAttractionFreshness_EmptyStore(t *testing.T) {
	f := newEntryFixture(t)

	got := f.do(t, "GET", "/internal/maintenance/sync/attractions/freshness", nil, 200)

	count, _ := got["count"].(float64) // encoding/json 把數字解成 float64
	if count != 0 {
		t.Errorf("count = %v，預期 0（尚未建立任何景點資料）", got["count"])
	}
}

func TestHandleMaintenanceAttractionFreshness_ReturnsLatest(t *testing.T) {
	f := newEntryFixture(t)
	f.createAttraction(t, "清水寺", "京都")
	newest := f.createAttraction(t, "產寧坂", "京都") // 後建立的 UpdatedAt 較新

	got := f.do(t, "GET", "/internal/maintenance/sync/attractions/freshness", nil, 200)

	count, _ := got["count"].(float64)
	if count != 2 {
		t.Errorf("count = %v，預期 2", got["count"])
	}
	if got["latestId"] != newest {
		t.Errorf("latestId = %v，預期最後建立的那筆 %q", got["latestId"], newest)
	}
	if _, ok := got["latestUpdatedAt"]; !ok {
		t.Error("回應應含 latestUpdatedAt")
	}
}

// ---- pull 專用的比對端點（見設計文件「三、架構」「來源方決策」）----

// TestHandleMaintenanceAttractionSyncCompare_DestinationRequestsComparison
// 對應設計文件 pull 情境：本機（目的方）把自己的探測/清單資料送給正式站
// （來源＋決策方）的比對端點，由正式站執行比對邏輯、回傳應同步的內容。
//
// 這裡先驗證最小情境：目的方回報「完全沒有資料」，來源方（這台測試用的
// server，已經建了一筆）應該回傳「應該新增」的那一筆完整內容。
func TestHandleMaintenanceAttractionSyncCompare_DestinationEmpty(t *testing.T) {
	f := newEntryFixture(t)
	f.createAttraction(t, "清水寺", "京都")

	body := map[string]any{
		"destinationList": []any{}, // 目的方目前沒有任何記錄
	}
	got := f.do(t, "POST", "/internal/maintenance/sync/attractions/compare", body, 200)

	toCreate, ok := got["toCreate"].([]any)
	if !ok || len(toCreate) != 1 {
		t.Fatalf("toCreate = %v，預期含 1 筆（目的方完全沒有資料，來源方僅有的一筆應該回傳）", got["toCreate"])
	}
}

// createAttraction 用 /internal/maintenance/attractions 端點建一筆景點
// 資料，回傳其 ID——供本檔案內需要「先有一筆資料」的測試當前置。
func (f *testFixture) createAttraction(t *testing.T, name, city string) string {
	t.Helper()
	got := f.do(t, "POST", "/internal/maintenance/attractions", map[string]any{
		"name": name, "cityName": city, "lat": 25.03, "lng": 121.56, "level": 3,
	}, 201)
	id, _ := got["id"].(string)
	if id == "" {
		t.Fatalf("建立景點資料未回傳 id: %v", got)
	}
	return id
}

// ---- 交握式傳輸的逐筆寫入/更新/刪除端點 ----

// TestHandleMaintenanceAttractionSyncWrite_PreservesSourceID 對應
// store.CreateAttractionWithID 的核心目的：write 端點必須沿用請求 body
// 裡的 ID 建檔，不能像一般的 attraction-add 產生新 ID——否則下一輪同步
// 比對 ID 時會誤判成兩筆互不相干的記錄，導致同一筆資料被無限重複新增。
func TestHandleMaintenanceAttractionSyncWrite_PreservesSourceID(t *testing.T) {
	f := newEntryFixture(t)

	got := f.do(t, "POST", "/internal/maintenance/sync/attractions/write", map[string]any{
		"id": "lmk_fixedid001", "name": "清水寺", "cityName": "京都", "lat": 25.03, "lng": 121.56, "level": 3,
	}, 200)

	if got["id"] != "lmk_fixedid001" {
		t.Errorf("write 回應 id = %v，預期沿用請求帶的 %q", got["id"], "lmk_fixedid001")
	}
	if got["written"] != true {
		t.Errorf("written = %v，預期 true", got["written"])
	}

	list := f.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := list["attractions"].([]any)
	if len(attractions) != 1 {
		t.Fatalf("寫入後查詢應有 1 筆，得到 %v", attractions)
	}
	first, _ := attractions[0].(map[string]any)
	if first["id"] != "lmk_fixedid001" {
		t.Errorf("資料庫裡的 id = %v，預期 %q（來源方指定的 ID 應被沿用）", first["id"], "lmk_fixedid001")
	}
}

// TestHandleMaintenanceAttractionSyncWrite_IdempotentOnExistingID 對應
// 設計文件交握協定「筆數不符時重新查詢斷點、重新整批送出」的情境：
// 已經寫入過的 ID 再送一次，應該視為冪等成功，不視為錯誤、也不重複
// 建檔。
func TestHandleMaintenanceAttractionSyncWrite_IdempotentOnExistingID(t *testing.T) {
	f := newEntryFixture(t)
	body := map[string]any{
		"id": "lmk_dup001", "name": "清水寺", "cityName": "京都", "lat": 25.03, "lng": 121.56, "level": 3,
	}
	f.do(t, "POST", "/internal/maintenance/sync/attractions/write", body, 200)
	got := f.do(t, "POST", "/internal/maintenance/sync/attractions/write", body, 200)
	if got["written"] != true {
		t.Errorf("重複寫入同一個 id，預期仍回報 written=true（冪等），得到 %v", got)
	}

	list := f.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := list["attractions"].([]any)
	if len(attractions) != 1 {
		t.Fatalf("重複寫入同一個 id 不應該產生第二筆，得到 %v", attractions)
	}
}

func TestHandleMaintenanceAttractionSyncUpdate_OverwritesFields(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createAttraction(t, "清水寺", "京都")

	got := f.do(t, "POST", "/internal/maintenance/sync/attractions/update", map[string]any{
		"id": id, "name": "清水寺（更新）", "cityName": "京都", "lat": 25.031, "lng": 121.561, "level": 3,
	}, 200)
	if got["written"] != true {
		t.Errorf("update 回應 written = %v，預期 true", got["written"])
	}

	list := f.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := list["attractions"].([]any)
	first, _ := attractions[0].(map[string]any)
	if first["name"] != "清水寺（更新）" {
		t.Errorf("update 後 name = %v，預期已覆蓋為新版本", first["name"])
	}
}

func TestHandleMaintenanceAttractionSyncDelete_RemovesRecord(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createAttraction(t, "清水寺", "京都")

	got := f.do(t, "POST", "/internal/maintenance/sync/attractions/delete", map[string]any{"id": id}, 200)
	if got["deleted"] != true {
		t.Errorf("delete 回應 deleted = %v，預期 true", got["deleted"])
	}

	list := f.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := list["attractions"].([]any)
	if len(attractions) != 0 {
		t.Fatalf("刪除後應該查無資料，得到 %v", attractions)
	}
}

// ---- 第一層清單比對端點 ----

func TestHandleMaintenanceAttractionSyncList_ReturnsLiteRecords(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createAttraction(t, "清水寺", "京都")

	// f.do 假設回應是 JSON 物件，但這支端點直接回傳陣列，改用 doList。
	list := f.doList(t, "GET", "/internal/maintenance/sync/attractions/list", nil, 200)
	if len(list) != 1 {
		t.Fatalf("list 應含 1 筆，得到 %v", list)
	}
	item, _ := list[0].(map[string]any)
	if item["ID"] != id {
		t.Errorf("list[0].ID = %v，預期 %q", item["ID"], id)
	}
}

// ---- 單筆查詢端點（push 情境第二層完整欄位比對用）----

func TestHandleMaintenanceAttractionSyncGet_ReturnsFullRecord(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createAttraction(t, "清水寺", "京都")

	got := f.do(t, "GET", "/internal/maintenance/sync/attractions/"+id, nil, 200)
	if got["name"] != "清水寺" {
		t.Errorf("name = %v，預期 %q", got["name"], "清水寺")
	}
}

func TestHandleMaintenanceAttractionSyncGet_NotFound(t *testing.T) {
	f := newEntryFixture(t)
	f.do(t, "GET", "/internal/maintenance/sync/attractions/lmk_doesnotexist", nil, 404)
}

// ---- setup 端點（本機 server 收 CLI 轉交的 token 並存檔）----

func TestHandleMaintenanceSyncSetup_SavesSyncToken(t *testing.T) {
	withSyncTokenDir(t)
	f := newEntryFixture(t)

	got := f.do(t, "POST", "/internal/maintenance/sync/setup", map[string]any{
		"target": "http://example-target.test",
		"token":  "fake-jwt-for-target",
	}, 200)
	if got["ok"] != true {
		t.Errorf("setup 回應 ok = %v，預期 true", got["ok"])
	}

	saved, err := loadSyncToken()
	if err != nil {
		t.Fatalf("loadSyncToken: %v", err)
	}
	if saved.Target != "http://example-target.test" || saved.Token != "fake-jwt-for-target" {
		t.Errorf("儲存的 sync-token = %+v，跟請求內容不符", saved)
	}
}

func TestHandleMaintenanceSyncSetup_RejectsMissingFields(t *testing.T) {
	withSyncTokenDir(t)
	f := newEntryFixture(t)
	f.do(t, "POST", "/internal/maintenance/sync/setup", map[string]any{"target": ""}, 400)
}

// ---- run 端點（本機 server 觸發後執行完整 push/pull，見 handleMaintenanceSyncRun）----

// TestHandleMaintenanceSyncRun_Push_DryRunReportsToCreate 是最貼近實際
// 使用情境的整合測試：兩個各自獨立的 *Server（用 httptest.Server 包起來
// 模擬「兩台真的伺服器」，不需要 Docker/網路設定，比照
// internal/attractionsync/integration_test.go 的兩個 fake server 模式）
// ——本機（來源）已有一筆景點資料，target（目的）完全沒有，push 的
// dry-run 報告應該顯示這一筆會被新增到 target。
//
// 兩邊共用同一把 signer secret（見 newTestServer 固定用 "test-secret"）
// 才能讓本機簽出的 sync-token 通過 target 的 internalAuth 驗證——這對應
// 設計文件「四、認證」重用個人登入 JWT 機制的假設:兩邊 server 是同一套
// auth.Signer 體系,不是各自獨立的信任網域。
func TestHandleMaintenanceSyncRun_Push_DryRunReportsToCreate(t *testing.T) {
	withSyncTokenDir(t)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)

	local := newEntryFixture(t)
	local.createAttraction(t, "清水寺", "京都")

	// 模擬 attractionSyncSetup 已經完成:本機的 sync-token 檔案裡存著
	// target 的網址與一把能通過 target internalAuth 的 JWT(這裡直接用
	// local 自己的 token——兩個 fixture 共用同一把 signer secret,任一邊
	// 簽出的 token 對兩邊都有效,見上方函式說明)。
	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "push", "allowDelete": false, "apply": false, "retry": false,
	}, 200)

	report, ok := got["report"].(map[string]any)
	if !ok {
		t.Fatalf("回應應含 report 物件，得到 %v", got)
	}
	if report["needsSync"] != true {
		t.Errorf("needsSync = %v，預期 true（本機有一筆 target 沒有的資料）", report["needsSync"])
	}
	toCreate, _ := report["toCreate"].([]any)
	if len(toCreate) != 1 {
		t.Fatalf("toCreate = %v，預期含 1 筆", report["toCreate"])
	}
	if applied, _ := report["applied"].(bool); applied {
		t.Error("dry-run（未帶 apply）不應該實際寫入，applied 應為 false")
	}
}

// TestHandleMaintenanceSyncRun_Push_ApplyWritesRecordToTarget 驗證
// -apply 情境下,資料真的被交握式傳輸寫進 target,且沿用來源方的 ID
// （見 TestHandleMaintenanceAttractionSyncWrite_PreservesSourceID 的
// 說明:ID 必須一致,下一輪同步比對才不會誤判）。
func TestHandleMaintenanceSyncRun_Push_ApplyWritesRecordToTarget(t *testing.T) {
	withSyncTokenDir(t)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)

	local := newEntryFixture(t)
	localID := local.createAttraction(t, "清水寺", "京都")

	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "push", "allowDelete": false, "apply": true, "retry": false,
	}, 200)

	report, _ := got["report"].(map[string]any)
	if applied, _ := report["applied"].(bool); !applied {
		t.Fatalf("-apply 情境下 applied 應為 true，report = %v", report)
	}
	if complete, _ := report["complete"].(bool); !complete {
		t.Errorf("交握式傳輸應該完整寫入（筆數相符），report = %v", report)
	}

	targetList := target.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := targetList["attractions"].([]any)
	if len(attractions) != 1 {
		t.Fatalf("target 應該收到 1 筆資料，得到 %v", attractions)
	}
	first, _ := attractions[0].(map[string]any)
	if first["id"] != localID {
		t.Errorf("target 上的 id = %v，預期沿用來源方的 %q", first["id"], localID)
	}
}

// ---- pull 方向的 run 端到端測試（見 runSyncPull）----
//
// push 情境下本機是來源＋決策方，pull 情境下角色互換：target 才是
// 來源＋決策方，本機把自己的探測/清單資料送給 target 的 compare 端點，
// 由 target 決策要回傳什麼，本機收到後直接寫回本機 DB，不執行任何比對
// 判斷（見設計文件「二、傳輸流程」「誰做比對決策」）。這裡的
// fixture 命名沿用 push 測試的 local/target 變數名，但語意對調：
// local 現在扮演「目的方」，target 現在扮演「來源＋決策方」。

// TestHandleMaintenanceSyncRun_Pull_DryRunReportsToCreate 對應
// TestHandleMaintenanceSyncRun_Push_DryRunReportsToCreate 的鏡像情境：
// target（來源）有一筆本機沒有的資料，pull dry-run 應該回報這筆會被
// 新增到本機。
func TestHandleMaintenanceSyncRun_Pull_DryRunReportsToCreate(t *testing.T) {
	withSyncTokenDir(t)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)
	target.createAttraction(t, "清水寺", "京都") // target（來源）有本機沒有的一筆

	local := newEntryFixture(t)
	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "pull", "allowDelete": false, "apply": false, "retry": false,
	}, 200)

	report, ok := got["report"].(map[string]any)
	if !ok {
		t.Fatalf("回應應含 report 物件，得到 %v", got)
	}
	if report["needsSync"] != true {
		t.Errorf("needsSync = %v，預期 true（target 有一筆本機沒有的資料）", report["needsSync"])
	}
	toCreate, _ := report["toCreate"].([]any)
	if len(toCreate) != 1 {
		t.Fatalf("toCreate = %v，預期含 1 筆", report["toCreate"])
	}
	if applied, _ := report["applied"].(bool); applied {
		t.Error("dry-run（未帶 apply）不應該實際寫入，applied 應為 false")
	}

	// dry-run 不該動到本機 DB。
	localList := local.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	if attractions, _ := localList["attractions"].([]any); len(attractions) != 0 {
		t.Errorf("dry-run 不應該寫入本機，得到 %v", attractions)
	}
}

// TestHandleMaintenanceSyncRun_Pull_ApplyWritesRecordToLocal 驗證 -apply
// 情境下，資料真的從 target 寫進本機，且沿用來源方（target）的 ID——
// 跟 push 情境的 ID 保留要求對稱，任一方向下一輪同步比對 ID 才不會
// 誤判成兩筆互不相干的記錄。
func TestHandleMaintenanceSyncRun_Pull_ApplyWritesRecordToLocal(t *testing.T) {
	withSyncTokenDir(t)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)
	targetID := target.createAttraction(t, "清水寺", "京都")

	local := newEntryFixture(t)
	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "pull", "allowDelete": false, "apply": true, "retry": false,
	}, 200)

	report, _ := got["report"].(map[string]any)
	if applied, _ := report["applied"].(bool); !applied {
		t.Fatalf("-apply 情境下 applied 應為 true，report = %v", report)
	}
	if complete, _ := report["complete"].(bool); !complete {
		t.Errorf("應該完整寫入（筆數相符），report = %v", report)
	}
	if wc, _ := report["writtenCount"].(float64); wc != 1 {
		t.Errorf("writtenCount = %v，預期 1", report["writtenCount"])
	}

	localList := local.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := localList["attractions"].([]any)
	if len(attractions) != 1 {
		t.Fatalf("本機應該收到 1 筆資料，得到 %v", attractions)
	}
	first, _ := attractions[0].(map[string]any)
	if first["id"] != targetID {
		t.Errorf("本機上的 id = %v，預期沿用來源方（target）的 %q", first["id"], targetID)
	}
}

// TestHandleMaintenanceSyncRun_Pull_ApplyUpdatesExistingRecord 涵蓋
// 「兩邊都有、內容不同」情境：本機與 target 用同一個 ID 各自有一筆
// 內容不同的記錄，pull -apply 應該用來源方（target）版本覆蓋本機既有
// 內容（見設計文件「一、比對模型」：單向同步下來源方永遠是權威版本，
// 不需要判斷誰新誰舊）。用 sync/attractions/write 端點直接指定 ID
// 建檔，確保兩邊是同一個 ID 但欄位內容故意不同。
//
// 寫入順序刻意先 local 後 target：第零層新鮮度探測（NeedsSync，見
// attractionsync.NeedsSync）只比較「來源方最新一筆 UpdatedAt 是否比
// 目的方記錄的更新」，不比對內容本身——若 target（來源）的 UpdatedAt
// 不比 local（目的）晚，NeedsSync 會直接判定不需要同步，根本不會進入
// 第一/二層比對，這筆內容差異就不會被偵測到。要讓這個測試情境成立，
// target 的寫入時間必須確實晚於 local。
func TestHandleMaintenanceSyncRun_Pull_ApplyUpdatesExistingRecord(t *testing.T) {
	withSyncTokenDir(t)

	local := newEntryFixture(t)
	local.do(t, "POST", "/internal/maintenance/sync/attractions/write", map[string]any{
		"id": "lmk_shared001", "name": "清水寺（本機舊版本）", "cityName": "京都", "lat": 25.030, "lng": 121.560, "level": 3,
	}, 200)

	time.Sleep(2 * time.Millisecond) // 確保 target 的 UpdatedAt 嚴格晚於 local（見上方說明）

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)
	target.do(t, "POST", "/internal/maintenance/sync/attractions/write", map[string]any{
		"id": "lmk_shared001", "name": "清水寺（來源版本）", "cityName": "京都", "lat": 25.031, "lng": 121.561, "level": 3,
	}, 200)

	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "pull", "allowDelete": false, "apply": true, "retry": false,
	}, 200)

	report, _ := got["report"].(map[string]any)
	toUpdate, _ := report["toUpdate"].([]any)
	if len(toUpdate) != 1 {
		t.Fatalf("toUpdate = %v，預期含 1 筆（同一 ID、內容不同）", report["toUpdate"])
	}
	if applied, _ := report["applied"].(bool); !applied {
		t.Fatalf("-apply 情境下 applied 應為 true，report = %v", report)
	}

	localList := local.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := localList["attractions"].([]any)
	if len(attractions) != 1 {
		t.Fatalf("同一個 ID 更新後仍應只有 1 筆，得到 %v", attractions)
	}
	first, _ := attractions[0].(map[string]any)
	if first["name"] != "清水寺（來源版本）" {
		t.Errorf("本機 name = %v，預期已被來源方（target）版本覆蓋", first["name"])
	}
}

// TestHandleMaintenanceSyncRun_Pull_AllowDeleteRemovesLocalOnly 對應
// 設計文件「一、比對模型」：「只在目的方」的記錄預設保留，只有明確帶
// -allow-delete 才會刪除。這裡驗證 pull 方向、且已加上 allowDelete 的
// 情境：本機有一筆 target 沒有的資料，pull -allow-delete -apply 後
// 這筆應該從本機被刪除。
func TestHandleMaintenanceSyncRun_Pull_AllowDeleteRemovesLocalOnly(t *testing.T) {
	withSyncTokenDir(t)

	local := newEntryFixture(t)
	localOnlyID := local.createAttraction(t, "只在本機的景點", "京都")

	// target 的寫入必須晚於 local，NeedsSync 才會判定「有需要繼續比對」
	// （見 attractionsync.NeedsSync：只比較來源方最新一筆 UpdatedAt 是否
	// 比目的方記錄的更新；若 target 全部資料的 UpdatedAt 都不比 local
	// 晚，第零層探測會直接判定不需要同步，不會進到比對交集/只在目的方
	// 的邏輯——這個測試要驗證的正是「只在目的方」這條路徑，見同一份
	// 修正說明於 TestHandleMaintenanceSyncRun_Pull_ApplyUpdatesExistingRecord）。
	time.Sleep(2 * time.Millisecond)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)
	target.createAttraction(t, "產寧坂", "京都")

	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "pull", "allowDelete": true, "apply": true, "retry": false,
	}, 200)

	report, _ := got["report"].(map[string]any)
	toDelete, _ := report["toDelete"].([]any)
	if len(toDelete) != 1 || toDelete[0] != localOnlyID {
		t.Fatalf("toDelete = %v，預期含本機獨有的 %q", report["toDelete"], localOnlyID)
	}

	localList := local.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := localList["attractions"].([]any)
	for _, a := range attractions {
		m, _ := a.(map[string]any)
		if m["id"] == localOnlyID {
			t.Errorf("帶 -allow-delete 後，只在本機的記錄應該被刪除，但仍存在: %v", m)
		}
	}
}

// TestHandleMaintenanceSyncRun_Pull_WithoutAllowDeleteKeepsLocalOnly 是
// 上一個測試的對照組：不帶 -allow-delete 時，「只在目的方」的記錄應該
// 保留不動（安全預設值，見設計文件「一、比對模型」）。
func TestHandleMaintenanceSyncRun_Pull_WithoutAllowDeleteKeepsLocalOnly(t *testing.T) {
	withSyncTokenDir(t)

	local := newEntryFixture(t)
	localOnlyID := local.createAttraction(t, "只在本機的景點", "京都")

	// target 的寫入必須晚於 local，NeedsSync 才會判定需要繼續比對——見
	// TestHandleMaintenanceSyncRun_Pull_AllowDeleteRemovesLocalOnly 的
	// 同款說明。
	time.Sleep(2 * time.Millisecond)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)
	target.createAttraction(t, "產寧坂", "京都")

	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "pull", "allowDelete": false, "apply": true, "retry": false,
	}, 200)

	report, _ := got["report"].(map[string]any)
	if report["toDelete"] != nil {
		t.Errorf("未帶 -allow-delete，toDelete 應為空，得到 %v", report["toDelete"])
	}

	localList := local.do(t, "GET", "/internal/maintenance/attractions?city=京都", nil, 200)
	attractions, _ := localList["attractions"].([]any)
	found := false
	for _, a := range attractions {
		m, _ := a.(map[string]any)
		if m["id"] == localOnlyID {
			found = true
		}
	}
	if !found {
		t.Error("未帶 -allow-delete 時，只在本機的記錄應該保留，但已被刪除")
	}
}

// TestHandleMaintenanceSyncRun_Pull_NeedsSyncFalseWhenUpToDate 驗證
// pull 方向的第零層新鮮度探測：兩邊資料已經一致時，不需要進入比對，
// 且不應該產生任何 toCreate/toUpdate/toDelete。
func TestHandleMaintenanceSyncRun_Pull_NeedsSyncFalseWhenUpToDate(t *testing.T) {
	withSyncTokenDir(t)

	target := newEntryFixture(t)
	targetSrv := httptest.NewServer(target.routes)
	t.Cleanup(targetSrv.Close)

	local := newEntryFixture(t)
	if err := saveSyncToken(targetSrv.URL, local.token); err != nil {
		t.Fatalf("saveSyncToken: %v", err)
	}

	// 兩邊都完全沒有資料 → count 皆為 0 → NeedsSync 應為 false。
	got := local.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "pull", "allowDelete": false, "apply": false, "retry": false,
	}, 200)

	report, _ := got["report"].(map[string]any)
	if report["needsSync"] != false {
		t.Errorf("needsSync = %v，預期 false（兩邊皆無資料）", report["needsSync"])
	}
	if report["toCreate"] != nil || report["toUpdate"] != nil || report["toDelete"] != nil {
		t.Errorf("needsSync=false 時不該有任何差異，report = %v", report)
	}
}

func TestHandleMaintenanceSyncRun_RejectsInvalidDirection(t *testing.T) {
	withSyncTokenDir(t)
	f := newEntryFixture(t)
	f.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "sideways",
	}, 400)
}

func TestHandleMaintenanceSyncRun_NotConfigured(t *testing.T) {
	withSyncTokenDir(t) // 目錄存在,但尚未呼叫過 setup,檔案不存在
	f := newEntryFixture(t)
	f.do(t, "POST", "/internal/maintenance/sync/attractions/run", map[string]any{
		"direction": "push",
	}, 412) // http.StatusPreconditionFailed
}

// doList 是 (*testFixture).do 的陣列回應版本——handleMaintenanceAttractionSyncList
// 直接回傳 JSON 陣列而非物件,f.do 假設回應永遠是物件(map[string]any),
// 這裡另外提供一個處理陣列回應的最小 helper,只給本檔案這一種情境使用。
func (f *testFixture) doList(t *testing.T, method, path string, body any, wantStatus int) []any {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("狀態碼 = %d，預期 %d，body = %s", rec.Code, wantStatus, rec.Body.String())
	}
	var out []any
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("解析回應失敗: %v，body = %s", err, rec.Body.String())
	}
	return out
}
