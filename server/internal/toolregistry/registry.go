// Package toolregistry 是 tripace 自己的 want 工具登記處,鏡射 want v0.2.0
// 自身的 internal/toolregistry 設計(該套件受 Go internal/ 規則保護,tripace
// 無法直接 import)。
//
// want v0.2.0 起,每個 *wantorch.Orchestrator 各自持有一份注入的
// types.ToolProvider(不再有 process 級的全域工具登記表),故 tripace 需要
// 自己組一份能同時餵給多個 orchestrator(assistant 與 clienttools POC)的
// Registry/Toolbox。
package toolregistry

import "github.com/tim72117/want/types"

// Registry 累積所有已登記的工具宣告與建立方式,供 Toolbox 讀取組裝成
// types.ToolProvider。刻意不加鎖:tripace 的用法是「啟動期單一 goroutine
// 依序寫入,HTTP server 開始接受請求後只讀不寫」,與 want 自己
// internal/toolregistry.Registry 的假設一致。
type Registry struct {
	Declarations []types.ToolDeclaration
	Factories    map[string]types.ToolFactory
}

// NewRegistry 建立一個空的 Registry。
func NewRegistry() *Registry {
	return &Registry{
		Declarations: make([]types.ToolDeclaration, 0),
		Factories:    make(map[string]types.ToolFactory),
	}
}

// AddDeclaration 登記一則工具宣告。
func (r *Registry) AddDeclaration(decl types.ToolDeclaration) {
	r.Declarations = append(r.Declarations, decl)
}

// AddFactory 登記工具的建立方式。
func (r *Registry) AddFactory(name string, factory types.ToolFactory) {
	r.Factories[name] = factory
}

// AddRegistrations 依序登記 regs 裡每個工具的宣告與建立方式,供靜態工具檔
// (各自暴露一個 var Tool types.ToolRegistration)批次組裝時使用。
func (r *Registry) AddRegistrations(regs ...types.ToolRegistration) {
	for _, reg := range regs {
		decl := reg.Declaration()
		r.AddDeclaration(decl)
		r.AddFactory(decl.Name, reg.New)
	}
}

// Toolbox 包住一份 Registry,實作 types.ToolProvider,可直接注入
// orchestrator.Setup/SetupWith 的 toolbox 參數,或指派給
// Orchestrator.Toolbox 欄位。
//
// Declarations()/GetFactory() 每次呼叫都讀取 Registry 當下的內容(不快取):
// 這讓「先把 Toolbox 交給 orchestrator.SetupWith,之後才繼續往同一個
// Registry 追加工具(如 main.go 稍後才註冊 clienttools 的動態工具)」是安全的
// ——只要在任何一次實際推論發生前完成全部登記即可,不需要嚴格要求
// 「登記完才能建立 orchestrator」的順序。
type Toolbox struct {
	Registry *Registry
}

// NewToolbox 包裝 reg 成一個 types.ToolProvider。
func NewToolbox(reg *Registry) *Toolbox {
	return &Toolbox{Registry: reg}
}

// Declarations 回傳目前已登記的全部工具宣告。
func (t *Toolbox) Declarations() []types.ToolDeclaration {
	return t.Registry.Declarations
}

// GetFactory 依名稱取得建立工具實例的 factory。
func (t *Toolbox) GetFactory(name string) (types.ToolFactory, bool) {
	f, ok := t.Registry.Factories[name]
	return f, ok
}
