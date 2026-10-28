package adlink

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestValidKKdayURL(t *testing.T) {
	ok := []string{
		"https://www.kkday.com/zh-tw/product/2287",
		"https://kkday.com/en/product/1",
		"https://WWW.KKDAY.COM/zh-tw/product/1",
	}
	for _, s := range ok {
		if _, err := ValidKKdayURL(s); err != nil {
			t.Errorf("%q 應通過: %v", s, err)
		}
	}
	bad := []string{
		"",
		"javascript:alert(1)",
		"http://www.kkday.com/zh-tw/product/1",
		"https://evil.com/?u=https://www.kkday.com",
		"https://kkday.com.evil.com/x",
		"https://notkkday.com/x",
		"https://www.kkday.com@evil.com/x",
		"https://user:pw@www.kkday.com/x",
		"//www.kkday.com/x",
	}
	for _, s := range bad {
		if _, err := ValidKKdayURL(s); err == nil {
			t.Errorf("%q 不該通過", s)
		}
	}
}

func TestNormalizeKKdayDetail(t *testing.T) {
	out, err := NormalizeKKdayDetail(`{"cid":"tripace-27468","landingUrl":"https://www.kkday.com/zh-tw/product/2287?cid=other&ud1=x","desc":"九份一日遊"}`)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(m["landingUrl"])
	if u.Query().Get("cid") != "tripace-27468" || u.Query().Get("ud1") != "x" {
		t.Fatalf("cid 應被覆寫、其他參數保留: %s", m["landingUrl"])
	}
	if m["desc"] != "九份一日遊" {
		t.Fatalf("其他欄位應保留: %v", m)
	}

	bad := map[string]string{
		"缺 cid":      `{"landingUrl":"https://www.kkday.com/x"}`,
		"cid 含空白":    `{"cid":"a b","landingUrl":"https://www.kkday.com/x"}`,
		"cid 含符號":    `{"cid":"a&cid=b","landingUrl":"https://www.kkday.com/x"}`,
		"缺網址":        `{"cid":"abc"}`,
		"非 kkday 網域": `{"cid":"abc","landingUrl":"https://example.com/x"}`,
		"不是物件":       `[1]`,
		"參考價太長":      `{"cid":"abc","landingUrl":"https://www.kkday.com/x","fromPrice":"一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一"}`,
		"參考價非字串":     `{"cid":"abc","landingUrl":"https://www.kkday.com/x","fromPrice":599}`,
	}
	for name, d := range bad {
		if _, err := NormalizeKKdayDetail(d); err == nil {
			t.Errorf("%s 不該通過", name)
		}
	}
}

func TestSafeForPublic(t *testing.T) {
	if !SafeForPublic("group_tour", `{"landingUrl":"https://example.com"}`) {
		t.Error("非 KKday 方案不受影響")
	}
	if SafeForPublic("kkday", `{"cid":"abc","landingUrl":"https://example.com"}`) {
		t.Error("KKday 方案網域不對不該輸出")
	}
	if !SafeForPublic("kkday", `{"cid":"abc","landingUrl":"https://www.kkday.com/x"}`) {
		t.Error("合法的 KKday 方案應輸出")
	}
}

func TestCheckLandingURL(t *testing.T) {
	ok := []string{
		`{}`, ``, `not json`, `{"landingUrl":""}`, `{"desc":"x"}`,
		`{"landingUrl":"https://example.com/a?b=1"}`, `{"landingUrl":"http://example.com"}`,
	}
	for _, d := range ok {
		if err := CheckLandingURL(d); err != nil {
			t.Errorf("%q 應通過: %v", d, err)
		}
	}
	bad := []string{
		`{"landingUrl":"javascript:alert(1)"}`,
		`{"landingUrl":"JavaScript:alert(1)"}`,
		`{"landingUrl":"data:text/html,<script>alert(1)</script>"}`,
		`{"landingUrl":"vbscript:x"}`,
		`{"landingUrl":"//example.com"}`,
		`{"landingUrl":"/relative"}`,
		`{"landingUrl":"https://user:pw@example.com"}`,
		`{"landingUrl":123}`,
	}
	for _, d := range bad {
		if err := CheckLandingURL(d); err == nil {
			t.Errorf("%q 不該通過", d)
		}
	}
}

func TestIsKKdayCategoryAndPublicFilter(t *testing.T) {
	for _, c := range []string{"kkday", "KKday", " kkday ", "KKDAY"} {
		if !IsKKdayCategory(c) {
			t.Errorf("%q 應視為 KKday", c)
		}
	}
	if IsKKdayCategory("group_tour") || IsKKdayCategory("") {
		t.Error("其他分類不是 KKday")
	}
	// 非統一寫法的 KKday 分類(只可能是直接改資料庫)不對外輸出
	if SafeForPublic("KKday", `{"cid":"abc","landingUrl":"https://www.kkday.com/x"}`) {
		t.Error("分類寫法不統一不該輸出")
	}
	// 非 KKday 方案的危險協定不對外輸出
	if SafeForPublic("group_tour", `{"landingUrl":"javascript:alert(1)"}`) {
		t.Error("javascript: 不該輸出")
	}
	if !SafeForPublic("group_tour", `{"landingUrl":"https://example.com"}`) {
		t.Error("一般 https 連結應輸出")
	}
}
