package wanttools

// wanttypes.go——原本從 github.com/tim72117/want/types 引用的型別/函式,
// 改成本地定義。這個套件(internal/wanttools)本身沒有被任何 binary
// import(見 go list -deps 對 cmd/server、cmd/adminserver、cmd/cli 的
// 檢查結果都是空的),純粹是保留下來的舊 want 對話系統工具實作;但只要
// 它還 import 私有的 github.com/tim72117/want 模組,go.mod 就得列著這個
// 依賴,go mod download 這一步(不管實際 build target 用不用得到)就得先
// 能抓到它,連帶讓 Dockerfile 需要 GH_PAT——複製這裡用到的型別/函式簽章
// (值來源:go env GOMODCACHE 下 github.com/tim72117/want@v0.0.2/types 的
// action.go/arguments.go/experience.go/output.go/registry.go/types.go),
// 拿掉這個依賴,讓套件在不需要私有模組的情況下也能編譯。

// ---- action.go ----

// ToolDeclaration 用於向 AI 模型宣告工具的元數據。
type ToolDeclaration struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
	Type        string                 `json:"type"` // "sync" or "async"
}

// ---- arguments.go ----

// ToolArguments 是通用的工具參數容器,封裝 map[string]interface{} 並提供
// 一組安全的 Getter 方法,避免在工具實作中出現大量的類型斷言。
type ToolArguments map[string]interface{}

func (a ToolArguments) GetString(key string) string {
	if val, ok := a[key].(string); ok {
		return val
	}
	return ""
}

func (a ToolArguments) GetInt(key string) int {
	if val, ok := a[key].(float64); ok {
		return int(val)
	}
	if val, ok := a[key].(int); ok {
		return val
	}
	return 0
}

func (a ToolArguments) GetBool(key string) bool {
	if val, ok := a[key].(bool); ok {
		return val
	}
	return false
}

func (a ToolArguments) GetStringArray(key string) []string {
	val, ok := a[key].([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, 0, len(val))
	for _, item := range val {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}

// ---- experience.go(僅複製本套件實際用得到的部分) ----

// ImageSource 代表圖片 block 的來源。
type ImageSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

// ResultContentBlock 代表 tool result 內容陣列中的單一 block(text 或 image)。
type ResultContentBlock struct {
	Type   string       `json:"type"` // "text" | "image"
	Text   string       `json:"text"`
	Source *ImageSource `json:"source,omitempty"`
}

// ToolUse 代表一次工具呼叫的請求資料——本套件只有 fakeToolCtx(測試用
// no-op 假物件)的方法簽章用得到這個型別,實際欄位未被存取。
type ToolUse struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
	Input ToolArguments `json:"input"`
	Text  string        `json:"text,omitempty"`
}

// Experience 代表對話中的一條經歷——同 ToolUse,只有 ToolContext 介面的
// 方法簽章與 fakeToolCtx 用得到,實際欄位未被存取。
type Experience struct {
	Role    string `json:"role"`
	AgentID string `json:"agentId,omitempty"`
}

// AppState 定義全局狀態結構——同上,只有 ToolContext 介面簽章用得到。
type AppState struct {
	Version int `json:"version"`
}

// ---- output.go ----

// TextBlock 建立一個純文字的 ResultContentBlock。
func TextBlock(text string) ResultContentBlock {
	return ResultContentBlock{Type: "text", Text: text}
}

// ToolInterface 定義了物件化工具的核心介面。
type ToolInterface interface {
	Call(args ToolArguments, ctx ToolContext) ([]ResultContentBlock, error)
	ValidateInput(args ToolArguments, ctx ToolContext) error
	RenderToolUse(args ToolArguments) string
	RenderToolUseError(err error) string
	RenderToolResult(data map[string]interface{}) string
}

// BaseToolConfig 封裝了工具共有的基礎設定參數,可用於嵌入各工具結構體中。
type BaseToolConfig struct {
	RequiresAuthorization bool
	Lazy                  bool
}

func (c BaseToolConfig) IsLazy() bool {
	return c.Lazy
}

// ValidateInput 預設實作:不做任何驗證。
func (c *BaseToolConfig) ValidateInput(args ToolArguments, ctx ToolContext) error { return nil }

// ---- types.go ----

// ToolContext 定義了工具執行時的內容環境。
type ToolContext interface {
	AddMessage(role string, message Experience)
	CommitToolResult(fc *ToolUse, experiences ...Experience)
	GetAgentID() string
	GetWorkingDirectory() string
	SetWorkingDirectory(path string)
	GetAppState() AppState
	SetAppState(func(AppState) AppState)
	GetLastSnapshotFile() string
	SetLastSnapshotFile(string)
	GetSessionEnvs() map[string]string
	SetSessionEnvs(map[string]string)
	GetReadFileState() interface{}
	GetStagedChanges() interface{}
	GetExposedTools() []string
	SetExposedTools([]string)
	EmitEvent(event interface{})
	EmitToolResult(result map[string]interface{})
	EmitError(err error)
	RequestInteraction(payload map[string]interface{}) (interface{}, error)
}

// ---- registry.go ----

// ToolFactory 定義了建立工具實例的函式型別。
type ToolFactory func() ToolInterface

// Registry 儲存所有向系統註冊的工具資訊。
type Registry struct {
	Declarations []ToolDeclaration
	Factories    map[string]ToolFactory
}

// GlobalRegistry 全域單例,供各工具檔案於 init() 時調用。
var GlobalRegistry = &Registry{
	Declarations: make([]ToolDeclaration, 0),
	Factories:    make(map[string]ToolFactory),
}

// RegisterTool 是工具註冊的統一入口。
func RegisterTool(decl ToolDeclaration, factory ToolFactory) {
	GlobalRegistry.Declarations = append(GlobalRegistry.Declarations, decl)
	GlobalRegistry.Factories[decl.Name] = factory
}
