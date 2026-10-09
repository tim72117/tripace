package store

import (
	"errors"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// toUser 把 entity 轉成 API DTO(只取公開欄位)。
func toUser(r userRow) model.User {
	return model.User{ID: r.ID, Name: r.Name, AvatarColor: r.AvatarColor}
}

// toPlanTier 把 userRow.Plan 轉成 model.PlanTier,空字串(理論上不該發生,
// 見 userRow.Plan 欄位 default:'free' 的說明,這裡是多一層保險)一律視為
// 免費版,不讓呼叫端需要處理「方案是空字串」這種無意義的中介狀態。
func toPlanTier(plan string) model.PlanTier {
	if plan == "" {
		return model.DefaultPlanTier
	}
	return model.PlanTier(plan)
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// FindUserByAppleSub 依 Apple sub 查使用者,找不到回傳 ErrNotFound。
func (s *Store) FindUserByAppleSub(sub string) (model.User, error) {
	var r userRow
	err := s.db.Where("apple_sub = ?", sub).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// FindUserByGoogleSub 依 Google sub 查使用者,找不到回傳 ErrNotFound。
func (s *Store) FindUserByGoogleSub(sub string) (model.User, error) {
	var r userRow
	err := s.db.Where("google_sub = ?", sub).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// BackfillUserEmailIfMissing 補齊既有使用者缺失的 email——只在資料庫目前
// email 為 NULL 且這次傳入的 email 非空字串時才真的更新,否則是 no-op。
// 2026-10 新增:修 CreateAppleUser/CreateGoogleUser 曾經建立使用者卻沒寫入
// email 的 bug(見兩者的完整說明)時,刻意選擇「不處理現有資料」(不寫一次性
// 批次腳本回補舊資料),改成讓既有使用者下次透過 Apple/Google 重新登入時,
// 由呼叫端(handleAppleAuth/handleGoogleAuth)在找到既有使用者後呼叫這裡,
// 順便用這次驗證拿到的 email 自然補齊——不需要額外維護一支獨立維運腳本,
// 使用者本來就會定期重新登入(token 過期後),資料會隨著正常使用逐步修復。
// 只在「目前是 NULL」時才更新,避免覆寫使用者可能已經透過其他管道(例如
// 帳密註冊合併帳號)設定好的正確 email。
func (s *Store) BackfillUserEmailIfMissing(id, email string) error {
	if email == "" {
		return nil
	}
	return s.db.Model(&userRow{}).
		Where("id = ? AND email IS NULL", id).
		Update("email", email).Error
}

// GetUserEmail 依使用者 ID 取 email(私密資料,供自己的帳號端點);無 email 回空字串。
func (s *Store) GetUserEmail(id string) (string, error) {
	var r userRow
	err := s.db.Select("email").Where("id = ?", id).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if r.Email == nil {
		return "", nil
	}
	return *r.Email, nil
}

// FindUserByID 依使用者 ID 查使用者。
func (s *Store) FindUserByID(id string) (model.User, error) {
	var r userRow
	err := s.db.Where("id = ?", id).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// CreateAppleUser 建立一個由 Apple 登入而來的使用者。email 是 Apple 身分驗證
// 回傳的信箱(可能為空字串,見 auth.VerifyAppleToken 的說明——Apple 只在使用者
// 第一次授權該 App 時才會附帶 email,之後的登入可能拿不到),空字串時
// strPtr 回傳 nil,行為與未設定一致,不會寫入空字串當作「有 email」。
// 2026-10 修正:原本這裡完全沒有寫入 email 欄位,導致 Apple 登入建立的使用者
// email 永遠是 NULL——issueToken 回應裡看似有 email,其實是從驗證過的身分
// token 現榨出來直接塞進那次 response,從未真正落地存進資料庫,下次登入
// (GET /v1/me)查詢就讀不到,管理後台使用者列表也因此一片空白。
func (s *Store) CreateAppleUser(id, name, avatarColor, appleSub, email string) (model.User, error) {
	r := userRow{ID: id, Name: name, AvatarColor: avatarColor, AppleSub: strPtr(appleSub), Email: strPtr(email)}
	if err := s.db.Create(&r).Error; err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// FindUserByEmail 依 email 查使用者,連同密碼雜湊一併回傳(供登入驗證)。
// 找不到回傳 ErrNotFound;passwordHash 可能為空字串(該帳號未設密碼,如 Apple 使用者)。
func (s *Store) FindUserByEmail(email string) (model.User, string, error) {
	var r userRow
	err := s.db.Where("email = ?", email).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, "", ErrNotFound
	}
	if err != nil {
		return model.User{}, "", err
	}
	hash := ""
	if r.PasswordHash != nil {
		hash = *r.PasswordHash
	}
	return toUser(r), hash, nil
}

// CreateGoogleUser 建立一個由 Google 登入而來的使用者。email 是 Google 身分
// 驗證回傳的信箱——理由與 CreateAppleUser 的 email 參數完全相同(見該函式
// 2026-10 修正的完整說明),這裡同樣補上,不再讓 Google 登入建立的使用者
// email 欄位永遠是 NULL。
func (s *Store) CreateGoogleUser(id, name, avatarColor, googleSub, email string) (model.User, error) {
	r := userRow{ID: id, Name: name, AvatarColor: avatarColor, GoogleSub: strPtr(googleSub), Email: strPtr(email)}
	if err := s.db.Create(&r).Error; err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// LinkGoogleSubByEmail 把 googleSub 補到既有帳號(依 email 查找)上——供
// 「Google 登入時,google_sub 沒對應到任何使用者,但該 email(已驗證)已存在
// 於 users 表(不論原本是帳密使用者或 Apple 使用者)」的情境使用,讓同一個
// email 不論用哪種方式登入都能落到同一個帳號,而不是報錯或建立重複帳號。
//
// 呼叫端(handleGoogleAuth)必須先確認 Google 回傳的 email_verified 為
// true 才可呼叫這裡——這是這個「依 email 自動合併帳號」機制唯一的安全
// 前提,未驗證的 email 絕不可用來合併,否則會造成 account takeover
// (攻擊者用一個尚未驗證、但字面上等於受害者 email 的 Google 帳號登入,
// 就能接管受害者在 tripace 的既有帳號)。
//
// email 欄位有 uniqueIndex(見 entity.go),故最多只會有一筆吻合;找不到
// 回傳 ErrNotFound,呼叫端應改建立新使用者。
func (s *Store) LinkGoogleSubByEmail(email, googleSub string) (model.User, error) {
	var r userRow
	err := s.db.Where("email = ?", email).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	if err := s.db.Model(&userRow{}).Where("id = ?", r.ID).
		Update("google_sub", googleSub).Error; err != nil {
		return model.User{}, err
	}
	r.GoogleSub = strPtr(googleSub)
	return toUser(r), nil
}

// CreatePasswordUser 建立一個帳密使用者。email 須唯一(衝突時回傳 error)。
func (s *Store) CreatePasswordUser(id, name, avatarColor, email, passwordHash string) (model.User, error) {
	r := userRow{
		ID:           id,
		Name:         name,
		AvatarColor:  avatarColor,
		Email:        strPtr(email),
		PasswordHash: strPtr(passwordHash),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// SetUserPassword 為既有使用者設定 email 與密碼雜湊(seed 示範使用者用,冪等)。
func (s *Store) SetUserPassword(id, email, passwordHash string) error {
	return s.db.Model(&userRow{}).Where("id = ?", id).
		Updates(map[string]any{"email": email, "password_hash": passwordHash}).Error
}
