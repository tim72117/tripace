package store

import (
	"testing"

	"github.com/tim72117/tripace/internal/model"
)

// newTestAttraction 建立一筆景點區域資料,回傳完整的 model.Attraction
// (含 store 產生的 ID),供標籤相關測試使用。
func newTestAttraction(t *testing.T, s *Store, name, city string, lat, lng float64) model.Attraction {
	t.Helper()
	a, err := s.CreateAttraction(model.Attraction{
		Name:     name,
		CityName: city,
		Lat:      lat,
		Lng:      lng,
		Level:    3,
	})
	if err != nil {
		t.Fatalf("CreateAttraction(%s): %v", name, err)
	}
	return a
}

// TestSetAttractionTags 驗證整組覆寫語意:第二次呼叫應完全取代第一次
// 設定的標籤,而不是疊加。
func TestSetAttractionTags(t *testing.T) {
	s := newTestStore(t)
	a := newTestAttraction(t, s, "清水寺", "京都", 34.9948, 135.7850)

	if err := s.SetAttractionTags(a.ID, []string{"寺廟", "世界遺產"}); err != nil {
		t.Fatalf("SetAttractionTags: %v", err)
	}
	got, err := s.GetAttraction(a.ID)
	if err != nil {
		t.Fatalf("GetAttraction: %v", err)
	}
	if !equalStringSets(got.Tags, []string{"寺廟", "世界遺產"}) {
		t.Fatalf("Tags = %v, want [寺廟 世界遺產]", got.Tags)
	}

	// 整組覆寫:第二次呼叫應完全取代,不是疊加。
	if err := s.SetAttractionTags(a.ID, []string{"建築師作品"}); err != nil {
		t.Fatalf("SetAttractionTags(覆寫): %v", err)
	}
	got, err = s.GetAttraction(a.ID)
	if err != nil {
		t.Fatalf("GetAttraction after overwrite: %v", err)
	}
	if !equalStringSets(got.Tags, []string{"建築師作品"}) {
		t.Fatalf("Tags after overwrite = %v, want [建築師作品]", got.Tags)
	}

	// 空陣列應清空所有標籤。
	if err := s.SetAttractionTags(a.ID, nil); err != nil {
		t.Fatalf("SetAttractionTags(清空): %v", err)
	}
	got, err = s.GetAttraction(a.ID)
	if err != nil {
		t.Fatalf("GetAttraction after clear: %v", err)
	}
	if len(got.Tags) != 0 {
		t.Fatalf("Tags after clear = %v, want empty", got.Tags)
	}
}

// TestListAttractionsByTagInCity 驗證只回傳同城市、同標籤的地點,且不
// 誤含其他城市或沒有這個標籤的地點。
func TestListAttractionsByTagInCity(t *testing.T) {
	s := newTestStore(t)
	kiyomizu := newTestAttraction(t, s, "清水寺", "京都", 34.9948, 135.7850)
	kinkaku := newTestAttraction(t, s, "金閣寺", "京都", 35.0394, 135.7292)
	sensoji := newTestAttraction(t, s, "淺草寺", "東京", 35.7148, 139.7967)
	tower := newTestAttraction(t, s, "京都塔", "京都", 34.9858, 135.7588)

	if err := s.SetAttractionTags(kiyomizu.ID, []string{"寺廟"}); err != nil {
		t.Fatalf("SetAttractionTags(kiyomizu): %v", err)
	}
	if err := s.SetAttractionTags(kinkaku.ID, []string{"寺廟"}); err != nil {
		t.Fatalf("SetAttractionTags(kinkaku): %v", err)
	}
	if err := s.SetAttractionTags(sensoji.ID, []string{"寺廟"}); err != nil {
		t.Fatalf("SetAttractionTags(sensoji): %v", err)
	}
	if err := s.SetAttractionTags(tower.ID, []string{"地標"}); err != nil {
		t.Fatalf("SetAttractionTags(tower): %v", err)
	}

	got, err := s.ListAttractionsByTagInCity("京都", "寺廟")
	if err != nil {
		t.Fatalf("ListAttractionsByTagInCity: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2 (got %v)", len(got), got)
	}
	ids := map[string]bool{got[0].ID: true, got[1].ID: true}
	if !ids[kiyomizu.ID] || !ids[kinkaku.ID] {
		t.Fatalf("結果應同時包含清水寺與金閣寺,got %v", got)
	}
	if ids[sensoji.ID] {
		t.Fatal("結果不應包含東京的淺草寺(城市不符)")
	}
	if ids[tower.ID] {
		t.Fatal("結果不應包含京都塔(標籤不符)")
	}

	// 查無符合條件的組合應回傳空陣列而非 nil/error。
	empty, err := s.ListAttractionsByTagInCity("京都", "不存在的標籤")
	if err != nil {
		t.Fatalf("ListAttractionsByTagInCity(不存在的標籤): %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("len(empty) = %d, want 0", len(empty))
	}
}

// TestAttachTagsViaListAttractionsByCity 驗證 ListAttractionsByCity 回傳的
// 每一筆資料都帶有正確的 Tags(attachTags 的整合驗證,不直接測試未匯出的
// attachTags 本身)。
func TestAttachTagsViaListAttractionsByCity(t *testing.T) {
	s := newTestStore(t)
	a := newTestAttraction(t, s, "伏見稻荷大社", "京都", 34.9671, 135.7727)
	b := newTestAttraction(t, s, "嵐山", "京都", 35.0094, 135.6675)

	if err := s.SetAttractionTags(a.ID, []string{"神社", "世界遺產"}); err != nil {
		t.Fatalf("SetAttractionTags: %v", err)
	}

	list, err := s.ListAttractionsByCity("京都")
	if err != nil {
		t.Fatalf("ListAttractionsByCity: %v", err)
	}
	byID := map[string]model.Attraction{}
	for _, item := range list {
		byID[item.ID] = item
	}
	if !equalStringSets(byID[a.ID].Tags, []string{"神社", "世界遺產"}) {
		t.Fatalf("a.Tags = %v, want [神社 世界遺產]", byID[a.ID].Tags)
	}
	if len(byID[b.ID].Tags) != 0 {
		t.Fatalf("b.Tags = %v, want empty(未設定過標籤)", byID[b.ID].Tags)
	}
}

func equalStringSets(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	set := map[string]bool{}
	for _, g := range got {
		set[g] = true
	}
	for _, w := range want {
		if !set[w] {
			return false
		}
	}
	return true
}
