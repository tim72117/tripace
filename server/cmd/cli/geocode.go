package main

import (
	"flag"
	"net/url"
	"strconv"
)

// cmdGeocode 走 GET /internal/maintenance/geocode(見 server/internal/api/
// maintenance.go 的說明)——原本在這個 CLI process 內直接建立 geo.Client、
// 繞過後端打 Google Places API,現已搬進後端統一處理:好處是這次呼叫
// 會被 apigateway.Gateway 的節流與 geo_api_call_logs 記錄涵蓋到(見
// internal/apigateway 的說明),不再是「CLI 自己打、後端完全不知道」的
// 一條漏網之魚。副作用是現在需要先登入(`tripace-cli login --web`)才能
// 使用這個子命令——之前只要本機 server/.env 有 GOOGLE_PLACES_API_KEY
// 就能跑,現在跟其餘子命令一致改走 JWT 驗證的 /internal/* 路由。
func cmdGeocode(args []string) {
	fs := flag.NewFlagSet("geocode", flag.ExitOnError)
	place := fs.String("place", "", "地點名稱（必填）")
	region := fs.String("region", "", "國家代碼限制，如 jp / tw / cn（可選）")
	maxN := fs.Int("n", 1, "回傳候選筆數（1-5，預設 1）")
	entryID := fs.String("entry", "", "寫入座標的 entry ID（指定時取第一筆自動寫入）")
	apiURLFlag := fs.String("api", "http://localhost:8080", "server URL")
	_ = fs.Parse(args)

	if *place == "" && fs.NArg() > 0 {
		*place = fs.Arg(0)
	}
	if *place == "" {
		fatal("geocode 需要 -place 地點名稱")
	}

	c := newHTTPClient(*apiURLFlag)
	q := url.Values{}
	q.Set("place", *place)
	if *region != "" {
		q.Set("region", *region)
	}
	if *maxN > 0 {
		q.Set("n", strconv.Itoa(*maxN))
	}

	res, err := c.do("GET", "/internal/maintenance/geocode?"+q.Encode(), nil)
	if err != nil {
		fatal("geocode: %v", err)
	}

	// 有指定 entry ID 就把第一筆候選座標寫入。走 setEntryLatLng(而不是
	// 自己組 request):認證(Authorization: Bearer)只在 httpClient.do
	// 裡設定一次,理由同該方法的說明。
	if *entryID != "" {
		places, _ := res["places"].([]any)
		if len(places) == 0 {
			fatal("geocode: 查無候選地點,無法寫入 -entry")
		}
		first, _ := places[0].(map[string]any)
		lat, _ := first["lat"].(float64)
		lng, _ := first["lng"].(float64)
		if err := c.setEntryLatLng(*entryID, lat, lng); err != nil {
			fatal("geocode set-latlng: %v", err)
		}
	}

	res["entryID"] = *entryID
	output(res)
}
