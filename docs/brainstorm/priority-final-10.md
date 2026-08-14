# 立即處理的 10 項 —— 可觀測性與核心功能穩定性

> 整合自三方腦力激盪（後端工程師 / 系統架構師 / 測試品保專家），兩輪討論後收斂。
> 第一優先主題:**觀測用戶狀態**（上線後看得見）+ **確保關鍵核心功能穩定運作**（不靜默壞掉）。
>
> 本文件只做規劃排序,不含程式碼改動。

## 背景

專案是「單一 prod、無 staging、push main 直接 100% 上線、唯一品質門檻是能編譯過」——這條防線分三段:

```
上線前(測試攔截) ──→ 上線瞬間(health + smoke 判活) ──→ 上線後(log + metrics + alerting 偵測)
```

缺任何一段都會漏,因此排序原則是:**先能看見**(health + log)→ **再擋崩潰**(panic + timeout + pool)→ **再守迴歸**(關鍵測試)→ **最後補監測**(error tracking + alerting + metrics)。

意外發現:不少地基零件其實已做好一半、只是沒接起來,例如 `store.MigrationOK` 旗標早就存在(`store.go:25`),只是 `/health` 沒用它。

## 最終 10 項(依建議執行順序)

### 第 1 層:先能看見

1. **誠實的 `/health`(liveness / readiness 分離 + DB ping + `MigrationOK`)**
   `/health` 現在死回 `{"status":"ok"}`,DB 掛了、schema 壞了照樣回 200,Cloud Run 探針、部署 smoke test、uptime 告警全建在這個永遠說謊的訊號上。改成 liveness 與 readiness 分離,readiness 納入 DB ping + `MigrationOK`。是第 5、9、10 項的共同前置。

2. **CI gate(`go build`/`vet`/`test -race`,設為 branch protection required check)**
   現有測試紅了照樣上 prod,等於形同虛設。純粹把已有測試資產接上電,不寫新測試。是後續高風險改動能「安全地做」的前提。

3. **結構化 logging(slog + request ID 貫穿全流程)**
   目前只有 `log.Printf`,LLM 錯誤還繞過 log 系統走 `fmt.Printf`。request ID 從 middleware 生成、貫穿到底層,是第 4、7、10 項的共同掛點,必須連同「統一 error type」一起做。

### 第 2 層:再擋崩潰

4. **panic recovery(HTTP + 所有背景 goroutine + 結構化上報)**
   全 repo `recover()` 零命中,任一 handler 或背景 goroutine panic 會讓整個 process 崩潰。HTTP middleware 之外,`sink.go`/`want_analyzer.go` 自起的背景 goroutine 也各自要 `defer recover()`。

5. **`http.Server` timeout + graceful shutdown + DB connection pool 上限**
   裸 `http.ListenAndServe` 無逾時設定(slowloris 風險)、無 graceful shutdown(換 revision 會砍掉進行中請求)、無連線池上限(容易打爆 Cloud SQL)。三項皆為低成本純止血。

6. **權限矩陣測試 + API 測試 harness**
   `internal/api` 810 行的所有授權檢查零測試,程式碼自己都註記了兩個繞過風險。「viewer 能改別人行程」這種靜默越權比 panic 更可怕——沒有崩潰訊號,功能照跑但權限有洞。先建 in-memory API 測試 harness,再補權限矩陣測試。

### 第 3 層:守迴歸 + 補監測

7. **LLM retry / 逾時 / 降級 + 取代 `sleep(1500ms)` 完成判定**
   LLM provider 5xx/逾時沒有重試也沒有降級;完成判定靠 `time.Sleep(1500ms)` 這種 race-prone 啟發式,可能截斷或誤判回應。retry 要掛在 context 上(可被逾時/取消打斷),完成判定改用確定性事件信號。

8. **唯一的 e2e 接上 CI + 核心流程守門**
   專案唯一驗證「記事→AI→存檔→顯示」整條路徑的 e2e,因為要手動起三個 process 而永遠不上崗——改壞 prompt/工具白名單沒有任何自動化會發現。改用 Playwright `webServer` + mockllm 讓它能在 CI 獨立跑,並把「給定輸入 → 預期工具序列」寫成 golden 斷言。

9. **部署後 smoke test(失敗不切流量)+ uptime 監控與 alerting**
   push main 直接 100% 切換,無 smoke test、無 rollback、無告警,設定類事故直接打到全體使用者。起新 revision → smoke 過才導流,並設 uptime check + alert policy。

10. **LLM 核心業務指標 + 全域序列化點護欄**
    LLM 延遲/成功率全無觀測;全站 LLM 請求被單一 mutex 序列化,第二個使用者要排隊等 90 秒逾時,是效能天花板也是現成 DoS 面且完全不可見。先用 log-based metrics 產出業務指標,序列化點只加低風險護欄(排隊上限 + acquire 逾時 + 排隊觀測)——真正拆單例留到有 metrics 數據與並發測試護體之後,貿然拆解風險更高。

## 排出前 10、留待之後的項目

- 拆 `sink.go` 全域鎖 / 單例:立即只做護欄(第 10 項),拆解延後
- store 層全面 context 化:只做第 3 項的 middleware context 生成,store 簽章逐檔漸進
- 多步驟寫入包交易(entry + trip 歸組 + message 關聯):列為第 11 順位
- 時間欄位 timestamptz 遷移的迴歸測試:列為緊接前 10 的補強
- OTel 正式指標、統一 domain error type 完整版:延後
