package api

import (
	"log"
	"time"

	"github.com/tim72117/tripace/internal/geosettings"
)

// photo_max_count.go 管「照片最大張數」這個全域設定(2026-10,見
// internal/geosettings 登錄表的 photoMaxCount),以及補圖判斷用到的兩個
// helper。有效上限怎麼算見 effectivePhotoCap(geo_outline.go)。

// PhotoMaxCount 回傳目前生效的照片最大張數。
func (s *Server) PhotoMaxCount() int {
	if n := s.photoMaxCount.Load(); n > 0 {
		return int(n)
	}
	// 零值 Server(例如測試直接建構、沒走 New)沒有被初始化過:退回登錄表
	// 預設值,而不是回傳 0——0 會讓所有地點都不補圖。
	return geosettings.Find(geosettings.KeyPhotoMaxCount).Default
}

// SetPhotoMaxCount 設定照片最大張數,立即套用到執行中的實例(維運端點寫入
// 資料庫後呼叫,啟動與背景重讀時也呼叫)。超出登錄表合法範圍的值一律忽略:
// 0 會等於把所有補圖關掉,過大的值等於沒有天花板;合法範圍的驗證在這裡
// 守最後一道,即使呼叫端漏了驗證也不會把壞值套進去。
func (s *Server) SetPhotoMaxCount(n int) {
	setting := geosettings.Find(geosettings.KeyPhotoMaxCount)
	if err := setting.Validate(n); err != nil {
		log.Printf("SetPhotoMaxCount: 忽略不合法的值 %d: %v", n, err)
		return
	}
	s.photoMaxCount.Store(int64(n))
}

// decidePhotoRefresh 是三個補圖呼叫點共用的判斷:查該點已記下的實際張數、
// 讀全域最大張數、算有效上限,再依有效上限範圍內的新鮮度決定要不要補。
//
// 讀不到張數(查詢失敗)就當作「不知道」——退回只由點擊數上限與全域
// 最大值決定,行為等同加入張數記錄之前,不會因為這個查詢失敗而不補圖。
func (s *Server) decidePhotoRefresh(placeID string, clickCount int64) (shouldFetch bool, indexToFetch int) {
	photoCount, err := s.store.GetPlacePhotoCount(placeID)
	if err != nil {
		log.Printf("decidePhotoRefresh: GetPlacePhotoCount 失敗 place_id=%s(視為未知張數): %v", placeID, err)
		photoCount = nil
	}
	maxCount := s.PhotoMaxCount()
	fresh := s.freshPhotoIndexStates(placeID, effectivePhotoCap(clickCount, photoCount, maxCount))
	return decidePlacePhotoRefreshIndexWithCount(clickCount, photoCount, maxCount, fresh)
}

// recordPlacePhotoCount 記下這個地點在 Google 上實際有幾張照片。寫入失敗只記
// log、不中斷請求——少記一次只是下次還會再問一次 Google,不影響這次回應。
func (s *Server) recordPlacePhotoCount(placeID string, count int) {
	if err := s.store.SetPlacePhotoCount(placeID, count); err != nil {
		log.Printf("recordPlacePhotoCount: 寫入失敗 place_id=%s count=%d: %v", placeID, count, err)
	}
}

// PhotoExpiryDays 回傳目前生效的照片過期週期(天)。
func (s *Server) PhotoExpiryDays() int {
	if n := s.photoExpiryDays.Load(); n > 0 {
		return int(n)
	}
	// 零值 Server 沒有被初始化過:退回登錄表預設值(同 PhotoMaxCount)。
	return geosettings.Find(geosettings.KeyPhotoExpiryDays).Default
}

// SetPhotoExpiryDays 設定照片過期週期(天),立即套用到執行中的實例。超出登錄表
// 合法範圍的值一律忽略:0 或負數會讓照片一寫入就過期、每次請求都重補。
func (s *Server) SetPhotoExpiryDays(n int) {
	setting := geosettings.Find(geosettings.KeyPhotoExpiryDays)
	if err := setting.Validate(n); err != nil {
		log.Printf("SetPhotoExpiryDays: 忽略不合法的值 %d: %v", n, err)
		return
	}
	s.photoExpiryDays.Store(int64(n))
}

// PhotoAssetExpiry 是寫入 photo_assets 時用的有效期(取代原本寫死的
// photoAssetExpiry 常數,預設值相同)。兩個寫入點——背景補圖
// (backgroundFillPlacePhoto)與 CLI 的重新補圖端點(maintenance.go)——都要用
// 它,否則兩邊的過期週期會不一致。
func (s *Server) PhotoAssetExpiry() time.Duration {
	return time.Duration(s.PhotoExpiryDays()) * 24 * time.Hour
}
