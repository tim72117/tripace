// Package llm 封裝「語意查詢回答」(由 want LLM 引擎實作)。
// 唯一的 Analyzer 實作是接 want 引擎的 WantPool;不再有規則式(非 LLM)分析器。
package llm

import (
	"strings"

	"github.com/channel/server/internal/model"
)

// Analyzer 是 LLM 能力的抽象。唯一實作為接 want 引擎的 WantPool。
type Analyzer interface {
	// Answer 對頻道的 entry(事件/條目)做語意查詢,回傳回答與引用來源。
	// 原話已移至各裝置端,後端查詢以 entry 為依據。
	Answer(question string, pool []model.Entry) model.SearchAnswer
}

// citeEntries 對 pool 做輕量關鍵字檢索,挑出與問題最相關的 entry ID(取 Top-3)。
// 供 want 的 Answer 在 LLM 自由文字回答之外,附上「引用來源」的 entry ID。
// 這不是分析器,只是輔助 LLM 回答標註來源的檢索 helper。
func citeEntries(question string, pool []model.Entry) []string {
	terms := tokenize(question)
	type scored struct {
		id    string
		score int
	}
	var ranked []scored
	for _, e := range pool {
		hay := strings.ToLower(e.Item + " " + strings.Join(e.Tags, " "))
		if e.Category != nil {
			hay += " " + strings.ToLower(*e.Category)
		}
		if e.Summary != nil {
			hay += " " + strings.ToLower(*e.Summary)
		}
		score := 0
		for _, t := range terms {
			if strings.Contains(hay, t) {
				score++
			}
		}
		if score > 0 {
			ranked = append(ranked, scored{e.ID, score})
		}
	}
	// 依分數由高到低取 Top-3。
	for i := 0; i < len(ranked); i++ {
		for j := i + 1; j < len(ranked); j++ {
			if ranked[j].score > ranked[i].score {
				ranked[i], ranked[j] = ranked[j], ranked[i]
			}
		}
	}
	if len(ranked) > 3 {
		ranked = ranked[:3]
	}
	ids := make([]string, 0, len(ranked))
	for _, r := range ranked {
		ids = append(ids, r.id)
	}
	return ids
}

func tokenize(s string) []string {
	lower := strings.ToLower(s)
	topicKeywords := []string{"預算", "Q1", "Q2", "Q3", "Q4", "機票", "規格", "登入", "上線", "設計", "提案", "行程"}
	var terms []string
	for _, kw := range append([]string{"會議", "排程", "任務", "問題", "bug", "登入", "上線", "設計", "提案", "行程"}, topicKeywords...) {
		k := strings.ToLower(kw)
		if strings.Contains(lower, k) && !contains(terms, k) {
			terms = append(terms, k)
		}
	}
	for _, frag := range strings.FieldsFunc(lower, func(r rune) bool {
		return strings.ContainsRune(" ,.!?。，、！？", r)
	}) {
		if len([]rune(frag)) >= 2 && !contains(terms, frag) {
			terms = append(terms, frag)
		}
	}
	return terms
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
