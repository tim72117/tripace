package main

// db.go 保留直連 DB 的實作，供本地開發或無法連 server 時使用。
// 透過 -db 旗標啟用。

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
	"github.com/tim72117/tripace/internal/tripsvc"
)

func newDBClient() *dbClient {
	_ = godotenv.Load()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fatal("未設 DATABASE_URL(請在 server/.env 設定)")
	}
	st, err := store.Open(dsn)
	if err != nil {
		fatal("open store: %v", err)
	}
	return &dbClient{st: st, svc: tripsvc.New(st, nil)}
}

type dbClient struct {
	st  *store.Store
	svc *tripsvc.Service
}

func (c *dbClient) close() { c.st.Close() }

func (c *dbClient) listTrips() (any, error) {
	trips, err := c.st.ListAllTrips()
	return map[string]any{"trips": trips}, err
}

// tripEntries 列出某個行程的所有 entry(名稱沿用歷史,見 httpClient 的同名
// 方法說明)。
func (c *dbClient) tripEntries(tripID string) (any, error) {
	entries, err := c.st.ListEntriesByTrip(tripID)
	return map[string]any{"entries": entries}, err
}

// createTrip 在 -db 模式下沒有「已登入使用者」這個概念(整個 dbClient
// 都是直連 DB、無 HTTP 請求、無 auth context),故 owner 固定用
// api.Server 對未帶 token 請求的同一個訪客身分(usr_me/"我"，見
// internal/api/api.go 的 guestUser)——這樣 -db 模式建出來的行程，owner
// 與「不登入直接打 /v1/trips」拿到的結果一致，不會另外多出一種身分。
func (c *dbClient) createTrip(name string) (any, error) {
	id := make([]byte, 4)
	_, _ = rand.Read(id)
	creator := model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"}
	return c.st.CreateTrip("tr_"+hex.EncodeToString(id), name, creator)
}

func (c *dbClient) record(tripID, title, start, startTime, end, endTime, location string) (any, error) {
	return c.svc.Record(tripsvc.RecordInput{
		TripID: tripID, Title: title,
		Start: start, StartTime: startTime,
		End: end, EndTime: endTime,
		Location: location,
	})
}

func (c *dbClient) updateEntry(in tripsvc.UpdateEntryInput) error {
	return c.svc.UpdateEntry(in)
}

func (c *dbClient) deleteEntry(entryID string) error {
	return c.st.DeleteEntry(entryID)
}

func (c *dbClient) reset(tripID string) error {
	return c.svc.Reset(tripID)
}

// dropTripGrouping 是一次性維運操作:清掉 trip 歸組機制留下的孤兒資料庫
// 物件(entries.trip_id 欄位與 trips 表,見 store.DropTripGroupingObjects
// 的完整說明)。只在 -db 模式下有意義,故只掛在 dbClient 上,不進 client 介面。
//
// 注意:這裡的 trips 表指的是已移除的「trip 歸組」機制(把 entries 依時間
// 自動分組)留下的孤兒表,和這次 channel→trip 改名後的 trips 主表是恰好
// 同名、但完全無關的兩件事——這支維運指令在 channel→trip 改名之前就已經
// 針對本地/正式站執行過,執行當下 channels 表還叫 channels,不是這次改名
// 建出來的 trips 表。
func (c *dbClient) dropTripGrouping() ([]string, error) {
	return c.st.DropTripGroupingObjects()
}

// renameChannelToTrip 是一次性維運操作:把 channel→trip 改名這次程式碼重構
// 對應的資料庫結構變更真正落到資料庫上(channels 表改名 trips、三張表的
// channel_id 欄位改名 trip_id,見 store.RenameChannelToTrip 的完整說明)。
// 只在 -db 模式下有意義,故只掛在 dbClient 上,不進 client 介面。
func (c *dbClient) renameChannelToTrip() ([]string, error) {
	return c.st.RenameChannelToTrip()
}

// landmarkAdd/landmarkList/landmarkDelete/landmarkCities:地標/區域資料
// (見 model.Landmark、docs/TRIP_PLANNING_DESIGN_DISCUSSION.md 構想 6)
// 的人工建檔操作,只在 -db 模式下有意義(這是直接寫資料庫的維運/建檔
// 操作,不是給一般使用者用的業務功能,故不進 client 介面、不開 HTTP 端點)。
func (c *dbClient) landmarkAdd(in model.Landmark) (any, error) {
	return c.st.CreateLandmark(in)
}

func (c *dbClient) landmarkList(city string) (any, error) {
	landmarks, err := c.st.ListLandmarksByCity(city)
	return map[string]any{"city": city, "landmarks": landmarks}, err
}

func (c *dbClient) landmarkCities() (any, error) {
	cities, err := c.st.ListLandmarkCities()
	return map[string]any{"cities": cities}, err
}

func (c *dbClient) landmarkDelete(id string) error {
	return c.st.DeleteLandmark(id)
}

// landmarkUpdatePhoto 重新透過 Google Places 查詢一次地標圖片並回寫到
// 資料庫。query 為空字串時,用該筆地標既有的 Name+CityName 組成預設
// 查詢字串(對齊 SearchKnownDistricts 用「地標名稱」當查詢字串的慣例)。
// 查無圖片時回傳明確錯誤,不靜默略過——這是使用者主動觸發的單筆操作,
// 跟 SearchDistricts 內「找不到就跳過這區」的批次容錯邏輯不同,呼叫端
// 需要知道這次操作到底有沒有真的取到圖。
func (c *dbClient) landmarkUpdatePhoto(id, query string) (any, error) {
	lm, err := c.st.GetLandmark(id)
	if err != nil {
		return nil, fmt.Errorf("找不到地標 %s: %w", id, err)
	}
	if query == "" {
		query = lm.CityName + " " + lm.Name
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	_, photoRef, _, _, err := client.SearchLandmarkWithPhoto(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("查詢「%s」失敗: %w", query, err)
	}
	if photoRef == "" {
		return nil, fmt.Errorf("「%s」查無可用照片", query)
	}

	photoURL, err := client.PhotoDataURI(ctx, photoRef, 400)
	if err != nil {
		return nil, fmt.Errorf("下載照片失敗: %w", err)
	}

	if err := c.st.UpdateLandmarkPhoto(id, photoURL); err != nil {
		return nil, fmt.Errorf("寫入資料庫失敗: %w", err)
	}

	return map[string]any{
		"id":    id,
		"query": query,
		// 只回報是否成功與圖片長度,不把完整 data URI(可能數十 KB 的
		// base64 字串)印進終端機輸出——CLI 輸出是給人看的,不需要看到
		// 原始 base64 資料。
		"photoLength": len(photoURL),
		"status":      "updated",
	}, nil
}
