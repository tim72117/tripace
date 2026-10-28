package adminconsole

// schema_check_test.go 測 GET /admin/api/schema-check 的回應形狀。遺留表的
// 偵測邏輯本身由 store.OrphanTables 的測試負責(這裡拿不到 store 的底層
// 連線,無法手動建遺留表),這裡只確認端點確實帶出 orphanTables、且沒有
// 遺留表時是「空陣列」而不是 null(前端直接對它 .join/.length)。

import (
	"encoding/json"
	"io"
	"testing"
)

func TestSchemaCheck_FreshDatabaseHasNoOrphanTables(t *testing.T) {
	client, base := newAuthedGeoRateLimitTestClient(t)

	resp, err := client.Get(base + "/admin/api/schema-check")
	if err != nil {
		t.Fatalf("GET schema-check: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("解析回應: %v", err)
	}
	orphans, ok := raw["orphanTables"]
	if !ok {
		t.Fatalf("回應應包含 orphanTables,實際: %s", body)
	}
	if string(orphans) != "[]" {
		t.Errorf("沒有遺留表時 orphanTables 應為空陣列 [],得到 %s", orphans)
	}

	var parsed struct {
		Ok bool `json:"ok"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("解析 ok: %v", err)
	}
	if !parsed.Ok {
		t.Errorf("全新資料庫的整體結果應為 ok=true,回應: %s", body)
	}
}
