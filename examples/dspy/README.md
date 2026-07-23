# dspy-go 範例:用 optimizer 產生 prompt

用 [dspy-go](https://github.com/XiaoConstantine/dspy-go) 的 `BootstrapFewShot` optimizer,從少量標註範例自動產生/優化一個分類任務的
prompt(few-shot demonstrations),而非手動撰寫。跟 tripace 主專案(`server/`、`web/`)是完全獨立的 Go module,不會被
tripace 的 build/CI 影響到,純粹是技術驗證用的範例。

## 任務內容

分類器把一句使用者輸入判斷成三類之一,對應 `server/internal/llm/assistant_agent.go` 「地點處理」那段的判斷邏輯:

- `geocode`:有明確可定位的單一地點(如「宮古島希爾頓酒店」),該呼叫 `geocode` 工具確認座標。
- `ask_recommend`:地點是一個區域(如「京都」「北海道」),該用 `ask_user` 詢問要不要推薦附近景點。
- `none`:沒有地點資訊,或跟地點處理無關。

## 執行

### 雲端 provider(Gemini/Claude/OpenAI)

```bash
export DSPY_MODEL_ID=gemini-2.5-flash   # 或 claude-sonnet-4-6、gpt-4o-mini 等,完整常數見
                                         # dspy-go 的 pkg/core/llm.go
export DSPY_API_KEY=your-api-key        # 對應 provider 的 key
export GOSUMDB=off                      # 見下方「已知環境限制」
go run .
```

`DSPY_MODEL_ID` 決定要用哪個 provider——dspy-go 的 LLM factory 會依 model ID 字串本身判斷 provider(`gemini-*` →
Google Gemini、`claude-*` → Anthropic、`gpt-*`/`o1-*`/`o3-*` → OpenAI),不需要另外指定 provider 名稱。

### 自架 vLLM(或其他 OpenAI-compatible 服務)

```bash
export DSPY_MODEL_ID=your-model-name        # vLLM 啟動時 --served-model-name 指定的名稱
export DSPY_VLLM_BASE_URL=http://localhost:8000   # vLLM 的 OpenAI-compatible server 位址(不含 /v1/chat/completions)
export GOSUMDB=off
go run .
```

設定 `DSPY_VLLM_BASE_URL` 後不需要 `DSPY_API_KEY`(自架服務通常不驗證)。dspy-go 沒有專門的 vLLM provider,是透過
`llms.NewOpenAICompatible("vllm", modelID, baseURL)` 這個通用 OpenAI-compatible 建構子接上——vLLM 的
`/v1/chat/completions` 端點本來就是照 OpenAI 格式實作,原理跟 tripace 主專案(`server/internal/llm/
want_analyzer.go` 的 `AI_PROVIDER=vllm` + `VLLM_BASE_URL`)接 vLLM 的方式一致,只是換一套 SDK。

## 已知環境限制:本機網路 DNS 劫持

本機(透過 Tailscale VPN 出口)的 DNS 有時會把 `golang.org`、`google.golang.org`、`proxy.golang.org` 等網域解析到
一個第三方過濾伺服器(憑證主體顯示 `safebrowsing.hinet.net`),導致 `go get`/`go mod tidy`/`go build` 間歇性失敗、
報 `tls: failed to verify certificate`。這是網路環境問題,不是這份程式碼或 dspy-go 本身的問題——觀察到的現象是
**間歇性的**,同一個網域這次連不上、幾分鐘後重試可能就正常(用 `openssl s_client -connect proxy.golang.org:443
-servername proxy.golang.org </dev/null | openssl x509 -noout -subject` 可以檢查目前連到的是不是真正的 Google
憑證)。

若 `go build`/`go mod tidy` 卡住:

1. 先用上面的 `openssl` 指令確認目前是否被劫持。
2. 若被劫持,稍後重試,或切換網路(關閉 VPN、換一個網路環境)後再試。
3. `GOSUMDB=off` 是為了避免 `sumdb.golang.org` 這個校驗步驟也被劫持卡住,不是必要的安全性妥協——`go.sum` 本身
   仍會記錄雜湊、正常提供完整性校驗,只是不透過 checksum database 額外驗證。

`go.mod`/`go.sum` 已經在網路正常時完整驗證過(`go build .`、`go vet .` 皆乾淨通過),平常不需要重新
`go mod tidy`,除非要新增/更新依賴。
