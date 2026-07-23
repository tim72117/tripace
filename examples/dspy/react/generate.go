package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
)

// generateExamplesForPath 用 LLM 根據一條 flowPath 的行為規格(該不該呼叫
// 工具、預期關鍵字)生成 n 句符合這個規格的中文例句——這是「圖形只定義
// 行為骨架、例句由 LLM 產生」這個設計的實作:flow.mmd 完全不含任何具體
// 中文句子,data.go 也不再手寫例句,兩者都交給這裡動態生成。
//
// 用最單純的 core.GetDefaultLLM().Generate(ctx, prompt) 直接呼叫,不透過
// modules.Predict/signature 那一套——生成訓練資料本身是準備階段的工具性
// 操作,不是要被 optimizer 訓練的任務,不需要走那套機制。
//
// 回傳的例句沒有驗證品質(不會反過來跑一次 ReAct 確認 LLM 生成的句子
// 真的符合預期路徑)——這是刻意的簡化,真正嚴謹的作法應該是生成後
// 再用 flowPath 的規格跑一次驗證、過濾掉不合格的句子,但這樣會讓這支
// 範例牽扯進「驗證生成資料」這個更大的題目,不在這次的示範範圍內。
func generateExamplesForPath(ctx context.Context, path flowPath, n int) ([]string, error) {
	llm := core.GetDefaultLLM()
	if llm == nil {
		return nil, fmt.Errorf("尚未設定 LLM(core.SetDefaultLLM 尚未被呼叫)")
	}

	var behaviorDesc string
	if len(path.tools) > 0 {
		behaviorDesc = fmt.Sprintf("這句話必須包含明確可定位的單一地點(如飯店、景點、餐廳名稱),"+
			"讓 agent 判斷該呼叫 %s 工具查詢座標", strings.Join(path.tools, "、"))
	} else {
		behaviorDesc = "這句話完全不能包含任何具體地點資訊(不能有飯店/景點/餐廳/城市名稱),只是單純的待辦/會議/提醒"
	}

	prompt := fmt.Sprintf(
		"請生成 %d 句繁體中文的旅程記事句子,模擬使用者隨手記錄的一句話。要求:%s。"+
			"每句一行,不要加編號、不要加任何說明文字,直接輸出 %d 行句子。",
		n, behaviorDesc, n,
	)

	resp, err := llm.Generate(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("生成路徑 %q 的例句失敗: %w", path.id, err)
	}

	var lines []string
	for _, line := range strings.Split(resp.Content, "\n") {
		line = strings.TrimSpace(line)
		// 過濾掉 LLM 可能夾帶的編號前綴(如 "1. "、"- ")與空行,盡量寬容
		// 處理格式,不強求 LLM 完全照 prompt 的格式要求輸出。
		line = strings.TrimLeft(line, "0123456789.、- ")
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("路徑 %q 生成結果為空(LLM 回應: %q)", path.id, resp.Content)
	}
	return lines, nil
}

// generateDataset 對每條 flowPath 各生成 perPath 句,展開成完整的
// []reactExample——取代原本手寫在 data.go 裡的 reactTrainSet/reactEvalSet。
func generateDataset(ctx context.Context, paths []flowPath, perPath int) ([]reactExample, error) {
	var examples []reactExample
	for _, path := range paths {
		texts, err := generateExamplesForPath(ctx, path, perPath)
		if err != nil {
			return nil, err
		}
		for _, text := range texts {
			examples = append(examples, reactExample{Text: text, PathID: path.id})
		}
	}
	return examples, nil
}
