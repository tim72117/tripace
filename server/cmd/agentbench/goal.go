// Expected 是 session 建立時可選的「預期目標」設定:判斷這次 run 有沒有
// 達成「LLM 有沒有正確呼叫某個 tool call」這個測試目的。
//
// 完全可選:Session.expected 為 nil 時,goalMet 相關邏輯整段跳過,
// RunResult.GoalMet 回 nil、不觸發任何追問——維持「不設定 expected」時
// 與最初設計(單純回傳完整 tool call 清單讓外部軟體自己判斷)完全一致的行為。
package main

import "fmt"

// Expected 描述這次 session 期望 LLM 呼叫的工具與(可選的)參數。
type Expected struct {
	Tool   string                 `json:"tool"`
	Params map[string]interface{} `json:"params,omitempty"`
}

// paramsMatch 檢查 actual 裡,expectedParams 列出的每個 key 值是否相符。
// 只比對 expectedParams 有列出的欄位;expectedParams 為 nil/空 表示不比對參數,
// 一律視為相符(只要求「有呼叫到」)。actual 裡多出的欄位不影響判斷。
//
// 比對方式:用 fmt.Sprintf("%v", ...) 正規化後比字串相等,這樣可以讓
// JSON 解碼後常見的型別落差(例如整數在 JSON 數字上會被解成 float64,
// 但 expected.Params 手動填 int 字面值時 Go 端型別可能是 int)不會誤判為不相符,
// 同時維持「簡單的欄位比對即可」的需求(不做深度結構比對、不管型別,只看
// 呈現出來的值是否一致)。
func paramsMatch(actual map[string]interface{}, expectedParams map[string]interface{}) bool {
	for key, want := range expectedParams {
		got, ok := actual[key]
		if !ok {
			return false
		}
		if fmt.Sprintf("%v", got) != fmt.Sprintf("%v", want) {
			return false
		}
	}
	return true
}

// goalOutcome 是一次 goalMet 判斷的完整結果,供 followUpQuestion 決定要問
// 「完全沒呼叫」還是「呼叫了但參數不對」。
type goalOutcome struct {
	Met bool
	// CalledAtAll 表示 calls 裡有沒有出現過 expected.Tool 這個名稱的呼叫
	// (不論參數對不對)。Met 為 false 時,CalledAtAll 用來分辨兩種追問情境。
	CalledAtAll bool
}

// evaluateGoal 判斷 calls 有沒有達成 expected 描述的目標。
// expected 為 nil 時直接回 nil(呼叫端應先檢查 session 是否設定 expected)。
func evaluateGoal(calls []ToolCall, expected *Expected) *goalOutcome {
	if expected == nil {
		return nil
	}
	for i := range calls {
		if calls[i].Name != expected.Tool {
			continue
		}
		if paramsMatch(calls[i].Input, expected.Params) {
			return &goalOutcome{Met: true, CalledAtAll: true}
		}
	}
	// 走到這裡:沒有任何一筆呼叫「同時符合名稱與參數」。
	// 再掃一次判斷「至少呼叫過同名工具(只是參數不符)」vs「完全沒呼叫過」。
	calledAtAll := false
	for i := range calls {
		if calls[i].Name == expected.Tool {
			calledAtAll = true
			break
		}
	}
	return &goalOutcome{Met: false, CalledAtAll: calledAtAll}
}

// followUpQuestion 依 outcome 產生追問語句。要求:不含道歉或解釋性鋪陳,
// 直接、明確問思考邏輯本身。兩種情境:
//   - 完全沒呼叫該工具 → 問「為什麼沒有呼叫」。
//   - 呼叫了但參數不符 → 問「為什麼用了這樣的參數」。
func followUpQuestion(expected *Expected, outcome *goalOutcome) string {
	if outcome.CalledAtAll {
		return fmt.Sprintf("你剛剛呼叫 %s 時為什麼用了這樣的參數？給我你的思考邏輯。", expected.Tool)
	}
	return fmt.Sprintf("你剛剛為什麼沒有呼叫 %s 這個工具？給我你的思考邏輯。", expected.Tool)
}
