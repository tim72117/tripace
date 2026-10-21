package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/tim72117/tripace/internal/geosettings"
)

// maintenance_geo_settings.go——可線上調整的數值設定的維運端點(2026-10):
//
//	GET   /internal/maintenance/geo-settings          列出全部設定與目前值
//	PATCH /internal/maintenance/geo-settings/{key}    修改一項(body: {"value": N})
//
// 設定清單、預設值與合法範圍的唯一來源是 internal/geosettings 的登錄表
// (目前有 photoMaxCount 照片最大張數、photoExpiryDays 照片過期週期);
// 這裡只做權限、驗證、寫入與套用。呼叫者是 tripace-cli 的 geo-setting 指令。
//
// 權限:這批設定直接影響 Google Places 的呼叫量與費用,跟限流、field mask
// 一樣必須是管理員——internalAuth 只驗 JWT 簽章、不判斷角色,任何登入使用者
// 都過得了,所以每支 handler 自己檢查(見 requireRateLimitAdmin)。

// handleMaintenanceGeoSettingList 回傳每一項設定的說明、預設值、合法範圍、
// 目前值,以及這個值是「已自訂」還是「仍是預設」。
func (s *Server) handleMaintenanceGeoSettingList(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以檢視數值設定")
		return
	}
	rows, err := s.store.ListGeoSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	stored := make(map[string]int, len(rows))
	for _, row := range rows {
		stored[row.Key] = row.Value
	}

	out := make([]map[string]any, 0, len(geosettings.Registry))
	for _, st := range geosettings.Registry {
		value, configured := st.Default, false
		// 資料庫裡的壞值(例如有人直接改成 0)不能顯示成「目前值」:載入端會把它
		// 退回預設(見 cmd/server 的 applyGeoSettingsFromStore),這裡要跟實際
		// 生效的一致,否則列表會把「設定壞了」顯示成「設定正常」。
		if v, ok := stored[st.Key]; ok && st.Validate(v) == nil {
			value, configured = v, true
		}
		out = append(out, map[string]any{
			"key":        st.Key,
			"desc":       st.Desc,
			"default":    st.Default,
			"min":        st.Min,
			"max":        st.Max,
			"value":      value,
			"configured": configured,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"settings":         out,
		"appliesWithinSec": int(geosettings.RefreshInterval.Seconds()),
	})
}

// handleMaintenanceGeoSettingSet 修改一項設定。非法輸入一律拒絕、不靜默修正
// (key 不在登錄表、value 不是整數、超出合法範圍),拒絕時不寫資料庫、
// 不動執行中的狀態。成功時立即套用到這個實例;多實例部署時其他實例在
// geosettings.RefreshInterval 內由背景重讀跟上。
func (s *Server) handleMaintenanceGeoSettingSet(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以修改數值設定")
		return
	}
	key := r.PathValue("key")
	setting := geosettings.Find(key)
	if setting == nil {
		known := make([]string, 0, len(geosettings.Registry))
		for _, x := range geosettings.Registry {
			known = append(known, x.Key)
		}
		writeErr(w, http.StatusBadRequest, "unknown_setting",
			"不是登錄表裡的設定;可用的有: "+strings.Join(known, ", "))
		return
	}

	var body struct {
		Value json.RawMessage `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "請求內容不是合法的 JSON")
		return
	}
	if len(body.Value) == 0 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 value")
		return
	}
	// 只接受 JSON 整數:字串("5")、小數(2.5)、null 一律拒絕——不靜默轉型,
	// 避免運維以為設定成功、實際套用的是另一個值。
	value, err := strconv.Atoi(string(body.Value))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "value 必須是整數")
		return
	}
	if err := setting.Validate(value); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}

	if err := s.store.UpsertGeoSetting(key, value); err != nil {
		writeErr(w, http.StatusInternalServerError, "save_failed", err.Error())
		return
	}
	s.ApplyGeoSetting(key, value)

	writeJSON(w, http.StatusOK, map[string]any{
		"key":              key,
		"value":            value,
		"default":          setting.Default,
		"configured":       true,
		"appliesWithinSec": int(geosettings.RefreshInterval.Seconds()),
	})
}

// ApplyGeoSetting 把一項設定的值套用到執行中的 Server。維運端點寫入後呼叫,
// 啟動與背景重讀(cmd/server 的 applyGeoSettingsFromStore)也走同一個入口。
// 不認得的 key 一律忽略:資料庫可能留有程式已移除的舊設定。
func (s *Server) ApplyGeoSetting(key string, value int) {
	switch key {
	case geosettings.KeyPhotoMaxCount:
		s.SetPhotoMaxCount(value)
	case geosettings.KeyPhotoExpiryDays:
		s.SetPhotoExpiryDays(value)
	case geosettings.KeyPlaceDetailsCacheHours:
		s.SetPlaceDetailsCacheHours(value)
	}
}
