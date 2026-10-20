package fieldmasks

import (
	"strings"
	"testing"
)

// 這份登錄表直接決定每次 Google Places 呼叫的計費層級(見 registry.go
// 檔頭)。測試守的是那些會靜默出錯的地方:key 重複、欄位同時出現在
// 必填與選填、計費層級判斷錯、mask 前綴漏掉。

func TestScenarioKeysAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range Registry {
		if seen[s.Key] {
			t.Errorf("情境 key %q 重複——Find 只會回傳第一個,另一個的設定永遠讀不到", s.Key)
		}
		seen[s.Key] = true
	}
}

func TestScenariosAreComplete(t *testing.T) {
	for _, s := range Registry {
		if s.Key == "" {
			t.Error("有情境的 Key 是空字串")
		}
		if s.Endpoint == "" {
			t.Errorf("%s 缺少 Endpoint", s.Key)
		}
		if s.Desc == "" {
			t.Errorf("%s 缺少 Desc", s.Key)
		}
		if len(s.Required) == 0 {
			t.Errorf("%s 沒有任何必填欄位——那代表這個情境可以被設定成什麼都不取,查了也沒用", s.Key)
		}
		// 必填欄位必須是 Essentials:它們不可移除,若其中有 Pro/Enterprise
		// 級的欄位,這個情境就永遠無法降到最便宜的層級,而「必填」這個
		// 設計的前提是「留著不影響價格」。
		for _, f := range s.Required {
			if f.Tier != TierEssentials {
				t.Errorf("%s 的必填欄位 %s 是 %s 級——必填欄位不可移除,"+
					"帶著非 Essentials 級的欄位會讓這個情境無法降價", s.Key, f.Name, f.Tier)
			}
		}
		// 同一個欄位不該同時出現在必填與選填:IsRequired 與 Knows 會給出
		// 互相矛盾的答案,而維運端點靠它們判斷「可不可以移除」。
		req := map[string]bool{}
		for _, f := range s.Required {
			req[f.Name] = true
		}
		for _, f := range s.Optional {
			if req[f.Name] {
				t.Errorf("%s 的欄位 %s 同時列在 Required 與 Optional", s.Key, f.Name)
			}
		}
		for _, f := range s.AllFields() {
			if f.Name == "" {
				t.Errorf("%s 有欄位缺少 Name", s.Key)
			}
			if f.Desc == "" {
				t.Errorf("%s 的欄位 %s 缺少 Desc——CLI 靠它讓人判斷該不該砍這個欄位", s.Key, f.Name)
			}
		}
	}
}

func TestTierOfTakesTheHighest(t *testing.T) {
	sc := Find(ScenarioPlaceDetails)
	if sc == nil {
		t.Fatal("找不到 placeDetails 情境")
	}
	cases := []struct {
		name   string
		fields []string
		want   Tier
	}{
		{"只有必填 → Essentials", []string{"displayName", "formattedAddress", "location"}, TierEssentials},
		{"加 photos → Pro", []string{"displayName", "location", "photos"}, TierPro},
		{"加 rating → Pro", []string{"displayName", "location", "rating"}, TierPro},
		// 這是整個設定存在的理由:單一欄位把價格從 $17 推到 $25。
		{"加 editorialSummary → Enterprise+Atmosphere", []string{"displayName", "location", "editorialSummary"}, TierEnterprise},
		{"Pro 與 Enterprise 並存時取最貴", []string{"displayName", "photos", "editorialSummary"}, TierEnterprise},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := sc.TierOf(c.fields); got != c.want {
				t.Errorf("TierOf(%v) = %q, 想要 %q", c.fields, got, c.want)
			}
		})
	}
}

func TestMaskAppliesPrefix(t *testing.T) {
	// Place Details 回傳單一物件,欄位不帶前綴。
	pd := Find(ScenarioPlaceDetails)
	if got := pd.Mask([]string{"displayName", "location"}); got != "displayName,location" {
		t.Errorf("placeDetails mask = %q,不該有前綴", got)
	}
	// searchNearby/searchText 回傳陣列,欄位要 "places." 前綴——漏掉的
	// 話 Google 會回 400,那個情境的查詢全部失敗。
	ns := Find(ScenarioNearbySearch)
	if got := ns.Mask([]string{"id", "displayName"}); got != "places.id,places.displayName" {
		t.Errorf("nearbySearch mask = %q,想要帶 places. 前綴", got)
	}
}

// 預設值必須等於改動前 geo/places.go 裡那幾個 const 的欄位組合。
//
// 2026-10（review 發現）：原本這支測試斷言的是
// len(DefaultFields()) == len(AllFields())——那守的是「預設=全部欄位」
// 這個**實作細節**,不是登錄表註解宣稱的「預設=改動前的 const」。
// nearbySearch 多放了兩個 Pro 級欄位進 Optional 時,那個斷言照樣通過,
// 而實際後果是整個情境的計費從 Essentials 跳到 Pro。
//
// 改成把四份原始 const 硬寫進測試、逐情境做集合比較:這樣「不小心多/少
// 一個欄位」會立刻紅,而且紅的訊息直接指出是哪個欄位。
func TestDefaultFieldsMatchPreChangeConstants(t *testing.T) {
	// 這四份字串逐字取自改動前的 server/internal/geo/places.go
	// (git show HEAD:server/internal/geo/places.go)。前綴照原樣保留,
	// 比較時用 Scenario.Mask(DefaultFields()) 對照,連前綴一起驗。
	want := map[string]string{
		ScenarioPlaceDetails:  "displayName,formattedAddress,location,rating,photos,editorialSummary",
		ScenarioNearbySearch:  "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType",
		ScenarioTextSearch:    "places.displayName,places.formattedAddress,places.location,places.id",
		ScenarioCityDistricts: "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.rating,places.photos,places.editorialSummary",
	}
	for _, s := range Registry {
		original, ok := want[s.Key]
		if !ok {
			t.Errorf("情境 %s 沒有登記改動前的原值——新增情境時要把它的原始 const 加進這支測試,"+
				"否則預設值偏移不會被發現", s.Key)
			continue
		}
		gotSet := toSet(strings.Split(s.Mask(s.DefaultFields()), ","))
		wantSet := toSet(strings.Split(original, ","))
		for f := range wantSet {
			if !gotSet[f] {
				t.Errorf("%s 的預設值少了欄位 %s——改動前的 const 有它,"+
					"少取會讓對應的畫面內容變空", s.Key, f)
			}
		}
		for f := range gotSet {
			if !wantSet[f] {
				t.Errorf("%s 的預設值多了欄位 %s——改動前的 const 沒有它。"+
					"多一個欄位可能讓整個情境的計費跳檔(Google 按最高層級的那一個收費)",
					s.Key, f)
			}
		}
	}
}

func toSet(list []string) map[string]bool {
	out := map[string]bool{}
	for _, s := range list {
		if s = strings.TrimSpace(s); s != "" {
			out[s] = true
		}
	}
	return out
}

func TestDefaultFieldsCoversRequired(t *testing.T) {
	for _, s := range Registry {
		def := s.DefaultFields()
		// 預設值必須包含全部必填欄位,否則 seeding 寫進去的就是一份
		// 無效設定。
		for _, f := range s.Required {
			if !containsStr(def, f.Name) {
				t.Errorf("%s 的 DefaultFields 缺少必填欄位 %s", s.Key, f.Name)
			}
		}
	}
}

func TestKnowsAndIsRequired(t *testing.T) {
	sc := Find(ScenarioPlaceDetails)
	if !sc.Knows("editorialSummary") {
		t.Error("Knows 應認得 editorialSummary")
	}
	if sc.Knows("bogusField") {
		t.Error("Knows 不該認得不存在的欄位——那會讓它被設定進去,導致 Google 回 400")
	}
	if !sc.IsRequired("location") {
		t.Error("location 應是必填")
	}
	if sc.IsRequired("editorialSummary") {
		t.Error("editorialSummary 不該是必填——它正是要能被拿掉的那一個")
	}
}

func TestFind(t *testing.T) {
	if Find(ScenarioCityDistricts) == nil {
		t.Error("Find 查不到 cityDistricts")
	}
	if Find("does.not.exist") != nil {
		t.Error("Find 對不存在的 key 應回 nil")
	}
}

// 登錄表裡的每個欄位名稱都該是合法的 Places API 欄位格式(駝峰、無前綴、
// 無空白)——前綴由 Mask 統一加上,若欄位名稱自己帶了 "places." 就會變成
// "places.places.id" 這種無效值。
func TestFieldNamesHaveNoPrefix(t *testing.T) {
	for _, s := range Registry {
		for _, f := range s.AllFields() {
			if strings.Contains(f.Name, ".") {
				t.Errorf("%s 的欄位名稱 %q 含有點號——前綴由 Mask 統一加上,"+
					"名稱本身不該帶", s.Key, f.Name)
			}
			if strings.TrimSpace(f.Name) != f.Name {
				t.Errorf("%s 的欄位名稱 %q 前後有空白", s.Key, f.Name)
			}
		}
	}
}

func containsStr(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
