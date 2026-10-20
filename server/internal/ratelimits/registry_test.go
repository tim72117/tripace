package ratelimits

import "testing"

// 這份登錄表是「設定散在四處、改一處漏一處就靜默失效」的修正(見
// registry.go 檔頭)。測試守的就是那個失效模式本身:endpoint key 重複
// 或規則不完整時,實際後果是 SetLimitForKey 設定的是一條規則、Allow 查
// 的是另一條,等於那條規則完全沒有限流——而且不會有任何錯誤訊息。

func TestRegistryEndpointsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, r := range Registry {
		if seen[r.Endpoint] {
			t.Errorf("endpoint %q 重複——這會讓其中一條規則被另一條覆寫,且沒有任何錯誤訊息", r.Endpoint)
		}
		seen[r.Endpoint] = true
	}
}

func TestRegistryRulesAreComplete(t *testing.T) {
	for _, r := range Registry {
		if r.Endpoint == "" {
			t.Error("有規則的 Endpoint 是空字串")
		}
		// 視窗或次數是 0 的規則,套進 RateLimiter 之後的行為不是「不限制」
		// 就是「全部拒絕」,兩者都不是任何人想要的——這種值只可能是漏填。
		if r.DefaultWindow <= 0 {
			t.Errorf("%s 的 DefaultWindow 必須大於 0,目前是 %v", r.Endpoint, r.DefaultWindow)
		}
		if r.DefaultMaxCalls <= 0 {
			t.Errorf("%s 的 DefaultMaxCalls 必須大於 0,目前是 %d", r.Endpoint, r.DefaultMaxCalls)
		}
		if r.DefaultDailyMax < 0 {
			t.Errorf("%s 的 DefaultDailyMax 不可為負數(0 代表不限制),目前是 %d", r.Endpoint, r.DefaultDailyMax)
		}
		if r.Kind != KindGoogleAPI && r.Kind != KindPlanAIEndpoint {
			t.Errorf("%s 的 Kind 是未知值 %q——applyRateLimitsFromStore 的 switch 會整條略過它,等於這條規則永遠不會被套用", r.Endpoint, r.Kind)
		}
		// Desc/RejectBehavior 是 CLI 與後台顯示用的,缺了會印出空白欄位,
		// 讓操作者無從判斷調整這個值的代價。
		if r.Desc == "" {
			t.Errorf("%s 缺少 Desc", r.Endpoint)
		}
		if r.RejectBehavior == "" {
			t.Errorf("%s 缺少 RejectBehavior", r.Endpoint)
		}
	}
}

func TestFind(t *testing.T) {
	if got := Find(EndpointPublicPlaceSearch); got == nil {
		t.Fatal("Find 查不到 EndpointPublicPlaceSearch")
	} else if got.Kind != KindPlanAIEndpoint {
		t.Errorf("EndpointPublicPlaceSearch 的 Kind = %q, 想要 %q", got.Kind, KindPlanAIEndpoint)
	}
	if got := Find("does.not.exist"); got != nil {
		t.Errorf("Find 對不存在的 endpoint 應回 nil,得到 %+v", got)
	}
}

func TestOfKindSplitsAllRules(t *testing.T) {
	google := OfKind(KindGoogleAPI)
	planAI := OfKind(KindPlanAIEndpoint)
	// 兩類加起來必須等於全部——有規則落在兩類之外時,它不會被任何一邊
	// 套用(見 TestRegistryRulesAreComplete 對 Kind 的檢查),這裡從
	// 總數再守一次。
	if len(google)+len(planAI) != len(Registry) {
		t.Errorf("OfKind 兩類合計 %d 條,但 Registry 有 %d 條——有規則不屬於任何一類",
			len(google)+len(planAI), len(Registry))
	}
	// 斷言那兩個具名 endpoint 都在,而不是比總數——比總數的話,日後正當
	// 地新增第三條 plan-ai 規則會讓這支測試紅,而那會訓練出「測試紅了
	// 就改數字」的習慣(review 指出)。
	want := map[string]bool{
		EndpointPublicPlaceSearch:      false,
		EndpointNearbyAttractionSearch: false,
	}
	for _, r := range planAI {
		if _, ok := want[r.Endpoint]; ok {
			want[r.Endpoint] = true
		}
	}
	for ep, found := range want {
		if !found {
			t.Errorf("%s 應該屬於 KindPlanAIEndpoint,但不在 OfKind 的結果裡", ep)
		}
	}
}
