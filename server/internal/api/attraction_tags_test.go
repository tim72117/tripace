package api

// attraction_tags_test.go 測標籤機制的兩個新端點:
//   PUT /internal/maintenance/attractions/{id}/tags   設定標籤
//   GET /internal/geo/attractions/{id}/tag-neighbors  查詢周邊同標籤地點
//
// 跟 entry_test.go 一樣透過 s.Routes() 打完整的 mux,不直接呼叫 handler。
// 只寫 happy path,邊界情境(查無地點、404)各補一支。

import (
	"net/http"
	"testing"
)

// createAttraction 用 /internal/maintenance/attractions 端點建一筆景點區域
// 資料,回傳其 ID。
func (f *testFixture) createAttraction(t *testing.T, name, city string, lat, lng float64) string {
	t.Helper()
	got := f.do(t, "POST", "/internal/maintenance/attractions", map[string]any{
		"name": name, "cityName": city, "lat": lat, "lng": lng, "level": 3,
	}, http.StatusCreated)
	id, _ := got["id"].(string)
	if id == "" {
		t.Fatalf("建立地標沒回傳 id: %v", got)
	}
	return id
}

func TestMaintenanceSetAttractionTags(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createAttraction(t, "清水寺", "京都", 34.9948, 135.7850)

	got := f.do(t, "PUT", "/internal/maintenance/attractions/"+id+"/tags",
		map[string]any{"tags": []string{"寺廟", "世界遺產"}}, http.StatusOK)

	tags, ok := got["tags"].([]any)
	if !ok || len(tags) != 2 {
		t.Fatalf("回應 tags = %v，預期 2 筆", got["tags"])
	}

	attr, err := f.srv.store.GetAttraction(id)
	if err != nil {
		t.Fatalf("取回地標: %v", err)
	}
	if len(attr.Tags) != 2 {
		t.Fatalf("資料庫裡的 Tags = %v，預期 2 筆", attr.Tags)
	}

	// 整組覆寫:再設一次應完全取代。
	f.do(t, "PUT", "/internal/maintenance/attractions/"+id+"/tags",
		map[string]any{"tags": []string{"建築師作品"}}, http.StatusOK)
	attr, err = f.srv.store.GetAttraction(id)
	if err != nil {
		t.Fatalf("取回地標: %v", err)
	}
	if len(attr.Tags) != 1 || attr.Tags[0] != "建築師作品" {
		t.Fatalf("覆寫後 Tags = %v，預期 [建築師作品]", attr.Tags)
	}
}

func TestGeoAttractionTagNeighbors(t *testing.T) {
	f := newEntryFixture(t)
	origin := f.createAttraction(t, "清水寺", "京都", 34.9948, 135.7850)
	near := f.createAttraction(t, "地主神社", "京都", 34.9951, 135.7855)
	far := f.createAttraction(t, "金閣寺", "京都", 35.0394, 135.7292)
	otherCity := f.createAttraction(t, "淺草寺", "東京", 35.7148, 139.7967)
	untagged := f.createAttraction(t, "京都塔", "京都", 34.9858, 135.7588)
	_ = untagged

	for _, id := range []string{origin, near, far} {
		f.do(t, "PUT", "/internal/maintenance/attractions/"+id+"/tags",
			map[string]any{"tags": []string{"寺廟"}}, http.StatusOK)
	}
	f.do(t, "PUT", "/internal/maintenance/attractions/"+otherCity+"/tags",
		map[string]any{"tags": []string{"寺廟"}}, http.StatusOK)

	got := f.do(t, "GET", "/internal/geo/attractions/"+origin+"/tag-neighbors?tag="+"寺廟", nil, http.StatusOK)

	if got["tag"] != "寺廟" {
		t.Errorf("tag = %v，預期 寺廟", got["tag"])
	}
	neighbors, ok := got["attractions"].([]any)
	if !ok {
		t.Fatalf("attractions 不是陣列: %v", got["attractions"])
	}
	if len(neighbors) != 2 {
		t.Fatalf("len(neighbors) = %d，預期 2（不含自己、不含其他城市）: %v", len(neighbors), neighbors)
	}

	// 依距離排序:地主神社離清水寺很近,應排在金閣寺前面。
	first, ok := neighbors[0].(map[string]any)
	if !ok || first["name"] != "地主神社" {
		t.Fatalf("neighbors[0] = %v，預期最近的地主神社排最前面", neighbors[0])
	}
	if _, hasDistance := first["distanceKm"]; !hasDistance {
		t.Errorf("neighbors[0] 缺少 distanceKm: %v", first)
	}
}

func TestGeoAttractionTagNeighborsNotFound(t *testing.T) {
	f := newEntryFixture(t)
	f.do(t, "GET", "/internal/geo/attractions/lmk_nonexistent/tag-neighbors?tag=寺廟", nil, http.StatusNotFound)
}

func TestGeoAttractionTagNeighborsMissingTag(t *testing.T) {
	f := newEntryFixture(t)
	id := f.createAttraction(t, "清水寺", "京都", 34.9948, 135.7850)
	f.do(t, "GET", "/internal/geo/attractions/"+id+"/tag-neighbors", nil, http.StatusBadRequest)
}
