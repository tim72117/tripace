package llm

// Gemma 文字格式 tool-call 解析器(獨立、預設不啟用)。
//
// 背景:google/gemma-* 在 vLLM 上,若伺服器未啟用 --tool-call-parser gemma4
// (+ --enable-auto-tool-choice),tool-call 不會進標準 OpenAI 的 delta.tool_calls,
// 而是把整段「文字格式」塞進 delta.content,例如:
//
//   <|tool_call>call:present_entries{allDay:true,end:<|"|><|"|>,item:<|"|>生日<|"|>,start:<|"|>2026-06-25<|"|>}<tool_call|>
//
// 格式規律(由實際輸出與 Gemma chat template 歸納):
//   - 包裹:  <|tool_call> ... <tool_call|>
//   - 工具名: call:NAME 緊接在開標記後,NAME 後是 '{'
//   - 參數體: { key:value, key:value, ... },key 無引號、逗號分隔
//   - 字串值: 用特殊 token <|"|> 當引號包住(空字串為 <|"|><|"|>)
//   - 非字串: true / false / 數字 直接寫(無 <|"|> 包裹)
//
// 正解是在 vLLM 伺服器端加上述 flag,讓模型回標準 tool_calls;本檔是客戶端 fallback,
// 在伺服器未正確設定時仍能解析。目前【不接進】vllm.go 的串流流程(見 ParseGemmaToolCalls
// 的呼叫端為空),保留為獨立、可單測的工具,待需要時再於 processStreamResponse 接線。

import (
	"strconv"
	"strings"

	types "want/types"
)

const (
	gemmaToolOpen   = "<|tool_call>"
	gemmaToolClose  = "<tool_call|>"
	gemmaQuoteToken = `<|"|>` // Gemma 用來表示字串引號的特殊 token
	gemmaCallPrefix = "call:"
)

// ContainsGemmaToolCall 回報文字中是否含 Gemma 文字格式的 tool-call 開標記。
// 供呼叫端快速判斷是否需要走 fallback 解析(避免對一般文字做多餘處理)。
func ContainsGemmaToolCall(text string) bool {
	return strings.Contains(text, gemmaToolOpen)
}

// ParseGemmaToolCalls 從一段文字中抽出所有 Gemma 文字格式的 tool-call,
// 解析成標準的 tool_use Content;同時回傳「剝除 tool-call 後剩餘的純文字」。
//
// 容錯:
//   - 找不到開標記 → 回 (nil, 原文)。
//   - 有開標記但缺閉標記(串流截斷)→ 取到文字結尾為止,盡力解析。
//   - 單一 tool-call 解析失敗 → 略過該段(不中止其餘),不產生半成品 Content。
//
// idGen 用來產生 tool_use 的 ID(呼叫端可注入,便於測試與去重);傳 nil 時用內建遞增。
func ParseGemmaToolCalls(text string, idGen func(index int) string) (calls []types.Content, remaining string) {
	if !ContainsGemmaToolCall(text) {
		return nil, text
	}
	if idGen == nil {
		idGen = func(i int) string { return "gemma_call_" + strconv.Itoa(i) }
	}

	var rest strings.Builder
	cursor := 0
	index := 0
	for {
		open := strings.Index(text[cursor:], gemmaToolOpen)
		if open == -1 {
			rest.WriteString(text[cursor:])
			break
		}
		open += cursor
		// 開標記前的文字保留為一般內容。
		rest.WriteString(text[cursor:open])

		bodyStart := open + len(gemmaToolOpen)
		// 找閉標記;沒有就吃到結尾(截斷容錯)。
		close := strings.Index(text[bodyStart:], gemmaToolClose)
		var body string
		if close == -1 {
			body = text[bodyStart:]
			cursor = len(text)
		} else {
			body = text[bodyStart : bodyStart+close]
			cursor = bodyStart + close + len(gemmaToolClose)
		}

		if c, ok := parseOneGemmaCall(body, idGen(index)); ok {
			calls = append(calls, c)
			index++
		}
		if close == -1 {
			break
		}
	}
	return calls, rest.String()
}

// parseOneGemmaCall 解析單段 body(已去除外層 <|tool_call> / <tool_call|>):
//
//	call:NAME{ key:value, ... }
func parseOneGemmaCall(body, id string) (types.Content, bool) {
	body = strings.TrimSpace(body)
	if !strings.HasPrefix(body, gemmaCallPrefix) {
		return types.Content{}, false
	}
	body = body[len(gemmaCallPrefix):]

	brace := strings.IndexByte(body, '{')
	if brace == -1 {
		return types.Content{}, false
	}
	name := strings.TrimSpace(body[:brace])
	if name == "" {
		return types.Content{}, false
	}

	// 參數體:從 '{' 到對應 '}';沒有閉合就吃到結尾(截斷容錯)。
	inner := body[brace+1:]
	if end := strings.LastIndexByte(inner, '}'); end != -1 {
		inner = inner[:end]
	}

	args := parseGemmaArgs(inner)
	return types.NewToolUseContent(id, name, args), true
}

// parseGemmaArgs 逐字掃描 key:value 參數體,容忍字串值內含逗號/冒號/中文。
// 字串值用 <|"|> 成對包住;非字串值(true/false/數字)直接出現。
func parseGemmaArgs(inner string) types.ToolArguments {
	args := types.ToolArguments{}
	i := 0
	n := len(inner)
	for i < n {
		// 跳過分隔符與空白。
		for i < n && (inner[i] == ',' || inner[i] == ' ' || inner[i] == '\t' || inner[i] == '\n') {
			i++
		}
		if i >= n {
			break
		}
		// 讀 key:到下一個 ':'。
		colon := strings.IndexByte(inner[i:], ':')
		if colon == -1 {
			break
		}
		key := strings.TrimSpace(inner[i : i+colon])
		i += colon + 1
		// 讀 value。
		if i < n && strings.HasPrefix(inner[i:], gemmaQuoteToken) {
			// 字串:找成對的下一個 <|"|>。
			i += len(gemmaQuoteToken)
			endQuote := strings.Index(inner[i:], gemmaQuoteToken)
			var val string
			if endQuote == -1 {
				val = inner[i:] // 截斷容錯:吃到結尾
				i = n
			} else {
				val = inner[i : i+endQuote]
				i += endQuote + len(gemmaQuoteToken)
			}
			if key != "" {
				args[key] = val
			}
		} else {
			// 非字串:讀到下一個逗號為止。
			comma := strings.IndexByte(inner[i:], ',')
			var raw string
			if comma == -1 {
				raw = inner[i:]
				i = n
			} else {
				raw = inner[i : i+comma]
				i += comma
			}
			if key != "" {
				args[key] = coerceGemmaScalar(strings.TrimSpace(raw))
			}
		}
	}
	return args
}

// coerceGemmaScalar 將非字串字面量轉成與 json.Unmarshal 一致的 Go 型別:
// true/false→bool、數字→float64、其餘→原字串(保底)。
func coerceGemmaScalar(s string) interface{} {
	switch s {
	case "true":
		return true
	case "false":
		return false
	case "null", "":
		return nil
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	return s
}
