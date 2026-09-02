package store

import (
	"testing"

	"github.com/tim72117/tripace/internal/model"
)

// TestAttractionPlaceIDRoundTrip 驗證新增的 PlaceID 欄位能正確被寫入、讀出
// ——這是「attraction 對應 place_id、優先使用漸進補圖機制」這個並存設計的
// 資料庫層基礎:CreateAttraction 寫入時要正確帶出 in.PlaceID,GetAttraction/
// ListAttractionsByCity/ListAttractionsNearby 讀出時也都要正確帶回,任何一處
// 漏接都會讓前端誤判成「這筆沒有 place_id」而 fallback 回舊的 photo_url
// 路徑,不會有明顯錯誤訊息,只會靜默少了雙來源照片,故這裡把讀寫兩側都
// 覆蓋到。
func TestAttractionPlaceIDRoundTrip(t *testing.T) {
	s := newTestStore(t)

	placeID := "ChIJtest_place_id_123"
	in := model.Attraction{
		Name:     "測試景點",
		CityName: "測試市",
		Lat:      22.99,
		Lng:      120.20,
		Level:    3,
		PlaceID:  &placeID,
	}
	created, err := s.CreateAttraction(in)
	if err != nil {
		t.Fatalf("CreateAttraction: %v", err)
	}
	if created.PlaceID == nil || *created.PlaceID != placeID {
		t.Fatalf("CreateAttraction 回傳的 PlaceID = %v, want %q", created.PlaceID, placeID)
	}

	// GetAttraction 應該正確讀回 PlaceID。
	got, err := s.GetAttraction(created.ID)
	if err != nil {
		t.Fatalf("GetAttraction: %v", err)
	}
	if got.PlaceID == nil || *got.PlaceID != placeID {
		t.Fatalf("GetAttraction 的 PlaceID = %v, want %q", got.PlaceID, placeID)
	}

	// ListAttractionsByCity 應該正確帶出 PlaceID。
	byCity, err := s.ListAttractionsByCity("測試市")
	if err != nil {
		t.Fatalf("ListAttractionsByCity: %v", err)
	}
	if len(byCity) != 1 || byCity[0].PlaceID == nil || *byCity[0].PlaceID != placeID {
		t.Fatalf("ListAttractionsByCity 的結果沒有正確帶出 PlaceID: %+v", byCity)
	}

	// ListAttractionsNearby 應該正確帶出 PlaceID。
	nearby, err := s.ListAttractionsNearby(22.99, 120.20, 5000)
	if err != nil {
		t.Fatalf("ListAttractionsNearby: %v", err)
	}
	if len(nearby) != 1 || nearby[0].PlaceID == nil || *nearby[0].PlaceID != placeID {
		t.Fatalf("ListAttractionsNearby 的結果沒有正確帶出 PlaceID: %+v", nearby)
	}
}

// TestAttractionCreateWithoutPlaceID 驗證沒有帶 PlaceID 時(既有多數
// attraction 的現況——人工建檔當下沒有透過 -place/-place-id 指定),
// PlaceID 應維持 nil,不會被意外設成空字串或其他預設值——前端據此判斷
// 「這筆該不該打 place-details 補圖查詢」,nil 與空字串在這裡不能混用。
func TestAttractionCreateWithoutPlaceID(t *testing.T) {
	s := newTestStore(t)

	in := model.Attraction{
		Name:     "沒有 place_id 的景點",
		CityName: "測試市",
		Lat:      22.99,
		Lng:      120.20,
		Level:    3,
	}
	created, err := s.CreateAttraction(in)
	if err != nil {
		t.Fatalf("CreateAttraction: %v", err)
	}
	if created.PlaceID != nil {
		t.Fatalf("未帶 PlaceID 時 CreateAttraction 回傳的 PlaceID 應為 nil, got %v", *created.PlaceID)
	}

	got, err := s.GetAttraction(created.ID)
	if err != nil {
		t.Fatalf("GetAttraction: %v", err)
	}
	if got.PlaceID != nil {
		t.Fatalf("未帶 PlaceID 時 GetAttraction 回傳的 PlaceID 應為 nil, got %v", *got.PlaceID)
	}
}

// TestUpdateAttractionPlaceID 驗證 attraction-set-place-id 指令背後的
// store 方法:能補上 place_id(既有已建檔、原本沒有 place_id 的景點事後
// 補上),也能清空(placeID 傳空字串,見 UpdateAttractionPlaceID 的完整
// 說明——place_id 清空是使用者可能主動想要的操作,跟 UpdateAttractionCoords
// 那些「清空沒有意義」的欄位語意不同)。
func TestUpdateAttractionPlaceID(t *testing.T) {
	s := newTestStore(t)

	created, err := s.CreateAttraction(model.Attraction{
		Name: "待補 place_id 的景點", CityName: "測試市", Lat: 22.99, Lng: 120.20, Level: 3,
	})
	if err != nil {
		t.Fatalf("CreateAttraction: %v", err)
	}
	if created.PlaceID != nil {
		t.Fatalf("初始建檔不應帶 PlaceID, got %v", *created.PlaceID)
	}

	// 補上 place_id。
	const placeID = "ChIJ_set_later_456"
	if err := s.UpdateAttractionPlaceID(created.ID, placeID); err != nil {
		t.Fatalf("UpdateAttractionPlaceID(補上): %v", err)
	}
	got, err := s.GetAttraction(created.ID)
	if err != nil {
		t.Fatalf("GetAttraction: %v", err)
	}
	if got.PlaceID == nil || *got.PlaceID != placeID {
		t.Fatalf("補上 place_id 後 GetAttraction 的 PlaceID = %v, want %q", got.PlaceID, placeID)
	}

	// 清空 place_id(傳空字串)。
	if err := s.UpdateAttractionPlaceID(created.ID, ""); err != nil {
		t.Fatalf("UpdateAttractionPlaceID(清空): %v", err)
	}
	got, err = s.GetAttraction(created.ID)
	if err != nil {
		t.Fatalf("GetAttraction: %v", err)
	}
	if got.PlaceID != nil {
		t.Fatalf("清空後 GetAttraction 的 PlaceID 應為 nil, got %v", *got.PlaceID)
	}
}
