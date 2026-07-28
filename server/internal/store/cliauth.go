package store

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// cliAuthTTL 是一筆 CLI 登入 session 從建立到過期的存活時間,仿照
// onagent internal/cliauth 的 10 分鐘設計:短到即使 id 外洩也幾乎沒有可乘之機,
// 長到使用者在瀏覽器裡完成登入/核准綽綽有餘。
const cliAuthTTL = 10 * time.Minute

// cliAuthLoopbackRedirectRE 只允許 http://localhost:<port>/... 或
// http://127.0.0.1:<port>/... 這種本機 loopback 位址——CLI 自己的本地伺服器
// 合理能綁定的網址就只有這兩種。在 StartCliAuth 當下、伺服器端強制檢查,
// 之後任何地方都不再重新驗證使用者端傳來的 redirect 值,這正是這整套設計
// 安全的關鍵:見本檔案上方 package 說明。
var cliAuthLoopbackRedirectRE = regexp.MustCompile(`^http://(localhost|127\.0\.0\.1):\d+/`)

// cliAuthSessionRow 是「CLI 瀏覽器登入」流程的 pending session:CLI 執行
// `tripace-cli login --web` 時,先呼叫 StartCliAuth 在這裡登記一筆待核准的
// session(帶著它自己本地伺服器的 redirect_uri),換回一個 opaque、單次使用
// 的 id;瀏覽器頁面只帶著這個 id、從未帶著 redirect_uri 本身或任何 token——
// 這正是整套設計能防止惡意連結把剛核發的 token 導到攻擊者網址的關鍵:
// redirect_uri 與 id 的對應關係,自始至終只在伺服器端、只在 CLI 自己呼叫
// StartCliAuth 當下建立過一次,沒有任何後續步驟會讓網址本身的內容影響這個
// 對應關係(仿照 onagent backend/internal/cliauth 的設計,細節見該檔案開頭
// 的 package doc)。
//
// Token 欄位在 ApproveCliAuth 核准當下才寫入(簽好的 JWT),ExchangeCliAuth
// 讀取一次後立刻清空——讓「核准後被拿走一次」成為單次操作,重放/重複的
// callback 請求拿不到第二次。
type cliAuthSessionRow struct {
	ID          string `gorm:"primaryKey;column:id"`
	RedirectURI string `gorm:"column:redirect_uri;not null"`
	Name        string `gorm:"column:name;not null"`
	// Token 在核准前為 NULL;核准時寫入簽好的 JWT;被 ExchangeCliAuth 讀走後
	// 立刻清空回 NULL,故用 *string(可為 NULL)而非空字串——空字串本身無法
	// 區分「還沒核准」與「已核准但已被拿走」。
	Token     *string   `gorm:"column:token"`
	Approved  bool      `gorm:"column:approved;not null;default:false"`
	ExpiresAt time.Time `gorm:"column:expires_at;not null"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
}

func (cliAuthSessionRow) TableName() string { return "cli_auth_sessions" }

// StartCliAuth 為 redirectURI(須為 loopback 位址,否則回傳 error)登記一筆
// 待核准的 CLI 登入 session,回傳可安全放進網址的 opaque id。name 是顯示給
// 使用者看的 CLI 識別名稱(例如「XXX CLI 想要登入」的 XXX),留空時給預設值。
func (s *Store) StartCliAuth(redirectURI, name string) (id string, err error) {
	if !cliAuthLoopbackRedirectRE.MatchString(redirectURI) {
		return "", fmt.Errorf("cliauth: redirect_uri must be a loopback address (http://localhost:<port>/... or http://127.0.0.1:<port>/...)")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "browser login"
	}

	id, err = randomCliAuthID()
	if err != nil {
		return "", fmt.Errorf("cliauth: generate id: %w", err)
	}

	t := now()
	row := cliAuthSessionRow{
		ID:          id,
		RedirectURI: redirectURI,
		Name:        name,
		ExpiresAt:   t.Add(cliAuthTTL),
		CreatedAt:   t,
	}
	if err := s.db.Create(&row).Error; err != nil {
		return "", fmt.Errorf("cliauth: start: %w", err)
	}
	return id, nil
}

// CliAuthName 回傳 id 對應 session 的顯示名稱(供核准頁面顯示「XXX CLI 想要
// 登入」),id 不存在或已過期時 ok 為 false。
func (s *Store) CliAuthName(id string) (name string, ok bool) {
	var row cliAuthSessionRow
	err := s.db.Select("name").
		Where("id = ? AND expires_at > ?", id, now()).
		First(&row).Error
	if err != nil {
		return "", false
	}
	return row.Name, true
}

// ApproveCliAuth 把 token(呼叫端已用 auth.Signer.Sign 簽好的 JWT)記到 id
// 對應的 session 上,回傳該 session 登記時的 redirect_uri。id 不存在、已過期、
// 或已核准過一次時 ok 為 false——「已核准過」這個條件特別重要:避免同一個
// id 被核准兩次,讓第二個分頁/請求又拿到一次核准機會(那個核准動作本身沒有
// 任何正當用途,只可能是重放或競態)。用 WHERE ... approved = false 搭配檢查
// 影響筆數而非「先查再寫」兩步驟,是為了讓這個「只能核准一次」的保證在併發
// 下也成立。
func (s *Store) ApproveCliAuth(id, token string) (redirectURI string, ok bool) {
	res := s.db.Model(&cliAuthSessionRow{}).
		Where("id = ? AND expires_at > ? AND approved = ?", id, now(), false).
		Updates(map[string]any{"token": token, "approved": true})
	if res.Error != nil || res.RowsAffected == 0 {
		return "", false
	}

	var row cliAuthSessionRow
	if err := s.db.Select("redirect_uri").Where("id = ?", id).First(&row).Error; err != nil {
		return "", false
	}
	return row.RedirectURI, true
}

// ExchangeCliAuth 取走 id 已核准 session 的 token——CLI 本地的 callback
// 伺服器收到瀏覽器帶著 code(即這個 id)導回來後呼叫一次。成功取走後立刻把
// token 欄位清空,讓這個操作變成單次:同一個 id 的第二次 Exchange(重放的
// callback、或使用者重新整理該分頁)會因為 token 已經是 NULL 而查無資料、
// ok 回 false,不會讓同一個 token 被拿走第二次。id 不存在、尚未核准、或
// token 已被拿走時 ok 皆為 false。
func (s *Store) ExchangeCliAuth(id string) (token string, ok bool) {
	var row cliAuthSessionRow
	err := s.db.Where("id = ? AND approved = ? AND token IS NOT NULL", id, true).
		First(&row).Error
	if err != nil || row.Token == nil {
		return "", false
	}
	token = *row.Token

	// best-effort 清空:即使這裡失敗,token 已經回傳給這次呼叫端,不影響本次
	// 呼叫的正確性;只是下一次重放的 Exchange 可能還能再拿到一次——與 onagent
	// 對應邏輯(cliauth.go Exchange)相同的取捨,見該檔案註解。
	_ = s.db.Model(&cliAuthSessionRow{}).Where("id = ?", id).
		Update("token", nil).Error
	return token, true
}

func randomCliAuthID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
