package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// geocodeURL 是傳統 Geocoding API 端點(與 Places API 是不同服務,需在 GCP
// 專案另外啟用 geocoding-backend.googleapis.com)。
//
// 為什麼不直接沿用 Search(Places API Text Search):Places API (New) 的
// Text Search 本質上偏向商家/POI(餐廳、飯店、車站)搜尋,對「橋樑」「道路」
// 這類地理要素(Google 內部分類為 route)支援明顯較弱——實測「花蓮 光復橋」
// 這種查詢在 Places API 完全查無結果,單查「光復橋」甚至會誤配到台北的
// 店家。改用 Geocoding API 後同樣的查詢字串能正確解析出這座橋的座標
// (type: route),這是 Google Maps 消費端網頁/App 背後實際使用的服務,
// 對地址/道路類查詢的支援比 Places API Text Search 完整。
const geocodeURL = "https://maps.googleapis.com/maps/api/geocode/json"

// GeocodeResult 是 Geocoding API 單筆結果。
type GeocodeResult struct {
	FormattedAddress string  `json:"formattedAddress"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	// PlaceID 是這筆結果對應的 Google Place ID(Geocoding API 回應本身就
	// 附帶這個欄位,不需要另外查詢)——供呼叫端(handleGeocodeEntry)把
	// entry 的座標來源跟穩定的地點識別碼關聯起來,供之後跟 Places API
	// 其他已快取資料比對用。
	PlaceID string `json:"placeID,omitempty"`
}

// Geocode 查詢一個地址/地名字串,回傳第一筆最相符的結果。
// 與 Search(Places API)不同,這裡固定只取第一筆——Geocoding API 的結果
// 排序已經是相關性優先,這個端點目前的使用情境(entry geocode)只需要
// 最佳匹配,不需要候選清單。
func (c *Client) Geocode(ctx context.Context, address string) (GeocodeResult, error) {
	if c.apiKey == "" {
		return GeocodeResult{}, ErrNoKey
	}
	if address == "" {
		return GeocodeResult{}, ErrNotFound
	}

	reqURL := geocodeURL + "?address=" + url.QueryEscape(address) +
		"&language=zh-TW&key=" + url.QueryEscape(c.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return GeocodeResult{}, err
	}

	resp, err := c.gateway.Do(ctx, req, "geocode", callerFromContext(ctx), pathFromContext(ctx))
	if err != nil {
		return GeocodeResult{}, fmt.Errorf("geo: geocode request failed: %w", err)
	}
	defer resp.Body.Close()

	var body struct {
		Status       string `json:"status"`
		ErrorMessage string `json:"error_message"`
		Results      []struct {
			FormattedAddress string `json:"formatted_address"`
			PlaceID          string `json:"place_id"`
			Geometry         struct {
				Location struct {
					Lat float64 `json:"lat"`
					Lng float64 `json:"lng"`
				} `json:"location"`
			} `json:"geometry"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return GeocodeResult{}, fmt.Errorf("geo: geocode decode failed: %w", err)
	}

	switch body.Status {
	case "OK":
		// 往下走正常處理
	case "ZERO_RESULTS":
		return GeocodeResult{}, ErrNotFound
	default:
		msg := body.ErrorMessage
		if msg == "" {
			msg = body.Status
		}
		return GeocodeResult{}, fmt.Errorf("geo: geocode failed (%s): %s", body.Status, msg)
	}
	if len(body.Results) == 0 {
		return GeocodeResult{}, ErrNotFound
	}

	r := body.Results[0]
	return GeocodeResult{
		FormattedAddress: r.FormattedAddress,
		Lat:              r.Geometry.Location.Lat,
		Lng:              r.Geometry.Location.Lng,
		PlaceID:          r.PlaceID,
	}, nil
}
