# clienttools 前端架構設計筆記

> 2026-07-20,對 `web/src/clienttools/` 這批「LLM 呼叫前端 tool」技術試做(POC)做的一次設計檢視。記錄已辨識的設計模式、已修復的問題、以及尚未處理但值得記住的架構決策點。核心程式碼在 `web/src/clienttools/ClientToolsBridge.ts`,搭配 `web/src/clienttools/tools/` 底下各工具檔案。

## 目前的分層與設計模式

```
純邏輯層    tools/tripEntryAdd.ts 等   addTripEntry(entries, args) → 新 entries
              │  (純函式,可單獨測試,不依賴 ClientTool/React)
接線層      tools/*.ts 的 ClientTool   name + handle(args, ctx)
              │  (宣告「我是誰、我怎麼執行」)
傳輸層      ClientToolsBridge.ts       WS 生命週期、協定解析、查表分派
              │  (callback 通知外部,不認識 React)
呈現層      ClientToolsDemo.tsx        純渲染,callback 接進 setState
```

可辨識的四個設計模式,都是有實際理由才用,不是為了模式而模式:

1. **控制反轉(IoC)+ Registry**:`ClientToolsBridge` 不認識任何具體工具,建構子收 `ClientTool[]`、轉成查表用的 Record,重複名稱時 fail-fast(見 `ClientToolsBridge.ts` 建構子)。這跟後端 `toolschema.NewRegistry` 讀 YAML 形成對稱——後端宣告「LLM 看到什麼」,前端宣告「實際執行什麼」,工具名稱字串是兩邊的契約。
2. **最小權限介面(`ToolContext`)**:工具只拿得到 `getEntries`/`setEntries` 兩個口子,碰不到 WS 連線、log、callbacks。
3. **Observer**:六個 callback(`onStatusChange`/`onToolNamesChange`/`onEntriesChange`/`onAssistantText`/`onLog`/`onBusyChange`)單向通知外部,class 完全不知道外面是不是 React。
4. **Pure core, imperative shell**:副作用(`setEntries`、WS send)全部收在殼層,計算全部在純函式(`tools/*.ts` 裡各自 export 的純函式)。

拆成 class 之後一個附帶的好處:`entries` 變成同步的單一來源,原本 React 版靠 `entriesRef` 繞開 state 閉包過期問題的 workaround 因此自然消失(競態顧慮不再存在)。

## 已修復的問題

- **busy 狀態實質失效**:`pushLog` 尾端「log 一有新項目就解除 busy」的判斷原本沒分方向,自己送出的 log 也會觸發,導致 `busy` 只存在幾微秒。修法:只有 `dir === 'in'`(後端傳來的訊息)才解除 busy。
- **前後端工具清單飄移沒有連線時檢查**:後端 `ack.toolNames`(來自 YAML)與前端 handlers(來自 `defaultClientTools`)靠名稱字串對齊,原本沒有任何一致性檢查,飄移只會在 LLM 真的呼叫時才爆(浪費一輪真實推論)。修法:收到 `ack` 時做雙向差集比對,不一致時記一條警告 log。

## 尚未處理、留待未來的架構決策點

### 1. Bridge 的「通用性」目前只做了一半——註冊是通用的,狀態不是

工具可以自由註冊進 bridge,但 `ToolContext` 目前只開放 `TripEntry[]` 這一種狀態(`getEntries`/`setEntries`)。如果之後要加一個操作地圖標記、使用者偏好、或其他跟「行程清單」無關的狀態的工具,`ctx` 沒有位置給它。

這是一個岔路口,目前**刻意選擇維持現狀**,原因:POC 現有四個工具都操作同一份清單,提前把 `ToolContext` 設計成通用狀態容器是過度工程,會在還沒有真實需求時猜測未來形狀。

兩條可能的路線,供未來真的出現第二種狀態需求時參考:

- **路線 A(現狀)**:承認這是「行程清單專用 bridge」,`ToolContext` 就叫這個用途,簡單誠實。缺點是加新種類的狀態要改 `ToolContext` 型別定義與 bridge 內部實作。
- **路線 B**:狀態所有權下放給工具自己——每個 `ClientTool` 帶自己的狀態閉包(例如用模組層級變數或工具自己建立的一個小 store),bridge 徹底退化成純傳輸層,`ctx` 變成可選的通用服務(例如只提供 `pushLog`、`send` 這類跟協定相關而非跟業務資料相關的能力)。優點是 bridge 真正不需要知道任何業務資料形狀;缺點是失去「entries 是同步單一來源」這個目前拆成 class 才拿到的好處,每個工具要自己管競態。

**建議**:等真的有第二種狀態需求出現時,再評估要不要往路線 B 走,不要提前做。

### 2. 未來轉正式產品路徑前該處理的項目

這些不是 POC 現階段的缺陷,是「如果這條路徑要接上正式產品」才需要投入的健壯度,現有程式碼註解已經明講是刻意省略的(參照移植來源 agent 專案的 `AgentBridge` 有這些機制,這裡拿掉了):

- **WebSocket 重連與 backoff**:目前斷線後不會自動重連,`status` 變成 `closed` 後使用者只能重新整理頁面。
- **離線 beacon 回報**:連線中斷時沒有任何告知後端「這個 session 已經離開」的機制。
- **quota/rate limit 錯誤處理**:`sendPrompt`/`sendTestPrompt` 目前只處理連線層級的失敗(WS 未開啟、fetch 失敗),沒有處理後端可能回傳的配額或限流錯誤。
- **從 YAML 產生 TypeScript 參數型別**:`server/internal/toolschema/schema.go` 的 `Tool.Returns` 欄位當初設計時就註記了「用於 TS codegen」的用途,但目前完全沒有實作這個 codegen——每個工具檔案裡的 `args: Record<string, unknown>` 都要手動用 `asString` 等 helper 轉型,沒有編譯期型別檢查保護「YAML 改了參數名稱、前端忘記同步改」這種情況。

### 3. 小問題,不急但值得記住

- `sendPrompt` 裡的 90 秒保底計時器(`window.setTimeout`)沒有存下 timer id,`disconnect()` 不會取消它——舊 bridge 實例的計時器最終還是會對已經 disconnect 的 callback 開火(React 18 下因為 callback 通常已經沒有對應的 mounted 元件而無實際影響,但不是乾淨的資源管理)。
- 收到未知的 `env.type` 時(switch 沒有對應 case)目前靜默忽略,對一個 debug 工作台來說,`pushLog` 出來反而更有助於之後排查協定不符的問題。
- `setBusy` 是無狀態直通(不像 `status`/`entries`/`log` 有存成 class 私有欄位再透過 callback 通知),這個風格上的不一致本身無害,但如果之後 bridge 需要「讀取目前 busy 狀態」這種需求,會發現這個欄位其實不存在。
