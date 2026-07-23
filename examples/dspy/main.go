// Command dspy 是 dspy-go 的最小可執行範例:用少量標註範例(train set)
// 透過 MIPRO optimizer 自動優化一個分類任務的 prompt——MIPRO 不只是像
// BootstrapFewShot 那樣挑選 few-shot demonstrations,還會連 instruction
// 文字本身都一併搜尋、改寫,是真正會產生新 prompt 內容的 optimizer(見
// pkg/optimizers/mipro.go)。
//
// 任務內容取自 tripace 專案 server/internal/llm/assistant_agent.go「地點
// 處理」那段的判斷邏輯(見該檔案 addThought 常數):
//
//   - 事項若有明確可定位的地點,可先用 entry_query 查到的鄰近條目推斷
//     整體地區,再呼叫 geocode 確認地點,並在回覆中呈現給使用者參考。
//   - 若地點是一個區域(而非單一地點),用 ask_user 詢問需不需要推薦
//     附近景點,使用者同意才呼叫 recommend_nearby。
//
// 這裡把「這句話該怎麼處理地點」抽成一個獨立的三分類任務,示範
// dspy-go 的 optimizer 用法——完全不依賴 tripace 專案任何程式碼,是
// 獨立的 Go module(見同目錄 go.mod),純技術驗證。
//
// 訓練/評估資料(trainExample、trainSet、evalSet)搬到同目錄的 data.go,
// 讓這支檔案專注在程式邏輯——換一批訓練資料或增補邊界案例時,只需要
// 動 data.go,不用在一堆程式邏輯裡找資料定義在哪。
//
// 用法見同目錄 README.md。
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/llms"
	"github.com/XiaoConstantine/dspy-go/pkg/logging"
	"github.com/XiaoConstantine/dspy-go/pkg/modules"
	"github.com/XiaoConstantine/dspy-go/pkg/optimizers"
	"github.com/joho/godotenv"
)

func main() {
	// 自動載入同目錄的 .env(godotenv,同 tripace 主專案 server/cmd/server
	// 的慣例)。找不到檔案不算錯誤(err 忽略),但其他錯誤(如格式壞掉)
	// 印出來——同主專案 main.go 的處理方式。
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	// 變數命名對齊 tripace 主專案(server/.env.example 的 AI_MODEL/
	// VLLM_BASE_URL,見 server/internal/llm/want_analyzer.go 讀的環境
	// 變數),同一份 .env 檔案格式兩邊一致。
	modelID := os.Getenv("AI_MODEL")
	if modelID == "" {
		modelID = string(core.ModelGoogleGeminiFlash) // 預設值,方便沒設環境變數時仍知道要填什麼格式
	}
	vllmBaseURL := os.Getenv("VLLM_BASE_URL")

	logging.SetLogger(logging.NewLogger(logging.Config{
		Severity: logging.INFO,
		Outputs:  []logging.Output{logging.NewConsoleOutput(true, logging.WithColor(true))},
	}))

	ctx := core.WithExecutionState(context.Background())

	llms.EnsureFactory()

	// vllmBaseURL 有值時走 vLLM(或任何 OpenAI-compatible 的自架服務,
	// 如 tripace 主專案 server/internal/llm/want_analyzer.go 用的
	// AI_PROVIDER=vllm + VLLM_BASE_URL 那條路徑)——dspy-go 沒有專門的
	// vLLM provider,但 vLLM 的 OpenAI-compatible server 本來就是照
	// OpenAI 的 /v1/chat/completions 格式實作,用 llms.NewOpenAICompatible
	// (provider 標籤、model ID、baseURL)這個通用建構子就能接上,不需要
	// API key(自架服務通常不驗證,若你的部署有驗證,用 llms.WithAPIKey
	// option 補上,見 openai_providers.go 的 OpenAIOption)。
	//
	// 否則走一般的 core.ConfigureDefaultLLM(依 modelID 字串判斷
	// Gemini/Anthropic/OpenAI 等雲端 provider),需要 API key。
	if vllmBaseURL != "" {
		llm, err := llms.NewOpenAICompatible("vllm", core.ModelID(modelID), vllmBaseURL)
		if err != nil {
			log.Fatalf("設定 vLLM 失敗(VLLM_BASE_URL=%q, model=%q): %v", vllmBaseURL, modelID, err)
		}
		core.SetDefaultLLM(llm)
	} else {
		apiKey := os.Getenv("DSPY_API_KEY")
		if apiKey == "" {
			log.Fatal("請設定 VLLM_BASE_URL(自架 vLLM)或 DSPY_API_KEY(雲端 provider,對應 AI_MODEL 這個 provider 的 API key)")
		}
		if err := core.ConfigureDefaultLLM(apiKey, core.ModelID(modelID)); err != nil {
			log.Fatalf("設定 LLM 失敗(model=%q): %v", modelID, err)
		}
	}

	// signature 定義這個任務的輸入/輸出契約:輸入欄位刻意命名為 prompt
	// (而非語意更貼切的 text)——dspy-go 的 MIPRO teacher demonstration
	// 生成邏輯(pkg/optimizers/mipro.go 的 GenerateDemonstration)寫死讀
	// input.Inputs["prompt"] 這個固定 key,用別的欄位名稱會在優化階段
	// 直接失敗(teacher generation failed, missing prompt),官方範例
	// examples/others/mipro/main.go 的 signature 同樣是用 prompt/
	// completion 這組命名,不是巧合。輸出欄位 action 則沒有這個限制。
	// WithInstruction 給的只是「起始」指令——MIPRO 會把這段文字當起點,
	// 搜尋、產生候選 instruction 並實際評估效果,最終可能整段被改寫成
	// 完全不同的文字(見下方優化後印出的 signature,拿它跟這裡的原始
	// 文字比對就能看出差異)。
	signature := core.NewSignature(
		[]core.InputField{{Field: core.NewField("prompt", core.WithDescription("使用者記錄的一句行程/事項"))}},
		[]core.OutputField{{Field: core.NewField("action", core.WithDescription(`地點處理分類,只能是 "geocode"、"ask_recommend"、"none" 三者之一`))}},
	).WithInstruction(
		"判斷這句話該怎麼處理地點:" +
			"若有明確可定位的單一地點(如飯店、景點、餐廳名稱),回傳 geocode;" +
			"若地點是一個區域而非單一地點(如城市、縣市名),回傳 ask_recommend——" +
			"即使句子很簡短、只有地名加上「我要去」「這次去」之類的意圖動詞、" +
			"完全沒有提到期程或天數(例如「我要去台中」),只要是縣市/區域名稱" +
			"就要回傳 ask_recommend,不要因為線索少就誤判成 none;" +
			"若完全沒有地點資訊,回傳 none。只回傳分類結果,不要多餘文字。",
	)

	predict := modules.NewPredict(signature)
	program := core.NewProgram(
		map[string]core.Module{"classifier": predict},
		func(ctx context.Context, inputs map[string]any) (map[string]any, error) {
			return predict.Process(ctx, inputs)
		},
	)

	dataset := newDataset(trainSet)

	// metric 決定 optimizer 怎麼判斷「這次預測有多好」——MIPRO 要求
	// float64 分數(而非 BootstrapFewShot 的 bool),這裡用最單純的
	// 精確比對:對了給 1.0、錯了給 0.0(去除多餘空白後比較字串)。
	metric := func(example, prediction map[string]any, _ context.Context) float64 {
		expected, _ := example["action"].(string)
		actual, _ := prediction["action"].(string)
		if strings.TrimSpace(strings.ToLower(actual)) == strings.TrimSpace(strings.ToLower(expected)) {
			return 1.0
		}
		return 0.0
	}

	// LightMode + 少量 trial/候選數:trainSet 只有 13 筆、跑的是自架的
	// 小型 vLLM 服務(google/gemma-4-12b-it),用官方範例(examples/others/
	// mipro/main.go)的 MediumMode 預設值(25 trials)對這個資料集規模
	// 太重、也會對 vLLM 服務打太多次請求——LightMode 預設只需 7 trials,
	// 這裡再把候選數/demo 數也調小,示範用最省成本的設定跑完整趟
	// instruction 優化流程。
	optimizer := optimizers.NewMIPRO(
		metric,
		optimizers.WithMode(optimizers.LightMode),
		optimizers.WithNumTrials(3),
		optimizers.WithNumCandidates(3),
		optimizers.WithMaxLabeledDemos(3),
		optimizers.WithNumModules(1),
	)

	fmt.Println("=== 優化前:直接跑 evalSet ===")
	runEval(ctx, program, evalSet)

	fmt.Println("\n=== 開始用 MIPRO 優化 prompt(會對 vLLM 送出多輪請求,需要一點時間)===")
	optimizedProgram, err := optimizer.Compile(ctx, program, dataset, nil)
	if err != nil {
		log.Fatalf("優化失敗: %v", err)
	}

	// 印出優化後 classifier 模組的 signature——MIPRO 跟 BootstrapFewShot
	// 不同,這裡真的可能看到跟一開始 WithInstruction 完全不同的文字,
	// 因為 MIPRO 有實際搜尋、改寫過 instruction 本身(見上方的說明)。
	fmt.Println("\n=== 優化後的模組(比對這段跟最初的 WithInstruction 是否不同) ===")
	for name, mod := range optimizedProgram.Modules {
		fmt.Printf("模組 %q 的 signature: %s\n", name, mod.GetSignature().Instruction)
	}

	fmt.Println("\n=== 優化後:再跑一次 evalSet ===")
	runEval(ctx, optimizedProgram, evalSet)
}

func runEval(ctx context.Context, program core.Program, examples []trainExample) {
	correct := 0
	for _, ex := range examples {
		result, err := program.Execute(ctx, map[string]any{"prompt": ex.text})
		if err != nil {
			fmt.Printf("  [錯誤] %q: %v\n", ex.text, err)
			continue
		}
		actual, _ := result["action"].(string)
		actual = strings.TrimSpace(strings.ToLower(actual))
		ok := actual == ex.action
		if ok {
			correct++
		}
		mark := "✗"
		if ok {
			mark = "✓"
		}
		fmt.Printf("  %s %q → 預測=%s 正確=%s\n", mark, ex.text, actual, ex.action)
	}
	fmt.Printf("準確率: %d/%d\n", correct, len(examples))
}

// newDataset 把 []trainExample 轉成 dspy-go optimizer 要求的 core.Dataset
// 介面——dspy-go 沒有內建通用的 slice-backed dataset 實作,官方範例
// (examples/others/mipro/main.go)也是各自手刻一個最小實作,這裡照同樣
// 模式做。
func newDataset(examples []trainExample) core.Dataset {
	data := make([]core.Example, len(examples))
	for i, ex := range examples {
		data[i] = core.Example{
			Inputs:  map[string]any{"prompt": ex.text},
			Outputs: map[string]any{"action": ex.action},
		}
	}
	return &sliceDataset{examples: data}
}

type sliceDataset struct {
	examples []core.Example
	position int
}

func (d *sliceDataset) Next() (core.Example, bool) {
	if d.position >= len(d.examples) {
		return core.Example{}, false
	}
	ex := d.examples[d.position]
	d.position++
	return ex, true
}

func (d *sliceDataset) Reset() {
	d.position = 0
}
