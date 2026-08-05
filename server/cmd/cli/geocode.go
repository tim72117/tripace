package main

import (
	"context"
	"flag"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/tim72117/tripace/internal/geo"
)

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

	// geocode 直接在本地建立 geo.Client(不像其餘子命令走 HTTP 打伺服器),
	// 需要自己讀 GOOGLE_PLACES_API_KEY——理由同 db.go 的 newDBClient():
	// 載入 server/.env 讓使用者不需要手動 export,找不到 .env 不視為錯誤
	// (維持原本「未設定 key 時由 client.Search 報錯」的既有行為)。
	_ = godotenv.Load()
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	places, err := client.Search(ctx, *place, &geo.SearchOptions{
		Region:     *region,
		MaxResults: *maxN,
	})
	if err != nil {
		fatal("geocode: %v", err)
	}

	// 有指定 entry ID 就把第一筆座標寫入。走 httpClient 而不是自己組 request:
	// /internal/* 需要有效的 JWT(見 server 的 internalAuth middleware),token
	// 的讀取與 Authorization header 統一由 httpClient.do 處理,自己另外組 request
	// 就會像先前那樣漏帶 token、一律吃 401。
	if *entryID != "" {
		first := places[0]
		if err := newHTTPClient(*apiURLFlag).setEntryLatLng(*entryID, first.Lat, first.Lng); err != nil {
			fatal("geocode set-latlng: %v", err)
		}
	}

	output(map[string]any{
		"query":      *place,
		"region":     *region,
		"entryID":    *entryID,
		"candidates": places,
	})
}
