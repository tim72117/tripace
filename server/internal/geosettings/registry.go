// Package geosettings 是「可線上調整的數值設定」的單一登錄表:有哪些設定、
// 預設值、合法範圍與說明。跟 internal/ratelimits、internal/fieldmasks 同一個
// 模式——成本相關、需要運維依實際用量調整、不該寫死在程式碼裡的東西,定義處
// 只有這一個,維運端點、CLI 列表、啟動載入都讀它。
//
// 資料庫沒有資料列 = 沿用這裡的預設值(見 store.geoSettingRow),所以新增
// 一項設定只要在 Registry 加一筆,不需要 seeding、不需要遷移。
package geosettings

import (
	"fmt"
	"time"
)

// RefreshInterval 是背景重讀資料庫的間隔,對齊 ratelimits/fieldmasks 的
// 45 秒——維運端點直接套用到執行中的實例,這個間隔只影響多實例部署時
// 「另一個實例改的值多久會被這個實例看到」。
const RefreshInterval = 45 * time.Second

// 設定 key。字串值同時是 geo_settings 表的主鍵與 CLI 的 -key 參數,
// 改名等於換一個新設定(舊資料列會被忽略),不要輕易改。
const (
	KeyPhotoMaxCount   = "photoMaxCount"
	KeyPhotoExpiryDays = "photoExpiryDays"
	// KeyPlaceDetailsCacheHours:地點詳情(places.get)快取的有效期(小時)。
	KeyPlaceDetailsCacheHours = "placeDetailsCacheHours"
)

// Setting 描述一項數值設定。
type Setting struct {
	Key     string
	Desc    string
	Default int
	Min     int
	Max     int
}

// Validate 檢查 value 是否在合法範圍內。
func (s Setting) Validate(value int) error {
	if value < s.Min || value > s.Max {
		return fmt.Errorf("%s 必須介於 %d 與 %d 之間(收到 %d)", s.Key, s.Min, s.Max, value)
	}
	return nil
}

// Registry 是全部可調整的設定。
var Registry = []Setting{
	{
		Key: KeyPhotoMaxCount,
		Desc: "每個地點最多補幾張照片(全域天花板)。實際會補的張數取三者最小值:" +
			"點擊次數決定的上限、該地點在 Google 上實際有的張數、這個設定。" +
			"補到上限之後不再補照片、也不再重讀地點資訊(places.get)。" +
			"調高會增加 Google Place Photos 的呼叫與費用,調低會讓點擊多的地點照片變少。",
		Default: 3,
		// 最小 1:0 會讓所有地點都不補圖,等於把照片功能整個關掉——要關功能
		// 應該用功能開關,不是把這個值設成 0。
		Min: 1,
		// 最大 20:點擊數上限公式(2+點擊/100)沒有上限,這個設定存在的意義就是
		// 給它一個天花板;過大的值等於沒有天花板。
		Max: 20,
	},
	{
		Key: KeyPhotoExpiryDays,
		Desc: "照片資產的有效天數:照片寫入 photo_assets 時 expires_at = 寫入當下 + 這個天數," +
			"過期後下一次請求會觸發補圖換新(每次換新都會呼叫 places.get 與 Place Photos)。" +
			"只影響之後寫入的照片,已經存在的照片保留自己當時算好的過期時間。" +
			"調短會讓照片更常換新、增加 Google 呼叫與費用;調長會讓照片更久不更新。" +
			"預設 7 天是沿用原本寫死的值。",
		Default: 7,
		// 最小 1:0 或負數會讓照片一寫入就過期,每次請求都重補,成本失控。
		Min: 1,
		// 最大 30:Google 對 Places 照片快取有合規限制,不宜長期保存;30 天是
		// 保守的上限,真的需要更久應先確認條款再調整這個常數。
		Max: 30,
	},
	{
		Key: KeyPlaceDetailsCacheHours,
		Desc: "地點詳情(名稱、地址、座標、評分、簡介)的快取有效期:有效期內重複查詢同一個地點" +
			"直接回快取、不打 Google(places.get)。所有會查地點詳情的端點共用這一份快取。" +
			"照片參照有時效,不在快取範圍內。調短會讓地點資料更即時但增加 Google 呼叫與費用;" +
			"調長會省錢但資料更新較慢。預設 24 小時,對齊地圖版原本的文字新鮮度規則。",
		Default: 24,
		// 最小 1:0 或負數會讓所有快取立刻過期,等於把快取關掉卻看起來像有開。
		Min: 1,
		// 最大 720(30 天):對齊 place_details_cache「列是否存在」的既有判斷
		// (placeDetailsRowExistenceMaxAge = 30 天)。Google 對 Places 內容的快取有
		// 合規限制,超過這個長度應先確認條款。
		Max: 720,
	},
}

// Find 依 key 查登錄表,找不到回傳 nil。
func Find(key string) *Setting {
	for i := range Registry {
		if Registry[i].Key == key {
			return &Registry[i]
		}
	}
	return nil
}
