package attractionsync

import (
	"sort"
	"time"
)

// Record 是交握式傳輸協定實際搬運的單筆內容——刻意不是完整的
// model.Attraction，而是這個 package 自己的最小型別，讓 Transfer 不需要
// 依賴上層要傳輸的內容具體長什麼樣子（實作階段接上真實資料時，呼叫端
// 負責把 model.Attraction 轉成 Record，或者 Record 直接嵌入完整內容，
// 依接上真實 endpoint 時的實際需要調整）。
type Record struct {
	ID        string
	UpdatedAt time.Time
}

// WriteResult 是目的方對單筆寫入請求的回報。
type WriteResult struct {
	ID      string
	Written bool
}

// Destination 是交握協定裡「目的方」需要提供的最小介面——WriteOne 逐筆
// 接收並回報結果，LatestState 供筆數不符後查詢真正的斷點（見
// ResumeFrom）。push 情境下由呼叫正式站 HTTP API 的 client 實作；pull
// 情境下由直接寫本機 DB 的實作提供，兩者共用同一個 Transfer。
type Destination interface {
	WriteOne(Record) (WriteResult, error)
	LatestState() (FreshnessProbe, error)
}

// TransferResult 是 Transfer 一次執行的結果。Complete 為 false 代表筆數
// 不符（中途有記錄寫入失敗或連線中斷），呼叫端應該用 ResumeFrom 算出
// 剩下的部分、重新呼叫一次 Transfer 續傳，而不是把這視為一個 error。
type TransferResult struct {
	Complete     bool
	WrittenCount int
}

// Transfer 依 UpdatedAt 由舊到新排序後逐筆傳送，每筆立刻透過
// dest.WriteOne 驗證寫入結果；全部處理完後核對「應收筆數」與「實際
// 寫入筆數」是否相符（見 docs/ATTRACTION_SYNC_DESIGN.md「二、傳輸
// 流程」的交握協定）。
//
// 一旦有一筆 WriteOne 回傳 error 就停止繼續傳送剩下的記錄——設計文件
// 的交握協定本身不需要「跳過失敗的一筆、繼續傳下一筆」，筆數不符時
// 一律靠 ResumeFrom 重新查詢斷點接續，不在 Transfer 內部重試。
func Transfer(records []Record, dest Destination) (TransferResult, error) {
	sorted := make([]Record, len(records))
	copy(sorted, records)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].UpdatedAt.Before(sorted[j].UpdatedAt) })

	written := 0
	for _, rec := range sorted {
		result, err := dest.WriteOne(rec)
		if err != nil || !result.Written {
			break
		}
		written++
	}

	return TransferResult{
		Complete:     written == len(sorted),
		WrittenCount: written,
	}, nil
}

// ResumeFrom 用目的方回報的最新狀態，過濾掉「已經確認同步過去」的
// 部分，只留下真正還沒到達目的方的記錄——不依賴額外的進度檔案，純粹用
// UpdatedAt 排序 + 目的方回報的斷點位置計算（見設計文件「依時間序傳送/
// 寫入是這套機制能夠續傳的關鍵」）。
//
// destState 為零值（從未成功傳過任何一筆）時，原封不動回傳整份清單。
func ResumeFrom(all []Record, destState FreshnessProbe) []Record {
	if destState.Count == 0 {
		out := make([]Record, len(all))
		copy(out, all)
		return out
	}

	var remaining []Record
	for _, rec := range all {
		if rec.UpdatedAt.After(destState.LatestUpdatedAt) {
			remaining = append(remaining, rec)
		}
	}
	return remaining
}
