// Package auth 提供自家 JWT(HS256)簽發與驗證,以及 Apple 登入的處理。
// 原型階段用標準庫自行實作 JWT,不引第三方依賴。
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpired      = errors.New("token expired")
)

// Claims 是自家 JWT 的內容。
type Claims struct {
	Sub  string `json:"sub"`  // 使用者 ID
	Name string `json:"name"` // 顯示名稱
	Exp  int64  `json:"exp"`  // 到期(Unix 秒)
	Iat  int64  `json:"iat"`  // 簽發(Unix 秒)
}

// Signer 用一把對稱金鑰簽發/驗證 JWT。
type Signer struct {
	secret []byte
	ttl    time.Duration
}

func NewSigner(secret string, ttl time.Duration) *Signer {
	return &Signer{secret: []byte(secret), ttl: ttl}
}

// Sign 為使用者簽一個 JWT。
func (s *Signer) Sign(userID, name string) (string, error) {
	now := time.Now()
	claims := Claims{
		Sub:  userID,
		Name: name,
		Iat:  now.Unix(),
		Exp:  now.Add(s.ttl).Unix(),
	}
	header := map[string]string{"alg": "HS256", "typ": "JWT"}

	hb, _ := json.Marshal(header)
	cb, _ := json.Marshal(claims)
	headerB64 := b64(hb)
	claimsB64 := b64(cb)
	signingInput := headerB64 + "." + claimsB64
	sig := s.mac(signingInput)
	return signingInput + "." + sig, nil
}

// Verify 驗證 JWT 並回傳 claims。
func (s *Signer) Verify(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}
	signingInput := parts[0] + "." + parts[1]
	expected := s.mac(signingInput)
	// 常數時間比較,防時序攻擊。
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return nil, ErrInvalidToken
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}
	var c Claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, ErrInvalidToken
	}
	if time.Now().Unix() > c.Exp {
		return nil, ErrExpired
	}
	return &c, nil
}

func (s *Signer) mac(input string) string {
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// ParseBearer 從 "Bearer <token>" 取出 token。
func ParseBearer(header string) (string, error) {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return "", fmt.Errorf("missing bearer prefix")
	}
	return strings.TrimSpace(header[len(prefix):]), nil
}
