// Package llm 封裝「訊息分類/標注」與「語意查詢回答」。
// 原型階段用關鍵字規則模擬;之後把 Analyzer 換成呼叫真實 LLM 服務的實作即可,handler 不需更動。
package llm

import (
	"strings"

	"github.com/channel/server/internal/model"
)

// Annotation 是 LLM 對單則訊息的整理結果。
type Annotation struct {
	Category *string
	Tags     []string
	Summary  *string
}

// Analyzer 是 LLM 能力的抽象。原型用 RuleBasedAnalyzer;之後可實作 HTTPAnalyzer 呼叫真實服務。
type Analyzer interface {
	// Classify 整理、分類、標注一則訊息文字。
	Classify(text string) Annotation
	// Answer 對頻道訊息做語意查詢,回傳回答與引用來源。
	Answer(question string, pool []model.Message) model.SearchAnswer
}

// RuleBasedAnalyzer 用關鍵字規則模擬 LLM,與 iOS App 的 Mock 行為一致。
type RuleBasedAnalyzer struct{}

func NewRuleBased() *RuleBasedAnalyzer { return &RuleBasedAnalyzer{} }

var classifyRules = []struct {
	keywords []string
	category string
	tag      string
}{
	{[]string{"開會", "會議", "meeting", "敲定", "討論"}, "會議", "排程"},
	{[]string{"待辦", "todo", "記得", "準備", "負責", "完成"}, "任務", "待辦"},
	{[]string{"bug", "錯誤", "壞掉", "修好", "問題"}, "問題", "bug"},
	{[]string{"公告", "通知", "請注意", "重要"}, "公告", "公告"},
}

var topicKeywords = []string{"預算", "Q1", "Q2", "Q3", "Q4", "機票", "規格", "登入", "上線", "設計", "提案", "行程"}

func (RuleBasedAnalyzer) Classify(text string) Annotation {
	lower := strings.ToLower(text)
	var category string
	var tags []string

	for _, r := range classifyRules {
		for _, kw := range r.keywords {
			if strings.Contains(lower, strings.ToLower(kw)) {
				category = r.category
				tags = append(tags, r.tag)
				break
			}
		}
		if category != "" {
			break
		}
	}
	if category == "" && (strings.Contains(text, "?") || strings.Contains(text, "？") || strings.Contains(text, "嗎")) {
		category = "問題"
	}
	if category == "" {
		category = "閒聊"
	}

	for _, kw := range topicKeywords {
		if strings.Contains(lower, strings.ToLower(kw)) && !contains(tags, kw) {
			tags = append(tags, kw)
		}
	}

	a := Annotation{Category: &category, Tags: tags}
	if len([]rune(text)) > 30 {
		s := string([]rune(text)[:28]) + "…"
		a.Summary = &s
	}
	return a
}

func (RuleBasedAnalyzer) Answer(question string, pool []model.Message) model.SearchAnswer {
	terms := tokenize(question)

	type scored struct {
		msg   model.Message
		score int
	}
	var ranked []scored
	for _, m := range pool {
		// 標注(tags/category)已移至 entry,message 只剩原文;搜尋以原文為準。
		hay := strings.ToLower(m.Text)
		score := 0
		for _, t := range terms {
			if strings.Contains(hay, t) {
				score++
			}
		}
		if score > 0 {
			ranked = append(ranked, scored{m, score})
		}
	}
	// 取 Top-3
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

	if len(ranked) == 0 {
		conf := 0.2
		return model.SearchAnswer{
			Answer:          "我在這個頻道找不到與「" + question + "」相關的訊息。",
			CitedMessageIDs: []string{},
			Confidence:      &conf,
		}
	}

	var sb strings.Builder
	sb.WriteString("根據頻道中相關的訊息,我整理如下:\n\n")
	ids := make([]string, 0, len(ranked))
	for _, r := range ranked {
		sb.WriteString("・" + r.msg.AuthorName + "：" + r.msg.Text + "\n")
		ids = append(ids, r.msg.ID)
	}
	conf := 0.5 + float64(len(ranked))*0.15
	if conf > 0.95 {
		conf = 0.95
	}
	return model.SearchAnswer{Answer: sb.String(), CitedMessageIDs: ids, Confidence: &conf}
}

func tokenize(s string) []string {
	lower := strings.ToLower(s)
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
