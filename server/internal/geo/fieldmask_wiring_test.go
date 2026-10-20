package geo

import (
	"os"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/fieldmasks"
)

// 這支測試守的是一個靜默失效:登錄表定義了一個情境,但 places.go 沒有任何
// 呼叫點走 fieldMaskFor 去讀它。
//
// 2026-10（review 發現）：textSearch 正是這樣漏掉的——登錄表有它、CLI 可以
// 設定它、`field-mask list` 會顯示「已自訂」並印出新的 mask 與計費層級,
// 但 Client.Search 直寫 const,實際送給 Google 的 header 永遠是程式碼裡的
// 值。操作者以為砍了欄位、降了計費檔,實際完全沒有——在成本控制功能上
// 這種「設定成功的假象」特別危險。
//
// 用掃原始碼而非執行期檢查:fieldMaskFor 的呼叫散在各個 API 方法裡,要在
// 執行期觸發它們得真的打 Google API。掃原始碼雖然粗,但它守的正是「有沒有
// 人寫了這行」這件事,而那就是會漏掉的東西。
func TestEveryScenarioHasACallSite(t *testing.T) {
	src, err := os.ReadFile("places.go")
	if err != nil {
		t.Fatalf("讀取 places.go 失敗: %v", err)
	}
	code := string(src)
	for _, sc := range fieldmasks.Registry {
		want := "fieldMaskFor(\"" + sc.Key + "\""
		if !strings.Contains(code, want) {
			t.Errorf("登錄表有情境 %q,但 places.go 沒有任何 %s 的呼叫點——"+
				"CLI 可以設定它卻完全不生效,操作者會以為設定成功了", sc.Key, want)
		}
	}
}

// fieldMaskFor 的 fallback 與 SetFieldMaskOverrides 的整份取代語意。
func TestFieldMaskOverrides(t *testing.T) {
	// 測試之間會互相污染(package 級狀態),每個案例自己清乾淨。
	defer SetFieldMaskOverrides(nil)

	SetFieldMaskOverrides(nil)
	if got := fieldMaskFor("placeDetails", "fallback-value"); got != "fallback-value" {
		t.Errorf("沒有覆寫時應回 fallback,得到 %q", got)
	}

	SetFieldMaskOverrides(map[string]string{"placeDetails": "a,b,c"})
	if got := fieldMaskFor("placeDetails", "fallback-value"); got != "a,b,c" {
		t.Errorf("有覆寫時應回覆寫值,得到 %q", got)
	}
	// 沒被覆寫的 key 仍走 fallback。
	if got := fieldMaskFor("nearbySearch", "nearby-fallback"); got != "nearby-fallback" {
		t.Errorf("未覆寫的 key 應回 fallback,得到 %q", got)
	}

	// 整份取代:上一次設定的 placeDetails 應該消失,不是跟新的合併。
	SetFieldMaskOverrides(map[string]string{"nearbySearch": "x,y"})
	if got := fieldMaskFor("placeDetails", "fallback-value"); got != "fallback-value" {
		t.Errorf("整份取代後舊的覆寫應消失、回到 fallback,得到 %q——"+
			"若是合併語意,「某個情境的設定被刪掉」這件事就無法表達", got)
	}

	// 空字串值要被濾掉:送一個空 mask 給 Google 會回 400。
	SetFieldMaskOverrides(map[string]string{"placeDetails": ""})
	if got := fieldMaskFor("placeDetails", "fallback-value"); got != "fallback-value" {
		t.Errorf("空字串覆寫應被濾掉、回到 fallback,得到 %q", got)
	}
}

// hasField 用逗號切開精確比對,不是 strings.Contains——欄位名稱可能是
// 另一個的子字串。
func TestHasField(t *testing.T) {
	cases := []struct {
		mask  string
		field string
		want  bool
	}{
		{"places.id,places.photos", "places.photos", true},
		{"places.id,places.displayName", "places.photos", false},
		// 子字串的陷阱:"photos" 出現在 "places.photos" 裡面,但它不是
		// 一個獨立的欄位。Contains 會誤判成已存在,於是漏掉該附加的欄位。
		{"places.photos", "photos", false},
		{"places.id, places.photos", "places.photos", true}, // 容忍空白
		{"", "places.photos", false},
	}
	for _, c := range cases {
		if got := hasField(c.mask, c.field); got != c.want {
			t.Errorf("hasField(%q, %q) = %v, 想要 %v", c.mask, c.field, got, c.want)
		}
	}
}
