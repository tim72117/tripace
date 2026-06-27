package api

import (
	"net/http"

	"nhooyr.io/websocket"
)

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")
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
