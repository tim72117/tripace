// Package adlink 驗證廣告方案裡的外部導流連結。目前只處理 KKday 聯盟連結:
// 業主在方案 detail 填 cid(KKpartners 聯盟代碼)與 landingUrl(KKday 商品頁),
// 儲存時檢查網域並把 cid 寫進網址,前台點擊才會歸因到該業主的聯盟帳號。
// 同一份檢查在業主控制台寫入時與公開端點輸出時各跑一次,避免舊資料或直接
// 改資料庫繞過白名單。
package adlink

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// CategoryKKday 是 KKday 聯盟連結方案的 category 值。
const CategoryKKday = "kkday"

// maxFromPriceRunes 限制參考價文字長度,避免被拿來塞宣傳長文。
const maxFromPriceRunes = 30

var cidPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// IsKKdayCategory 判斷分類是不是 KKday(不分大小寫、忽略前後空白,避免靠大小寫繞過
// KKday 的網域檢查);寫入時會把分類統一成 CategoryKKday,前台才認得。
func IsKKdayCategory(category string) bool {
	return strings.EqualFold(strings.TrimSpace(category), CategoryKKday)
}

// CheckLandingURL 檢查方案 detail 裡的 landingUrl:有填的話只允許 http(s) 且有主機、
// 沒有內嵌帳密。這是所有分類共用的底線,擋掉 javascript:、data: 等會在訪客瀏覽器
// 執行的協定(前台把 landingUrl 直接放進 <a href>)。detail 不是 JSON 物件或沒有
// landingUrl 時不檢查(前台解析不到也不會顯示按鈕)。
func CheckLandingURL(detail string) error {
	var m map[string]any
	if json.Unmarshal([]byte(detail), &m) != nil || m == nil {
		return nil
	}
	v, ok := m["landingUrl"]
	if !ok {
		return nil
	}
	raw, isStr := v.(string)
	if !isStr {
		return errors.New("landingUrl 必須是字串")
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return errors.New("landingUrl 不是有效的網址")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("landingUrl 只能是 http 或 https 網址")
	}
	if u.User != nil {
		return errors.New("landingUrl 不可包含帳號密碼")
	}
	return nil
}

// ValidKKdayURL 檢查是不是 https 的 kkday.com(含子網域)網址,且沒有內嵌帳密。
func ValidKKdayURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return nil, errors.New("landingUrl 不是有效的網址")
	}
	if u.Scheme != "https" {
		return nil, errors.New("landingUrl 必須是 https 網址")
	}
	if u.User != nil {
		return nil, errors.New("landingUrl 不可包含帳號密碼")
	}
	host := strings.ToLower(u.Hostname())
	if host != "kkday.com" && !strings.HasSuffix(host, ".kkday.com") {
		return nil, errors.New("landingUrl 的網域必須是 kkday.com")
	}
	return u, nil
}

// NormalizeKKdayDetail 驗證 KKday 方案的 detail JSON 並回傳正規化後的字串:
// 要求 cid(英數、-、_,最長 64)與 kkday.com 的 landingUrl,並把網址的 cid
// 查詢參數覆寫成業主設定的 cid(業主貼進來的網址若帶了別的 cid 也會被改正)。
func NormalizeKKdayDetail(detail string) (string, error) {
	m := map[string]any{}
	if strings.TrimSpace(detail) != "" {
		if err := json.Unmarshal([]byte(detail), &m); err != nil || m == nil {
			return "", errors.New("detail 必須是 JSON 物件")
		}
	}
	cid, _ := m["cid"].(string)
	cid = strings.TrimSpace(cid)
	if !cidPattern.MatchString(cid) {
		return "", errors.New("cid 必填,只能包含英數字、- 與 _(最長 64 字)")
	}
	if fp, ok := m["fromPrice"]; ok {
		s, isStr := fp.(string)
		if !isStr || utf8.RuneCountInString(s) > maxFromPriceRunes {
			return "", errors.New("fromPrice 必須是不超過 30 字的字串,例如 \"NT$ 599 起\"")
		}
	}
	raw, _ := m["landingUrl"].(string)
	u, err := ValidKKdayURL(raw)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("cid", cid)
	u.RawQuery = q.Encode()

	m["cid"] = cid
	m["landingUrl"] = u.String()

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

// SafeForPublic 回傳這個方案能不能對外輸出:非 KKday 方案要通過 CheckLandingURL
// (只允許 http(s)),KKday 方案必須通過 NormalizeKKdayDetail 的檢查。
func SafeForPublic(category, detail string) bool {
	if !IsKKdayCategory(category) {
		return CheckLandingURL(detail) == nil
	}
	if category != CategoryKKday {
		return false // 分類寫法不是統一後的 "kkday",前台不會當成 KKday 處理
	}
	_, err := NormalizeKKdayDetail(detail)
	return err == nil
}
