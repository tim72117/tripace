package attractionsync

// integration_test.go 用兩個獨立的 httptest.Server 模擬「本機」與「正式站」
// 兩台真實主機，跑完整的 push/pull 端到端流程，驗證的重點是：本機/正式站
// 各自的資料狀態最終是否符合設計文件裡的規則（見
// docs/ATTRACTION_SYNC_DESIGN.md），而不是重複測 diff_test.go/
// handshake_test.go 已經涵蓋過的單元邏輯細節。
//
// 兩個 httptest.Server 都在同一個測試進程裡跑，不需要 Docker/實體機器/
// 網路設定；因為 handler 是自己控制的 Go 函式，可以精確注入「第 N 筆
// 寫入時模擬失敗」這種其他方式很難重現的邊界情況，這正是這裡特別適合
// 用來驗證中斷/續傳邏輯的原因。
//
// 這個檔案裡的 fakeAttractionHost 是「一台主機」的最小可用替身：一個
// httptest.Server + 一份記憶體中的 attraction 清單 + 幾個對齊設計文件
// 端點形狀的 handler。實際的 API handler（server/internal/api/
// attraction_sync_test.go 定義的那些）會是更完整、走真實 DB 的版本，
// 這裡的替身只需要撐起端到端流程需要的最小行為。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// fakeAttractionHost 模擬「一台主機」：維護一份記憶體中的 attraction
// 清單，並提供對齊三層比對 + 交握協定所需的最小 HTTP 介面。
type fakeAttractionHost struct {
	mu      sync.Mutex
	records map[string]Record // ID -> Record，模擬這台主機自己的 DB

	// failWriteAt：從 1 起算，第幾次「接收寫入」要回應失敗，模擬傳輸
	// 中途中斷。0 = 永不失敗。供 TestPushResumesAfterInterruption 使用。
	failWriteAt int
	writeCount  int

	srv *httptest.Server
}

func newFakeAttractionHost(t *testing.T, seed []Record) *fakeAttractionHost {
	t.Helper()
	h := &fakeAttractionHost{records: map[string]Record{}}
	for _, r := range seed {
		h.records[r.ID] = r
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /freshness", h.handleFreshness)
	mux.HandleFunc("GET /list", h.handleList)
	mux.HandleFunc("POST /write", h.handleWrite)
	h.srv = httptest.NewServer(mux)
	t.Cleanup(h.srv.Close)
	return h
}

func (h *fakeAttractionHost) handleFreshness(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	probe := computeFreshness(h.records)
	writeJSON(w, probe)
}

func (h *fakeAttractionHost) handleList(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := make([]LiteRecord, 0, len(h.records))
	for _, rec := range h.records {
		list = append(list, LiteRecord{ID: rec.ID, UpdatedAt: rec.UpdatedAt})
	}
	writeJSON(w, list)
}

func (h *fakeAttractionHost) handleWrite(w http.ResponseWriter, r *http.Request) {
	var rec Record
	if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.mu.Lock()
	h.writeCount++
	shouldFail := h.failWriteAt != 0 && h.writeCount == h.failWriteAt
	if !shouldFail {
		h.records[rec.ID] = rec
	}
	h.mu.Unlock()

	if shouldFail {
		http.Error(w, "模擬寫入失敗", http.StatusInternalServerError)
		return
	}
	writeJSON(w, WriteResult{ID: rec.ID, Written: true})
}

func (h *fakeAttractionHost) snapshot() map[string]Record {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make(map[string]Record, len(h.records))
	for k, v := range h.records {
		out[k] = v
	}
	return out
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// computeFreshness 是 fakeAttractionHost 內部用的最小替身：從記憶體清單
// 算出 FreshnessProbe。實作階段這個計算邏輯理論上會跟 attractionsync
// package 本身提供的邏輯共用（不重複實作一套「找最新一筆」的規則），
// 這裡先用測試檔案本地的版本，等主套件的對外函式定案後可以直接替換掉
// 這個 fake 專屬實作。
func computeFreshness(records map[string]Record) FreshnessProbe {
	probe := FreshnessProbe{Count: len(records)}
	for _, r := range records {
		if r.UpdatedAt.After(probe.LatestUpdatedAt) {
			probe.LatestUpdatedAt = r.UpdatedAt
			probe.LatestID = r.ID
		}
	}
	return probe
}

// TestPushEndToEnd 模擬完整的 push 流程：本機（來源＋決策方）主動查詢
// 「正式站」（用 fakeAttractionHost 模擬）現有狀態、算出差異、把差異
// 推送過去，驗證「正式站」這台主機最終的資料狀態符合預期。
//
// 這是設計文件裡「二、傳輸流程」三層比對 + 交握式傳輸兩個環節串起來的
// 端到端驗證，而不是重複測任一環節自身的細節（那些在 diff_test.go /
// handshake_test.go 已經個別覆蓋）。
func TestPushEndToEnd(t *testing.T) {
	local := []Record{
		{ID: "lmk_1", UpdatedAt: ts("2026-08-01T00:00:00Z")},
		{ID: "lmk_2", UpdatedAt: ts("2026-08-02T00:00:00Z")}, // 只在本機 → 應推送到正式站
	}
	remote := newFakeAttractionHost(t, []Record{
		{ID: "lmk_1", UpdatedAt: ts("2026-08-01T00:00:00Z")},
	})

	// PushTo 是 attractionsync 套件對外提供的整合入口，對應「push」情境
	// 的完整流程：本機（來源＋決策方）依序打 remote 的探測/清單/寫入
	// 端點（見 fakeAttractionHost 的 /freshness /list /write），內部
	// 完成第零/一/二層比對 + Transfer，不需要呼叫端自己組合這些步驟。
	// 尚未實作，此處先定義預期的呼叫簽章與回傳形狀。
	result, err := PushTo(remote.srv.URL, local)
	if err != nil {
		t.Fatalf("PushTo: %v", err)
	}
	if !result.Complete {
		t.Errorf("result.Complete = false，預期 true（只有一筆差異，應該一次成功）")
	}

	got := remote.snapshot()
	if len(got) != 2 {
		t.Fatalf("正式站最終有 %d 筆，預期 2 筆（lmk_1 原有 + lmk_2 新推送）", len(got))
	}
	if _, ok := got["lmk_2"]; !ok {
		t.Error("正式站應該收到新推送的 lmk_2，但沒有")
	}
	// lmk_1 兩邊內容相同，不該被重新寫入（驗證「兩邊都有、內容相同 →
	// 不動作」這條規則在端到端流程裡也成立，不是只在 DiffLite 單元
	// 測試裡成立）。
	if remote.writeCount != 1 {
		t.Errorf("remote 收到 %d 次寫入請求，預期 1 次（只有 lmk_2 需要寫入）", remote.writeCount)
	}
}

// TestPushResumesAfterInterruption 驗證「筆數不符時，不猜測斷點、直接
// 重新查詢目的方最新狀態接續」這條規則在端到端情境下成立：讓
// fakeAttractionHost 模擬第 2 筆寫入失敗，確認第一次 PushTo 只成功寫入
// 1 筆、result.Complete 為 false，接著不帶失敗設定再呼叫一次 PushTo，
// 確認第二次執行後全部 3 筆都到齊、且沒有重複寫入已經成功的第一筆。
//
// 用 push 情境驗證（而非 pull）是因為 Transfer/ResumeFrom 這套續傳邏輯
// 本身跟方向無關（見 docs/ATTRACTION_SYNC_DESIGN.md「二、傳輸流程」：
// 交握協定發生在三層比對「決定要傳什麼」之後，不論 push 或 pull 都是
// 同一套續傳規則）——用 PushTo 驗證即可涵蓋這條規則，不需要為 pull 情境
// 重寫一次幾乎相同的測試。
func TestPushResumesAfterInterruption(t *testing.T) {
	local := []Record{
		{ID: "lmk_1", UpdatedAt: ts("2026-08-01T00:00:00Z")},
		{ID: "lmk_2", UpdatedAt: ts("2026-08-02T00:00:00Z")},
		{ID: "lmk_3", UpdatedAt: ts("2026-08-03T00:00:00Z")},
	}
	dest := newFakeAttractionHost(t, nil)
	dest.failWriteAt = 2 // 第 2 筆寫入模擬失敗，中斷傳輸

	firstResult, err := PushTo(dest.srv.URL, local)
	if err != nil {
		t.Fatalf("第一次 PushTo: %v", err)
	}
	if firstResult.Complete {
		t.Fatal("第 2 筆模擬寫入失敗，預期第一次 PushTo 的 result.Complete = false")
	}
	if firstResult.WrittenCount != 1 {
		t.Errorf("第一次 PushTo 寫入 %d 筆，預期 1 筆（lmk_1 成功、lmk_2 失敗、lmk_3 未送達）", firstResult.WrittenCount)
	}
	if got := dest.snapshot(); len(got) != 1 {
		t.Fatalf("中斷後 dest 應該只有 1 筆，得到 %d 筆", len(got))
	}

	// 解除失敗模擬，重新呼叫一次——不需要呼叫端自己算「該從哪裡繼續」，
	// PushTo 內部應該自己重新查詢 dest 最新狀態、只送還沒到達的部分。
	dest.mu.Lock()
	dest.failWriteAt = 0
	dest.mu.Unlock()

	secondResult, err := PushTo(dest.srv.URL, local)
	if err != nil {
		t.Fatalf("第二次 PushTo（續傳）: %v", err)
	}
	if !secondResult.Complete {
		t.Errorf("續傳後應該全部完成，result.Complete = false（得到 %+v）", secondResult)
	}
	if secondResult.WrittenCount != 2 {
		t.Errorf("續傳只應該補送剩下的 2 筆（lmk_2、lmk_3），但 WrittenCount = %d", secondResult.WrittenCount)
	}

	final := dest.snapshot()
	if len(final) != 3 {
		t.Fatalf("最終 dest 應有 3 筆，得到 %d 筆", len(final))
	}
	// dest.writeCount 累計兩次呼叫的寫入次數：第一次 2 次嘗試（lmk_1 成功
	// +lmk_2 失敗）、第二次應只補送 2 筆（不重送已經成功的 lmk_1），
	// 總計 4 次寫入嘗試——藉此確認續傳沒有把 lmk_1 又送一次。
	if dest.writeCount != 4 {
		t.Errorf("dest 總共收到 %d 次寫入嘗試，預期 4 次（第一輪 2 次 + 續傳 2 次，lmk_1 全程只被送過一次）", dest.writeCount)
	}
}
