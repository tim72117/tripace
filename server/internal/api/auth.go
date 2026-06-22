package api

import (
	"errors"
	"net/http"

	"github.com/channel/server/internal/auth"
	"github.com/channel/server/internal/model"
	"github.com/channel/server/internal/store"
)

// userFor 從請求的 Authorization header 解析目前使用者。
// 無 token 或 token 無效時,回退為訪客(維持可跳過登入的體驗)。
func (s *Server) userFor(r *http.Request) model.User {
	token, err := auth.ParseBearer(r.Header.Get("Authorization"))
	if err != nil {
		return s.guestUser
	}
	claims, err := s.signer.Verify(token)
	if err != nil {
		return s.guestUser
	}
	// 以 token 內的身分為主;若 DB 查得到使用者就用最新資料。
	if u, err := s.store.FindUserByID(claims.Sub); err == nil {
		return u
	}
	return model.User{ID: claims.Sub, Name: claims.Name, AvatarColor: "#4A90D9"}
}

// POST /v1/auth/apple
// Body: { "identityToken": "...", "fullName": "可選,首次登入時帶入" }
// 驗證 Apple identity token → 建立或查出使用者 → 簽自家 JWT 回傳。
func (s *Server) handleAppleAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IdentityToken string `json:"identityToken"`
		FullName      string `json:"fullName"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.IdentityToken == "" {
		writeErr(w, http.StatusBadRequest, "missing_token", "identityToken 不可為空")
		return
	}

	identity, err := auth.VerifyAppleToken(body.IdentityToken, s.devMode)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "apple_verify_failed", err.Error())
		return
	}

	// 依 Apple sub 找使用者,沒有就建立。
	user, err := s.store.FindUserByAppleSub(identity.Sub)
	if errors.Is(err, store.ErrNotFound) {
		name := body.FullName
		if name == "" {
			name = "Apple 使用者"
		}
		user, err = s.store.CreateAppleUser("usr_"+newID(), name, "#4A90D9", identity.Sub)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "user_failed", err.Error())
		return
	}

	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "sign_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  user,
	})
}

// GET /v1/me — 用 Bearer token 取得目前登入使用者(驗證 token 是否仍有效)。
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	token, err := auth.ParseBearer(r.Header.Get("Authorization"))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "no_token", "缺少 Authorization")
		return
	}
	claims, err := s.signer.Verify(token)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_token", "token 無效或過期")
		return
	}
	user, err := s.store.FindUserByID(claims.Sub)
	if err != nil {
		// token 有效但使用者已不存在
		user = model.User{ID: claims.Sub, Name: claims.Name, AvatarColor: "#4A90D9"}
	}
	writeJSON(w, http.StatusOK, user)
}
