package api

import (
	"net/http"

	"nhooyr.io/websocket"
)

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")

	// 瀏覽器原生 WebSocket API 不支援自訂 header,token 改從 query string 帶;
	// 驗證身分後仍須是頻道成員才放行,避免任何知道 channelID 的人都能訂閱事件
	// (entries_updated/task_created/ask_user 等含頻道內容的廣播)。
	token := r.URL.Query().Get("token")
	user := s.userFromToken(token)
	if !s.requireMember(w, channelID, user.ID) {
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	s.hub.subscribe(channelID, conn)
	defer func() {
		s.hub.unsubscribe(channelID, conn)
		conn.CloseNow()
	}()
	ctx := r.Context()
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			return
		}
	}
}

// handleNotify 供 CLI 或內部服務呼叫，廣播 entries_updated 事件給指定 channel 的訂閱者。
func (s *Server) handleNotify(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")
	s.hub.Broadcast(channelID, map[string]any{"event": "entries_updated", "channelID": channelID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
