package api

import (
	"net/http"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/model"
)

// POST /v1/cli-auth/start
// Body: { "redirectUri": "http://127.0.0.1:<port>/callback", "name": "..." }
// 不需登入:這是 `tripace-cli login --web` 整個流程最一開始的呼叫,CLI 此時
// 還沒有任何憑證。redirectUri 須為 loopback 位址(store 層會驗證,見
// store.StartCliAuth),否則回 400。回傳的 id 是唯一之後會出現在網址裡的東西
// ——CLI 印給使用者、開瀏覽器帶去的核准頁面網址只帶這個 id,從不帶
// redirectUri 本身,詳細理由見 internal/store/cliauth.go 開頭的說明。
func (s *Server) handleStartCliAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RedirectURI string `json:"redirectUri"`
		Name        string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	id, err := s.store.StartCliAuth(body.RedirectURI, body.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_redirect_uri", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// GET /v1/cli-auth/{id}
// 不需登入:核准頁面(web/src/CliAuthPage.tsx)載入時,用網址上的 id 呼叫這個
// 端點取得要顯示的 CLI 名稱(「XXX CLI 想要登入」)。id 不存在或已過期回 404
// ——這種情況通常代表連結已用過或使用者拖了超過 10 分鐘才點開。
func (s *Server) handleGetCliAuth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name, ok := s.store.CliAuthName(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "cli_auth_not_found", "此登入連結不存在或已過期")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"name": name})
}

// POST /v1/cli-auth/{id}/approve
// 必須是真正已登入的使用者:核准的當下要簽出一把交給 CLI 的新 JWT,若接受
// s.userFor(r) 在缺 header/token 無效時靜默回退的訪客身分,會讓未登入的
// 訪客也能「核准」出一把可用的 token——所以這裡刻意不用 s.userFor,而是照
// handleMe 的作法自己解析 Authorization、驗證失敗一律回 401,絕不落回訪客
// (見 authenticatedUserForApproval,device code 流程的
// handleApproveDeviceAuth 共用同一份檢查)。核准成功後回傳 CLI 本地伺服器的
// redirectUri,前端據此把瀏覽器導過去、帶上 ?code={id},讓 CLI 的本地
// callback 伺服器能用這個 id 呼叫 exchange 取得剛剛簽好的 token。
func (s *Server) handleApproveCliAuth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	user, ok := s.authenticatedUserForApproval(w, r)
	if !ok {
		return
	}

	cliToken, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "sign_failed", err.Error())
		return
	}

	redirectURI, ok := s.store.ApproveCliAuth(id, cliToken)
	if !ok {
		writeErr(w, http.StatusNotFound, "cli_auth_not_found", "此登入連結不存在、已過期或已被核准過")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"redirectUri": redirectURI})
}

// authenticatedUserForApproval 是 handleApproveCliAuth/handleApproveDeviceAuth
// 共用的身分驗證邏輯(見 handleApproveCliAuth 上方註解說明的理由:核准動作
// 要簽出新 token,不能接受訪客身分)。驗證失敗時已經自己寫好對應的錯誤
// 回應,呼叫端只需要在 ok 為 false 時直接 return,不需要再另外處理 http
// 回應。
func (s *Server) authenticatedUserForApproval(w http.ResponseWriter, r *http.Request) (model.User, bool) {
	token, err := auth.ParseBearer(r.Header.Get("Authorization"))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "no_token", "缺少 Authorization,請先登入")
		return model.User{}, false
	}
	claims, err := s.signer.Verify(token)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_token", "token 無效或過期,請重新登入")
		return model.User{}, false
	}
	user, err := s.store.FindUserByID(claims.Sub)
	if err != nil {
		// token 簽章有效,但對應使用者已不存在於資料庫——不能像訪客那樣放行
		// (見上方註解,這裡刻意不接受訪客核准是有意的例外設計),也不能偽造
		// 一個假身份繼續簽發新 token,那會讓一個查無此人的身份無限循環延續
		// 下去。一律要求重新登入取得對應真實使用者的新 token。
		writeErr(w, http.StatusUnauthorized, "user_not_found", "使用者不存在,請重新登入")
		return model.User{}, false
	}
	return user, true
}

// POST /v1/cli-auth/device/start
// Body: { "name": "..." }
// 不需登入,理由同 handleStartCliAuth:這是 `tripace-cli login --device`
// 整個流程最一開始的呼叫,CLI 此時還沒有任何憑證。跟 handleStartCliAuth
// 的差異是不需要(也不接受)redirectUri——device code 流程沒有本機 callback
// 伺服器這回事,見 store.StartDeviceAuth 的說明。回應同時帶 deviceCode(CLI
// 自己留著輪詢 exchange 用)與 userCode(印給使用者看、手動輸入用),兩者
// 用途不同、絕不能混用:userCode 才是唯一會出現在畫面/使用者輸入框裡的值。
func (s *Server) handleStartDeviceAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	deviceCode, userCode, err := s.store.StartDeviceAuth(body.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "start_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"deviceCode": deviceCode, "userCode": userCode})
}

// GET /v1/cli-auth/device/{userCode}
// 不需登入:/device 核准頁面(web/src/DeviceAuthPage.tsx)載入時,用使用者
// 手動輸入(或網址帶入預先填好)的 userCode 呼叫這個端點取得要顯示的 CLI
// 名稱(「XXX CLI 想要登入」)——對應 handleGetCliAuth,差別只在查詢鍵是
// userCode 而非 id。userCode 不存在或已過期回 404。
func (s *Server) handleGetDeviceAuth(w http.ResponseWriter, r *http.Request) {
	userCode := r.PathValue("userCode")
	name, ok := s.store.DeviceAuthName(userCode)
	if !ok {
		writeErr(w, http.StatusNotFound, "cli_auth_not_found", "此代碼不存在或已過期")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"name": name})
}

// POST /v1/cli-auth/device/{userCode}/approve
// 必須是真正已登入的使用者,驗證邏輯與 handleApproveCliAuth 共用同一份
// (見 authenticatedUserForApproval)。跟 handleApproveCliAuth 的差異:
// 沒有 redirectUri 可回傳(device code 流程沒有瀏覽器導回這回事),核准
// 成功只需要回一個空的成功回應——CLI 自己輪詢 POST /v1/cli-auth/{id}/exchange
// (用它自己持有的 deviceCode)拿 token,不是靠這裡的回應內容。
func (s *Server) handleApproveDeviceAuth(w http.ResponseWriter, r *http.Request) {
	userCode := r.PathValue("userCode")

	user, ok := s.authenticatedUserForApproval(w, r)
	if !ok {
		return
	}

	cliToken, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "sign_failed", err.Error())
		return
	}

	if !s.store.ApproveDeviceAuth(userCode, cliToken) {
		writeErr(w, http.StatusNotFound, "cli_auth_not_found", "此代碼不存在、已過期或已被核准過")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}

// POST /v1/cli-auth/{id}/exchange
// 不需登入:憑證是 id(即 deviceCode)本身(32 bytes 隨機、單次使用),不是
// 使用者身分。兩種登入流程共用這一支端點(見 store.ExchangeCliAuth 的
// 說明):loopback 回呼流程(login --web)由 CLI 本地的 callback 伺服器收到
// 瀏覽器帶著 ?code={id} 導回來後呼叫一次;device code 流程(login --device)
// 由 CLI 自己按固定間隔輪詢,直到拿到 token 或自行判斷逾時放棄為止。尚未
// 核准、id 不存在/已過期、或 token 已被拿走過一次,一律回 404
// (store.ExchangeCliAuth 讀到後立刻清空 token 欄位,見該方法註解——這讓
// 重放的 callback 或輪詢請求拿不到第二次;device code 流程的輪詢端會把這個
// 404 一律當成「還沒核准,繼續等」)。
func (s *Server) handleExchangeCliAuth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	token, ok := s.store.ExchangeCliAuth(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "cli_auth_not_found", "此登入連結尚未核准、不存在、已過期或已被使用過")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}
