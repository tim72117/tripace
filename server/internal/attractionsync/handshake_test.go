package attractionsync

// handshake_test.go 定義交握式傳輸協定的預期行為（見
// docs/ATTRACTION_SYNC_DESIGN.md「二、傳輸流程」的「交握式傳輸」一節）：
// 依時間序（舊→新）傳送、逐筆驗證、筆數核對，筆數不符時不猜測斷點、
// 改為重新查詢目的方最新狀態接續。
//
// 這裡用一個記憶體中的 fakeDestination 模擬「目的方」這一端會做的事
// （逐筆接收、逐筆回報、必要時模擬寫入失敗/中斷），Transfer() 是這個
// package 對外提供、實際驅動整個交握流程的函式——不管呼叫端是 push
// 情境下的本機、還是 pull 情境下的正式站，都呼叫同一個 Transfer()。

import (
	"errors"
	"testing"
	"time"
)

// fakeDestination 實作 Destination 介面，模擬交握協定裡「目的方」的行為：
// 依序接收記錄、逐筆回報寫入結果，並可設定在第幾筆時模擬失敗。
type fakeDestination struct {
	received  []Record // 依接收順序累積，供測試斷言順序正確
	failAt    int      // 從 1 起算，第幾筆要回報失敗；0 = 不失敗
	callCount int
}

func (f *fakeDestination) WriteOne(rec Record) (WriteResult, error) {
	f.callCount++
	f.received = append(f.received, rec)
	if f.failAt != 0 && f.callCount == f.failAt {
		return WriteResult{}, errors.New("模擬第 " + rec.ID + " 筆寫入失敗")
	}
	return WriteResult{ID: rec.ID, Written: true}, nil
}

func (f *fakeDestination) LatestState() (FreshnessProbe, error) {
	if len(f.received) == 0 {
		return FreshnessProbe{}, nil
	}
	last := f.received[len(f.received)-1]
	return FreshnessProbe{Count: len(f.received), LatestUpdatedAt: last.UpdatedAt, LatestID: last.ID}, nil
}

func rec(id string, updatedAt time.Time) Record {
	return Record{ID: id, UpdatedAt: updatedAt}
}

func TestTransfer_SendsOldestFirst(t *testing.T) {
	// 三筆刻意用「新→舊」的順序放進輸入切片，驗證 Transfer 自己依
	// UpdatedAt 由舊到新重新排序後才傳送，不依賴呼叫端先排好序。
	records := []Record{
		rec("lmk_3", ts("2026-08-03T00:00:00Z")),
		rec("lmk_1", ts("2026-08-01T00:00:00Z")),
		rec("lmk_2", ts("2026-08-02T00:00:00Z")),
	}
	dest := &fakeDestination{}

	result, err := Transfer(records, dest)
	if err != nil {
		t.Fatalf("Transfer: %v", err)
	}

	wantOrder := []string{"lmk_1", "lmk_2", "lmk_3"}
	if len(dest.received) != len(wantOrder) {
		t.Fatalf("收到 %d 筆，預期 %d 筆", len(dest.received), len(wantOrder))
	}
	for i, want := range wantOrder {
		if dest.received[i].ID != want {
			t.Errorf("第 %d 筆寫入順序 = %s，預期 %s（未依 UpdatedAt 舊到新排序）", i, dest.received[i].ID, want)
		}
	}
	if !result.Complete {
		t.Error("三筆全部成功寫入，預期 result.Complete = true")
	}
	if result.WrittenCount != 3 {
		t.Errorf("result.WrittenCount = %d，預期 3", result.WrittenCount)
	}
}

func TestTransfer_CountMismatchNotComplete(t *testing.T) {
	// 對應設計文件：「全部處理完後，目的方回報『實際寫入筆數』，來源方
	// 核對是否等於應收筆數；不相符 → 不需要猜測斷在哪一筆」。這裡用
	// failAt 模擬第 2 筆寫入失敗，驗證 Transfer 正確地把這個中斷回報
	// 出來（Complete=false），而不是默默當作成功。
	records := []Record{
		rec("lmk_1", ts("2026-08-01T00:00:00Z")),
		rec("lmk_2", ts("2026-08-02T00:00:00Z")),
		rec("lmk_3", ts("2026-08-03T00:00:00Z")),
	}
	dest := &fakeDestination{failAt: 2}

	result, err := Transfer(records, dest)

	// 傳輸中斷本身不是 Go 的 error（呼叫端要能拿到 result 決定下一步，
	// 例如自動重新查詢斷點續傳），只有真正的協定層錯誤（例如連線層級
	// 的問題）才回傳 error——這裡用 result.Complete 表達「筆數不符」。
	if err != nil {
		t.Fatalf("Transfer 不應該直接回傳 error（中斷應反映在 result），得到: %v", err)
	}
	if result.Complete {
		t.Error("第 2 筆寫入失敗，預期 result.Complete = false")
	}
	if result.WrittenCount != 1 {
		t.Errorf("result.WrittenCount = %d，預期 1（只有 lmk_1 在失敗前成功寫入）", result.WrittenCount)
	}
}

func TestTransfer_EachWriteVerifiedImmediately(t *testing.T) {
	// 對應設計文件：「每寫入一筆，立刻回傳寫入結果⋯來源方當下就比對這筆
	// 的回傳內容是否與送出內容相符（逐筆完整性驗證）」——這裡驗證
	// Transfer 確實逐筆呼叫 WriteOne，而不是先收集完所有記錄再一次送出
	// （呼叫次數必須等於記錄筆數，順序見 TestTransfer_SendsOldestFirst）。
	records := []Record{
		rec("lmk_1", ts("2026-08-01T00:00:00Z")),
		rec("lmk_2", ts("2026-08-02T00:00:00Z")),
	}
	dest := &fakeDestination{}

	if _, err := Transfer(records, dest); err != nil {
		t.Fatalf("Transfer: %v", err)
	}

	if dest.callCount != len(records) {
		t.Errorf("WriteOne 被呼叫 %d 次，預期 %d 次（每筆各一次）", dest.callCount, len(records))
	}
}

func TestTransfer_EmptyRecordsIsComplete(t *testing.T) {
	// 邊界情況：沒有要傳的記錄（三層比對後判定沒有差異）時，Transfer
	// 應該直接視為已完成，不呼叫 WriteOne，也不應該出錯。
	dest := &fakeDestination{}

	result, err := Transfer(nil, dest)
	if err != nil {
		t.Fatalf("Transfer(nil, ...): %v", err)
	}
	if !result.Complete || result.WrittenCount != 0 {
		t.Errorf("result = %+v，預期 Complete=true, WrittenCount=0", result)
	}
	if dest.callCount != 0 {
		t.Errorf("WriteOne 被呼叫 %d 次，預期 0 次", dest.callCount)
	}
}

// ---- 續傳：筆數不符後，靠重新查詢目的方最新狀態接續 ----

func TestResumeFrom_FiltersAlreadyWritten(t *testing.T) {
	// 對應設計文件：「不需要猜測斷在哪一筆，直接重新查詢目的方目前最新
	// 一筆的 UpdatedAt，用這個值重新跑一次三層比對，差異自然只會剩下
	// 『目的方還沒收到的部分』」。
	//
	// 這裡直接測 ResumeFrom 這個更小的輔助函式：給定「原本要傳的完整
	// 清單」與「目的方回報的最新狀態」，過濾掉已經確認同步過去的部分，
	// 只留下真正還沒到達目的方的記錄——不依賴額外的進度檔案，純粹用
	// UpdatedAt 排序 + 目的方回報的斷點位置計算。
	all := []Record{
		rec("lmk_1", ts("2026-08-01T00:00:00Z")),
		rec("lmk_2", ts("2026-08-02T00:00:00Z")),
		rec("lmk_3", ts("2026-08-03T00:00:00Z")),
	}
	// 目的方回報：目前最新一筆是 lmk_2（代表 lmk_1、lmk_2 已確認寫入，
	// lmk_3 還沒到）。
	destState := FreshnessProbe{Count: 2, LatestUpdatedAt: ts("2026-08-02T00:00:00Z"), LatestID: "lmk_2"}

	remaining := ResumeFrom(all, destState)

	if len(remaining) != 1 || remaining[0].ID != "lmk_3" {
		t.Errorf("ResumeFrom = %v，預期只剩 [lmk_3]", remaining)
	}
}

func TestResumeFrom_DestEmptyReturnsAll(t *testing.T) {
	// 目的方完全沒有任何已知狀態（例如從未成功傳過任何一筆）→ 全部都
	// 還沒同步，應該原封不動回傳整份清單。
	all := []Record{
		rec("lmk_1", ts("2026-08-01T00:00:00Z")),
		rec("lmk_2", ts("2026-08-02T00:00:00Z")),
	}

	remaining := ResumeFrom(all, FreshnessProbe{})

	if len(remaining) != len(all) {
		t.Errorf("ResumeFrom 回傳 %d 筆，預期全部 %d 筆都還沒同步", len(remaining), len(all))
	}
}
