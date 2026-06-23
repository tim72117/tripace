package wanttools

import (
	"strings"
	"time"

	"github.com/olebedev/when"
	"github.com/olebedev/when/rules/common"
	"github.com/olebedev/when/rules/en"
)

// whenParser 是共用的英文自然語言時間解析器(olebedev/when 的 en 規則)。
// LLM 負責把使用者語意翻成英文時間語詞(如 "next Monday at 10am"),
// 由這裡確定性換算成絕對時間——避免 LLM 自己算日期算錯。
var whenParser = func() *when.Parser {
	w := when.New(nil)
	w.Add(en.All...)
	w.Add(common.All...)
	return w
}()

// resolveDate 把英文日期語詞(如 "next Monday"、"in 3 days"、"June 30")
// 依基準時間 now 換算成 'YYYY-MM-DD'。解析不出或為空時回傳空字串。
// 只取日期部分——時刻由 LLM 另外用 24 小時制給,when 不負責時刻(避免填到當下時間)。
func resolveDate(phrase string, now time.Time) string {
	phrase = strings.TrimSpace(phrase)
	if phrase == "" {
		return ""
	}
	// 已是絕對格式就直接取日期部分。
	if t, ok := tryParseAbsolute(phrase); ok {
		return t.Format("2006-01-02")
	}
	r, err := whenParser.Parse(phrase, now)
	if err != nil || r == nil {
		return ""
	}
	return r.Time.Format("2006-01-02")
}

// combineDateTime 把日期語詞 + 24 小時制時刻(HH:MM,可空)組成儲存字串。
//   - 日期解析不出 → 空字串(無時間)。
//   - 有 clock(如 "10:00")→ 'YYYY-MM-DD HH:MM'。
//   - 無 clock → 'YYYY-MM-DD'(全日,時刻由 LLM 留空即代表全日)。
func combineDateTime(datePhrase, clock string, now time.Time) string {
	date := resolveDate(datePhrase, now)
	if date == "" {
		return ""
	}
	clock = strings.TrimSpace(clock)
	if !validClock(clock) {
		return date
	}
	return date + " " + clock
}

// validClock 檢查是否為合法的 24 小時制 'HH:MM'。
func validClock(s string) bool {
	if len(s) != 5 || s[2] != ':' {
		return false
	}
	if _, err := time.Parse("15:04", s); err != nil {
		return false
	}
	return true
}

// tryParseAbsolute 嘗試把已是絕對格式的字串解析成 time(容許 LLM 直接給絕對日期)。
func tryParseAbsolute(s string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02 15:04", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
