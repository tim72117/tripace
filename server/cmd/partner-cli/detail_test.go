package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"
)

func buildFrom(t *testing.T, base string, args ...string) (string, bool, error) {
	t.Helper()
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	df := registerDetailFlags(fs)
	if err := fs.Parse(args); err != nil {
		t.Fatalf("parse: %v", err)
	}
	return df.build(base, visitedFlags(fs), strings.NewReader(""))
}

func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("輸出不是合法 JSON: %v\n%s", err, s)
	}
	return m
}

func TestBuildNoFlagsMeansUnchanged(t *testing.T) {
	_, changed, err := buildFrom(t, `{"days":"5"}`)
	if err != nil || changed {
		t.Fatalf("changed=%v err=%v,沒給內容旗標應該不動 detail", changed, err)
	}
}

func TestBuildPartialKeepsOtherFields(t *testing.T) {
	base := `{"departures":[{"date":"2026-10-27","weekday":"星期二","price":"$21,900"}],"days":"5","desc":"舊說明"}`
	out, changed, err := buildFrom(t, base, "-desc", "新說明")
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	m := decode(t, out)
	if m["desc"] != "新說明" || m["days"] != "5" {
		t.Fatalf("只該改 desc、保留 days: %v", m)
	}
	if len(m["departures"].([]any)) != 1 {
		t.Fatalf("departures 不該被動到: %v", m["departures"])
	}
}

func TestBuildDepartureReplacesAllAndKeepsCommaPrice(t *testing.T) {
	base := `{"departures":[{"date":"2026-01-01","weekday":"","price":"$1"}],"days":"5"}`
	out, _, err := buildFrom(t, base, "-departure", "2026-10-27|星期二|$21,900", "-departure", "2026-11-03||$19,900")
	if err != nil {
		t.Fatal(err)
	}
	deps := decode(t, out)["departures"].([]any)
	if len(deps) != 2 {
		t.Fatalf("應取代成 2 個梯次: %v", deps)
	}
	first := deps[0].(map[string]any)
	if first["price"] != "$21,900" || first["weekday"] != "星期二" {
		t.Fatalf("梯次內容錯誤: %v", first)
	}
}

func TestBuildHighlightsJoinAndClear(t *testing.T) {
	out, _, err := buildFrom(t, "", "-highlight", "甲｜乙", "-highlight", "丙｜丁")
	if err != nil {
		t.Fatal(err)
	}
	if got := decode(t, out)["highlights"]; got != "甲｜乙\n丙｜丁" {
		t.Fatalf("highlights = %q", got)
	}
	out, _, err = buildFrom(t, `{"highlights":"x","days":"5"}`, "-highlight", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := decode(t, out)["highlights"]; ok {
		t.Fatalf("給空字串應清除 highlights: %s", out)
	}
}

func TestBuildDetailReplacesBase(t *testing.T) {
	out, _, err := buildFrom(t, `{"days":"9","desc":"舊"}`, "-detail", `{"days":"5"}`)
	if err != nil {
		t.Fatal(err)
	}
	m := decode(t, out)
	if m["days"] != "5" || m["desc"] != nil {
		t.Fatalf("-detail 應整份取代底稿: %v", m)
	}
}

func TestBuildDoesNotEscapeHTML(t *testing.T) {
	out, _, err := buildFrom(t, "", "-desc", "A&B <ok>")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "A&B <ok>") {
		t.Fatalf("不該把 & < > 轉成 \\u00xx: %s", out)
	}
}

func TestBuildRejectsBadInput(t *testing.T) {
	cases := []struct {
		name string
		base string
		args []string
		want string
	}{
		{"departure 格式錯", "", []string{"-departure", "2026-10-27|$21,900"}, "格式錯誤"},
		{"departure 缺團費", "", []string{"-departure", "2026-10-27|星期二|"}, "不能是空的"},
		{"price 純數字", "", []string{"-detail", `{"departures":[{"date":"d","weekday":"w","price":32900}]}`}, "不要用純數字"},
		{"departures 不是陣列", "", []string{"-detail", `{"departures":"x"}`}, "必須是陣列"},
		{"days 不是字串", "", []string{"-detail", `{"days":5}`}, "必須是字串"},
		{"不是物件", "", []string{"-detail", `[1,2]`}, "JSON 物件"},
		{"detail 與 detail-file 並用", "", []string{"-detail", "{}", "-detail-file", "x.json"}, "只能擇一"},
		{"內容含亂碼", "", []string{"-desc", "abc�def"}, "U+FFFD"},
		{"現有內容含亂碼", `{"desc":"x�y"}`, []string{"-days", "5"}, "U+FFFD"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, _, err := buildFrom(t, c.base, c.args...)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v,應包含 %q", err, c.want)
			}
		})
	}
}

func TestValidateDetailWarnsUnknownKey(t *testing.T) {
	warnings, err := validateDetail(map[string]any{"days": "5", "price": "$1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], `"price"`) {
		t.Fatalf("未知欄位應只警告不報錯: %v", warnings)
	}
}

func TestReadDetailFile(t *testing.T) {
	dir := t.TempDir()
	const body = `{"desc":"中文內容"}`

	write := func(name string, b []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, b, 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}

	got, err := readDetailFile(write("utf8.json", []byte(body)), nil)
	if err != nil || got != body {
		t.Fatalf("UTF-8: %q %v", got, err)
	}

	got, err = readDetailFile(write("bom.json", append([]byte{0xEF, 0xBB, 0xBF}, body...)), nil)
	if err != nil || got != body {
		t.Fatalf("UTF-8 BOM 應被剝掉: %q %v", got, err)
	}

	u16 := utf16.Encode([]rune(body))
	raw := []byte{0xFF, 0xFE}
	for _, c := range u16 {
		raw = append(raw, byte(c), byte(c>>8))
	}
	if _, err := readDetailFile(write("utf16.json", raw), nil); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("UTF-16 應被擋下並提示編碼: %v", err)
	}

	got, err = readDetailFile("-", strings.NewReader(body))
	if err != nil || got != body {
		t.Fatalf("stdin: %q %v", got, err)
	}
}

func TestCleanText(t *testing.T) {
	if err := cleanText("x", "北海道溫泉 5日 $21,900 ｜＋"); err != nil {
		t.Fatalf("正常文字不該被擋: %v", err)
	}
	if err := cleanText("x", "a�b"); err == nil {
		t.Fatal("含 U+FFFD 應被擋")
	}
	if err := cleanText("x", "a\xffb"); err == nil {
		t.Fatal("非法 UTF-8 應被擋")
	}
}

func TestBuildCIDAndLandingURL(t *testing.T) {
	out, changed, err := buildFrom(t, `{"desc":"舊說明"}`, "-cid", "tripace-27468", "-landing-url", "https://www.kkday.com/zh-tw/product/2287")
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	m := decode(t, out)
	if m["cid"] != "tripace-27468" || m["landingUrl"] != "https://www.kkday.com/zh-tw/product/2287" || m["desc"] != "舊說明" {
		t.Fatalf("cid/landingUrl 應寫入且保留其他欄位: %v", m)
	}
	out, _, _ = buildFrom(t, out, "-cid", "")
	if _, ok := decode(t, out)["cid"]; ok {
		t.Fatalf("-cid \"\" 應清除 cid: %s", out)
	}
}

func TestBuildFromPrice(t *testing.T) {
	out, _, err := buildFrom(t, ``, "-from-price", "NT$ 599 起")
	if err != nil || decode(t, out)["fromPrice"] != "NT$ 599 起" {
		t.Fatalf("fromPrice 應寫入: %s %v", out, err)
	}
	out, _, _ = buildFrom(t, out, "-from-price", "")
	if _, ok := decode(t, out)["fromPrice"]; ok {
		t.Fatalf("-from-price \"\" 應清除: %s", out)
	}
}
