# 併發安全深入掃描報告 — Tripace Go 後端

**日期**：2026-07-27
**範圍**：`server/` 全體 Go 後端（含 `github.com/tim72117/want@v0.0.2` 函式庫原始碼交叉驗證）
**方法**：唯讀分析，逐行對照實際程式碼與 want 函式庫原始碼（`~/go/pkg/mod/github.com/tim72117/want@v0.0.2/`）驗證，非憑印象推測。未修改任何檔案。
**關聯文件**：本報告是 [architecture-review-2026-07.md](./architecture-review-2026-07.md) 中併發相關疑慮的深入驗證與修正——部分結論修正了該文件的判斷（見下方「與先前架構評估的差異」）。

---

## 決定性前提：want 引擎的執行模型

`orch.Submit(prompt)` 只是把命令推進 `activationQueue`（buffered 500），真正的推論與**工具執行跑在 orchestrator 內部一條長駐的背景 goroutine 上**（`orchestrator.go:133` 的 consumer → `dispatch` → `orchestrator.go:220` 的 goroutine → `RunAgent` → `agent.Run` → `tool.Call`）。

tripace 這邊的 `Assist`/`Answer`/`generate`/`Prompt` 只是持鎖後 `Submit`、然後 `select` 等一個 `done` channel 或 90 秒逾時。**tripace 從未把 HTTP request 的 context 傳進 want，也從未呼叫 `orch.Interrupt()`**（全 repo 零命中）——所以逾時或 client 斷線都**不會**取消正在跑的 agent goroutine。這是下面多個發現的共同根因。

---

## A. 會導致整個 process 崩潰退出

### A1. want 的工具執行鏈完全沒有 `recover()`，任一工具 panic 直接殺掉整個 server

- **位置**：want 函式庫 `internal/query.go`（`agent.Run`）、`internal/agent_tool.go:196`（`tool.Call`）、`orchestrator/orchestrator.go:220-233`（dispatch goroutine）。對整個 `want@v0.0.2/internal/` grep `recover()` **零命中**；唯一的 `recover()` 在 `events/event_bus.go:82`，只保護 EventBus 的事件回呼，**不保護工具執行**。tripace 端也全 repo 零 `recover()`。
- **觸發情境**：任一 want 工具的 `Call` 內發生 panic——例如 nil pointer、型別斷言失敗、切片越界。工具在 `orchestrator.go:220` 那條 goroutine 上執行，panic 往上沒有任何 `recover()`，goroutine crash = 整個 process 退出。
- **後果**：單一使用者的一則訊息就能讓整台 server 崩潰；Cloud Run 上等於一次請求打掛整個 instance。

### A2. `sink.go` 全域寫入路徑會呼叫 GORM，任一 DB 層 panic 在無 recover 的 goroutine 上崩潰

- **位置**：`internal/wanttools/sink.go:260-272`（`emit`）→ `cmd/server/main.go:95-116` 的 `BindSink` 閉包 → `st.InsertEntry` → GORM。`emit` 跑在 A1 所述的無 recover goroutine 上。
- **觸發情境**：`record_entry` 工具觸發 `emit`，而 GORM/driver 在連線中斷、型別不符等情況下 panic（GORM 在某些邊界確實會 panic 而非回 error）。
- **後果**：同 A1，process 崩潰。這是「全域可變狀態 + 無 recover 的背景 goroutine」疊加後最實際的崩潰入口。

> 已排查、確認為誤報：`geocode.go:53 places[0]` 與 `recommend_nearby.go:87 center[0]` 曾懷疑是越界 panic，經查證 `geo.Client.Search` 在零結果時回 `(nil, ErrNotFound)`（`places.go:169-170`），呼叫端 `err != nil` 會先 return，不會走到 `[0]`。此處不列為問題，記錄以說明已實際驗證而非略過。

### A3. `Hub.Broadcast` 併發存取 map，會觸發無法 recover 的 runtime fatal error

- **位置**：`api/hub.go:42-48`。`Broadcast` 用 `RLock` 取出內層 map 參照（`conns := h.subs[channelID]`）後就 `RUnlock`，才開始 `for conn := range conns` 遍歷並 `go conn.Write(...)`。
- **觸發情境**：`Broadcast` 讀出內層 map 參照並 `RUnlock` 後，另一 goroutine（`ws.go:29` 的 defer）呼叫 `unsubscribe` → `delete(h.subs[channelID], conn)` 修改**同一個內層 map**。`Broadcast` 這邊正在 `range` 同一個 map，形成「一個 goroutine range、另一個 goroutine delete 同一 map」的併發存取。鎖只涵蓋了「取出 map 參照」這個動作，沒有涵蓋後續的遍歷。
- **後果**：Go runtime 對「併發讀寫同一 map」會直接 `fatal error: concurrent map iteration and map write`，這個 fatal **無法被 recover**，整個 process 崩潰。觸發條件：一個頻道有事件廣播的同時、另一個成員的 WS 連線正在關閉/退訂——多人協作場景下並不罕見。

---

## B. 會導致永久卡死 / 資源洩漏 / goroutine 累積

### B1.（最嚴重的洩漏）want 的 `EventBus.Subscribe` 退訂用「函式指標比較」，實務上退訂失敗，shared orchestrator 上的訂閱者無限累積

- **位置**：want `events/event_bus.go:48-61`。退訂函式用 `fmt.Sprintf("%p", h) == fmt.Sprintf("%p", callback)` 比對要移除哪個 handler。tripace 端每次呼叫都 `Subscribe` + `defer unsub()`：`want_analyzer.go:71/189/284`、`clienttools_agent.go:173`。
- **觸發情境**：Go 對「同一個閉包值」多次取 `%p` 不保證得到穩定可比對的位址（尤其閉包捕獲了不同的區域變數，如每次 `Assist` 新建的 `sb`/`state`/`mu`）。當比對失敗，`unsub()` 靜默地一個都沒刪（迴圈找不到相符者）。關鍵是 `WantAnalyzer` 是**全域單例**（`want_pool.go:48-63` `For()` 一律回傳 `shared`），它的 `orch.EventBus` 被**所有使用者的每一次 `Assist/Answer/generate` 重複用**。
- **後果**：每處理一個 LLM 請求，shared EventBus 的 `agent.inference` 訂閱者清單就可能多留一個舊 handler 永不移除。之後每次 `Publish`（每個推論事件）都會對**所有歷史遺留的 handler 各開一條 goroutine**（見 B2），且這些舊 handler 還在對早已回傳的舊請求的 `sb`/`state` 做寫入。這是隨請求量線性成長的 goroutine + 記憶體洩漏，並使每次推論的事件廣播成本隨時間放大——長跑必然劣化甚至 OOM。這比先前架構評估提到的「單例序列化」更深一層：序列化只是慢，這個是會累積的洩漏。

### B2. `EventBus.Publish` 對每個事件、每個 handler 都 spawn 一條 goroutine，且與 `defer unsub()` 有 race，舊請求的 callback 會在請求回傳後仍寫入其區域狀態

- **位置**：want `events/event_bus.go:79-88`（`go func(...)` per handler）。消費端：`want_analyzer.go:71-97` 等的 subscriber callback 在 `mu.Lock()` 下寫 `sb`。
- **觸發情境**：即使 B1 的退訂成功，`unsub()` 只是把 handler 從清單移除，**不會等待已經 `go` 出去、正在執行或排隊中的 callback goroutine**。當 `Assist` 因逾時或收到 idle 而 `select` 返回、跑完 `defer unsub()` 後，可能仍有 in-flight 的 `Publish` goroutine 之後才執行那個 callback，對已離開作用域的 `sb`（透過捕獲的 `mu`）寫入。因為每個 callback 都是新 closure、捕獲各自的 `mu/sb`，寫入本身有 `mu` 保護不會 corrupt，但這代表 callback goroutine 的生命週期不受 `Assist` 控制。
- **後果**：goroutine 生命週期不受控，配合 B1 造成累積；屬洩漏而非立即崩潰。

### B3. 90 秒逾時後，持鎖方返回但 agent goroutine 不被取消，下一個請求可正常進入——臨界區的全域狀態發生跨請求資料競爭（見 C1），同時卡住的 agent 仍佔用 shared orchestrator 的單一 dispatch consumer

- **位置**：`want_analyzer.go:212-216`（`select { case <-done: case <-time.After(90*time.Second): }`）；`orchestrator.go:133-160`（單一 consumer goroutine，序列處理 `activationQueue`）。
- **觸發情境**：LLM provider 卡住（vLLM/Gemini 長時間不回，`GenerateStream` 在某一 round 阻塞）。`Assist` 90 秒後返回並釋放 `w.mu` + `recordMu`（都是 `defer`，所以鎖**會**釋放——這點修正了先前架構評估「一旦卡住全站永久排隊」的說法：鎖是放掉的）。但那條 agent goroutine 沒被 cancel，仍佔著 orchestrator 唯一的 dispatch consumer（consumer 要等 `dispatch` 內的 `RunAgent` 回傳才會處理 `activationQueue` 的下一個命令）。
- **後果**：**後續所有使用者的 LLM 請求會塞在 `activationQueue` 裡不被處理**（表面上 `Submit` 沒阻塞、`Assist` 各自等 90 秒後回一個逾時訊息），直到那個卡住的推論自己結束或 provider 逾時。等於一次 provider hang 造成全站 LLM 功能停擺一段時間。若持續有請求進來，`activationQueue`（容量 500）被填滿後，`Submit`（`orchestrator.go:267` `orch.activationQueue <- ...`）會**在持有 `w.mu` 的情況下阻塞**，屆時才真的變成「持鎖阻塞、全站 LLM 永久卡死」。這是一個現成的匿名 DoS 面（公開 editable 連結的 `/v1/public/{token}/assist` 無需登入即可觸發，見 `public_link.go:148`）。

### B4. `activationQueue` 滿載時 `Submit` 在持有 `w.mu`/`recordMu` 下阻塞，把 B3 從「暫時停擺」升級為「持鎖死等」

- **位置**：`orchestrator.go:267`（無 default 的 channel send）、被 `want_analyzer.go:210` 在 `w.mu` + `recordMu` 臨界區內呼叫。
- **觸發情境**：B3 的卡死持續、且湧入超過 500 個排隊請求後。
- **後果**：`Submit` 阻塞 → `Assist` 不返回 → `w.mu`/`recordMu` 永久被持有 → 之後每個 `handleAssist`/`handleQuery` 都卡在 `w.mu.Lock()`。這才是真正的全站永久卡死，且無任何逾時保護能自動脫離（要靠重啟 process）。

### B5. `handleWS` 的讀迴圈生命週期依賴 client 主動關連線；寫入端（Broadcast）無界地 spawn goroutine

- **位置**：`api/ws.go:33-38`（`for { conn.Read(ctx) }`，`ctx` 是 `r.Context()`）。
- **觸發情境**：此路徑本身 OK（client 端 TCP 斷線會讓 `Read` 回 error 而退出）。但沒有 server 端 ping/keepalive，半開連線（client 當機但 TCP 未 FIN）會讓這個 goroutine 與其 Hub 訂閱**永久存活**，直到 OS TCP keepalive（預設數小時）才清掉。對照 `clienttools_ws.go` 有完整的 `startPingLoop` 死連線偵測，`ws.go` 這條正式頻道 WS **沒有**。
- **後果**：半開連線造成 goroutine + Hub map entry 洩漏（每個殭屍連線一份），長期累積。

---

## C. Race condition（不一定馬上出事，但確實是資料競爭）

### C1.（核心 race）`sink.go` 的 13 個 package 全域變數只靠「呼叫方持有 `recordMu`」保護，但寫入者是不受 `recordMu` 生命週期約束的 agent goroutine

- **位置**：`internal/wanttools/sink.go:97-121` 的 `emitCount/emittedIDs/presented/recommendedPlaces` 等；寫入點 `sink.go:247 addPresented`、`sink.go:254 addRecommendedPlaces`、`sink.go:269-270 emit`——**這三個寫入函式本身完全不加任何鎖**，純粹假設「呼叫時 `recordMu` 已被 `Assist`/`Answer` 經 `RecordLock()` 持有」。
- **關鍵驗證**：正常情況下，工具（寫這些全域）跑在 idle 事件**之前**的 round（`query.go:143-154`：只有「沒有工具呼叫的 round」才發 idle），而 `Assist` 是收到 idle + 等 1500ms 才關 `done` 返回。所以 happy path 下寫入確實都發生在 `RecordUnlock` 之前，**沒事**。但——
- **觸發情境**：B3 的逾時路徑。`Assist` 在 90 秒逾時後返回、跑 `defer RecordUnlock()`，agent goroutine 仍在跑；之後該 agent 又執行了一次 `record_entry`/`present_entries`/`recommend_nearby`，對 `emitCount++`、`emittedIDs = append(...)`、`presented = append(...)` 做寫入。與此同時**下一個請求**已經 `RecordLock()`（把這些全域 reset 成 0/nil）並開始它自己的讀寫。兩條 goroutine 對同一組 `int`/`slice`/`map` 無同步併發讀寫 = 資料競爭：計數錯亂、slice append 撞車可能導致底層陣列踩踏、甚至前一個請求寫入的 entry ID 被算進後一個請求的 `EmittedIDs()` 回給錯誤的頻道/使用者。
- **後果**：資料錯亂（entry 歸錯 message/頻道）、`-race` 下必報、極端情況 slice 底層陣列競爭造成不可預期行為。跨使用者資料串味是這裡最嚴重的實際後果。

### C2. `orch.SetSessionEnvs` / `SetPromptBuilder` 的「設定→Submit→讀取」跨越 `w.mu` 但 envs 讀取在另一條 goroutine

- **位置**：`want_analyzer.go:177,180`（在 `w.mu` 下設 `SetSessionEnvs`/`SetPromptBuilder`）；want `orchestrator.go:145-155`（dispatch goroutine 讀 `sessionEnvs`，有 `sessionEnvsMu` 保護）、`orchestrator.go:49-51`（`SetPromptBuilder` **無鎖**寫 `orch.promptBuilder`，dispatch goroutine 於 `orchestrator.go:153-155` 無鎖讀）。
- **觸發情境**：`sessionEnvs` 這半有 `sessionEnvsMu` 保護，靠 `w.mu` 序列化「設定→Submit」也對（單例被序列化）。但 `promptBuilder` 欄位在 want 內部**讀寫都沒有鎖**：若因 B3 逾時，舊 agent goroutine 尚未讀取 `promptBuilder`，新請求的 `SetPromptBuilder` 已覆寫，舊推論會用到新的 prompt builder（語言錯亂）；更根本地，這是一個無同步的欄位讀寫 race。
- **後果**：回答語言/system prompt 串到別的請求；`-race` 下對 `orch.promptBuilder` 報 race。屬跨請求污染，發生條件同 B3。

### C3. `Broadcast` 對每個訂閱者 `go conn.Write(...)`，寫入已關閉連線只回 error（不 panic），但完全無界且錯誤被丟棄

- **位置**：`api/hub.go:45-48`。
- **觸發情境**：對已 `CloseNow()` 的連線 `Write`，`nhooyr.io/websocket` v1.8.17 回 `net.ErrClosed`（已查證 `write.go:257-315`，不 panic）；且該版本文件保證「所有方法可併發呼叫、同時只允許一個 writer」，故不會 corrupt。但 `go conn.Write(...)` 的回傳值被直接丟棄，寫入失敗無人知曉；高頻廣播 + 慢連線時，每則事件對每個連線都開一條 goroutine，無上限。
- **後果**：非崩潰，但慢連線下 goroutine 短時間暴增；寫入錯誤靜默吞掉（斷線的 client 收不到、也不會被清理，與 B5 疊加）。

---

## D. clienttools `pendingCalls` 機制專項分析

這是全 repo 註解最完整、設計最嚴謹的一塊，**經逐行驗證，基本正確**，但有兩個真實邊界問題：

### D1.（真實邊界問題，非 panic）`select` 隨機選擇可能導致工具結果被誤判逾時

- **位置**：`clienttools_ws.go:285-306`（`handleToolResult`：持 `s.mu` 取出並 `delete`，解鎖後 `ch <- p; close(ch)`）vs `clienttools_ws.go:339-353`（`AskInteraction` 逾時分支：持 `s.mu` `delete(s.pendingCalls, requestID)`）。
- **實際安全性驗證**：channel 是 `make(chan ..., 1)`（buffer 1，`clienttools_ws.go:324`），且兩邊都用 `s.mu` 保護「查表 + delete」，`handleToolResult` 只有在**成功從 map 取出**（`ok==true`）時才會 `ch <- p; close(ch)`。逾時分支也持鎖 delete。因為 map 的 take/delete 是互斥的，同一個 requestID 只會被其中一方成功取走一次——所以**不會 double-close，也不會對 close 過的 channel 送值**。這部分是對的。
- **殘留風險（競態但不 panic）**：`AskInteraction` 的 `select`（`clienttools_ws.go:339`）在「`time.After` 已觸發」與「`handleToolResult` 剛好同時 `ch <- p`」之間，Go 的 `select` 若兩個 case 同時 ready 會**隨機選一個**。若選了逾時分支，`handleToolResult` 那邊因為已經成功 take（它先持鎖 delete 了）會走 `ch <- p`（buffer 1，不阻塞）然後 `close(ch)`——此時沒有 receiver，但 buffered send + close 不會 panic，channel 被 GC。**結論：不 panic，但那次工具呼叫的結果被丟棄，LLM 收到「page didn't answer」逾時錯誤，即使 client 其實有回。**屬正確性瑕疵，非崩潰。
- **後果**：低。邊界時序下工具結果偶爾被誤判逾時。設計本身用 buffer-1 + 雙邊持鎖 take 規避了 panic，值得肯定。

### D2. client 斷線 / 送格式錯誤的回應時，等待方靠 `clientToolsInteractionTimeout`（20s）脫困——已驗證確實有 timeout 保護，不會永久阻塞

- **位置**：`clienttools_ws.go:322-353`（`AskInteraction` 的 `select` 含 `case <-time.After(clientToolsInteractionTimeout)`）。
- **驗證**：若 client 斷線，`run` 的 `Read` 回 error → `runClientToolsSession` 的 `defer clienttools.UnregisterAsker(s.id)` + `defer sessions.remove(s)` 執行，但**已經 in-flight 的 `AskInteraction` 不會被主動喚醒**（斷線不會對 `pendingCalls` 的 channel 送值）——它靠 20 秒 `time.After` 脫困。若 client 送格式錯誤的 `tool_result`，`handleToolResult` 在 `json.Unmarshal` 失敗時 `sendError` 後 `return`（`clienttools_ws.go:287-290`），**不會**送值到 channel，那個 `AskInteraction` 同樣等滿 20 秒逾時。
- **後果**：不會永久卡死（有 20s timeout），但斷線後仍要空等最多 20 秒。可接受，但註解宣稱的即時性在斷線情境下不成立。

### D3.（單例 + 全域 asker registry 的跨 session 污染）`clienttools.askers` 是 package 全域 map，`current()` 用「最近連線者」；多分頁時 `trip_entry_*` 可能轉發到錯的分頁

- **位置**：`clienttools/interaction.go:65-92`（全域 `askers`，有 `askersMu` 保護，map 存取安全）；`clienttools_sessions.go:44-53`（`current()` 回「最近連線的那個」）；`clienttools_ws.go:95` 每個連線用 `s.id` 註冊。
- **觸發情境**：map 本身有鎖、無 race。但 `handleAssist`（`api.go:480`）把前端傳來的 `clientToolsSessionID` 經 `SetSessionEnvs` 交給工具，工具用它 `lookupAsker`。若使用者開兩個分頁，各自有不同 `cts_` session，而 assist 請求帶的是 A 分頁的 sessionID、`ClientToolsAnalyzer` 卻是**跨所有分頁共用的單例**（`clienttools_agent.go:89` + `main.go:161` 全域一份，`Prompt` 用 `c.mu` 序列化），B 分頁同時發 assist 會排隊等 A 跑完（90 秒級）。文件已自陳「single-tab-at-a-time」，屬已知限制。
- **後果**：多分頁下 LLM 對話互相排隊（非崩潰）；sessionID 綁定正確時不會轉發到錯分頁，但兩個分頁共用一條 90 秒序列化管線。

---

## E. Mutex 使用正確性盤點

大致良好，**未發現漏 unlock 或典型 AB/BA 死鎖**，但有一處鎖語意標示與實際不符：

- **無漏 unlock**：所有 `sync.Mutex/RWMutex` 的持鎖-釋放大多用 `defer`（`task_store.go`、`hub.go`、`clienttools_sessions.go`、`toolschema/registry.go`、`clienttools/interaction.go`、`mock_analyzer.go`、`mockllm/server.go` 全部正確）。少數手動 `Unlock`（`want_analyzer.go:218-220,313-315`、`clienttools_ws.go:225-227,292-297,326-328,349-351`）都在同一函式內線性配對，無提前 return 漏放，驗證無誤。
- **`sink.go` 的 `RecordLock/RecordUnlock`**：`want_analyzer.go:172-173,270-271` 用 `defer RecordUnlock()`，所以 panic/逾時都會釋放——**不會**永久持鎖（修正先前架構評估的說法）。但釋放後 agent goroutine 仍可寫全域，才是真問題（見 C1）。
- **無巢狀鎖死鎖**：`Assist` 依序 `w.mu.Lock()` → `RecordLock()`（`recordMu`），全 codebase 沒有任何地方以相反順序（先 `recordMu` 再 `w.mu`）加鎖，故無 AB/BA 死鎖。`recordMu` 是 package 全域單鎖、`w.mu` 是單例的鎖，兩者永遠同序，安全。
- **RWMutex 讀/寫鎖用法**：`hub.go`（`Broadcast` 用 `RLock`、subscribe/unsubscribe 用 `Lock`）、`toolschema/registry.go`（讀 `RLock`、`Reload` 用 `Lock`）、`clienttools/interaction.go`（lookup 用 `RLock`、register/unregister 用 `Lock`）——讀寫分級都正確。唯一問題是 `hub.go` 的 `Broadcast` 在 `RUnlock` 後才用取出的內層 map 參照做遍歷（見 A3），那不是「該用寫鎖卻用讀鎖」，而是「鎖範圍沒涵蓋到實際併發存取的遍歷動作」。

---

## 全域可變狀態盤點

| 全域變數 | 位置 | 保護 | 判定 |
|---|---|---|---|
| `sink/notifyFn/…/emitCount/emittedIDs/presented/recommendedPlaces` | `wanttools/sink.go:97-121` | `recordMu`，但寫入函式本身不加鎖、靠呼叫方持鎖 | **C1 race**：逾時後跨請求競爭 |
| `tasks`（`taskStore`） | `wanttools/task_store.go:39` | 自帶 `s.mu`，所有方法 `defer` 加鎖 | 安全 |
| `kindRegistry` | `wanttools/kindspec.go:25` | 無鎖 | 只在 `init()` 寫、執行期唯讀 → 安全 |
| `entryStore` | `wanttools/entry_query.go:23` | 無鎖 | 啟動時 `BindStore` 寫一次、之後唯讀 → 安全 |
| `tripService` | `wanttools/trip/init.go:12` | 無鎖 | 同上，啟動寫一次 → 安全 |
| `askers` | `clienttools/interaction.go:67` | `askersMu`（RWMutex） | 安全 |
| `whenParser` | `wanttools/parsetime.go:15` | 無鎖 | 見下方註記 |
| want `GlobalEngine/GlobalEventBus/GlobalSessionStorage/GlobalToolbox/defaultAgentLoader` | want 函式庫 | 部分有鎖 | 單例，啟動初始化；`GlobalEventBus` 未被 tripace 直接用（tripace 用 per-orch 的 `orch.EventBus`） |

**`whenParser` 補充**：`parsetime.go:15` 是 `var whenParser = func() *when.Parser {...}()`（package init 時建一次），被 `resolveDate` 在 `entry_query` 等工具的 goroutine 上併發呼叫 `whenParser.Parse(...)`。`when` 函式庫的 `Parser.Parse` 是否 goroutine-safe 未知——若其內部有可變狀態，這會是一個隱藏 race。本次未深入 `olebedev/when` 原始碼確認，**不列為確定發現，僅列為待查項目**。

---

## goroutine 建立點盤點（生產路徑）

| 位置 | panic 會否崩潰 | 生命週期受控？ | context 取消？ |
|---|---|---|---|
| `orchestrator.go:133/206/220`（want dispatch/publish/agent） | **會崩潰**（A1，無 recover） | **否**，逾時不 cancel（B3） | 否，tripace 不傳 request ctx |
| `event_bus.go:80`（每事件每 handler） | 有 recover（不崩潰） | **否**，累積（B1/B2） | 否 |
| `hub.go:47`（`go conn.Write`） | 不崩潰（回 err） | 一次性，但無界（C3） | `context.Background()`，不受控 |
| `ws.go:33` 讀迴圈（HTTP handler goroutine） | Read 錯誤即退 | 半開連線洩漏（B5） | 用 `r.Context()`，client 斷線才退 |
| `clienttools_ws.go:162`（ping loop）、`:204`（handlePrompt） | 無 recover，但邏輯簡單少 panic 面 | 受控（`done`/ctx） | 是，`ctx` = request ctx |
| `tripsvc.go:83`（geo 補經緯度） | 無 recover；`SetEntryLatLng`/GORM panic 會崩潰 | 受控（自帶 5s timeout） | 自建 `context.WithTimeout`，不隨請求取消（fire-and-forget，設計如此） |
| `want_analyzer.go:91/204/299`、`clienttools_agent.go:190`（1500ms settle） | 無 recover，但只 `time.Sleep`+`once.Do(close)`，無 panic 面 | 受控（`once` 保證只 close 一次） | 否，但 1.5s 後自然結束 |
| `adminconsole/health.go:68/78` | 無 recover；但 `runOne`/probe 都回 error 不 panic | 受控（WaitGroup + overallCtx） | 是 |

**`tripsvc.go:83` 補充**：這條 fire-and-forget goroutine 若 `s.geo.Lookup` 或 `s.st.SetEntryLatLng` panic，會崩潰整個 process（無 recover）。觸發需 GORM/HTTP client 在特定錯誤下 panic，機率低但存在，且它與主請求解耦、崩潰時毫無關聯線索，排查困難。

---

## 與先前架構評估的差異

[architecture-review-2026-07.md](./architecture-review-2026-07.md) 中「want 引擎單例卡死會讓全站永久排隊」的說法，經本次逐行驗證需要修正：

- `w.mu` 與 `recordMu` **都用 `defer` 釋放**，90 秒逾時後鎖確實會被放掉，不是永久持有。
- 但這不代表沒事：鎖放掉之後，沒被取消的 agent goroutine 仍在背景跑，一邊佔用 orchestrator 唯一的序列化 consumer（B3），一邊繼續寫已經被下一個請求 reset 過的全域狀態（C1）。
- 真正會導致「永久持鎖、全站死鎖」的情境，是 B3 疊加 B4：卡住的 agent 持續佔用 consumer，同時湧入請求把 `activationQueue`（500 容量）填滿，此時 `Submit` 才會在持鎖狀態下真正阻塞。這比原始評估描述的「一卡就永久卡死」門檻更高，但一旦達到，後果相同且同樣需要重啟 process 才能恢復。

---

## 總結：最需要優先注意的三條

1. **A3（`Hub.Broadcast` 併發 map iteration/write → fatal error）與 A1/A2（want 工具鏈無 recover → 任一 panic 崩潰）**：這兩類會讓**單一使用者操作打掛整台 server**，且 Cloud Run 無 panic recovery middleware 兜底（全 repo 零 `recover()`）。
2. **B1（EventBus 退訂靠函式指標比較，實務退訂失敗）+ B2/B3（逾時不取消 agent）**：shared 單例 orchestrator 上訂閱者與 goroutine 隨請求量無限累積，長跑必然劣化；疊加 provider hang 時 `activationQueue` 填滿會升級成 **B4 持鎖永久卡死**。
3. **C1（`sink.go` 全域狀態跨請求資料競爭）**：逾時窗口內舊 agent 與新請求同時讀寫 13 個無鎖全域，會造成**跨使用者/跨頻道的 entry 資料串味**，是正確性層級最嚴重的問題，且 `-race` 下必現。

---

*本報告為唯讀分析，未修改任何檔案。所有 want 函式庫的行為均以 `~/go/pkg/mod/github.com/tim72117/want@v0.0.2/` 的實際原始碼驗證，非臆測。*
