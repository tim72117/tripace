package main

// command_test.go 測 cmd* 這一層:旗標解析、以及解析結果有沒有正確傳給 client。
// 只寫 happy path——錯誤路徑一律走 fatal(),而 fatal() 是 log.Fatalf 也就是
// os.Exit(1),在測試裡會直接終結整個測試程序,要測得先把 fatal 改成可注入的
// 變數。那是另一件事,這裡不做。
//
// 這一層刻意用 fakeClient 而不是真的 httpClient:cmd* 函式的職責就只有
// 「把命令列參數翻譯成 client 呼叫」,用 fake 才能精確斷言翻譯結果。client 實作
// 本身跟 server 對不對得上,由 http_test.go 那層負責。

import (
	"encoding/json"
	"io"
	"os"
	"testing"

	"github.com/tim72117/tripace/internal/tripsvc"
)

// fakeClient 記錄下每個方法收到的參數,供測試斷言。
type fakeClient struct {
	listTripsCalled bool

	createTripName string

	tripEntriesTrip string

	recordArgs []string // tripID, title, start, startTime, end, endTime, location

	updateInput tripsvc.UpdateEntryInput

	deletedEntry string

	resetTrip string

	// result 是所有「有回傳值」的方法共用的回傳內容,測試用來確認 cmd* 有把
	// client 的結果原封不動輸出。
	result any
}

func (f *fakeClient) listTrips() (any, error) {
	f.listTripsCalled = true
	return f.result, nil
}

func (f *fakeClient) createTrip(name string) (any, error) {
	f.createTripName = name
	return f.result, nil
}

func (f *fakeClient) tripEntries(tripID string) (any, error) {
	f.tripEntriesTrip = tripID
	return f.result, nil
}

func (f *fakeClient) record(tripID, title, start, startTime, end, endTime, location string) (any, error) {
	f.recordArgs = []string{tripID, title, start, startTime, end, endTime, location}
	return f.result, nil
}

func (f *fakeClient) updateEntry(in tripsvc.UpdateEntryInput) error {
	f.updateInput = in
	return nil
}

func (f *fakeClient) deleteEntry(entryID string) error {
	f.deletedEntry = entryID
	return nil
}

func (f *fakeClient) reset(tripID string) error {
	f.resetTrip = tripID
	return nil
}

// attractionSyncSetup/attractionSync 的最小實作,單純讓 fakeClient 滿足
// client 介面——實際斷言這兩個方法收到的參數,由
// attraction_sync_test.go 的 fakeSyncClient(內嵌 fakeClient 並覆寫這兩個
// 方法)負責,這裡不需要記錄任何東西。
func (f *fakeClient) attractionSyncSetup(target string) (any, error) {
	return f.result, nil
}

func (f *fakeClient) attractionSync(direction string, allowDelete, apply, retry bool) (any, error) {
	return f.result, nil
}

// captureOutput 攔截 output() 印到 stdout 的 JSON,解析成 map 回傳。
// output() 直接用 fmt.Println 寫 os.Stdout,沒有可注入的 writer,所以這裡
// 暫時把 os.Stdout 換成 pipe。
func captureOutput(t *testing.T, fn func()) map[string]any {
	t.Helper()
	orig := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w

	done := make(chan []byte, 1)
	go func() {
		b, _ := io.ReadAll(r)
		done <- b
	}()

	fn()

	w.Close()
	os.Stdout = orig
	raw := <-done

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("output 不是合法 JSON object: %v（原始輸出 %q）", err, raw)
	}
	return got
}

func TestCmdListTrips(t *testing.T) {
	c := &fakeClient{result: map[string]any{"trips": []any{}}}
	got := captureOutput(t, func() { cmdListTrips(c) })

	if !c.listTripsCalled {
		t.Error("沒有呼叫 client.listTrips")
	}
	if _, ok := got["trips"]; !ok {
		t.Errorf("輸出缺少 trips 欄位: %v", got)
	}
}

func TestCmdCreateTrip(t *testing.T) {
	c := &fakeClient{result: map[string]any{"id": "tr_abc"}}
	got := captureOutput(t, func() {
		cmdCreateTrip(c, []string{"-name", "花蓮三日"})
	})

	if c.createTripName != "花蓮三日" {
		t.Errorf("createTrip 收到 %q，預期 %q", c.createTripName, "花蓮三日")
	}
	if got["id"] != "tr_abc" {
		t.Errorf("輸出 id = %v，預期 tr_abc", got["id"])
	}
}

func TestCmdEntryAdd(t *testing.T) {
	c := &fakeClient{result: map[string]any{"entryID": "ent_1"}}
	got := captureOutput(t, func() {
		cmdEntryAdd(c, []string{
			"-trip", "tr_abc",
			"-title", "光復糖廠",
			"-start", "2026-03-01",
			"-start-time", "09:00",
			"-end", "2026-03-01",
			"-end-time", "10:30",
			"-location", "花蓮縣光復鄉",
		})
	})

	want := []string{"tr_abc", "光復糖廠", "2026-03-01", "09:00", "2026-03-01", "10:30", "花蓮縣光復鄉"}
	if len(c.recordArgs) != len(want) {
		t.Fatalf("record 收到 %d 個參數，預期 %d 個: %v", len(c.recordArgs), len(want), c.recordArgs)
	}
	for i := range want {
		if c.recordArgs[i] != want[i] {
			t.Errorf("record 第 %d 個參數 = %q，預期 %q", i, c.recordArgs[i], want[i])
		}
	}
	if got["entryID"] != "ent_1" {
		t.Errorf("輸出 entryID = %v，預期 ent_1", got["entryID"])
	}
}

// TestCmdEntryUpdate 一併涵蓋 -detail 這個唯一需要在 CLI 端做轉換(JSON 字串
// 解析成 map)的旗標——先前 Detail 欄位寫入的 bug 就出在這條路徑上,雖然根因
// 在 store 層的 serializer,但 CLI 這端有沒有正確把字串解析成 map 同樣值得測。
func TestCmdEntryUpdate(t *testing.T) {
	c := &fakeClient{}
	got := captureOutput(t, func() {
		cmdEntryUpdate(c, []string{
			"-entry", "ent_1",
			"-title", "光復糖廠",
			"-kind", "activity",
			"-detail", `{"distanceKm":12.5}`,
		})
	})

	if c.updateInput.ID != "ent_1" {
		t.Errorf("updateEntry ID = %q，預期 ent_1", c.updateInput.ID)
	}
	if c.updateInput.Title != "光復糖廠" {
		t.Errorf("updateEntry Title = %q，預期 光復糖廠", c.updateInput.Title)
	}
	if c.updateInput.Kind != "activity" {
		t.Errorf("updateEntry Kind = %q，預期 activity", c.updateInput.Kind)
	}
	if c.updateInput.Detail["distanceKm"] != 12.5 {
		t.Errorf("updateEntry Detail[distanceKm] = %v，預期 12.5", c.updateInput.Detail["distanceKm"])
	}
	if got["updated"] != "ent_1" {
		t.Errorf("輸出 updated = %v，預期 ent_1", got["updated"])
	}
}

func TestCmdEntryDelete(t *testing.T) {
	c := &fakeClient{}
	got := captureOutput(t, func() {
		cmdEntryDelete(c, []string{"-entry", "ent_1"})
	})

	if c.deletedEntry != "ent_1" {
		t.Errorf("deleteEntry 收到 %q，預期 ent_1", c.deletedEntry)
	}
	if got["deleted"] != "ent_1" {
		t.Errorf("輸出 deleted = %v，預期 ent_1", got["deleted"])
	}
}

func TestCmdTripEntries(t *testing.T) {
	c := &fakeClient{result: map[string]any{"entries": []any{}}}
	got := captureOutput(t, func() {
		cmdTripEntries(c, []string{"-trip", "tr_abc"})
	})

	if c.tripEntriesTrip != "tr_abc" {
		t.Errorf("tripEntries 收到 %q，預期 tr_abc", c.tripEntriesTrip)
	}
	if _, ok := got["entries"]; !ok {
		t.Errorf("輸出缺少 entries 欄位: %v", got)
	}
}

func TestCmdReset(t *testing.T) {
	c := &fakeClient{}
	got := captureOutput(t, func() {
		cmdReset(c, []string{"-trip", "tr_abc"})
	})

	if c.resetTrip != "tr_abc" {
		t.Errorf("reset 收到 %q，預期 tr_abc", c.resetTrip)
	}
	if got["trip"] != "tr_abc" || got["status"] != "ok" {
		t.Errorf("輸出 = %v，預期 status=ok trip=tr_abc", got)
	}
}
