package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"
)

// 密碼雜湊:PBKDF2-HMAC-SHA256 + 隨機 salt,純標準庫(Go 1.24+ 的 crypto/pbkdf2),
// 與專案「原型階段不引第三方依賴」一致(見 jwt.go)。
// 儲存格式:base64(salt) + "$" + base64(hash)。

const (
	pbkdfIters  = 100_000 // 迭代次數
	pbkdfKeyLen = 32      // 衍生金鑰長度(bytes)
	saltLen     = 16      // salt 長度(bytes)
)

var ErrBadPassword = errors.New("password mismatch")

// HashPassword 產生可儲存的密碼雜湊字串。
func HashPassword(plain string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	dk, err := pbkdf2.Key(sha256.New, plain, salt, pbkdfIters, pbkdfKeyLen)
	if err != nil {
		return "", err
	}
	return b64Std(salt) + "$" + b64Std(dk), nil
}

// VerifyPassword 比對明文密碼與儲存的雜湊。常數時間比較,防時序攻擊。
func VerifyPassword(plain, stored string) error {
	parts := strings.SplitN(stored, "$", 2)
	if len(parts) != 2 {
		return ErrBadPassword
	}
	salt, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return ErrBadPassword
	}
	want, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return ErrBadPassword
	}
	got, err := pbkdf2.Key(sha256.New, plain, salt, pbkdfIters, pbkdfKeyLen)
	if err != nil {
		return ErrBadPassword
	}
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return ErrBadPassword
	}
	return nil
}

func b64Std(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
