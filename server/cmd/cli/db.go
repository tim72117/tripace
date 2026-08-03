package main

// db.go 保留直連 DB 的實作，供本地開發或無法連 server 時使用。
// 透過 -db 旗標啟用。

import (
	"crypto/rand"
	"encoding/hex"
	"os"

	"github.com/joho/godotenv"
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

func (c *dbClient) listChannels() (any, error) {
	channels, err := c.st.ListAllChannels()
	return map[string]any{"channels": channels}, err
}

// tripEntries 列出某個頻道的所有 entry(名稱沿用歷史,見 httpClient 的同名
// 方法說明)。
func (c *dbClient) tripEntries(channelID string) (any, error) {
	entries, err := c.st.ListEntriesByChannel(channelID)
	return map[string]any{"entries": entries}, err
}

// createChannel 在 -db 模式下沒有「已登入使用者」這個概念(整個 dbClient
// 都是直連 DB、無 HTTP 請求、無 auth context),故 owner 固定用
// api.Server 對未帶 token 請求的同一個訪客身分(usr_me/"我"，見
// internal/api/api.go 的 guestUser)——這樣 -db 模式建出來的頻道，owner
// 與「不登入直接打 /v1/channels」拿到的結果一致，不會另外多出一種身分。
func (c *dbClient) createChannel(name string) (any, error) {
	id := make([]byte, 4)
	_, _ = rand.Read(id)
	creator := model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"}
	return c.st.CreateChannel("ch_"+hex.EncodeToString(id), name, creator)
}

func (c *dbClient) record(channelID, title, start, startTime, end, endTime, location string) (any, error) {
	return c.svc.Record(tripsvc.RecordInput{
		ChannelID: channelID, Title: title,
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

func (c *dbClient) reset(channelID string) error {
	return c.svc.Reset(channelID)
}

// dropTripGrouping 是一次性維運操作:清掉 trip 歸組機制留下的孤兒資料庫
// 物件(entries.trip_id 欄位與 trips 表,見 store.DropTripGroupingObjects
// 的完整說明)。只在 -db 模式下有意義,故只掛在 dbClient 上,不進 client 介面。
func (c *dbClient) dropTripGrouping() ([]string, error) {
	return c.st.DropTripGroupingObjects()
}
