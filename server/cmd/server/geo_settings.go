package main

import (
	"log"
	"time"

	"github.com/tim72117/tripace/internal/geosettings"
	"github.com/tim72117/tripace/internal/store"
)

// geo_settings.go——把資料庫裡的數值設定(照片最大張數、照片過期週期)套用到
// 執行中的 server,啟動時一次、之後背景定期重讀(2026-10)。
//
// 設計:資料庫沒有資料列 = 沿用 internal/geosettings 登錄表的預設值,所以
// 不需要 seeding(跟限流/field mask 不同,見 store.geoSettingRow 的說明)。
// 載入時不合法的值(例如有人直接改資料庫寫了 0)一律退回預設並記 log,而不是
// 把壞值套進去——photoMaxCount=0 會讓所有地點都不補圖、photoExpiryDays=0
// 會讓照片一寫入就過期(每次請求都重補)。

// geoSettingsApplier 是 api.Server 對這個載入器曝露的那一小塊介面(用介面讓
// 載入邏輯可以不起整個 Server 就測試)。
type geoSettingsApplier interface {
	SetPhotoMaxCount(n int)
	SetPhotoExpiryDays(n int)
	SetPlaceDetailsCacheHours(n int)
}

// applyGeoSettingsFromStore 讀出資料庫目前的設定,逐項套用。讀取失敗時維持
// 目前設定不變(不要因為一次資料庫暫時失敗就把設定退回預設)。
func applyGeoSettingsFromStore(st *store.Store, a geoSettingsApplier) {
	rows, err := st.ListGeoSettings()
	if err != nil {
		log.Printf("geo 數值設定讀取失敗,維持目前設定不變: %v", err)
		return
	}
	stored := make(map[string]int, len(rows))
	for _, r := range rows {
		stored[r.Key] = r.Value
	}

	for _, setting := range geosettings.Registry {
		value := setting.Default
		if v, ok := stored[setting.Key]; ok {
			if err := setting.Validate(v); err != nil {
				log.Printf("geo 數值設定 %s 在資料庫裡的值 %d 不合法(%v),退回預設 %d", setting.Key, v, err, setting.Default)
			} else {
				value = v
			}
		}
		switch setting.Key {
		case geosettings.KeyPhotoMaxCount:
			a.SetPhotoMaxCount(value)
		case geosettings.KeyPhotoExpiryDays:
			a.SetPhotoExpiryDays(value)
		case geosettings.KeyPlaceDetailsCacheHours:
			a.SetPlaceDetailsCacheHours(value)
		}
	}
}

// startGeoSettingsRefreshLoop 啟動時立刻套用一次,之後每 interval 重讀一次——
// 讓多實例部署時,另一個實例(或直接改資料庫)修改的設定不需要重啟就生效。
// 同一個實例透過維運端點改的值會立即生效,不必等這個迴圈。
func startGeoSettingsRefreshLoop(st *store.Store, interval time.Duration, a geoSettingsApplier) {
	applyGeoSettingsFromStore(st, a)
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			applyGeoSettingsFromStore(st, a)
		}
	}()
}
