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
// handleMe 的作法自己解析 Authorization、驗證失敗一律回 401,絕不落回訪客。
// 核准成功後回傳 CLI 本地伺服器的 redirectUri,前端據此把瀏覽器導過去、
// 帶上 ?code={id},讓 CLI 的本地 callback 伺服器能用這個 id 呼叫 exchange
// 取得剛剛簽好的 token。
func (s *Server) handleApproveCliAuth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	token, err := auth.ParseBearer(r.Header.Get("Authorization"))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "no_token", "缺少 Authorization,請先登入")
		return
	}
	claims, err := s.signer.Verify(token)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_token", "token 無效或過期,請重新登入")
		return
	}
	user, err := s.store.FindUserByID(claims.Sub)
	if err != nil {
		user = model.User{ID: claims.Sub, Name: claims.Name, AvatarColor: "#8C7B6A"}
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

// POST /v1/cli-auth/{id}/exchange
// 不需登入:憑證是 id 本身(32 bytes 隨機、單次使用),不是使用者身分。CLI
// 本地的 callback 伺服器收到瀏覽器帶著 ?code={id} 導回來後呼叫一次,取走
// approve 當下簽好的 token。尚未核准、id 不存在/已過期、或 token 已被拿走
// 過一次,一律回 404(store.ExchangeCliAuth 讀到後立刻清空 token 欄位,見該
// 方法註解——這讓重放的 callback 請求拿不到第二次)。
func (s *Server) handleExchangeCliAuth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	token, ok := s.store.ExchangeCliAuth(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "cli_auth_not_found", "此登入連結尚未核准、不存在、已過期或已被使用過")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}
