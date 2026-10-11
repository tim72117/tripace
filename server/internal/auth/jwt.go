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
	"os"
	"strings"
	"time"
)

// DefaultDevJWTSecret 是本機開發/測試用的 JWT 簽章金鑰預設值——刻意不是
// 隨機產生的強密鑰,因為本機開發環境不需要這個保護,方便重啟後仍能驗證
// 先前簽出的 token。正式環境必須透過 JWT_SECRET 環境變數覆寫(見
// ResolveSecretFromEnv),不應該依賴這個預設值。
const DefaultDevJWTSecret = "dev-secret-change-me"

// ResolveSecretFromEnv 決定 JWT 簽章金鑰的最終值:環境變數 JWT_SECRET 有
// 設定時採用該值,否則退回 DefaultDevJWTSecret。
//
// 這支函式抽出來的理由(2026-10,code review 發現的維護性問題)
// ——cmd/server/main.go 跟 cmd/adminserver/main.go 這兩支各自獨立部署的
// binary 必須使用完全相同的 JWT secret 才能互相驗證對方簽發的 token
// (admin 後台消費的是 cmd/server 簽的 JWT,見
// cmd/adminserver/main.go 開頭的完整說明),原本兩邊各自重複寫一次
// 「讀環境變數、預設值是 dev-secret-change-me」的邏輯,只靠程式碼註解
// 提醒要保持同步——這裡抽成一個共用函式,兩個 main.go 都呼叫這支,之後
// 要調整預設值或讀取邏輯只需要改一個地方,不會出現「改了一邊、忘記改
// 另一邊」的風險。
//
// 放在 internal/auth 套件(而非各自 cmd/ 底下另開一個共用檔案)的理由:
// 這支函式的輸出本來就是直接餵給本套件的 NewSigner 使用,邏輯上屬於
// 「JWT 簽章金鑰怎麼決定」這個套件已經在管的職責範圍,cmd/server 與
// cmd/adminserver 原本就都已經 import 這個套件,不需要新增任何依賴。
func ResolveSecretFromEnv() string {
	if s := os.Getenv("JWT_SECRET"); s != "" {
		return s
	}
	return DefaultDevJWTSecret
}

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
