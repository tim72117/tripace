// Package geo 封裝 Google Places API（Text Search），
// 輸入地點名稱，回傳候選地點清單（含經緯度）。
package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const placesURL = "https://maps.googleapis.com/maps/api/place/textsearch/json"

// Client 持有 API key，提供地點查詢。
type Client struct {
	apiKey string
	http   *http.Client
}

// New 建立 Client；apiKey 為空時 Search 永遠回傳 ErrNoKey。
func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 5 * time.Second},
	}
}

var ErrNoKey = fmt.Errorf("geo: Google Places API key 未設定")
var ErrNotFound = fmt.Errorf("geo: 找不到符合的地點")

// Place 是候選地點結果。
type Place struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

// SearchOptions 是查詢選項。
type SearchOptions struct {
	// Region 是 ISO 3166-1 alpha-2 國家代碼（如 "jp"、"tw"、"cn"），
	// 讓結果優先偏向該國。空字串表示不限制。
	Region string
	// MaxResults 最多回傳幾筆候選，預設 1，最大 5。
	MaxResults int
}

// Search 查詢地點名稱，回傳候選清單。
// opts 可傳 nil 使用預設值（只回傳第一筆，不限地區）。
func (c *Client) Search(ctx context.Context, place string, opts *SearchOptions) ([]Place, error) {
	if c.apiKey == "" {
		return nil, ErrNoKey
	}
	if place == "" {
		return nil, ErrNotFound
	}

	maxN := 1
	region := ""
	if opts != nil {
		if opts.MaxResults > 0 {
			maxN = opts.MaxResults
			if maxN > 5 {
				maxN = 5
			}
		}
		region = opts.Region
	}

	req, err := http.NewRequestWithContext(ctx, "GET", placesURL, nil)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	q.Set("query", place)
	q.Set("key", c.apiKey)
	if region != "" {
		q.Set("region", region)
	}
	req.URL.RawQuery = q.Encode()

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("geo: request failed: %w", err)
	}
	defer resp.Body.Close()

	var body struct {
		Status  string `json:"status"`
		Results []struct {
			Name             string `json:"name"`
			FormattedAddress string `json:"formatted_address"`
			Geometry         struct {
				Location struct {
					Lat float64 `json:"lat"`
					Lng float64 `json:"lng"`
				} `json:"location"`
			} `json:"geometry"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("geo: decode failed: %w", err)
	}
	if body.Status != "OK" || len(body.Results) == 0 {
		return nil, ErrNotFound
	}

	out := make([]Place, 0, maxN)
	for i, r := range body.Results {
		if i >= maxN {
			break
		}
		out = append(out, Place{
			Name:    r.Name,
			Address: r.FormattedAddress,
			Lat:     r.Geometry.Location.Lat,
			Lng:     r.Geometry.Location.Lng,
		})
	}
	return out, nil
}

// Lookup 查詢地點名稱，回傳第一筆結果的經緯度（向下相容用）。
func (c *Client) Lookup(ctx context.Context, place string) (lat, lng float64, err error) {
	places, err := c.Search(ctx, place, nil)
	if err != nil {
		return 0, 0, err
	}
	return places[0].Lat, places[0].Lng, nil
}
