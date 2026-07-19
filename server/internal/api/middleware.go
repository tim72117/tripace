package api

import (
	"crypto/subtle"
	"log"
	"net/http"
	"os"
	"time"
)

// logging 記錄每個請求的方法、路徑與耗時。
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

// cors 開放跨來源請求,供本機 web 測試台(Vite dev server,不同 port)呼叫。
// 僅供開發使用:放行所有來源,並回應 preflight。正式環境應收斂 Allow-Origin。
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
// 沒有這層驗證,任何知道 entryID/channelID 的人都能直接打 /internal/* 繞過
// /v1/* 的權限檢查(例如繞過 requireOwner 清空任意頻道)。
//
// INTERNAL_API_TOKEN 未設定時:本機開發預設放行(維持 CLI 免設定即可用的體驗),
// 並在啟動時記一次警告;正式環境部署務必設定,否則等同完全不設防。
func internalAuth(next http.Handler) http.Handler {
	token := os.Getenv("INTERNAL_API_TOKEN")
	if token == "" {
		log.Printf("[警告] INTERNAL_API_TOKEN 未設定,/internal/* 端點目前不受保護(僅建議本機開發使用)")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			got := r.Header.Get("X-Internal-Token")
			if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
				http.Error(w, `{"error":"unauthorized","message":"缺少或錯誤的 X-Internal-Token"}`, http.StatusUnauthorized)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
