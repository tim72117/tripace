// Command react 是 dspy-go 的多步驟(ReAct)訓練範例——跟同目錄上一層
// examples/dspy(單輪分類,MIPRO 優化 instruction)不同,這裡示範的是「多輪
// 推論過程」:LLM 不是一次輸入就給答案,而是可能先思考、呼叫工具、看工具
// 回傳的結果,再決定下一步(繼續呼叫工具,或給出最終答案)——這就是 ReAct
// (Reason + Act)的意思。
//
// 任務內容延續 examples/dspy 的地點處理場景,但這次是動作而非分類:給
// LLM 一句記事,讓它自己判斷「這句話有沒有明確地點、需不需要查座標」,
// 需要的話呼叫 geocode 工具(這裡是模擬,回傳假座標,不真的打 Google
// Places API),最後根據查到的結果(或沒查到)給出一句確認回覆。
//
// 關鍵技術點:dspy-go 有兩套 ReAct 實作——
//   - pkg/agents/react(dspy-go 官方 examples/react_agent 用的那套):
//     自帶記憶體優化(WithMemoryOptimization)等執行期特性,但不是
//     core.Module,不能被 pkg/optimizers 的 MIPRO/BootstrapFewShot
//     訓練/優化。
//   - pkg/modules.ReAct(這裡用的):實作 core.Module 介面,可以像
//     examples/dspy 的 modules.Predict 一樣塞進 core.Program,一樣可以
//     用 optimizer.Compile(...) 訓練——這正是「訓練多步驟推論過程」在
//     dspy-go 裡的做法:不是換一套訓練機制,是換模組(Predict → ReAct),
//     MIPRO/BootstrapFewShot 這套 optimizer 完全不用換。
//
// 工具用 tools.NewFuncTool(name, description, schema, fn) 包一個 Go 函式
// 成 core.Tool,不需要手刻 core.Tool 介面要求的六個方法(Name/Description/
// Metadata/CanHandle/Execute/Validate)——pkg/agents/react 範例的
// SearchTool/CalculatorTool 才需要手刻,那是因為那套系統對工具介面的
// 要求跟 pkg/modules.ReAct 不同,不能互通,寫 pkg/modules.ReAct 的工具
// 要用 tools.NewFuncTool 這個 helper。
//
// 訓練/評估資料不是手寫的:flow.mmd 用 Mermaid flowchart 語法定義行為
// 骨架(哪些路徑合法、每條路徑該不該呼叫工具、預期關鍵字),flow.go 的
// parseFlowFile 解析成 []flowPath,generate.go 對每條路徑各自呼叫 LLM
// 生成符合規格的中文例句——圖形只標示行為模式,不含任何具體案例文字,
// 案例由 LLM 根據行為規格產生(見 generate.go 開頭的完整說明)。
//
// 生成資料跟訓練是兩個獨立步驟,不會一次串到底:
//
//	go run . gendata   # 解析 flow.mmd,用 LLM 生成例句,寫進 dataset.json
//	                    # (人工打開這個檔案看過、確認例句品質沒問題)
//	go run . train      # 讀 dataset.json,跑 MIPRO 訓練 + 過程驗證
//
// 用法見同目錄 README.md(跟上層 examples/dspy 共用同一份 .env 慣例)。
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/llms"
	"github.com/XiaoConstantine/dspy-go/pkg/logging"
	"github.com/XiaoConstantine/dspy-go/pkg/modules"
	"github.com/XiaoConstantine/dspy-go/pkg/optimizers"
	"github.com/XiaoConstantine/dspy-go/pkg/tools"
	"github.com/joho/godotenv"

	models "github.com/XiaoConstantine/mcp-go/pkg/model"
)

const datasetPath = "dataset.json"

func main() {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	logging.SetLogger(logging.NewLogger(logging.Config{
		Severity: logging.INFO,
		Outputs:  []logging.Output{logging.NewConsoleOutput(true, logging.WithColor(true))},
	}))

	if len(os.Args) < 2 {
		log.Fatal(`請指定子命令: "go run . gendata [flow檔.mmd] [每路徑筆數]"(生成資料) 或 "go run . train"(訓練)`)
	}

	ctx := core.WithExecutionState(context.Background())
	setupLLM()

	switch os.Args[1] {
	case "gendata":
		runGenData(ctx, os.Args[2:])
	case "train":
		runTrain(ctx)
	default:
		log.Fatalf("未知子命令 %q,只支援 gendata、train", os.Args[1])
	}
}

// setupLLM 設定 core 的 default LLM(vLLM 或雲端 provider 二選一,依 .env
// 是否有 VLLM_BASE_URL 判斷)——gendata、train 兩個子命令都需要呼叫 LLM
// (gendata 用來生成例句,train 用來跑 MIPRO 優化與 ReAct 推論),故共用。
func setupLLM() {
	modelID := os.Getenv("AI_MODEL")
	if modelID == "" {
		modelID = string(core.ModelGoogleGeminiFlash)
	}
	vllmBaseURL := os.Getenv("VLLM_BASE_URL")

	llms.EnsureFactory()

	if vllmBaseURL != "" {
		llm, err := llms.NewOpenAICompatible("vllm", core.ModelID(modelID), vllmBaseURL)
		if err != nil {
			log.Fatalf("設定 vLLM 失敗(VLLM_BASE_URL=%q, model=%q): %v", vllmBaseURL, modelID, err)
		}
		core.SetDefaultLLM(llm)
	} else {
		apiKey := os.Getenv("DSPY_API_KEY")
		if apiKey == "" {
			log.Fatal("請設定 VLLM_BASE_URL(自架 vLLM)或 DSPY_API_KEY(雲端 provider)")
		}
		if err := core.ConfigureDefaultLLM(apiKey, core.ModelID(modelID)); err != nil {
			log.Fatalf("設定 LLM 失敗(model=%q): %v", modelID, err)
		}
	}
}

// runGenData 是 "go run . gendata [flow檔.mmd] [每路徑筆數]" 的邏輯:解析
// 指定的 .mmd(不指定時預設 flow.mmd,維持向下相容),對每條路徑呼叫 LLM
// 生成訓練/評估例句,寫進對應的 dataset*.json——只生成、不訓練,讓使用者
// 能在下一步(runTrain)之前先打開這個檔案確認例句品質。
//
// args 是 os.Args[2:],依序是可選的 .mmd 檔名、可選的每路徑生成筆數
// (train 用,eval 固定是這個數字的三分之一、至少 1 筆)——用來支援
// "只想針對某張圖產生少量資料看看" 這種情境,不用每次都产生預設的
// 每路徑 3 筆。
func runGenData(ctx context.Context, args []string) {
	flowFile := "flow.mmd"
	if len(args) >= 1 && args[0] != "" {
		flowFile = args[0]
	}
	perPathTrain := 3
	if len(args) >= 2 {
		n, err := strconv.Atoi(args[1])
		if err != nil || n < 1 {
			log.Fatalf("每路徑筆數必須是正整數,收到 %q", args[1])
		}
		perPathTrain = n
	}
	perPathEval := perPathTrain / 3
	if perPathEval < 1 {
		perPathEval = 1
	}

	// 解析指定的 .mmd:展開成所有起點到終點的路徑,每條路徑定義「該不該
	// 呼叫哪個工具、預期關鍵字」這個行為規格(見 flow.go)。
	paths, err := parseFlowFile(flowFile)
	if err != nil {
		log.Fatalf("解析 %s 失敗: %v", flowFile, err)
	}
	fmt.Printf("從 %s 解析出 %d 條行為路徑\n", flowFile, len(paths))

	// 用 LLM 對每條路徑生成訓練/評估例句——trainSet 每條路徑生成較多筆
	// (讓 MIPRO 有更多可挑的 few-shot demo 候選),evalSet 少量、且是
	// 獨立生成的一批(不是從 trainSet 挖幾筆出來,兩批分開呼叫 LLM 生成,
	// 天然就不會重複,能測到真正的泛化能力,而非讓 LLM 挑出自己已經生成
	// 過的句子)。
	fmt.Printf("=== 用 LLM 根據 %s 的行為規格生成訓練/評估資料(每路徑 train=%d、eval=%d 筆) ===\n",
		flowFile, perPathTrain, perPathEval)
	reactTrainSet, err := generateDataset(ctx, paths, perPathTrain)
	if err != nil {
		log.Fatalf("生成訓練資料失敗: %v", err)
	}
	reactEvalSet, err := generateDataset(ctx, paths, perPathEval)
	if err != nil {
		log.Fatalf("生成評估資料失敗: %v", err)
	}
	for _, ex := range reactTrainSet {
		fmt.Printf("  [train] (%s) %q\n", ex.PathID, ex.Text)
	}
	for _, ex := range reactEvalSet {
		fmt.Printf("  [eval]  (%s) %q\n", ex.PathID, ex.Text)
	}

	outPath := datasetPathFor(flowFile)
	if err := saveDataset(outPath, datasetFile{TrainSet: reactTrainSet, EvalSet: reactEvalSet}); err != nil {
		log.Fatalf("儲存 %s 失敗: %v", outPath, err)
	}
	fmt.Printf("\n已寫入 %s——請先打開確認例句品質,沒問題再執行 \"go run . train\"\n", outPath)
}

// datasetPathFor 依 .mmd 檔名推導對應的輸出檔名(如 flow_intent.mmd →
// dataset_intent.json),避免不同 .mmd 生成的資料互相覆蓋;flow.mmd 這個
// 預設檔案維持用原本的 dataset.json,不改名,不影響既有用法。
func datasetPathFor(flowFile string) string {
	base := strings.TrimSuffix(filepath.Base(flowFile), ".mmd")
	if base == "flow" {
		return datasetPath
	}
	suffix := strings.TrimPrefix(base, "flow_")
	return "dataset_" + suffix + ".json"
}

// runTrain 是 "go run . train" 的邏輯:讀 dataset.json(必須先跑過
// gendata 且已人工確認過),建立 ReAct agent,跑 MIPRO 優化,並在優化前後
// 都用過程驗證跑一次 evalSet。
func runTrain(ctx context.Context) {
	d, err := loadDataset(datasetPath)
	if err != nil {
		log.Fatal(err)
	}
	reactTrainSet, reactEvalSet := d.TrainSet, d.EvalSet

	paths, err := parseFlowFile("flow.mmd")
	if err != nil {
		log.Fatalf("解析 flow.mmd 失敗: %v", err)
	}
	pathTable := pathsByID(paths)

	registry := tools.NewInMemoryToolRegistry()
	if err := registry.Register(newGeocodeTool()); err != nil {
		log.Fatalf("註冊 geocode 工具失敗: %v", err)
	}

	// signature 輸入欄位同樣命名為 prompt(見同目錄上一層 examples/dspy 的
	// main.go 對這個限制的完整說明:dspy-go 的 MIPRO teacher demonstration
	// 生成邏輯寫死讀 input.Inputs["prompt"])。輸出 answer 是這一輪最終要
	// 給使用者的一句確認回覆(不是分類標籤)。
	signature := core.NewSignature(
		[]core.InputField{{Field: core.NewField("prompt", core.WithDescription("使用者記錄的一句行程/事項"))}},
		[]core.OutputField{{Field: core.NewField("answer", core.WithDescription("根據是否查到地點座標,給使用者的一句確認回覆"))}},
	).WithInstruction(
		"你會收到使用者記錄的一句行程。若句子裡有明確可定位的地點(飯店、景點、餐廳等)," +
			"呼叫 geocode 工具查詢座標,查到後在回覆裡帶出座標確認地點正確;" +
			"若沒有明確地點,不要呼叫任何工具,直接回覆已經記下這件事。",
	)

	// maxIters=3:最多允許 3 輪思考-行動循環(思考→呼叫 geocode→看結果→
	// 決定是否結束)。這個任務通常 1-2 輪就該結束(至多查一次地點),
	// 3 是留一點餘裕、不是預期真的會用滿。
	react := modules.NewReAct(signature, registry, 3)
	program := core.NewProgram(
		map[string]core.Module{"agent": react},
		func(ctx context.Context, inputs map[string]any) (map[string]any, error) {
			return react.Process(ctx, inputs)
		},
	)

	dataset := newDataset(reactTrainSet, pathTable)

	// metric:用最寬鬆的「答案裡有沒有出現關鍵字」判斷,而非精確字串比對
	// ——多步驟任務的最終回覆是一句自然語言(不像分類任務只回一個固定
	// 標籤),沒辦法要求逐字相同,只能檢查該出現的關鍵訊號有沒有出現
	// (座標數字格式、或「已經記下」這種確認語)。
	metric := func(example, prediction map[string]any, _ context.Context) float64 {
		expectedKeyword, _ := example["expect_keyword"].(string)
		actual, _ := prediction["answer"].(string)
		if strings.Contains(actual, expectedKeyword) {
			return 1.0
		}
		return 0.0
	}

	optimizer := optimizers.NewMIPRO(
		metric,
		optimizers.WithMode(optimizers.LightMode),
		optimizers.WithNumTrials(3),
		optimizers.WithNumCandidates(3),
		optimizers.WithMaxLabeledDemos(2),
		optimizers.WithNumModules(1),
	)

	fmt.Println("=== 優化前:直接跑 evalSet(含中間過程驗證) ===")
	runEval(ctx, react, reactEvalSet, paths)

	fmt.Println("\n=== 開始用 MIPRO 優化 ReAct agent 的 prompt(多輪工具呼叫,會花更久)===")
	optimizedProgram, err := optimizer.Compile(ctx, program, dataset, nil)
	if err != nil {
		log.Fatalf("優化失敗: %v", err)
	}

	// optimizedProgram.Modules["agent"] 型別是 core.Module 介面,要斷言回
	// *modules.ReAct 才能呼叫 ProcessWithTrace(見 runEval 的說明)——
	// optimizer.Compile 回傳的 Program 裡的模組,實際底層型別跟優化前
	// 塞進去的是同一種(這裡是 *modules.ReAct),只是介面型別擦除了,
	// 斷言失敗理論上不會發生,但仍寫 ok 檢查避免 panic。
	optimizedReact, ok := optimizedProgram.Modules["agent"].(*modules.ReAct)
	if !ok {
		log.Fatal("優化後的 agent 模組型別不是 *modules.ReAct,無法取得執行軌跡")
	}

	fmt.Println("\n=== 優化後的模組 ===")
	for name, mod := range optimizedProgram.Modules {
		fmt.Printf("模組 %q 的 signature: %s\n", name, mod.GetSignature().Instruction)
	}

	fmt.Println("\n=== 優化後:再跑一次 evalSet(含中間過程驗證) ===")
	runEval(ctx, optimizedReact, reactEvalSet, paths)
}

// newGeocodeTool 建一個模擬的 geocode 工具:輸入地點名稱字串,回傳假座標
// (不真的打 Google Places API,這是純技術驗證,不需要真實座標資料或
// GOOGLE_PLACES_API_KEY)。用 tools.NewFuncTool 包裝,自動滿足 core.Tool
// 介面要求的全部方法。
func newGeocodeTool() core.Tool {
	schema := models.InputSchema{
		Type: "object",
		Properties: map[string]models.ParameterSchema{
			"location": {
				Type:        "string",
				Description: "要查詢座標的地點名稱",
				Required:    true,
			},
		},
	}
	fn := func(ctx context.Context, args map[string]any) (*models.CallToolResult, error) {
		location, _ := args["location"].(string)
		if location == "" {
			return nil, fmt.Errorf("location 參數必填")
		}
		// 固定回傳一組假座標(不含實際地理意義),純粹讓 ReAct 迴圈有
		// 「工具真的回傳了資料」這個訊號可以往下推理。
		text := fmt.Sprintf("座標: 25.0330, 121.5654(模擬查詢結果,地點: %s)", location)
		return &models.CallToolResult{
			Content: []models.Content{models.TextContent{Type: "text", Text: text}},
			IsError: false,
		}, nil
	}
	return tools.NewFuncTool(
		"geocode",
		"查詢地點名稱對應的地理座標,輸入明確地點(飯店、景點、餐廳)時使用",
		schema,
		fn,
	)
}

// runEval 用 react.ProcessWithTrace(而非 core.Program.Execute)驗證兩層。
// 過程層不是拿 ex.PathID(例句生成當下綁定的標籤)直接查表信任,而是用
// matchPathByTools 拿這次實際呼叫的工具序列反查 flow.mmd 展開出的所有
// 路徑,找出真正相符的那一條(見 flow.go 的完整說明)——這樣才是「動態
// 判斷這次執行走的是哪條路徑」,而不是預先假設「這句話一定走生成時
// 標記的那條路」:
//   - 過程層:trace.Steps 實際呼叫的工具序列,能不能在 flow.mmd 定義的
//     合法路徑裡找到完全相符的一條。找不到,代表 agent 這次做的事完全
//     不符合圖上任何一條合法路徑。
//   - 答案層:若過程層有找到相符路徑,再檢查最終 answer 有沒有出現該
//     路徑定義的預期關鍵字。若過程層找不到相符路徑,答案層無從比對
//     (沒有「預期關鍵字」可言),直接判定整體失敗。
//
// ex.PathID 只用來印出「生成時預期屬於哪條路徑」以便人工比對,不參與
// 判定邏輯。
func runEval(ctx context.Context, react *modules.ReAct, examples []reactExample, paths []flowPath) {
	for _, ex := range examples {
		result, trace, err := react.ProcessWithTrace(ctx, map[string]any{"prompt": ex.Text})
		if err != nil {
			fmt.Printf("  [錯誤] %q: %v\n", ex.Text, err)
			continue
		}

		var calledTools []string
		for _, step := range trace.Steps {
			if step.Tool != "" {
				calledTools = append(calledTools, step.Tool)
			}
		}

		matched, matchedOK := matchPathByTools(paths, calledTools)

		answer, _ := result["answer"].(string)
		answerOK := matchedOK && strings.Contains(answer, matched.expectKeyword)

		mark := "✗"
		if answerOK {
			mark = "✓"
		}
		matchedID := "(無相符路徑)"
		if matchedOK {
			matchedID = matched.id
		}
		fmt.Printf("  %s %q(共 %d 步,呼叫工具=%v)\n      生成時預期路徑=%s,實際相符路徑=%s\n      → %s\n",
			mark, ex.Text, len(trace.Steps), calledTools, ex.PathID, matchedID, answer)
		if matchedOK && matched.id != ex.PathID {
			fmt.Printf("      ⚠ 實際走的路徑跟生成時預期的不同(可能是這句話本身有歧義,或 agent 判斷錯誤)\n")
		}
		if !matchedOK {
			fmt.Printf("      ⚠ 呼叫的工具序列不符合 flow.mmd 任何一條合法路徑\n")
		}
	}
}

func newDataset(examples []reactExample, pathTable map[string]flowPath) core.Dataset {
	data := make([]core.Example, 0, len(examples))
	for _, ex := range examples {
		path, ok := pathTable[ex.PathID]
		if !ok {
			continue // 找不到對應路徑的例句略過,不讓整個 dataset 建構失敗
		}
		data = append(data, core.Example{
			Inputs:  map[string]any{"prompt": ex.Text},
			Outputs: map[string]any{"expect_keyword": path.expectKeyword},
		})
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
