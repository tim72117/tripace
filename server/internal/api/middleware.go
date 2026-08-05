package api

import (
	"log"
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
			http.Error(w, `{"error":"unauthorized","message":"缺少或格式錯誤的 Authorization: Bearer token"}`, http.StatusUnauthorized)
			return
		}
		if _, err := signer.Verify(token); err != nil {
			http.Error(w, `{"error":"unauthorized","message":"token 無效或過期,請先執行 tripace-cli login --web 登入"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
