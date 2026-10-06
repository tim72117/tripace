package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/model"
)

// TestThrottleGeoQueryByUser_AllowsUpToLimitThenBlocks 驗證
// throttleGeoQueryByUser(見 api.go 該函式與
// geoQueryUserThrottleWindow/geoQueryUserThrottleMaxCalls 的完整說明)
// 的邊界行為:同一個使用者在視窗內的前 geoQueryUserThrottleMaxCalls
// (目前 300)次請求應全部放行,緊接著第 300+1 次應被拒絕(429
// rate_limited)。
//
// 這支測試直接呼叫 throttleGeoQueryByUser 本身,不經過任何真正的
// handler(例如 handleGeocodeEntry)——這層節流只讀 Authorization
// header 解析使用者身份(見 userFor)、操作記憶體內的
// geoQueryUserRateLimiter,不需要真的打 Google API 或查資料庫,直接測
// 這個函式最單純、也最快。
//
// 不帶 Authorization header:userFor 在沒有 token 時固定回退成
// s.guestUser(ID 固定為 "usr_me",見 userFor 的完整說明),所有請求
// 因此共用同一個 per-user key,不需要另外簽發測試用的 JWT。
//
// 先前(2026-10 之前)這層節流只有 nearbyAttractionSearchEndpoint 等
// 測試間接繞過它的存在(透過改用不同使用者身份跳過節流),從未有測試
// 直接驗證這個邊界值本身——這支測試補上這個缺口。
func TestThrottleGeoQueryByUser_AllowsUpToLimitThenBlocks(t *testing.T) {
	s := newTestServer(t)

	for i := 0; i < geoQueryUserThrottleMaxCalls; i++ {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/internal/geo/throttle-test", nil)
		// 判斷放行與否一律看回傳值本身,不猜測 w.Code——
		// httptest.ResponseRecorder.Code 預設值是 200(不是 0),放行路徑
		// 完全不寫入任何回應(呼叫端的 handler 才會接著寫真正的狀態碼),
		// 靠 Code 是否等於某個值來判斷「有沒有被擋下」並不可靠,只有
		// throttleGeoQueryByUser 的回傳值能準確區分兩種結果。
		if ok := s.throttleGeoQueryByUser(w, r); !ok {
			t.Fatalf("request %d/%d: expected allowed, got blocked (status %d)", i+1, geoQueryUserThrottleMaxCalls, w.Code)
		}
	}

	// 第 geoQueryUserThrottleMaxCalls+1 次:視窗配額已耗盡,應被拒絕。
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/internal/geo/throttle-test", nil)
	if ok := s.throttleGeoQueryByUser(w, r); ok {
		t.Fatalf("request %d: expected blocked after exhausting quota, got allowed", geoQueryUserThrottleMaxCalls+1)
	}
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, w.Code)
	}
}

// TestThrottleGeoQueryByUser_DifferentUsersHaveIndependentQuota 驗證
// per-user 節流的「per-user」語意本身:使用者 A 耗盡自己的配額,不影響
// 使用者 B 的配額——理由見 geoQueryUserRateLimiter 欄位的完整說明
// (「不該讓使用者 A 的操作頻率影響到使用者 B 還剩多少配額可用」)。
func TestThrottleGeoQueryByUser_DifferentUsersHaveIndependentQuota(t *testing.T) {
	s := newTestServer(t)

	reqAsUser := func(userID string) bool {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/internal/geo/throttle-test", nil)
		token, err := s.signer.Sign(userID, "guest")
		if err != nil {
			t.Fatalf("sign token for %s: %v", userID, err)
		}
		r.Header.Set("Authorization", "Bearer "+token)
		return s.throttleGeoQueryByUser(w, r)
	}

	userA := "usr_a"
	userB := "usr_b"
	for _, id := range []string{userA, userB} {
		if err := s.store.UpsertUser(model.User{ID: id, Name: id}); err != nil {
			t.Fatalf("upsert test user %s: %v", id, err)
		}
	}

	for i := 0; i < geoQueryUserThrottleMaxCalls; i++ {
		if !reqAsUser(userA) {
			t.Fatalf("user A request %d/%d: expected allowed, got blocked", i+1, geoQueryUserThrottleMaxCalls)
		}
	}
	// 使用者 A 的配額已耗盡。
	if reqAsUser(userA) {
		t.Fatalf("user A: expected blocked after exhausting quota, got allowed")
	}
	// 使用者 B 的配額應完全不受使用者 A 影響,仍能正常放行。
	if !reqAsUser(userB) {
		t.Fatalf("user B: expected allowed (independent quota), got blocked")
	}
}
