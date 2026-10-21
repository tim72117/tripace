package api

import (
	"log"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/geosettings"
)

// place_details_cache_setting.go 管「地點詳情快取有效期(小時)」這個全域設定
// (2026-10,見 internal/geosettings 登錄表的 placeDetailsCacheHours)。
//
// 快取本身在 geo 層(geo.SetDetailsCacheMaxAge 是 process 層級的全域值,因為
// 統一快取要讓所有 geo.New() 建出來的 client 共用同一個有效期),這裡只是
// 把維運端點與啟動載入的值轉接過去,並守住合法範圍。

// PlaceDetailsCacheHours 回傳目前生效的地點詳情快取有效期(小時)。
func (s *Server) PlaceDetailsCacheHours() int {
	return int(geo.DetailsCacheMaxAge() / time.Hour)
}

// SetPlaceDetailsCacheHours 設定快取有效期,立即套用。超出登錄表合法範圍的值
// 一律忽略:0 或負數會讓所有快取立刻過期,等於把快取關掉卻看起來像有開。
func (s *Server) SetPlaceDetailsCacheHours(n int) {
	setting := geosettings.Find(geosettings.KeyPlaceDetailsCacheHours)
	if err := setting.Validate(n); err != nil {
		log.Printf("SetPlaceDetailsCacheHours: 忽略不合法的值 %d: %v", n, err)
		return
	}
	geo.SetDetailsCacheMaxAge(time.Duration(n) * time.Hour)
}
