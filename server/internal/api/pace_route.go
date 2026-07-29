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
	waypoints := make([]routeWaypoint, 0, len(paceRouteWaypoints))
	for _, addr := range paceRouteWaypoints {
		waypoints = append(waypoints, routeWaypoint{Address: addr})
	}
	return computeRouteByWaypoints(ctx, apiKey,
		routeWaypoint{Address: paceRouteOrigin}, waypoints, routeWaypoint{Address: paceRouteDestination})
}

// routeWaypoint 是 computeRoutes 的 origin/intermediates/destination 共用的
// 輸入形狀:優先用座標(HasLatLng)、沒有座標才 fallback 用地址字串——座標
// 是既有 Entry.Lat/Lng 查證過的精確位置,直接送座標給 Google 完全略過地址
// 解析這一步,不會像「左轉 民治街(花52)」這種夾雜轉彎描述/括號代碼的
// entry title 那樣讓 Google 的地址解析失敗、整條路線算不出來(實測過:同樣
// 三個點,傳完整 title 當地址會讓 computeRoutes 回應空的 routes 陣列,改傳
// 座標就能正確算出路線)。
type routeWaypoint struct {
	Lat       float64
	Lng       float64
	HasLatLng bool
	Address   string
}

func (w routeWaypoint) toRequestValue() map[string]any {
	if w.HasLatLng {
		return map[string]any{
			"location": map[string]any{
				"latLng": map[string]any{"latitude": w.Lat, "longitude": w.Lng},
			},
		}
	}
	return map[string]any{"address": w.Address}
}

// computeRouteByWaypoints 是 computePaceRoute/handleComputeRouteFromEntries
// 共用的核心:接受 routeWaypoint(座標優先、地址 fallback)組成的
// origin/intermediates/destination,呼叫 computeRoutes 並回傳扁平化結果。
func computeRouteByWaypoints(ctx context.Context, apiKey string, origin routeWaypoint, intermediates []routeWaypoint, destination routeWaypoint) (*paceRouteResult, error) {
	waypoints := make([]map[string]any, 0, len(intermediates))
	for _, wp := range intermediates {
		waypoints = append(waypoints, wp.toRequestValue())
	}
	body, err := json.Marshal(map[string]any{
		"origin":        origin.toRequestValue(),
		"destination":   destination.toRequestValue(),
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
