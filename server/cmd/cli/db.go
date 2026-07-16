package main

// db.go 保留直連 DB 的實作，供本地開發或無法連 server 時使用。
// 透過 -db 旗標啟用。

import (
	"github.com/joho/godotenv"
	"github.com/tim72117/shuttle/internal/store"
	"github.com/tim72117/shuttle/internal/tripsvc"
	"os"
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

func (c *dbClient) record(channelID, title, start, startTime, end, endTime, location string) (any, error) {
	return c.svc.Record(tripsvc.RecordInput{
		ChannelID: channelID, Title: title,
		Start: start, StartTime: startTime,
		End: end, EndTime: endTime,
		Location: location,
	})
}

func (c *dbClient) addToTrip(entryID, tripID, title string) (string, string, error) {
	return c.svc.AddToTrip(entryID, tripID, title)
}

func (c *dbClient) listTrips(channelID string) (any, error) {
	trips, err := c.svc.ListTrips(channelID)
	return map[string]any{"trips": trips}, err
}

func (c *dbClient) tripEntries(channelID, tripID string) (any, error) {
	ents, err := c.svc.ListTripEntries(channelID, tripID)
	return map[string]any{"entries": ents}, err
}

func (c *dbClient) candidates(channelID, start, end string) (any, error) {
	trips, err := c.svc.FindCandidates(channelID, start, end)
	return map[string]any{"candidates": trips}, err
}

func (c *dbClient) updateEntry(in tripsvc.UpdateEntryInput) error {
	return c.svc.UpdateEntry(in)
}

func (c *dbClient) deleteEntry(entryID string) error {
	return c.st.DeleteEntry(entryID)
}

func (c *dbClient) deleteTrip(tripID string) error {
	return c.svc.DeleteTrip(tripID)
}

func (c *dbClient) reset(channelID string) error {
	return c.svc.Reset(channelID)
}

// dropLegacyColumns 是一次性維運操作:清掉 entries 表已改名淘汰的舊欄位
// (item/summary)。只在 -db 模式下有意義,故只掛在 dbClient 上,不進 client 介面。
func (c *dbClient) dropLegacyColumns() ([]string, error) {
	return c.st.DropLegacyEntryColumns()
}
