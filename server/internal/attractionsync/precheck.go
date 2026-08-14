package attractionsync

import "time"

// SchemaField 對應 attractions 表單一欄位的名稱與型別，供 CompareSchema
// 比對兩邊 schema 是否一致（見 docs/ATTRACTION_SYNC_DESIGN.md「零、
// 前置檢查」：只比對欄位名稱與型別，不涉及索引/約束）。
type SchemaField struct {
	Name string
	Type string
}

// SchemaCompareResult 是 CompareSchema 的輸出。Mismatches 用人類可讀的
// 句子描述每一項不一致，供中止時直接呈現給使用者（設計文件要求「列出
// 具體差異：缺少哪個欄位、哪個欄位型別不同」）。
type SchemaCompareResult struct {
	Match      bool
	Mismatches []string
}

// CompareSchema 比對兩邊 attractions 表的欄位集合與型別，不依賴輸入
// 順序。兩邊欄位集合與型別完全一致才判定 Match = true；不一致時列出
// 每一項具體差異（缺少的欄位、型別不同的欄位），不嘗試猜測相容性。
func CompareSchema(a, b []SchemaField) SchemaCompareResult {
	aByName := make(map[string]string, len(a))
	for _, f := range a {
		aByName[f.Name] = f.Type
	}
	bByName := make(map[string]string, len(b))
	for _, f := range b {
		bByName[f.Name] = f.Type
	}

	var mismatches []string
	for name, aType := range aByName {
		bType, ok := bByName[name]
		if !ok {
			mismatches = append(mismatches, "缺少欄位: "+name)
			continue
		}
		if aType != bType {
			mismatches = append(mismatches, "欄位 "+name+" 型別不同: "+aType+" vs "+bType)
		}
	}
	for name := range bByName {
		if _, ok := aByName[name]; !ok {
			mismatches = append(mismatches, "缺少欄位: "+name)
		}
	}

	return SchemaCompareResult{Match: len(mismatches) == 0, Mismatches: mismatches}
}

// ClockSkewResult 是 CheckClockSkew 的輸出。
type ClockSkewResult struct {
	OK   bool
	Skew time.Duration
}

// CheckClockSkew 比較本機與對方當下時間的絕對差距，超過 threshold 就
// 判定 OK = false（見設計文件「零、前置檢查」：「Δ 超過門檻就拒絕同步
// 並警告」）。方向無關——本機比對方快或慢，只要偏移量超過門檻都視為
// 不通過。剛好等於門檻視為仍在容許範圍內（設計文件用「超過」，即嚴格
// 大於，當拒絕條件）。
func CheckClockSkew(local, remote time.Time, threshold time.Duration) ClockSkewResult {
	skew := local.Sub(remote)
	if skew < 0 {
		skew = -skew
	}
	return ClockSkewResult{OK: skew <= threshold, Skew: skew}
}
