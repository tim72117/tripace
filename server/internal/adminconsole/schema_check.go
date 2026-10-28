// 資料庫 schema 完整性檢查(GET /admin/api/schema-check)。比對 GORM
// entity struct 的欄位/主鍵定義,與資料庫實際欄位/主鍵是否一致——見
// store.CheckSchema 的完整說明:GORM AutoMigrate 遇到欄位改名或主鍵
// 變更這類結構性調整時不會自動處理(只會新增缺少的欄位,不會刪除/
// 重新命名舊欄位,也不會修改既有表的主鍵),這類 schema 漂移不會讓
// AutoMigrate 本身報錯,必須額外主動比對才抓得到,故加這支端點讓
// 管理員能隨時檢查、不需要逐張表手動查 information_schema。
package adminconsole

import (
	"net/http"

	"github.com/tim72117/tripace/internal/store"
)

// schemaCheckResponse 是 GET /admin/api/schema-check 的回應格式。Ok 為
// 整體結果(所有表都 ok 且沒有遺留表才是 true),Tables 依 store.CheckSchema
// 的順序(即 Open() 裡 AutoMigrate 清單的順序)逐表列出。OrphanTables 是
// 資料庫裡沒有對應 struct 的遺留表(見 store.OrphanTables),永遠是陣列
// (沒有時是空陣列,不是 null)。
type schemaCheckResponse struct {
	Ok           bool                `json:"ok"`
	Tables       []store.SchemaCheck `json:"tables"`
	OrphanTables []string            `json:"orphanTables"`
}

func (h *Handler) checkSchema(w http.ResponseWriter, r *http.Request, _ *Admin) {
	checks, err := h.Store.CheckSchema()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	orphans, err := h.Store.OrphanTables()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	ok := len(orphans) == 0
	for _, c := range checks {
		if !c.Ok {
			ok = false
			break
		}
	}
	writeJSON(w, http.StatusOK, schemaCheckResponse{Ok: ok, Tables: checks, OrphanTables: orphans})
}
