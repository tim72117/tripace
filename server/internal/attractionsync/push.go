package attractionsync

// push.go 提供 push 情境（本機是來源＋決策方）的端到端整合入口——依序
// 打對方（目的方）的探測/清單/寫入端點，內部完成三層比對 + Transfer，
// 呼叫端不需要自己組合這些步驟（見 docs/ATTRACTION_SYNC_DESIGN.md
// 「二、傳輸流程」）。
//
// 這裡假設的目的方 HTTP 介面（GET /freshness、GET /list、POST /write）
// 對齊 integration_test.go 的 fakeAttractionHost——實際串接
// server/internal/api 的正式端點時，若路徑/形狀不同，只需要調整這個
// 檔案裡組 URL 與 decode 回應的部分，PushTo 的整體流程與呼叫端簽章
// 不需要跟著改。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

// PushTo 把 local 這份完整記錄，依序跟 baseURL 指向的目的方做第零/一/
// 二層比對，算出差異後透過 Transfer 交握式傳送過去。
//
// 目前不做「第零層新鮮度探測直接判定不需要同步」的提早返回——
// PushTo 收到的 local 已經是呼叫端準備要檢查的完整清單，是否要繼續
// 交由 DiffLite/CompareFields 的結果決定，避免在整合層重複一次
// NeedsSync 該由更上層（例如 CLI 端在呼叫 PushTo 前）決定的提早退出
// 邏輯，保持這個函式職責單純：「給定 local，跟 baseURL 同步到底」。
func PushTo(baseURL string, local []Record) (TransferResult, error) {
	destList, err := fetchList(baseURL)
	if err != nil {
		return TransferResult{}, fmt.Errorf("取得目的方清單: %w", err)
	}

	diff := DiffLite(toLiteRecords(local), destList)

	localByID := make(map[string]Record, len(local))
	for _, r := range local {
		localByID[r.ID] = r
	}

	// 交集部分（兩邊都有）：DiffLite 只看 ID+UpdatedAt，Record 型別本身
	// 沒有完整欄位內容可比對（見 handshake.go 對 Record 的說明：這是
	// 交握傳輸用的最小型別，不是 model.Attraction）。第二層完整欄位
	// 比對（CompareFields）留給接上真實 model.Attraction 資料的呼叫端
	// 處理；PushTo 目前只送「只在來源方」的部分，接上真實 endpoint 時
	// 再決定交集部分要不要、如何送進這個函式（例如改成接受
	// map[string]model.Attraction 並在這裡呼叫 CompareFields，把有
	// 欄位差異的交集記錄也併入 toSend）。
	var toSend []Record
	for _, id := range diff.OnlyInSource {
		toSend = append(toSend, localByID[id])
	}

	dest := &httpDestination{baseURL: baseURL}
	return Transfer(toSend, dest)

	// 筆數不符（result.Complete = false）時，PushTo 刻意不在內部自動
	// 重試——見 docs/ATTRACTION_SYNC_DESIGN.md「五、CLI 指令介面」的
	// -retry 說明：續傳是呼叫端（CLI）決定要不要、何時觸發的動作，不是
	// PushTo 自己悄悄做掉。而且不需要為此另外寫一套「只送剩下部分」的
	// 邏輯：呼叫端只要用同一份 local 再呼叫一次 PushTo，DiffLite 會
	// 重新對照目的方當下的最新狀態，已經成功寫入的記錄自然會落在
	// 「兩邊都有、內容相同」而不會被重送——ResumeFrom／Transfer 內部的
	// 「不猜斷點、查真實狀態」精神，在這裡是透過「reuse 同一個
	// PushTo」自然達成，不需要 PushTo 自己再包一層重試迴圈。
}

func toLiteRecords(records []Record) []LiteRecord {
	out := make([]LiteRecord, len(records))
	for i, r := range records {
		out[i] = LiteRecord{ID: r.ID, UpdatedAt: r.UpdatedAt}
	}
	return out
}

func fetchList(baseURL string) ([]LiteRecord, error) {
	resp, err := http.Get(baseURL + "/list")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var list []LiteRecord
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, err
	}
	return list, nil
}

// httpDestination 實作 Destination 介面，把 WriteOne/LatestState 轉成
// 對 baseURL 的 HTTP 呼叫——push 情境下，目的方就是這樣一個遠端 HTTP
// 服務（見 docs/ATTRACTION_SYNC_DESIGN.md「三、架構」：本機永遠是發起
// 請求的一方）。
type httpDestination struct {
	baseURL string
}

func (d *httpDestination) WriteOne(rec Record) (WriteResult, error) {
	body, err := json.Marshal(rec)
	if err != nil {
		return WriteResult{}, err
	}
	resp, err := http.Post(d.baseURL+"/write", "application/json", bytes.NewReader(body))
	if err != nil {
		return WriteResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return WriteResult{}, fmt.Errorf("write %s: 目的方回應 %d", rec.ID, resp.StatusCode)
	}
	var result WriteResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return WriteResult{}, err
	}
	return result, nil
}

func (d *httpDestination) LatestState() (FreshnessProbe, error) {
	resp, err := http.Get(d.baseURL + "/freshness")
	if err != nil {
		return FreshnessProbe{}, err
	}
	defer resp.Body.Close()
	var probe FreshnessProbe
	if err := json.NewDecoder(resp.Body).Decode(&probe); err != nil {
		return FreshnessProbe{}, err
	}
	return probe, nil
}
