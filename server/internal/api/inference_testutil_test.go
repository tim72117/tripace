// inference_testutil_test.go 是 assist_inference_mockllm_test.go(預設,無
// build tag)與 assist_inference_real_llm_test.go(//go:build real_llm)共用的
// 建構邏輯:兩者都需要「真的 store + 真的 channel + 真的 toolRegistry + 真的
// WantPool + 真的 api.Server」這條鏈路,差別只在 WantPool 背後接的是哪個
// provider(mockllm.Server 還是真的 vLLM)——那個差異由各自的檔案在呼叫
// newInferenceTestServer 前,透過環境變數(AI_PROVIDER/AI_MODEL/VLLM_BASE_URL)
// 決定,本檔案完全不知道背後接的是真是假。
package api_test

import (
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/api"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/llm"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
	"github.com/tim72117/tripace/internal/toolregistry"
	"github.com/tim72117/tripace/internal/wanttools"
	tripwanttools "github.com/tim72117/tripace/internal/wanttools/trip"
)

// seededEntryTitle 是種在測試頻道裡、查詢應該要找到的已知 entry 標題。
// 刻意用一個不太可能被 LLM(或劇本)自己編出來的字串,讓「查詢結果裡出現
// 這個標題」成為判斷「entry_query 真的查對資料」的強訊號。
const seededEntryTitle = "測試專用晚餐聚會-assist-inference-probe"

// newInferenceTestServer 建構一條完整的真實依賴鏈(同 cmd/server/main.go 的
// 組裝方式,測試環境版):in-memory SQLite store、一個由 usr_me 擁有的頻道
// (已種入一筆 seededEntryTitle,日期為今天)、餵滿 wanttools/trip 靜態工具的
// toolRegistry、真的 WantPool(讀取呼叫端已設定好的 AI_PROVIDER 等環境變數)、
// 真的 api.Server(含 entries_loaded 廣播綁定)。
//
// 回傳的 *store.Store 只在測試需要跳過 HTTP 直接查 DB 斷言時才用得到;一般
// 情況下只需要 srv 與 ch.ID。
func newInferenceTestServer(t *testing.T) (*api.Server, *store.Store, model.Channel) {
	t.Helper()

	st, err := store.Open("file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	owner := model.User{ID: "usr_me", Name: "測試使用者", AvatarColor: "#8C7B6A"}
	ch, err := st.CreateChannel("ch_assist_inference_test", "推論測試頻道", owner)
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}

	today := time.Now().UTC().Format("2006-01-02")
	if err := st.InsertEntry(model.Entry{
		ID:        "ent_seed_probe",
		ChannelID: ch.ID,
		Title:     seededEntryTitle,
		Start:     today,
		StartTime: "19:00",
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed entry: %v", err)
	}

	toolReg := toolregistry.NewRegistry()
	wanttools.RegisterBuiltinTools(toolReg)
	tripwanttools.RegisterBuiltinTools(toolReg)

	pool, err := llm.NewWantPool(toolregistry.NewToolbox(toolReg))
	if err != nil {
		t.Fatalf("初始化 want 分析器失敗(檢查 AI_PROVIDER/VLLM_BASE_URL 是否可連線): %v", err)
	}
	wanttools.BindStore(st)

	signer := auth.NewSigner("test-secret", time.Hour)
	srv := api.New(st, pool, signer, true)
	wanttools.BindEntriesLoaded(srv.NotifyEntriesLoaded)

	return srv, st, ch
}
