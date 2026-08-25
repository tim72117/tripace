// Package pexels 封裝 Pexels Search API(https://www.pexels.com/api/),
// 依關鍵字查詢示意圖——跟 internal/geo(Google Places,綁定實際地點/
// place_id)是完全獨立的資料來源:Pexels 是純關鍵字比對的圖庫服務,
// 查詢結果不保證是「該地點的真實照片」,只是攝影師上傳時標記的相關圖片,
// 見 server/tools/onagent-tools.yaml 開頭對兩者定位差異的說明。
//
// 這個套件目前只負責查詢本身,不含快取邏輯(呼叫端自行決定要不要接上
// internal/store 的 GetCachedPexelsPhoto/SetCachedPexelsPhoto)。
package pexels

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const defaultBaseURL = "https://api.pexels.com/v1/search"

// Client 是 Pexels Search API 的最小可用封裝。
type Client struct {
	apiKey     string
	httpClient *http.Client
	// baseURL 預設是正式的 Pexels API 端點(defaultBaseURL),測試用
	// newClientWithBaseURL 覆寫成 httptest.NewServer 的位址,不需要真的
	// 打外部網路——理由同 internal/photostorage 的 objectStore 注入,
	// 只是這裡端點本身就是最小可替換的單元,不需要另外抽介面。
	baseURL string
}

// New 建立一個 Client。apiKey 是 Pexels 開發者後台簽發的 API Key(見
// https://www.pexels.com/api/ 申請流程),空字串時 Search 會直接回傳
// ErrNoAPIKey,不會發出任何請求。
func New(apiKey string) *Client {
	return &Client{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 8 * time.Second},
		baseURL:    defaultBaseURL,
	}
}

// newClientWithBaseURL 供測試使用——同 New,但可指定 baseURL(通常是
// httptest.NewServer 的位址),不對外匯出。
func newClientWithBaseURL(apiKey, baseURL string) *Client {
	c := New(apiKey)
	c.baseURL = baseURL
	return c
}

// ErrNoAPIKey 是未設定 apiKey 時 Search 回傳的錯誤——這是刻意的早期
// 攔截,理由同 geo.Client 對空 apiKey 的既有處理:讓呼叫端能明確分辨
// 「未設定金鑰」與「查無結果」兩種不同情況,而不是讓兩者都表現成空結果。
var ErrNoAPIKey = fmt.Errorf("pexels: 未設定 API Key")

// Photo 是 Search 回傳的單筆候選結果,只取這個套件實際會用到的欄位
// (Pexels API 回應本身欄位更多,如攝影師資訊、多種尺寸的 src 變體等,
// 目前用不到的一律不解析)。
type Photo struct {
	// ImageURL 是可直接當 <img src> 使用的圖片網址(取 src.large,
	// 約 1200px 寬,適合行程/景點卡片用的示意圖尺寸——src.original
	// 原始解析度過大,src.tiny/small 對卡片顯示而言太小)。
	ImageURL string
	// PageURL 是這張照片在 pexels.com 的原始頁面網址(非下載連結)——
	// 依 Pexels License 的建議保留可追溯到來源的連結,見
	// internal/store 的 pexelsPhotoCacheRow 說明。
	PageURL string
	// Alt 是 Pexels 提供的簡短英文描述(攝影師/系統標記的替代文字,
	// 不是詳細說明,可能為空字串)——僅供除錯/日誌參考,不保證與查詢
	// 字串的相關程度,不應該當成「這是哪裡」的驗證依據。
	Alt string
}

// searchResponse 是 Pexels Search API 回應的子集,只解析 photos 陣列
// 與其中用得到的欄位。
type searchResponse struct {
	Photos []struct {
		URL string `json:"url"`
		Alt string `json:"alt"`
		Src struct {
			Large string `json:"large"`
		} `json:"src"`
	} `json:"photos"`
}

// Search 依關鍵字查詢示意圖,回傳最相關的第一筆結果。查無結果時回傳
// ok=false(非 error)——同 geo.Client.Search 對「查無此地點」的既有
// 處理慣例,查無結果是正常的業務情況,不是異常。
func (c *Client) Search(ctx context.Context, query string) (photo Photo, ok bool, err error) {
	if c.apiKey == "" {
		return Photo{}, false, ErrNoAPIKey
	}
	if query == "" {
		return Photo{}, false, fmt.Errorf("pexels: query 不可為空")
	}

	u := c.baseURL + "?per_page=1&query=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return Photo{}, false, fmt.Errorf("pexels: 建立請求失敗: %w", err)
	}
	// Pexels 用自訂 Authorization header 直接放 API Key(不是 "Bearer "
	// 前綴,見官方文件 https://www.pexels.com/api/documentation/#authorization)。
	req.Header.Set("Authorization", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Photo{}, false, fmt.Errorf("pexels: 請求失敗: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Photo{}, false, fmt.Errorf("pexels: 回應狀態碼 %d", resp.StatusCode)
	}

	var body searchResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Photo{}, false, fmt.Errorf("pexels: 解析回應失敗: %w", err)
	}
	if len(body.Photos) == 0 {
		return Photo{}, false, nil
	}

	p := body.Photos[0]
	return Photo{ImageURL: p.Src.Large, PageURL: p.URL, Alt: p.Alt}, true, nil
}
