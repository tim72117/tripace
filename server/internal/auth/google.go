package auth

import (
	"context"
	"errors"

	"google.golang.org/api/idtoken"
)

// GoogleIdentity 是從 Google ID Token(GSI credential)驗證後取出的使用者識別。
type GoogleIdentity struct {
	Sub           string // Google 的穩定使用者 ID(subject),身分查詢一律用這個,不用 Email
	Email         string
	EmailVerified bool
	Name          string
}

// VerifyGoogleToken 驗證 Google ID Token(前端 Google Identity Services
// renderButton 回呼拿到的 credential 字串)並取出識別。
//
// 用 google.golang.org/api/idtoken 這個 Google 官方維護的套件做驗證——
// idtoken.Validate 一次做完:
//  1. 用 Google 的 JWKS 公開金鑰驗證 RS256 簽章
//  2. 檢查 aud(audience)等於呼叫端傳入的 clientID
//  3. 檢查 iss(issuer)是 accounts.google.com 或 https://accounts.google.com
//  4. 檢查 exp 未過期
//
// 這四項是本次 Google 登入功能的安全核心(見
// docs/…實作報告的「安全性完全建立在後端正確驗證」段落),不自行刻一套
// 簽章/JWKS 驗證邏輯,避免重新發明容易出錯的 OAuth/OIDC 驗證細節。
//
// clientID 為空字串時視為「Google 登入功能未設定」,直接拒絕——避免
// idtoken.Validate 在極端情況下對空字串 audience 產生非預期行為,也讓
// 呼叫端(handleGoogleAuth)可以用同一個錯誤路徑處理「功能未啟用」。
//
// email_verified 檢查是必要的安全防線:GoogleIdentity.EmailVerified 為
// false 時,呼叫端不可用這個 email 去合併/建立帳號(見
// store.LinkGoogleSubByEmail 的說明)——避免用未經 Google 驗證的 email
// 做帳號接管。這裡刻意不在驗證函式內部直接拒絕(未驗證 email 仍可能是
// 合法的「先建立一個全新帳號、不合併」情境的其中一種輸入),交由呼叫端
// 依業務邏輯決定如何處理,但一律透過 EmailVerified 欄位誠實回報。
func VerifyGoogleToken(ctx context.Context, rawIDToken, clientID string) (GoogleIdentity, error) {
	if clientID == "" {
		return GoogleIdentity{}, errors.New("google sign-in not configured (GOOGLE_OAUTH_CLIENT_ID unset)")
	}
	if rawIDToken == "" {
		return GoogleIdentity{}, errors.New("empty google id token")
	}

	payload, err := idtoken.Validate(ctx, rawIDToken, clientID)
	if err != nil {
		return GoogleIdentity{}, err
	}

	sub := payload.Subject
	if sub == "" {
		return GoogleIdentity{}, errors.New("google token missing sub")
	}

	identity := GoogleIdentity{Sub: sub}
	if email, ok := payload.Claims["email"].(string); ok {
		identity.Email = email
	}
	if verified, ok := payload.Claims["email_verified"].(bool); ok {
		identity.EmailVerified = verified
	}
	if name, ok := payload.Claims["name"].(string); ok {
		identity.Name = name
	}
	return identity, nil
}
