package store

// timeconv.go:store 之外的呼叫端(tripsvc、wanttools)仍然只處理「日期字串 +
// 24 小時制時刻字串」這種人類可讀格式(這是 LLM 與前端表單最自然的輸入/
// 顯示形式),真正的 timestamptz 只存在於 store 內部與資料庫。這裡提供一組
// 匯出的轉換函式當作邊界,讓字串 ↔ time.Time 的轉換邏輯集中一處、行為一致,
// 不必在每個呼叫端各自重寫一份解析/格式化規則。

import "time"

// ParseLocalDateTime 把「本地日期字串 + 時刻字串」解析成 UTC 時刻。
// date 可能是 'YYYY-MM-DD' 或(相容舊資料)'YYYY-MM-DD HH:MM';
// timeStr 是 'HH:MM' 或空字串(空=全日)。loc 決定如何詮釋這兩個字串代表的
// 本地時刻。
//
// 回傳 (UTC 時刻, 是否為全日事件);date 為空或無法解析時回 (nil, false)。
func ParseLocalDateTime(date, timeStr string, loc *time.Location) (*time.Time, bool) {
	if date == "" {
		return nil, false
	}
	// 已含時刻的完整格式優先嘗試(相容舊資料可能把時刻併進 date 傳入的情況)。
	if t, err := time.ParseInLocation("2006-01-02 15:04", date, loc); err == nil {
		utc := t.UTC()
		return &utc, false
	}
	d, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return nil, false
	}
	if timeStr == "" {
		utc := d.UTC() // 全日事件:存當日在該時區的 00:00。
		return &utc, true
	}
	hm, err := time.ParseInLocation("2006-01-02 15:04", date+" "+timeStr, loc)
	if err != nil {
		utc := d.UTC() // 時刻格式不對,退回全日,不讓整筆因為時刻格式錯誤而丟失日期。
		return &utc, true
	}
	utc := hm.UTC()
	return &utc, false
}

// FormatLocalDateTime 是 ParseLocalDateTime 的反向:把 UTC 時刻依 loc 換算
// 回本地日期字串與時刻字串。t 為 nil 時回兩個空字串。allDay=true 時只回
// 日期部分,時刻固定回空字串(對齊「空字串=全日」的既有前端/LLM 慣例)。
func FormatLocalDateTime(t *time.Time, loc *time.Location, allDay bool) (date, timeStr string) {
	if t == nil {
		return "", ""
	}
	local := t.In(loc)
	if allDay {
		return local.Format("2006-01-02"), ""
	}
	return local.Format("2006-01-02"), local.Format("15:04")
}

// LoadTimeZoneOrDefault 解析 IANA 時區名;空字串或無法解析時回退到
// DefaultTimeZone()。供呼叫端在「entry 自己存的 tz 欄位」與「沒有 tz 時的
// fallback」之間統一處理,不必各自寫 if/else。
func LoadTimeZoneOrDefault(tz string) *time.Location {
	if tz == "" {
		return DefaultTimeZone()
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return DefaultTimeZone()
	}
	return loc
}
