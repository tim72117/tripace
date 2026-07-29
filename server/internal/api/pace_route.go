package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

// PaceRouteMap(web/src/PaceRouteMap.tsx,UI 試做用)原本直接在瀏覽器端呼叫
// Google 的 computeRoutes REST 端點,需要把 Maps API key 開放 routes.googleapis.com
// 服務才能用。改成由後端代呼叫,前端只打這支端點,不需要再讓瀏覽器端的
// VITE_GOOGLE_MAPS_API_KEY 承擔 Routes API 的呼叫責任——這個 key 是給
// Maps JavaScript API(地圖渲染)用的,呼叫計算類 REST API 應該用後端專用的
// GOOGLE_PLACES_API_KEY(與 internal/wanttools 的 geocode/recommend_nearby
// 共用同一把 key,已擴大其 API 限制涵蓋 routes.googleapis.com)。
//
// 起訖點與中繼點皆為展示用固定資料(對應前端原本寫死的 ORIGIN/WAYPOINTS/
// DESTINATION),故用行程序啟動時的記憶體快取即可,不需要接收任何請求參數、
// 也不需要每次都重打 Google API(按次計費,固定資料重算沒有意義)。

const (
	paceRouteOrigin      = "花蓮 光復橋"
	paceRouteDestination = "花蓮 富興客棧"
)

var paceRouteWaypoints = []string{"花蓮 大農大富平地森林園區", "花蓮 七彩釣竿橋", "花蓮 大富火車站"}

type paceRouteLatLng struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type paceRouteLeg struct {
	StartLocation *paceRouteLatLng `json:"startLocation,omitempty"`
	EndLocation   *paceRouteLatLng `json:"endLocation,omitempty"`
}

type paceRouteResult struct {
	Encoded string         `json:"encoded"`
	Legs    []paceRouteLeg `json:"legs"`
}

type computeRoutesResponse struct {
	Routes []struct {
		Polyline struct {
			EncodedPolyline string `json:"encodedPolyline"`
		} `json:"polyline"`
		Legs []struct {
			StartLocation struct {
				LatLng paceRouteLatLng `json:"latLng"`
			} `json:"startLocation"`
			EndLocation struct {
				LatLng paceRouteLatLng `json:"latLng"`
			} `json:"endLocation"`
		} `json:"legs"`
	} `json:"routes"`
}

// paceRouteCache:進程內快取,首次請求時打一次 Google API,之後同一個
// server 生命週期內都直接回傳快取結果——固定路線資料,沒有必要每個請求
// 都重打一次按次計費的 API。
var (
	paceRouteCacheMu sync.Mutex
	paceRouteCache   *paceRouteResult
)

func (s *Server) handlePaceRoute(w http.ResponseWriter, r *http.Request) {
	paceRouteCacheMu.Lock()
	cached := paceRouteCache
	paceRouteCacheMu.Unlock()
	if cached != nil {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	if apiKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "未設定 GOOGLE_PLACES_API_KEY"})
		return
	}

	result, err := computePaceRoute(r.Context(), apiKey)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	paceRouteCacheMu.Lock()
	paceRouteCache = result
	paceRouteCacheMu.Unlock()

	writeJSON(w, http.StatusOK, result)
}

func computePaceRoute(ctx context.Context, apiKey string) (*paceRouteResult, error) {
	waypoints := make([]map[string]any, 0, len(paceRouteWaypoints))
	for _, addr := range paceRouteWaypoints {
		waypoints = append(waypoints, map[string]any{"address": addr})
	}
	body, err := json.Marshal(map[string]any{
		"origin":        map[string]any{"address": paceRouteOrigin},
		"destination":   map[string]any{"address": paceRouteDestination},
		"intermediates": waypoints,
		"travelMode":    "DRIVE",
	})
	if err != nil {
		return nil, fmt.Errorf("組裝 computeRoutes 請求失敗: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost,
		"https://routes.googleapis.com/directions/v2:computeRoutes", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("建立 computeRoutes 請求失敗: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", "routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("呼叫 computeRoutes 失敗: %w", err)
	}
	defer resp.Body.Close()

	var decoded computeRoutesResponse
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("computeRoutes 回應狀態碼 %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("解析 computeRoutes 回應失敗: %w", err)
	}
	if len(decoded.Routes) == 0 || decoded.Routes[0].Polyline.EncodedPolyline == "" {
		return nil, fmt.Errorf("computeRoutes 回應沒有可用的路線")
	}

	route := decoded.Routes[0]
	legs := make([]paceRouteLeg, 0, len(route.Legs))
	for _, leg := range route.Legs {
		legs = append(legs, paceRouteLeg{
			StartLocation: &paceRouteLatLng{Latitude: leg.StartLocation.LatLng.Latitude, Longitude: leg.StartLocation.LatLng.Longitude},
			EndLocation:   &paceRouteLatLng{Latitude: leg.EndLocation.LatLng.Latitude, Longitude: leg.EndLocation.LatLng.Longitude},
		})
	}

	return &paceRouteResult{Encoded: route.Polyline.EncodedPolyline, Legs: legs}, nil
}
