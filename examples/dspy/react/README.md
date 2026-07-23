# dspy-go 範例:訓練多步驟(ReAct)推論過程

跟上一層 [`examples/dspy`](../README.md)(單輪分類任務)不同,這裡示範「多輪推論過程」的訓練:LLM 不是一次輸入就給
答案,而是可能先思考、呼叫工具、看工具回傳的結果,再決定下一步——這就是 ReAct(Reason + Act)。跟主範例一樣是
完全獨立的 Go module,不依賴 tripace 主專案任何程式碼。

## 用 Mermaid 圖定義行為骨架,LLM 動態生成訓練資料

訓練/評估資料不是手寫的:`.mmd` 檔案用 Mermaid flowchart 語法定義「這個任務有哪些合法的推理路徑」(哪些節點該
呼叫哪個工具、每條路徑預期的回覆關鍵字是什麼),`flow.go` 的 `parseFlowFile` 解析成 `[]flowPath`,`generate.go`
對每條路徑各自呼叫 LLM 生成符合規格的中文例句——圖只標示行為模式,不含任何具體案例文字,案例由 LLM 根據行為
規格動態產生。

### 節點語法約定

parser 依形狀符號判斷節點種類(見 `flow.go`):

| 語法 | 節點種類 | 說明 |
|---|---|---|
| `([...])` | 起點 | stadium 圓角。支援多個起點(見下方「多起點」) |
| `{...}` | 決策節點 | 菱形,純文件用途,不影響路徑展開邏輯本身 |
| `[[...]]` | 工具呼叫節點 | 子程序框,方括號內文字是工具名稱 |
| `((...))` | 終點 | 圓形,格式固定為 `"回覆:關鍵字"` |

**多起點**:`parseFlowFile` 對每個 `([...])` 起點各自做一次 DFS 展開,結果合併回同一個 `[]flowPath`——不需要為了
湊單一起點而畫一個純文件用途的分流節點。兩條不同起點的路徑也可以匯入同一個下游節點(如共用同一個工具呼叫),
parser 會各自展開成完整路徑,不會出錯;但圖裡不能有迴圈,parser 沒有防環機制。

**mermaid v11 已知限制**:開頭連續多行 `%%` 註解區塊在瀏覽器端(`viewer.html` 用的 CDN mermaid@11)偶爾會解析
失敗(`Parse error ... got 'NODE_STRING'`,通常是最後一行註解跟 `flowchart TD` 黏在一起被誤判),故所有 `.mmd`
檔案開頭只放最短的單行註解,詳細說明統一寫在這份 README。

## 目前的 `.mmd` 檔案

這個目錄同時保留了幾個階段性版本,方便對照演進過程:

- **`flow.mmd`** — 最初的極簡範例,單一決策點(有無明確地點),2 條路徑。
- **`flow_assistant.mmd`** — 從 `server/internal/llm/assistant_agent.go` 整理出的完整行為骨架,把「意圖分類」
  跟「行程操作」合併畫在同一張圖裡(單一 `classify` 決策節點接四種意圖各自的完整流程)。**目前是過渡版本**,
  已被下面兩份取代。
- **`flow_intent.mmd`** — 意圖分類骨架,對應要用 `modules.Predict` 訓練的單輪分類模組。單起點、無工具呼叫,
  4 條路徑(查詢/推薦/想去哪裡/規劃)。
- **`flow_trip_action.mmd`** — 行程操作骨架,對應要用 `modules.ReAct` 訓練的多步驟模組。四個獨立起點(分別
  對應 `flow_intent.mmd` 分類出的四種意圖),13 條路徑,承接了 `flow_assistant.mmd` 除了 `classify` 以外的
  全部邏輯。

### 為什麼要把意圖分類跟行程操作拆成兩份圖

`assistant_agent.go` 的四種意圖(查詢/推薦/想去哪裡/規劃)最終都收斂到少數幾種行程操作(`trip_entry_add`/
`trip_entry_update`/`trip_entry_list` 等)。把「意圖分類」跟「行程操作執行」拆成兩個獨立可訓練的模組:

- **意圖分類**是簡單的單步驟任務(一句話→四選一),適合用 `modules.Predict` 訓練,metric 可以用精確比對,
  訓練快、樣本需求小。
- **行程操作執行**才是真正的多步驟 ReAct(決定呼叫哪個工具、處理查重/確認等),需要 `modules.ReAct` +
  `ProcessWithTrace` 過程驗證。
- 兩者的訓練資料生成邏輯也該分開:意圖分類只需要「一句話→標籤」的例句;行程操作的訓練資料則是「已知意圖後,
  這句話該怎麼被拆解成工具呼叫序列」。
- 分開後可以各自獨立調整/重訓,不會因為改了地點判斷邏輯就要重新訓練意圖分類器,反之亦然。

`flow_intent.mmd` 的 `classify` 決策節點文字與四條分支 label,直接照搬自 `flow_assistant.mmd` 的同一段——地點/
範圍判斷的細節(`規劃` 底下的 `hasLocation`、`想去哪裡` 底下的 `destinationScope`)不屬於「意圖分類」本身,
仍留在 `flow_trip_action.mmd` 裡,由已知意圖之後的行程操作模組處理。

這形成兩層判斷:**意圖分類階段做粗判**(有無地點、要不要建行程),**行程操作階段做細判**(`flow_trip_action.mmd`
裡 `規劃` 的 `hasLocation` 再細分單一地點/區域,`想去哪裡` 的 `destinationScope` 再細分大區域/特定定點)。

## 關鍵技術點:兩套 ReAct 實作

dspy-go 有兩套 ReAct,能不能被 optimizer(MIPRO/BootstrapFewShot)訓練是關鍵差異:

| | `pkg/agents/react`(官方 `examples/react_agent` 用的) | `pkg/modules.ReAct`(這裡用的) |
|---|---|---|
| 是否為 `core.Module` | 否 | 是 |
| 能否被 optimizer 訓練 | 不能 | 能,跟單輪的 `modules.Predict` 用同一套 `optimizer.Compile(...)` |
| 工具介面 | 需手刻完整 `core.Tool` 六個方法(見官方範例的 `SearchTool`) | 用 `tools.NewFuncTool(name, description, schema, fn)` 包一個 Go 函式即可 |
| 特色 | 自帶記憶體優化、reflection、planning 等執行期特性 | 單純,專注在能被 optimizer 訓練 |

「訓練多步驟推論過程」在 dspy-go 裡的做法是**換模組,不是換訓練機制**:把 `modules.NewPredict(signature)` 換成
`modules.NewReAct(signature, registry, maxIters)`,MIPRO/BootstrapFewShot 這套 optimizer 完全不用換。

## Metric 的差異

單輪分類任務可以用精確字串比對(答案要嘛對要嘛錯)。多步驟任務的最終回覆是一句自然語言,沒辦法要求逐字相同,
這裡改用「答案裡有沒有出現預期關鍵字」(`strings.Contains`)這種寬鬆判斷,見各 `flowPath.expectKeyword` 欄位。

## 驗證中間過程,不只驗證最終答案

`optimizer.Compile` 訓練階段的 metric **看不到中間過程**——dspy-go 的 `core.Metric` 介面只收 `(example,
prediction)`,MIPRO 評分候選 instruction 時只看最終輸出對不對,不會檢查 ReAct 有沒有真的呼叫工具、呼叫了幾次。
這代表訓練出來的 prompt,即使準確率很高,也可能是「LLM 矇對關鍵字,沒有真的照該有的推理流程做」。

`runEval`(訓練完之後的評估,不影響訓練過程本身)額外做了這一層檢查:用 `react.ProcessWithTrace(...)`(而非
`program.Execute(...)`)拿到完整的 `*modules.ReActTrace`,裡面 `Steps[].Tool` 記錄每一步實際呼叫了哪個工具。

**過程驗證不是拿例句生成時綁定的 `pathID` 直接信任比對**,而是用 `matchPathByTools`(見 `flow.go`)拿這次實際
呼叫的工具序列,反查圖裡展開出的所有路徑,找出真正相符的那一條——分岔越多、輸入本身越模糊時,例句生成當下
標記的 `pathID` 只代表「請 LLM 生成時預期它會怎麼分類」,不保證 agent 實際執行時真的走那條路。若答案關鍵字對了
但過程對不上任何合法路徑,代表可能是「矇對關鍵字,不是真的照推理流程做」。

## 生成資料跟訓練是兩個獨立步驟

```bash
export GOSUMDB=off   # 見上一層 examples/dspy/README.md 的「已知環境限制」
go run . gendata     # 解析 flow.mmd,用 LLM 生成例句,寫進 dataset.json
                      # (人工打開這個檔案看過、確認例句品質沒問題)
go run . train        # 讀 dataset.json,跑 MIPRO 訓練 + 過程驗證
```

`.env` 沿用跟 `examples/dspy` 相同的 `AI_MODEL`/`VLLM_BASE_URL` 慣例。

**注意**:MIPRO 對多步驟 agent 的優化會產生比單輪分類多更多次 LLM 呼叫(每個 trial 裡,ReAct 每筆訓練資料
可能要跑到 `maxIters` 輪),對自架的小型 vLLM 服務會花比 `examples/dspy` 明顯更久的時間,請耐心等待或先用
`WithNumTrials`/`WithNumCandidates` 調更小的值測試。

**目前 `main.go` 仍固定讀 `flow.mmd`**,尚未整合 `flow_intent.mmd`/`flow_trip_action.mmd` 這組拆分後的雙模組
訓練流程(意圖分類 + 行程操作各自獨立訓練),這是後續待辦。

## 本機預覽 `.mmd` 流程圖(不需要 IDE 外掛)

```bash
python3 serve.py                    # 預設開 flow.mmd
python3 serve.py flow_intent.mmd    # 指定要看哪個 .mmd 檔案
```

`serve.py` 起一個本機靜態伺服器並自動開瀏覽器顯示 `viewer.html`(用 CDN 版 mermaid@11 渲染)。`viewer.html`
支援熱重載:網址帶 `?file=xxx.mmd` 時每秒輪詢一次同一份檔案,內容有變化才重新渲染,編輯 `.mmd` 存檔後 1 秒內
畫面會自動更新,不用手動重新整理。也可以不透過伺服器,直接用瀏覽器打開 `viewer.html`(`file://`),用選檔/拖曳/
貼上的方式手動載入(但沒有熱重載,`fetch` 會被 CORS 擋掉)。
