package api

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/tim72117/tripace/internal/auth"
)

// statusRecorder 包住 http.ResponseWriter,記錄實際寫出的狀態碼——
// http.ResponseWriter 本身不提供「這次回應到底是什麼狀態碼」的讀取
// 介面,requestLogging 要把狀態碼寫進 api_request_logs 就必須自己攔截
// WriteHeader() 的呼叫。若 handler 從未明確呼叫 WriteHeader(例如只呼叫
// Write() 就結束),依 net/http 的預設行為視為 200,同 status 欄位的
// 初始值。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Hijack 讓 statusRecorder 滿足 http.Hijacker 介面,把呼叫原封不動轉發給
// 底層真正的 ResponseWriter——net/http 的 WebSocket upgrade(不論是
// nhooyr.io/websocket 或任何走 http.Hijacker 的實作)需要拿到底層 TCP
// 連線的讀寫控制權才能完成 101 Switching Protocols 交握。statusRecorder
// 是自訂的 wrapper struct,預設不會自動滿足這個介面(Go 的 interface
// 滿足是結構性的,wrapper 本身沒有 Hijack 方法就是沒有),沒有這個轉發
// 方法時,任何試圖對 statusRecorder 做型別斷言 w.(http.Hijacker) 的
// 呼叫都會失敗,導致所有經過 requestLogging 這層 middleware 的 WebSocket
// 端點(含既有的 /v1/trips/{id}/ws,見 handleWS)在完成 upgrade 前就被
// 擋下來,回應 501 Not Implemented——這是實測發現的問題,不是理論推測:
// 開發 AI 規劃時間軸的模擬推論 WebSocket(保存在 plan-ai-sim 分支)時第
// 一次連線就踩到,回頭檢查發現 statusRecorder 這層從一開始就缺少這個轉發,
// 推測既有的 handleWS 之所以沒被注意到同樣的問題,可能是測試環境較少對它
// 做端對端的連線驗證。這個修正因此不只服務那個模擬端點,既有的聊天
// WebSocket 也一併受惠。
//
// 底層 ResponseWriter 若本身不支援 hijack(例如某些測試用的
// httptest.ResponseRecorder),回傳 net/http 標準的
// ErrNotSupported——呼叫端(這裡是 websocket.Accept)本來就會處理這個
// 錯誤,不需要在這裡做額外的降級處理。
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("statusRecorder: 底層 ResponseWriter 不支援 http.Hijacker: %w", http.ErrNotSupported)
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return conn, rw, err
	}
	// 2026-09(code review 發現):Hijack 成功後,接下來的雙向資料交換
	// 完全繞過 http.ResponseWriter(呼叫端直接操作拿到的 net.Conn),
	// WriteHeader 永遠不會再被呼叫——status 欄位會停留在建構時的初始值
	// (呼叫端目前一律傳 http.StatusOK,見 requestLogging 建立
	// statusRecorder 那行),導致 WebSocket upgrade 請求在 api_request_logs
	// 裡被記成 200,不是實際發生的 101 Switching Protocols。Hijack 本身
	// 成功就代表 upgrade 交握完成到可以接手連線的地步,在這裡明確記錄
	// 101,讓日誌反映真實狀態,不需要 handler 自己額外處理記錄邏輯。
	r.status = http.StatusSwitchingProtocols
	return conn, rw, nil
}

// requestLogging 記錄每個請求的方法、路徑、狀態碼、耗時與呼叫者,同時
// 印到 log(維持既有行為)並寫入 api_request_logs 資料表(見
// store.LogAPIRequest/apiRequestLogRow 的說明)——涵蓋這個 server 收到
// 的所有請求,不限於 /internal/geo/* 這幾支之前排查 Photo Media 重複
// 呼叫問題時關注的端點。
//
// 寫入資料庫用獨立 goroutine,不擋在回應路徑上——這支 middleware 包住
// 每一個請求,若同步寫 DB,會讓「記錄一筆 log」的延遲疊加到「使用者
// 實際等待回應」的時間上,而記錄本身失敗與否不該影響這次請求是否成功;
// 高流量情境下這裡會產生大量並發的短命 goroutine 與 DB 寫入,是已知的
// 效能取捨,目前資料量/流量規模下可接受,之後有需要可以改成批次寫入
// 或加緩衝佇列。
//
// userFor(r) 只依賴 Authorization header,呼叫時機在請求進入路由前
// (mux 判斷路徑之前),與 /internal/* 路由本身各自的 internalAuth 驗證
// 各自獨立、不互相影響——這裡拿到的身分只用於記錄,不做任何授權判斷。
func (s *Server) requestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		duration := time.Since(start)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, duration.Round(time.Millisecond))

		method, path, status, durationMs := r.Method, r.URL.Path, rec.status, duration.Milliseconds()
		userID := s.userFor(r).ID
		go func() {
			if err := s.store.LogAPIRequest(method, path, status, durationMs, userID); err != nil {
				log.Printf("api request log 寫入失敗: %v", err)
			}
		}()
	})
}

// cors 開放跨來源請求,供本機 web 開發伺服器(Vite dev server,不同 port)呼叫。
// 目前放行所有來源並回應 preflight——**正式環境應收斂 Allow-Origin 為白名單**,
// 這是已知待處理項目,不應僅視為開發階段的暫時設定。
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// internalAuth 保護 /internal/* 路由:這組端點直接呼叫 store/tripsvc,不像
// /v1/* 有 requireOwner/requireEditor/requireMember 檢查(見 api.go 各 handler),
// 設計上只給 CLI(cmd/cli)/自動化腳本用,不該被前端使用者或外部呼叫者觸及。
// 但 /internal/ 與 /v1/ 掛在同一個對外 port,路徑命名本身不構成安全邊界——
// 沒有這層驗證,任何知道 entryID/tripID 的人都能直接打 /internal/* 繞過
// /v1/* 的權限檢查(例如繞過 requireOwner 清空任意行程)。
//
// 驗證方式與 /v1/* 一般使用者相同:解析 Authorization: Bearer <token>,用
// signer.Verify 驗證這是一把有效的自家 JWT(見 internal/auth.Signer)。CLI 端
// 透過 `tripace-cli login --web` 走瀏覽器核准流程換到這個 JWT(見
// cmd/cli/login.go、/v1/cli-auth/* 端點),不再有任何「環境變數沒設定就整段
// 跳過驗證放行」的分支——舊版用共享密鑰 INTERNAL_API_TOKEN/X-Internal-Token
// 的機制已完全移除:那個機制在正式環境未設定該環境變數時會直接不設防,已確認
// 正式環境(Cloud Run tripace-server)實際上就處於這個狀態,任何人都能不登入
// 直接讀寫刪除任意行程資料;改用 JWT 後不存在「忘記設定就等於不設防」這種
// 失效模式,驗證失敗一律回 401。
func internalAuth(signer *auth.Signer, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, err := auth.ParseBearer(r.Header.Get("Authorization"))
		if err != nil {
			// 2026-09:原本用 http.Error 手寫
			// {"error":"unauthorized","message":"..."}(error 是字串),
			// 跟全站其餘端點一律透過 writeErr 產生的
			// {"error":{"code":"...","message":"..."}}(error 是物件)
			// 格式不一致——前端 api.ts 的 errBody?.error?.message 是
			// 針對物件形狀寫的,對這種字串形狀的 error 欄位永遠讀不到
			// message,顯示訊息會 fallback 成籠統的「HTTP 401」,使用者
			// 完全看不到後端真正想表達的內容。改用 writeErr 統一格式。
			writeErr(w, http.StatusUnauthorized, "unauthorized", "缺少或格式錯誤的 Authorization: Bearer token")
			return
		}
		if _, err := signer.Verify(token); err != nil {
			// 訊息原本寫死指向「請先執行 tripace-cli login --web
			// 登入」,誤導性——這句提示只對 CLI 呼叫端有意義,但
			// /internal/* 這組端點同時也被登入版前端直接呼叫(見本函式
			// 開頭的完整說明:CLI 與一般使用者共用同一套 JWT 驗證),
			// 一般使用者的瀏覽器 session 過期時看到這句話會被導向一個
			// 他們不可能、也不該執行的 CLI 指令。改成不預設呼叫端身分
			// 的中性措辭,前端可依此判斷「需要重新登入」並導回登入頁
			// (見 web/src 對 401 的全域攔截)。
			writeErr(w, http.StatusUnauthorized, "unauthorized", "登入已過期,請重新登入")
			return
		}
		next.ServeHTTP(w, r)
	})
}
