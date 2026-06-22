package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// AppleIdentity 是從 Apple identity token 解析出的使用者識別。
type AppleIdentity struct {
	Sub   string // Apple 的穩定使用者 ID(subject)
	Email string
}

// AppleClaims 對應 Apple identity token 的 payload 欄位(取用部分)。
type appleClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Iss   string `json:"iss"`
	Aud   string `json:"aud"`
}

// VerifyAppleToken 驗證 Apple identity token 並取出識別。
//
// 原型(開發)模式:只解析 JWT payload 取 sub/email,不驗 Apple 簽章。
// 正式環境 TODO:
//  1. 取得 Apple 公鑰 https://appleid.apple.com/auth/keys (JWKS)
//  2. 用對應 kid 的公鑰驗證 RS256 簽章
//  3. 檢查 iss == https://appleid.apple.com、aud == 你的 Bundle ID、exp 未過期
func VerifyAppleToken(identityToken string, devMode bool) (AppleIdentity, error) {
	parts := strings.Split(identityToken, ".")
	if len(parts) < 2 {
		return AppleIdentity{}, errors.New("malformed apple token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return AppleIdentity{}, errors.New("bad apple token payload")
	}
	var c appleClaims
	if err := json.Unmarshal(payload, &c); err != nil {
		return AppleIdentity{}, errors.New("bad apple token json")
	}
	if c.Sub == "" {
		return AppleIdentity{}, errors.New("apple token missing sub")
	}
	if !devMode {
		// 正式模式應在此完成簽章與宣告檢查。
		return AppleIdentity{}, errors.New("apple signature verification not implemented")
	}
	return AppleIdentity{Sub: c.Sub, Email: c.Email}, nil
}
