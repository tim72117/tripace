package trip

import (
	"time"

	"github.com/tim72117/tripace/internal/store"
)

// formatTripBoundary 把一個 trip/entry 的時間端點(UTC)依 loc 格式化成給 LLM
// 讀的單一字串:全日或無時刻時只顯示日期,有時刻時顯示「日期 時刻」。
// t 為 nil 時回空字串。這是這幾個工具(list_trips/trip_entries)共用的顯示
// 邏輯,故獨立成檔案,不在每個工具裡各自組字串。
func formatTripBoundary(t *time.Time, loc *time.Location) string {
	if t == nil {
		return ""
	}
	date, timeStr := store.FormatLocalDateTime(t, loc, false)
	if timeStr == "" {
		return date
	}
	return date + " " + timeStr
}
