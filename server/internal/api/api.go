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
	mux.HandleFunc("POST /v1/channels/{id}/assist", s.handleAssist)
	mux.HandleFunc("GET /v1/channels/{id}/entries", s.handleListEntries)
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

	// message 只存原文(LLM 標注改放 entry);若 agent 後續記錄條目,
	// 會把條目關聯回這則 message。
	msg := model.Message{
		ID:         "msg_" + newID(),
		ChannelID:  id,
		AuthorID:   user.ID,
		AuthorName: user.Name,
		Text:       text,
		CreatedAt:  time.Now().UTC(),
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
		// linkEntries:agent 跑完後,把本次寫入的 entry 關聯到這則 message(已寫入)。
		linkEntries := func(entryIDs []string) error {
			for _, eid := range entryIDs {
				if err := s.store.LinkEntryMessage(eid, msg.ID); err != nil {
					return err
				}
			}
			return nil
		}
		go rec.RecordForSession(user.ID, id, msg.ID, text, linkEntries)
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
// POST /v1/channels/{id}/members  { "email": "..." }
// 以 email 查出使用者後加入頻道。
func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Email string `json:"email"`
	}
	if !decode(w, r, &body) {
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	if email == "" {
		writeErr(w, http.StatusBadRequest, "invalid_email", "email 不可為空")
		return
	}

	u, _, err := s.store.FindUserByEmail(email)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "user_not_found", "找不到使用此 email 的使用者")
			return
		}
		writeErr(w, http.StatusInternalServerError, "lookup_failed", err.Error())
		return
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

// POST /v1/channels/{id}/assist  { "text": "..." }
// owner 統一輸入:LLM 自主判斷「記錄事項」或「回答提問」。
// - 記錄(recorded):把輸入存成訊息,並由 record_entry 產生關聯的 Entry,回 { kind:"recorded", message }。
// - 回答(answer):不存訊息,回 { kind:"answer", answer }。
// 只有頻道 owner 能用;分析器須支援 Assist(want 引擎),否則回 501。
func (s *Server) handleAssist(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	user := s.userFor(r)

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
		writeErr(w, http.StatusForbidden, "not_owner", "只有頻道擁有者能使用統一輸入")
		return
	}

	assistant, ok := s.analyzer.(llm.Assistant)
	if !ok {
		writeErr(w, http.StatusNotImplemented, "assist_unsupported", "目前分析器不支援統一輸入(需 -llm want)")
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

	// 先產生 messageID:agent 若記錄條目,這則來源 message 會與條目建立關聯。
	// 提問時 agent 會自己用 query_entries 工具查條目,不需在此撈頻道訊息。
	msgID := "msg_" + newID()

	// linkMessage:agent 決定「記錄」時呼叫(條目已由 emit 同步寫入)。
	// 寫入來源 message(純原文,標注已移至 entry),再把它與本次寫入的
	// entry(entryIDs)逐一建立多對多關聯。agent 只回答時不呼叫,故不留 message。
	var savedMsg model.Message
	linkMessage := func(entryIDs []string) error {
		savedMsg = model.Message{
			ID: msgID, ChannelID: id, AuthorID: user.ID, AuthorName: user.Name,
			Text: text, CreatedAt: time.Now().UTC(),
		}
		if err := s.store.InsertMessage(savedMsg); err != nil {
			return err
		}
		for _, eid := range entryIDs {
			if err := s.store.LinkEntryMessage(eid, msgID); err != nil {
				return err
			}
		}
		return nil
	}

	res := assistant.AssistForSession(user.ID, id, msgID, text, linkMessage)

	if res.Kind == "error" {
		writeErr(w, http.StatusInternalServerError, "assist_failed", res.Text)
		return
	}
	if res.Kind == "recorded" {
		// 記錄了 → message 與關聯 Entry 已由 Assist 在正確順序下寫入。
		writeJSON(w, http.StatusOK, map[string]any{"kind": "recorded", "message": savedMsg})
		return
	}

	// 回答了 → 不存訊息,只回答案;若 agent 用 present_entries 輸出了條目,一併回給前端用列表顯示。
	entries := res.Entries
	if entries == nil {
		entries = []llm.AssistEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"kind":    "answer",
		"answer":  res.Text,
		"entries": entries,
	})
}

// GET /v1/channels/{id}/entries — 頻道的日期/事件條目(LLM 從訊息解析,關聯訊息)。
func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	entries, err := s.store.ListEntriesByChannel(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	if entries == nil {
		entries = []model.Entry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
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
