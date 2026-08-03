package api

// HTTP entry points for the "LLM calls a frontend tool" POC:
//   - GET  /internal/clienttools/ws           WS upgrade, see clienttools_ws.go
//   - POST /internal/clienttools/test-prompt  drive a prompt without a browser
//
// Both live under /internal/ (see api.go's Routes, guarded by
// middleware.go's internalAuth) rather than under /v1/ — this POC has no
// per-user auth model of its own, and /internal/ is already shuttle's
// convention for "no per-channel auth, trusted caller only" endpoints (see
// api.go's own comment on handleInternalRecord and friends).
//
// internalAuth no longer has a "no token configured, allow through" branch
// (that was the old shared-secret INTERNAL_API_TOKEN scheme, since
// removed) — it now requires the same Authorization: Bearer JWT as every
// other /internal/* endpoint, verified against the same auth.Signer as
// /v1/*. Failing that check is a hard 401, same as any other /internal/*
// call.
//
// Known gap (not fixed by this comment, just recorded here so it isn't
// mistaken for "works"): the frontend caller,
// web/src/clienttools/bridge/ClientToolsBridge.ts's connect(), opens the WS
// with `new WebSocket(wsURL())` and does not attach any Authorization
// header or token — a plain browser WebSocket constructor has no mechanism
// to set custom headers. In a real browser this connection is therefore
// expected to fail internalAuth's check and get rejected before the WS
// handshake completes. This gap predates this comment and isn't something
// this change fixes; it's flagged here so the POC's actual state is
// visible rather than silently implied to work end-to-end.

import (
	"net/http"

	"nhooyr.io/websocket"
)

// handleClientToolsWS upgrades to a clientToolsSession. No channel/user
// association at all (unlike handleWS's tripID + requireMember check) —
// this POC's trip entry list isn't scoped to any shuttle channel; it's a
// standalone in-memory list living entirely in the connected browser tab
// (see web/src/DebugApp.tsx).
func (s *Server) handleClientToolsWS(w http.ResponseWriter, r *http.Request) {
	if s.clientToolsAnalyzer == nil {
		http.Error(w, `{"error":"clienttools_disabled","message":"clienttools POC 未啟用(啟動時 want 分析器初始化失敗或使用 -llm mock)"}`, http.StatusServiceUnavailable)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	runClientToolsSession(r.Context(), conn, s.clientToolsRegistry, s.clientToolsAnalyzer, s.clientToolsSessions)
}

// handleClientToolsTestPrompt drives a single inference turn on whichever
// clienttools page is currently connected, without needing a WS client of
// its own — e.g. `curl -X POST .../internal/clienttools/test-prompt -d
// '{"text":"..."}'`, or Playwright driving the page directly and never
// calling this at all (see this POC's actual end-to-end test, which drives
// the page's own textbox+button — this endpoint exists as the
// task-requested trigger mechanism, not as the only way to fire a prompt).
// Blocks for the same up-to-90s an in-page prompt would (see
// llm.ClientToolsAnalyzer.Prompt), since it runs the identical
// runPrompt path.
func (s *Server) handleClientToolsTestPrompt(w http.ResponseWriter, r *http.Request) {
	if s.clientToolsAnalyzer == nil {
		writeErr(w, http.StatusServiceUnavailable, "clienttools_disabled", "clienttools POC 未啟用")
		return
	}

	var body struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Text == "" {
		writeErr(w, http.StatusBadRequest, "empty_text", "text 不可為空")
		return
	}

	sess, ok := s.clientToolsSessions.current()
	if !ok {
		writeErr(w, http.StatusConflict, "no_page_connected", "目前沒有連線中的 clienttools 頁面;請先在瀏覽器開啟試做頁面")
		return
	}

	text, err := sess.runPrompt(body.Text)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "prompt_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessionId": sess.id,
		"reply":     text,
	})
}

// handleClientToolsInfo returns the tool names the "clienttools" app
// declares (server/tools/clienttools.yaml), for a small unauthenticated GET
// the debug page can call at load time to render "known tools" without
// needing a live WS connection first — purely informational, not on the
// blocking path.
func (s *Server) handleClientToolsInfo(w http.ResponseWriter, _ *http.Request) {
	if s.clientToolsRegistry == nil {
		writeJSON(w, http.StatusOK, map[string]any{"appId": "", "toolNames": []string{}})
		return
	}
	app, ok := s.clientToolsRegistry.Get("clienttools")
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"appId": "", "toolNames": []string{}})
		return
	}
	names := make([]string, 0, len(app.Tools))
	for _, t := range app.Tools {
		names = append(names, t.Name)
	}
	writeJSON(w, http.StatusOK, map[string]any{"appId": app.AppID, "toolNames": names})
}
