package store

import (
	"fmt"
	"sort"
	"time"
)

// LogGeoCache 寫入一筆快取查詢結果(見 geoCacheLogRow)。由 cmd/server 的
// 觀察者轉接呼叫;寫入失敗由呼叫端只記 log,不影響查詢本身。
func (s *Store) LogGeoCache(cache, outcome, caller, path, placeID string) error {
	return s.db.Create(&geoCacheLogRow{
		Cache:     cache,
		Outcome:   outcome,
		Caller:    caller,
		Path:      path,
		PlaceID:   placeID,
		CreatedAt: now(),
	}).Error
}

// GeoCachePeriodBucket 是「某個週期 × 某個結果」的次數。Bucket 標籤格式同
// GeoAPIPeriodBucket。
type GeoCachePeriodBucket struct {
	Bucket  string `json:"bucket"`
	Outcome string `json:"outcome"`
	Count   int64  `json:"count"`
}

// GeoCacheStatsByPeriod 回傳 [from, to) 之間、指定快取(如 "place_details")
// 依週期與結果分組的次數。分組與時區處理同 GeoAPICallStatsByPeriod。
func (s *Store) GeoCacheStatsByPeriod(cache string, from, to time.Time, loc *time.Location, period string) ([]GeoCachePeriodBucket, error) {
	layout := "2006-01-02"
	switch period {
	case "day":
	case "hour":
		layout = "2006-01-02 15:00"
	default:
		return nil, fmt.Errorf("period 必須是 day 或 hour")
	}
	var rows []struct {
		CreatedAt time.Time
		Outcome   string
	}
	err := s.db.Model(&geoCacheLogRow{}).
		Select("created_at, outcome").
		Where("cache = ? AND created_at >= ? AND created_at < ?", cache, from.UTC(), to.UTC()).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	type key struct{ bucket, outcome string }
	agg := map[key]*GeoCachePeriodBucket{}
	for _, r := range rows {
		k := key{r.CreatedAt.In(loc).Format(layout), r.Outcome}
		b, ok := agg[k]
		if !ok {
			b = &GeoCachePeriodBucket{Bucket: k.bucket, Outcome: k.outcome}
			agg[k] = b
		}
		b.Count++
	}
	out := make([]GeoCachePeriodBucket, 0, len(agg))
	for _, b := range agg {
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Bucket != out[j].Bucket {
			return out[i].Bucket < out[j].Bucket
		}
		return out[i].Outcome < out[j].Outcome
	})
	return out, nil
}
