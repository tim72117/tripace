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

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/store"
)

// schemaCheckResponse 是 GET /admin/api/schema-check 的回應格式。Ok 為
// 整體結果(所有表都 ok 才是 true),Tables 依 store.CheckSchema 的順序
// (即 Open() 裡 AutoMigrate 清單的順序)逐表列出。
type schemaCheckResponse struct {
	Ok     bool                `json:"ok"`
	Tables []store.SchemaCheck `json:"tables"`
}

func (h *Handler) checkSchema(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	checks, err := h.Store.CheckSchema()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	ok := true
	for _, c := range checks {
		if !c.Ok {
			ok = false
			break
		}
	}
	writeJSON(w, http.StatusOK, schemaCheckResponse{Ok: ok, Tables: checks})
}
