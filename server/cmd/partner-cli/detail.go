package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"unicode/utf8"
)

type stringList []string

func (l *stringList) String() string     { return strings.Join(*l, ",") }
func (l *stringList) Set(v string) error { *l = append(*l, v); return nil }

func visitedFlags(fs *flag.FlagSet) map[string]bool {
	v := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { v[f.Name] = true })
	return v
}

// cleanText 擋下已損壞的文字:Windows shell 傳中文參數轉碼出錯時,內容會變成
// U+FFFD,寫進資料庫就無法還原。
func cleanText(label, s string) error {
	if !utf8.ValidString(s) || strings.ContainsRune(s, utf8.RuneError) {
		return fmt.Errorf("%s 含無法辨識的字元(U+FFFD),通常是 shell 傳遞中文時轉碼出錯;請改用 -detail-file(UTF-8 檔案)或網頁控制台輸入。若這是現有資料,請在這次指令用對應旗標一併重新指定", label)
	}
	return nil
}

// detailFlags 是 plan create/update 共用的方案內容旗標。
type detailFlags struct {
	detail        *string
	detailFile    *string
	departures    *stringList
	highlights    *stringList
	days          *string
	originalPrice *string
	desc          *string
	ctaLabel      *string
	landingURL    *string
}

func registerDetailFlags(fs *flag.FlagSet) *detailFlags {
	d := &detailFlags{departures: &stringList{}, highlights: &stringList{}}
	d.detail = fs.String("detail", "", "整份方案內容 JSON 字串(與 -detail-file 擇一;給了就取代現有內容)")
	d.detailFile = fs.String("detail-file", "", "從 UTF-8 檔案讀方案內容 JSON,'-' 代表 stdin(避開 shell 引號與轉碼問題)")
	fs.Var(d.departures, "departure", "出發日梯次,格式 \"日期|星期|團費\",例如 \"2026-10-27|星期二|$21,900\";可重複,給了就取代全部梯次")
	fs.Var(d.highlights, "highlight", "行程亮點,每個旗標一行;可重複,給了就取代全部亮點")
	d.days = fs.String("days", "", "天數,例如 5")
	d.originalPrice = fs.String("original-price", "", "原價,例如 \"$23,900\"")
	d.desc = fs.String("desc", "", "說明文字")
	d.ctaLabel = fs.String("cta-label", "", "按鈕文字")
	d.landingURL = fs.String("landing-url", "", "按鈕連結(沒有連結前台就不顯示按鈕)")
	return d
}

var detailFlagNames = []string{"detail", "detail-file", "departure", "highlight", "days", "original-price", "desc", "cta-label", "landing-url"}

func (d *detailFlags) any(visited map[string]bool) bool {
	for _, n := range detailFlagNames {
		if visited[n] {
			return true
		}
	}
	return false
}

// build 組出要送出的 detail JSON 字串。changed=false 代表沒有任何內容旗標被
// 指定。給了 -detail/-detail-file 就以它為底,否則以 base(update 時是現有
// 內容)為底,再套上結構化旗標;沒給的欄位維持底稿的值。
func (d *detailFlags) build(base string, visited map[string]bool, stdin io.Reader) (out string, changed bool, err error) {
	if !d.any(visited) {
		return "", false, nil
	}
	if visited["detail"] && visited["detail-file"] {
		return "", false, fmt.Errorf("-detail 與 -detail-file 只能擇一")
	}
	if visited["detail"] {
		base = *d.detail
	}
	if visited["detail-file"] {
		b, err := readDetailFile(*d.detailFile, stdin)
		if err != nil {
			return "", false, err
		}
		base = b
	}

	m := map[string]any{}
	if strings.TrimSpace(base) != "" {
		if err := json.Unmarshal([]byte(base), &m); err != nil {
			return "", false, fmt.Errorf("方案內容必須是合法的 JSON 物件: %w", err)
		}
		if m == nil {
			m = map[string]any{}
		}
	}

	if visited["departure"] {
		deps := make([]any, 0, len(*d.departures))
		for _, s := range *d.departures {
			dep, err := parseDeparture(s)
			if err != nil {
				return "", false, err
			}
			deps = append(deps, dep)
		}
		m["departures"] = deps
	}
	if visited["highlight"] {
		setOrDelete(m, "highlights", strings.Join(*d.highlights, "\n"))
	}
	if visited["days"] {
		setOrDelete(m, "days", *d.days)
	}
	if visited["original-price"] {
		setOrDelete(m, "originalPrice", *d.originalPrice)
	}
	if visited["desc"] {
		setOrDelete(m, "desc", *d.desc)
	}
	if visited["cta-label"] {
		setOrDelete(m, "ctaLabel", *d.ctaLabel)
	}
	if visited["landing-url"] {
		setOrDelete(m, "landingUrl", *d.landingURL)
	}

	warnings, err := validateDetail(m)
	if err != nil {
		return "", false, err
	}
	for _, w := range warnings {
		fmt.Fprintln(os.Stderr, "警告:", w)
	}
	if err := checkCleanJSON(m, "detail"); err != nil {
		return "", false, err
	}

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		return "", false, err
	}
	return strings.TrimRight(buf.String(), "\n"), true, nil
}

func setOrDelete(m map[string]any, key, v string) {
	if v == "" {
		delete(m, key)
		return
	}
	m[key] = v
}

func parseDeparture(s string) (map[string]any, error) {
	parts := strings.Split(s, "|")
	if len(parts) != 3 {
		return nil, fmt.Errorf("-departure %q 格式錯誤,應為 \"日期|星期|團費\",例如 \"2026-10-27|星期二|$21,900\"(星期可留空:\"2026-10-27||$21,900\")", s)
	}
	date, weekday, price := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2])
	if date == "" || price == "" {
		return nil, fmt.Errorf("-departure %q 的日期與團費不能是空的", s)
	}
	return map[string]any{"date": date, "weekday": weekday, "price": price}, nil
}

func readDetailFile(path string, stdin io.Reader) (string, error) {
	var b []byte
	var err error
	if path == "-" {
		b, err = io.ReadAll(stdin)
	} else {
		b, err = os.ReadFile(path)
	}
	if err != nil {
		return "", fmt.Errorf("讀取 -detail-file 失敗: %w", err)
	}
	b = bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF})
	if !utf8.Valid(b) {
		return "", fmt.Errorf("-detail-file 不是 UTF-8 編碼(Windows PowerShell 5.1 的 > 預設會存成 UTF-16),請存成 UTF-8 再試")
	}
	return string(b), nil
}

var knownDetailKeys = map[string]bool{
	"departures": true, "days": true, "originalPrice": true,
	"highlights": true, "desc": true, "ctaLabel": true, "landingUrl": true,
}

func validateDetail(m map[string]any) (warnings []string, err error) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		v := m[k]
		if !knownDetailKeys[k] {
			warnings = append(warnings, fmt.Sprintf("未知欄位 %q,前台不會顯示(可用欄位:departures/days/originalPrice/highlights/desc/ctaLabel/landingUrl)", k))
			continue
		}
		if k != "departures" {
			if _, ok := v.(string); !ok {
				return nil, fmt.Errorf("detail.%s 必須是字串,收到 %T", k, v)
			}
			continue
		}
		deps, ok := v.([]any)
		if !ok {
			return nil, fmt.Errorf("detail.departures 必須是陣列,收到 %T", v)
		}
		for i, e := range deps {
			dep, ok := e.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("detail.departures[%d] 必須是物件", i)
			}
			for _, f := range []string{"date", "weekday", "price"} {
				fv, exists := dep[f]
				if !exists {
					continue
				}
				if _, ok := fv.(string); !ok {
					hint := ""
					if f == "price" {
						hint = "(團費請用帶格式的字串,例如 \"$32,900\",不要用純數字)"
					}
					return nil, fmt.Errorf("detail.departures[%d].%s 必須是字串,收到 %T%s", i, f, fv, hint)
				}
			}
		}
	}
	return warnings, nil
}

func checkCleanJSON(v any, path string) error {
	switch x := v.(type) {
	case string:
		return cleanText(path, x)
	case map[string]any:
		for k, e := range x {
			if err := checkCleanJSON(e, path+"."+k); err != nil {
				return err
			}
		}
	case []any:
		for i, e := range x {
			if err := checkCleanJSON(e, fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
	}
	return nil
}
