// Expected 是 session 建立時可選的「預期目標」設定:判斷這次 run 有沒有
// 達成「LLM 有沒有正確呼叫某個 tool call」這個測試目的。
//
// 完全可選:Session.expected 為 nil 時,goalMet 相關邏輯整段跳過,
// RunResult.GoalMet 回 nil、不觸發任何追問——維持「不設定 expected」時
// 與最初設計(單純回傳完整 tool call 清單讓外部軟體自己判斷)完全一致的行為。
//
// 參數比對已降級(want v0.2.0 起):Expected.Params 欄位仍保留在 API 裡
// (呼叫端可以繼續帶,不會噴錯),但 evaluateGoal 不再拿它跟實際呼叫的參數
// 比對——want v0.2.0 移除了工具呼叫結構化參數的公開存取(見 capture.go
// 頂部的詳細說明:ToolCall.Input 這次改動後恆為 nil,上游沒有任何公開 API
// 能取得這份資料),paramsMatch 已無資料可比,故 evaluateGoal 目前只驗證
// 「有沒有呼叫到 expected.Tool 這個名稱」,不再驗證參數值是否相符。
// 若未來 want 補回公開 API,這裡應優先復原完整比對。
package main

import "fmt"

// Expected 描述這次 session 期望 LLM 呼叫的工具與(可選的)參數。
// Params 目前不參與比對(見上方套件註解),保留欄位是為了不改動既有
// request body 格式——呼叫端沿用舊的呼叫方式不會出錯,只是這個欄位暫時
// 沒有效果。
type Expected struct {
	Tool   string                 `json:"tool"`
	Params map[string]interface{} `json:"params,omitempty"`
}

// goalOutcome 是一次 goalMet 判斷的完整結果。
//
// 降級前(參數比對仍在時)Met 有兩種 false 情境(完全沒呼叫 / 呼叫了但參數
// 不符),由已移除的 CalledAtAll 欄位分辨,followUpQuestion 依此問不同的
// 追問語句。降級後(見上方套件註解)只剩「有沒有呼叫到」一種判斷,兩者恆
// 相等,故 CalledAtAll 已移除,followUpQuestion 也收斂成單一問法。
type goalOutcome struct {
	Met bool
}

// evaluateGoal 判斷 calls 有沒有呼叫過 expected.Tool 這個名稱。
// expected 為 nil 時直接回 nil(呼叫端應先檢查 session 是否設定 expected)。
//
// 只比對工具名稱,不比對 expected.Params(見上方套件註解)。
func evaluateGoal(calls []ToolCall, expected *Expected) *goalOutcome {
	if expected == nil {
		return nil
	}
	for i := range calls {
		if calls[i].Name == expected.Tool {
			return &goalOutcome{Met: true}
		}
	}
	return &goalOutcome{Met: false}
}

// followUpQuestion 產生追問語句。要求:不含道歉或解釋性鋪陳,直接、明確問
// 思考邏輯本身。
func followUpQuestion(expected *Expected) string {
	return fmt.Sprintf("你剛剛為什麼沒有呼叫 %s 這個工具？給我你的思考邏輯。", expected.Tool)
}
