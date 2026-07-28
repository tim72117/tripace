package trip

import "github.com/tim72117/tripace/internal/toolregistry"

// RegisterBuiltinTools 把本套件的靜態工具登記進 reg,取代原本各檔案 init()
// 副作用註冊的機制(want v0.2.0 起,全域 types.RegisterTool 已移除)。
//
// 這 4 個工具目前不在任何角色的 Tools 白名單裡(trip 功能尚未啟用,見
// assistant_agent.go 的 tripThought 註解),但為了與改動前行為 1:1 一致
// (改動前它們同樣已註冊進全域 registry,只是沒被任何角色曝光),仍一併登記。
func RegisterBuiltinTools(reg *toolregistry.Registry) {
	reg.AddRegistrations(
		AddToTripToolRegistration,
		TripEntriesToolRegistration,
		ListTripsToolRegistration,
		DeleteTripToolRegistration,
	)
}
