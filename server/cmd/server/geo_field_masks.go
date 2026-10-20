package main

import (
	"log"
	"strings"

	"github.com/tim72117/tripace/internal/fieldmasks"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/store"
)

// geo_field_masks.go — Google Places API field mask 設定的 seeding 與
// 執行期套用,結構與 geo_rate_limit.go 完全對稱(見該檔案的完整說明)。
//
// 2026-10 新增(使用者明確要求「加入可以控制欄位的設定,也讓 cli 可以
// 設定」)。field mask 直接決定每次 Places 呼叫的計費層級——最高層級的
// 那一個欄位決定整筆價格(見 internal/fieldmasks 的完整說明),所以這是
// 跟限流同一類的成本設定,沿用同一套機制:登錄表當回退、資料表存自訂值、
// 背景迴圈定期重讀。

// seedGeoFieldMasksIfEmpty 對登錄表裡每個情境檢查資料庫是否已有資料列,
// 沒有的話用登錄表的預設值寫入一筆——讓後台/CLI 第一次查詢時就看得到
// 目前實際生效的設定,而不是空表格。
//
// 已經有資料列的情境完全不動,理由同 seedGeoRateLimitsIfEmpty:避免每次
// 重啟都用程式碼的預設值蓋掉運維已經調整過的設定。
func seedGeoFieldMasksIfEmpty(st *store.Store) {
	existing, err := st.ListGeoFieldMasks()
	if err != nil {
		log.Printf("field mask 設定初始化讀取失敗,略過 seed: %v", err)
		return
	}
	seeded := make(map[string]bool, len(existing))
	for _, r := range existing {
		seeded[r.Key] = true
	}
	for _, sc := range fieldmasks.Registry {
		if seeded[sc.Key] {
			continue
		}
		if err := st.UpsertGeoFieldMask(sc.Key, strings.Join(sc.DefaultFields(), ",")); err != nil {
			log.Printf("field mask 初始化 %s 失敗: %v", sc.Key, err)
		}
	}
}

// applyFieldMasksFromStore 從 geo_field_masks 表讀出全部設定,組成完整的
// X-Goog-FieldMask 字串交給 geo 套件(見 geo.SetFieldMaskOverrides)。
//
// 組字串的職責在這裡而不是 geo 套件:前綴規則(searchText/searchNearby
// 要 "places." 前綴、Place Details 不要)屬於登錄表對每個情境的定義,
// geo 那側只需要拿到一個可以直接送進 header 的字串。
//
// 讀取失敗時維持目前的覆寫不變(不清空)——理由同 applyRateLimitsFromStore:
// 資料庫暫時查不到不該讓已經生效的設定被還原成預設值。
//
// 資料庫裡有、但登錄表沒有的 key 直接忽略:程式已經移除那個情境,資料列
// 還留著。留著不影響行為(沒有任何呼叫處會查那個 key),自動刪除別人
// 設定過的資料反而風險更高。
func applyFieldMasksFromStore(st *store.Store) {
	rows, err := st.ListGeoFieldMasks()
	if err != nil {
		log.Printf("field mask 設定讀取失敗,維持目前設定不變: %v", err)
		return
	}
	overrides := make(map[string]string, len(rows))
	for _, r := range rows {
		sc := fieldmasks.Find(r.Key)
		if sc == nil {
			continue
		}
		names := splitFields(r.Fields)
		if len(names) == 0 {
			continue
		}
		// 必填欄位被刪掉的資料列(例如有人直接改資料庫)補回來——少了
		// 它們呼叫端拿不到名稱/座標,那次查詢等於白花錢。維運端點本來
		// 就會擋(見 handleMaintenanceFieldMaskSet),這裡是第二道防線。
		for _, f := range sc.Required {
			if !containsField(names, f.Name) {
				log.Printf("field mask %s 缺少必填欄位 %s,自動補回", sc.Key, f.Name)
				names = append(names, f.Name)
			}
		}
		overrides[r.Key] = sc.Mask(names)
	}
	geo.SetFieldMaskOverrides(overrides)
}

func splitFields(raw string) []string {
	out := []string{}
	for _, f := range strings.Split(raw, ",") {
		f = strings.TrimSpace(f)
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

func containsField(names []string, name string) bool {
	for _, n := range names {
		if n == name {
			return true
		}
	}
	return false
}
