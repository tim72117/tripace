package api

import (
	"context"
	"encoding/json"
	"sync"

	"nhooyr.io/websocket"
)

// Hub 管理每個 channel 的 WebSocket 訂閱者，提供廣播能力。
type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[*websocket.Conn]struct{} // channelID → conns
}

func newHub() *Hub {
	return &Hub{subs: make(map[string]map[*websocket.Conn]struct{})}
}

func (h *Hub) subscribe(channelID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[channelID] == nil {
		h.subs[channelID] = make(map[*websocket.Conn]struct{})
	}
	h.subs[channelID][conn] = struct{}{}
}

func (h *Hub) unsubscribe(channelID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subs[channelID], conn)
}

// Broadcast 傳送 JSON 事件給 channel 所有訂閱者。
func (h *Hub) Broadcast(channelID string, event any) {
	b, err := json.Marshal(event)
	if err != nil {
		return
	}
	h.mu.RLock()
	conns := h.subs[channelID]
	h.mu.RUnlock()
	for conn := range conns {
		// 非同步寫，避免單一慢連線阻塞廣播
		go conn.Write(context.Background(), websocket.MessageText, b)
	}
}
