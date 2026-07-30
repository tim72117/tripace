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

// cliAuthSessionRow 是「CLI 瀏覽器登入」流程的 pending session,同時支援
// 兩種核准方式:
//
//   - loopback 回呼(`tripace-cli login --web`,StartCliAuth):CLI 自己起一個
//     本地伺服器,登記帶著 redirect_uri 的 session,換回一個 opaque、單次使用
//     的 id;瀏覽器頁面只帶著這個 id、從未帶著 redirect_uri 本身或任何
//     token——這正是整套設計能防止惡意連結把剛核發的 token 導到攻擊者網址的
//     關鍵:redirect_uri 與 id 的對應關係,自始至終只在伺服器端、只在 CLI
//     自己呼叫 StartCliAuth 當下建立過一次,沒有任何後續步驟會讓網址本身的
//     內容影響這個對應關係(仿照 onagent backend/internal/cliauth 的設計,
//     細節見該檔案開頭的 package doc)。
//   - device code(`tripace-cli login --device`,StartDeviceAuth):CLI 不需要
//     本機網路可達性(真正的無頭環境,例如遠端容器/沒有對外埠的機器),
//     redirect_uri 留空,改額外核發一組短的、方便手動輸入的 user_code——
//     使用者在任何一台裝置打開固定網址(/device)、手動輸入這組代碼核准,
//     CLI 則改用輪詢 ExchangeCliAuth(用它自己持有、使用者從未看過的長 id)
//     取得 token,不需要接收任何 callback。這是標準的 OAuth 2.0 Device
//     Authorization Grant(RFC 8628)模式,細節見 StartDeviceAuth 的說明。
//
// Token 欄位在 ApproveCliAuth/ApproveDeviceAuth 核准當下才寫入(簽好的
// JWT),ExchangeCliAuth 讀取一次後立刻清空——讓「核准後被拿走一次」成為
// 單次操作,重放/重複的 callback 或輪詢請求拿不到第二次。
type cliAuthSessionRow struct {
	ID string `gorm:"primaryKey;column:id"`
	// UserCode:device code 流程專用的短代碼(見上方型別說明),loopback
	// 回呼流程(StartCliAuth)也會生成一份但不會被使用——每筆 session 都
	// 生成同一組欄位,單純是讓兩種流程共用同一張表/同一套 helper,不代表
	// loopback 流程的使用者會看到或用到這個值。
	UserCode string `gorm:"column:user_code;not null"`
	// RedirectURI:loopback 回呼流程必填(見 StartCliAuth);device code 流程
	// 留空字串(見 StartDeviceAuth),核准時不會有任何網址可以導向。
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
// 這是 loopback 回呼流程(`login --web`)專用的入口;device code 流程見
// StartDeviceAuth。
func (s *Store) StartCliAuth(redirectURI, name string) (id string, err error) {
	if !cliAuthLoopbackRedirectRE.MatchString(redirectURI) {
		return "", fmt.Errorf("cliauth: redirect_uri must be a loopback address (http://localhost:<port>/... or http://127.0.0.1:<port>/...)")
	}
	id, _, err = s.startCliAuthSession(redirectURI, name)
	return id, err
}

// StartDeviceAuth 登記一筆待核准的 device code 登入 session(見
// cliAuthSessionRow 型別說明的第二種流程),回傳:
//
//   - deviceCode:給 CLI 自己持有、拿去輪詢 ExchangeCliAuth 用,使用者從未
//     看過這個值(不會出現在任何要使用者手動輸入/開啟的畫面上)。
//   - userCode:短的、方便手動輸入的代碼,CLI 印給使用者看,使用者在
//     /device 頁面手動輸入這組代碼、核准(見 DeviceAuthName/ApproveDeviceAuth)。
//
// 不需要(也不接受)redirect_uri——這正是 device code 流程存在的理由:CLI
// 不需要有本機可達的網路位址,核准的那台裝置也不需要連得到 CLI 那台機器,
// 兩邊只靠這組短代碼人工連結。
func (s *Store) StartDeviceAuth(name string) (deviceCode, userCode string, err error) {
	return s.startCliAuthSession("", name)
}

// startCliAuthSession 是 StartCliAuth/StartDeviceAuth 共用的核心:兩種流程
// 除了 redirectURI 是否必填、回傳值裡使用者需不需要看到 userCode 之外,
// session 的建立/存活時間/單次核准保證完全相同,故合併成一份實作,避免兩處
// 各自維護一份幾乎一樣的邏輯。
func (s *Store) startCliAuthSession(redirectURI, name string) (id, userCode string, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "browser login"
	}

	id, err = randomCliAuthID()
	if err != nil {
		return "", "", fmt.Errorf("cliauth: generate id: %w", err)
	}
	userCode, err = randomUserCode()
	if err != nil {
		return "", "", fmt.Errorf("cliauth: generate user code: %w", err)
	}

	t := now()
	row := cliAuthSessionRow{
		ID:          id,
		UserCode:    userCode,
		RedirectURI: redirectURI,
		Name:        name,
		ExpiresAt:   t.Add(cliAuthTTL),
		CreatedAt:   t,
	}
	if err := s.db.Create(&row).Error; err != nil {
		return "", "", fmt.Errorf("cliauth: start: %w", err)
	}
	return id, userCode, nil
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

// DeviceAuthName 是 CliAuthName 的 device code 流程對應版本:用使用者手動
// 輸入的 userCode(而非 CLI 自己持有、使用者從未看過的 id)查詢顯示名稱
// (供 /device 頁面顯示「XXX CLI 想要登入」)。userCode 不存在或已過期時
// ok 為 false。
func (s *Store) DeviceAuthName(userCode string) (name string, ok bool) {
	var row cliAuthSessionRow
	err := s.db.Select("name").
		Where("user_code = ? AND expires_at > ?", userCode, now()).
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

// ApproveDeviceAuth 是 ApproveCliAuth 的 device code 流程對應版本:用
// userCode(而非 id)找到待核准的 session、寫入 token。沒有 redirect_uri
// 可回傳——device code 流程沒有瀏覽器導回這回事,CLI 改用 ExchangeCliAuth
// 輪詢(見該方法說明),故這裡只需要回傳是否核准成功。userCode 不存在、
// 已過期、或已核准過一次時 ok 為 false,理由與 ApproveCliAuth 相同(避免
// 同一個 session 被核准兩次)。
func (s *Store) ApproveDeviceAuth(userCode, token string) (ok bool) {
	res := s.db.Model(&cliAuthSessionRow{}).
		Where("user_code = ? AND expires_at > ? AND approved = ?", userCode, now(), false).
		Updates(map[string]any{"token": token, "approved": true})
	return res.Error == nil && res.RowsAffected > 0
}

// ExchangeCliAuth 取走 id 已核准 session 的 token。兩種流程各自的呼叫方式
// 不同,但都是這同一個方法:loopback 回呼流程(login --web)由 CLI 本地的
// callback 伺服器收到瀏覽器帶著 code(即這個 id)導回來後呼叫一次;device
// code 流程(login --device)由 CLI 自己按固定間隔輪詢,直到拿到 token 或
// session 過期為止(見 StartDeviceAuth)。成功取走後立刻把 token 欄位清空,
// 讓這個操作變成單次:同一個 id 的下一次 Exchange(重放的 callback、輪詢
// 間隔內的重複請求、或使用者重新整理該分頁)會因為 token 已經是 NULL 而
// 查無資料、ok 回 false,不會讓同一個 token 被拿走第二次。id 不存在、尚未
// 核准、或 token 已被拿走時 ok 皆為 false——device code 流程的輪詢端會把
// 這個 false 一律當成「還沒核准,繼續等」,不特別區分原因(過期由呼叫端
// 自己的逾時處理)。
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

// userCodeCharset 排除容易看錯/打錯的字元(0/O、1/I、L 這幾組長得像的都只
// 留一個),device code 流程的 userCode 是設計給人眼讀、用手打的,不像
// randomCliAuthID 那種只會被程式讀取的 opaque id。全大寫是同一個理由:
// 使用者輸入時不需要切換大小寫、也不會有「這個字母到底是大寫還小寫」的
// 辨識問題。
const userCodeCharset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// randomUserCode 產生一組 8 碼、格式化成 "XXXX-XXXX" 的短代碼(見
// StartDeviceAuth)。8 碼、32 字元集(len(userCodeCharset))代表約 32^8
// (約 1.1 兆)種組合,對照 cliAuthTTL(10 分鐘)內實際會同時存在的 pending
// session 數量,碰撞機率低到可以直接忽略、不需要額外查 DB 是否已存在再
// 重試(比照 public_links.go newLinkToken/公開分享連結 token 的既有取捨)。
func randomUserCode() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	code := make([]byte, 8)
	for i, b := range buf {
		code[i] = userCodeCharset[int(b)%len(userCodeCharset)]
	}
	return string(code[:4]) + "-" + string(code[4:]), nil
}
