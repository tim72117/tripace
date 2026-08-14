package attractionsync

// precheck_test.go 定義「零、前置檢查」的預期行為（見
// docs/ATTRACTION_SYNC_DESIGN.md「零、前置檢查」）：Schema 比對與時鐘
// 偏移檢查，兩者都是在任何比對/傳輸之前執行、每次觸發同步都重新檢查
// 一次（不快取），不一致/超過門檻就中止，不嘗試自動修正或猜測相容性。
//
// 這兩項檢查的「拒絕」判斷邏輯本身是純函式（純比較兩份輸入），實際去
// HTTP 查詢對方 schema/時間是呼叫端的責任（server/internal/api/
// attraction_sync_test.go 定義的端點負責提供這些原始資料）——這裡只測
// 「給定兩份 schema/時間，該不該繼續」這個判斷本身。

import (
	"testing"
	"time"
)

// ---- Schema 比對 ----

// SchemaField 對應 attractionRow 單一欄位的名稱與型別（見設計文件「零、
// 前置檢查」對比對範圍的說明：只比對 attractions 表本身的欄位名稱與
// 型別，不涉及索引/約束）。
func TestCompareSchema_Identical(t *testing.T) {
	a := []SchemaField{
		{Name: "id", Type: "string"},
		{Name: "name", Type: "string"},
		{Name: "lat", Type: "float64"},
	}
	b := []SchemaField{
		{Name: "id", Type: "string"},
		{Name: "name", Type: "string"},
		{Name: "lat", Type: "float64"},
	}

	result := CompareSchema(a, b)
	if !result.Match {
		t.Errorf("兩邊欄位集合與型別完全一致，預期 Match = true，得到差異 %v", result.Mismatches)
	}
}

func TestCompareSchema_IdenticalIgnoresOrder(t *testing.T) {
	// 欄位集合比對不該依賴回傳順序——兩邊資料庫的欄位列出順序本來就
	// 沒有保證一致。
	a := []SchemaField{{Name: "id", Type: "string"}, {Name: "lat", Type: "float64"}}
	b := []SchemaField{{Name: "lat", Type: "float64"}, {Name: "id", Type: "string"}}

	if result := CompareSchema(a, b); !result.Match {
		t.Errorf("欄位順序不同但集合相同，預期 Match = true，得到差異 %v", result.Mismatches)
	}
}

func TestCompareSchema_MissingField(t *testing.T) {
	// 對應設計文件：「不一致時直接中止，並列出具體差異（缺少哪個欄位、
	// 哪個欄位型別不同）」——這裡驗證「缺少欄位」的情況會被偵測到，且
	// Mismatches 裡有可辨識的說明，不是只回傳一個籠統的布林值。
	a := []SchemaField{{Name: "id", Type: "string"}, {Name: "photo_url", Type: "*string"}}
	b := []SchemaField{{Name: "id", Type: "string"}} // 缺少 photo_url

	result := CompareSchema(a, b)
	if result.Match {
		t.Fatal("b 缺少 photo_url 欄位，預期 Match = false")
	}
	if len(result.Mismatches) == 0 {
		t.Error("Mismatches 不該是空的——需要列出具體是哪個欄位不一致")
	}
}

func TestCompareSchema_TypeMismatch(t *testing.T) {
	// 對應設計文件：「哪個欄位型別不同」——欄位名稱相同、型別不同，也要
	// 被判定為不一致，不能只比對欄位名稱集合。
	a := []SchemaField{{Name: "level", Type: "int"}}
	b := []SchemaField{{Name: "level", Type: "string"}}

	result := CompareSchema(a, b)
	if result.Match {
		t.Fatal("level 欄位型別不同（int vs string），預期 Match = false")
	}
}

// ---- 時鐘偏移檢查 ----

const clockSkewThreshold = 5 * time.Minute // 設計文件目前寫「量級上以分鐘計，例如 5 分鐘」，具體值待定，這裡先用文件裡舉例的數值

func TestCheckClockSkew_WithinThreshold(t *testing.T) {
	local := ts("2026-08-13T10:00:00Z")
	remote := ts("2026-08-13T10:00:30Z") // 差 30 秒，遠小於門檻

	result := CheckClockSkew(local, remote, clockSkewThreshold)
	if !result.OK {
		t.Errorf("時間差 30 秒遠小於 5 分鐘門檻，預期 OK = true，得到 Skew = %v", result.Skew)
	}
}

func TestCheckClockSkew_ExceedsThreshold(t *testing.T) {
	// 對應設計文件：「Δ 超過門檻就拒絕同步並警告」。
	local := ts("2026-08-13T10:00:00Z")
	remote := ts("2026-08-13T10:10:00Z") // 差 10 分鐘，超過 5 分鐘門檻

	result := CheckClockSkew(local, remote, clockSkewThreshold)
	if result.OK {
		t.Error("時間差 10 分鐘超過 5 分鐘門檻，預期 OK = false")
	}
}

func TestCheckClockSkew_SymmetricRegardlessOfDirection(t *testing.T) {
	// Δ 是絕對值——本機比正式站快，或本機比正式站慢，只要偏移量超過
	// 門檻都該被擋下，不該只檢查單一方向（例如只擋「本機比較慢」卻放行
	// 「本機比較快」）。
	base := ts("2026-08-13T10:00:00Z")
	ahead := ts("2026-08-13T10:10:00Z")

	forward := CheckClockSkew(base, ahead, clockSkewThreshold)
	backward := CheckClockSkew(ahead, base, clockSkewThreshold)

	if forward.OK || backward.OK {
		t.Errorf("兩個方向偏移量相同（10 分鐘），皆應判定超過門檻；forward.OK=%v backward.OK=%v", forward.OK, backward.OK)
	}
}

func TestCheckClockSkew_ExactlyAtThreshold(t *testing.T) {
	// 邊界值：剛好等於門檻，設計文件用「超過」（大於）當拒絕條件，所以
	// 剛好等於門檻應視為仍在容許範圍內（OK = true），不是「超過」。
	local := ts("2026-08-13T10:00:00Z")
	remote := ts("2026-08-13T10:05:00Z") // 剛好 5 分鐘

	result := CheckClockSkew(local, remote, clockSkewThreshold)
	if !result.OK {
		t.Error("時間差剛好等於門檻，設計文件用「超過」當拒絕條件，預期 OK = true")
	}
}
