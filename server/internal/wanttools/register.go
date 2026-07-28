package wanttools

import "github.com/tim72117/tripace/internal/toolregistry"

// RegisterBuiltinTools 把本套件的靜態工具(record_entry 以外——emit/sink 是
// 記錄用的內部機制,ask_user/ask_choice/entry_query/geocode/recommend_nearby/
// task_plan 才是真正掛給 LLM 的工具)登記進 reg,取代原本各檔案 init() 副作用
// 註冊的機制(want v0.2.0 起,全域 types.RegisterTool 已移除)。
func RegisterBuiltinTools(reg *toolregistry.Registry) {
	reg.AddRegistrations(
		AskUserToolRegistration,
		AskChoiceToolRegistration,
		QueryEntriesToolRegistration,
		GeocodeToolRegistration,
		RecommendNearbyToolRegistration,
		TaskPlanToolRegistration,
	)
}
