package main

// http.go 是 partner-cli 的 HTTP 層——打 partnerserver 的 /partner/api/*
// (業主身分已驗證過的操作)與主站的 /v1/auth/login(登入換 token,見
// login.go)。跟 cmd/cli/http.go 的 do() 結構一致(method/path/body →
// 帶 Authorization header → 解析 JSON 回應),但這裡的 client 只打
// 單一固定 base(不像 cmd/cli 的 httpClient 要同時支援 /internal/*
// 跟 /v1/* 兩種前綴),故簡化成建構時就固定 base,不需要每次呼叫都
// 重新判斷要打哪個 host。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type httpClient struct {
	base string // e.g. http://localhost:8082(partnerserver)
}

func newHTTPClient(base string) *httpClient {
	return &httpClient{base: base}
}

// do 送出一個已登入的請求(自動帶 Authorization: Bearer,讀本機快取的
// token,見 token.go)——partner-cli 的所有 campaign/plan 操作都是這種
// 已登入請求,不像 cmd/cli 的 do() 需要處理「這支端點其實不需要登入」
// 的情境,故不額外做 token 讀取失敗時的訊息客製化,統一報錯即可。
func (c *httpClient) do(method, path string, body any) (map[string]any, error) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, r)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	token, err := loadToken(c.base)
	if err != nil {
		return nil, fmt.Errorf("尚未登入,請先執行 `partner-cli login -email <email> -password <password> -api %s`: %w", c.base, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	// 刪除成功回 204 空內容,不能硬解析 JSON。
	result := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &result); err != nil {
			return nil, err
		}
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("server error %d: %v", resp.StatusCode, result)
	}
	return result, nil
}
