// Package api 提供對齊 docs/API.md 的 HTTP handlers。
package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/channel/server/internal/auth"
	"github.com/channel/server/internal/llm"
	"github.com/channel/server/internal/model"
	"github.com/channel/server/internal/store"
)

type Server struct {
	store    *store.Store
	analyzer llm.Analyzer
	signer   *auth.Signer
	// devMode:Apple token 不驗簽章(原型用)。
	devMode bool
	// 未登入時的預設使用者(維持可跳過登入的體驗)。
	guestUser model.User
}

func New(st *store.Store, an llm.Analyzer, signer *auth.Signer, devMode bool) *Server {
	return &Server{
		store:     st,
		analyzer:  an,
		signer:    signer,
		devMode:   devMode,
		guestUser: model.User{ID: "usr_me", Name: "我", AvatarColor: "#4A90D9"},
	}
}

// Routes 註冊路由(Go 1.22+ 的方法+路徑樣式)。
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /v1/auth/apple", s.handleAppleAuth)
	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("GET /v1/me", s.handleMe)
	mux.HandleFunc("GET /v1/channels", s.handleListChannels)
	mux.HandleFunc("POST /v1/channels", s.handleCreateChannel)
	mux.HandleFunc("GET /v1/channels/{id}/messages", s.handleListMessages)
	mux.HandleFunc("POST /v1/channels/{id}/messages", s.handlePostMessage)
	mux.HandleFunc("GET /v1/channels/{id}/members", s.handleListMembers)
	mux.HandleFunc("POST /v1/channels/{id}/members", s.handleAddMember)
	mux.HandleFunc("POST /v1/channels/{id}/query", s.handleQuery)
	mux.HandleFunc("GET /v1/users/search", s.handleSearchUsers)
	return logging(cors(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /v1/channels — 只回目前使用者參與的頻道。
func (s *Server) handleListChannels(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	chs, err := s.store.ListChannelsForUser(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if chs == nil {
		chs = []model.Channel{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": chs})
}

// POST /v1/channels  { "name": "..." }
func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_name", "name 不可為空")
		return
	}
	ch, err := s.store.CreateChannel("ch_"+newID(), body.Name, s.userFor(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ch)
}

// GET /v1/channels/{id}/messages
// 聊天畫面:每個人(含 owner)只看到自己輸入過的訊息。
func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	user := s.userFor(r)
	msgs, err := s.store.ListMessagesByAuthor(id, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if msgs == nil {
		msgs = []model.Message{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

// POST /v1/channels/{id}/messages  { "text": "..." }
// 只有頻道 owner 能發訊息(普通成員只能用 LLM 查詢)。
// 訊息先經 LLM 分類/標注,再存入資料庫,回傳處理後的訊息。
func (s *Server) handlePostMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	user := s.userFor(r)

	// 權限:非 owner 不能發訊息。
	owner, err := s.store.GetChannelOwner(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "channel_not_found", "頻道不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "owner_check_failed", err.Error())
		return
	}
	if user.ID != owner {
		writeErr(w, http.StatusForbidden, "not_owner", "只有頻道擁有者能發送訊息;成員可用查詢")
		return
	}

	var body struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &body) {
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		writeErr(w, http.StatusBadRequest, "empty_text", "text 不可為空")
		return
	}

	ann := s.analyzer.Classify(text)
	msg := model.Message{
		ID:         "msg_" + newID(),
		ChannelID:  id,
		AuthorID:   user.ID,
		AuthorName: user.Name,
		Text:       text,
		Category:   ann.Category,
		Tags:       ann.Tags,
		Summary:    ann.Summary,
		CreatedAt:  time.Now().UTC(),
	}
	if msg.Tags == nil {
		msg.Tags = []string{}
	}
	if err := s.store.InsertMessage(msg); err != nil {
		writeErr(w, http.StatusInternalServerError, "insert_failed", err.Error())
		return
	}

	// 若分析器支援背景記錄(want 引擎),讓 agent 自主決定是否把這則訊息記成條目
	// (record_entry 工具)。用 Recorder interface 斷言,不綁具體型別。
	// 以發訊息使用者的 ID 作為 session key(per-session 鋪路;現階段仍共用實例)。
	// 放 goroutine 不阻塞回應。
	if rec, ok := s.analyzer.(llm.Recorder); ok {
		go rec.RecordForSession(user.ID, text)
	}

	writeJSON(w, http.StatusCreated, msg)
}

// GET /v1/channels/{id}/members
func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	members, err := s.store.ListMembers(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if members == nil {
		members = []model.User{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// POST /v1/channels/{id}/members  { "userID", "name", "avatarColor" }
func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var u model.User
	var body struct {
		UserID      string `json:"userID"`
		Name        string `json:"name"`
		AvatarColor string `json:"avatarColor"`
	}
	if !decode(w, r, &body) {
		return
	}
	u = model.User{ID: body.UserID, Name: body.Name, AvatarColor: body.AvatarColor}
	if u.ID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_user", "userID 不可為空")
		return
	}
	if u.AvatarColor == "" {
		u.AvatarColor = "#888888"
	}
	members, err := s.store.AddMember(id, u)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "channel_not_found", "頻道不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "add_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// POST /v1/channels/{id}/query  { "question": "..." }
func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Question string `json:"question"`
	}
	if !decode(w, r, &body) {
		return
	}
	q := strings.TrimSpace(body.Question)
	if q == "" {
		writeErr(w, http.StatusBadRequest, "empty_question", "question 不可為空")
		return
	}
	pool, err := s.store.ListMessages(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	answer := s.analyzer.Answer(q, pool)
	writeJSON(w, http.StatusOK, answer)
}

// GET /v1/users/search?q=<keyword>
// 搜尋可邀請的使用者。
func (s *Server) handleSearchUsers(w http.ResponseWriter, r *http.Request) {
	keyword := strings.TrimSpace(r.URL.Query().Get("q"))
	users, err := s.store.SearchUsers(keyword)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "search_failed", err.Error())
		return
	}
	if users == nil {
		users = []model.User{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// ----- helpers -----

func newID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", "請求格式錯誤")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]any{
		"error": map[string]string{"code": errCode, "message": msg},
	})
}
