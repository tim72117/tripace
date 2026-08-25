package pexels

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearch_未設定ApiKey時回傳ErrNoAPIKey且不發出請求(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newClientWithBaseURL("", srv.URL)
	_, ok, err := c.Search(context.Background(), "台北 101")
	if !errors.Is(err, ErrNoAPIKey) {
		t.Fatalf("want ErrNoAPIKey, got %v", err)
	}
	if ok {
		t.Error("want ok=false")
	}
	if called {
		t.Error("expected no HTTP request when apiKey is empty")
	}
}

func TestSearch_query為空時回傳錯誤且不發出請求(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newClientWithBaseURL("fake-key", srv.URL)
	_, ok, err := c.Search(context.Background(), "")
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if ok {
		t.Error("want ok=false")
	}
	if called {
		t.Error("expected no HTTP request when query is empty")
	}
}

func TestSearch_成功查到照片時正確解析欄位(t *testing.T) {
	var gotAuth, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"photos": [
				{
					"url": "https://www.pexels.com/photo/123",
					"alt": "a cup of coffee",
					"src": {"large": "https://images.pexels.com/photos/123/large.jpg"}
				}
			]
		}`))
	}))
	defer srv.Close()

	c := newClientWithBaseURL("my-api-key", srv.URL)
	photo, ok, err := c.Search(context.Background(), "coffee")
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if !ok {
		t.Fatal("want ok=true")
	}
	if photo.ImageURL != "https://images.pexels.com/photos/123/large.jpg" {
		t.Errorf("ImageURL = %q", photo.ImageURL)
	}
	if photo.PageURL != "https://www.pexels.com/photo/123" {
		t.Errorf("PageURL = %q", photo.PageURL)
	}
	if photo.Alt != "a cup of coffee" {
		t.Errorf("Alt = %q", photo.Alt)
	}
	// Pexels 用自訂 Authorization header 直接放 API Key(不是 "Bearer "
	// 前綴),見 pexels.go Search 的說明——這裡驗證請求確實這樣組。
	if gotAuth != "my-api-key" {
		t.Errorf("Authorization header = %q, want %q (no Bearer prefix)", gotAuth, "my-api-key")
	}
	if gotQuery != "coffee" {
		t.Errorf("query param = %q, want %q", gotQuery, "coffee")
	}
}

func TestSearch_查無結果時回傳ok為false且不是錯誤(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"photos": []}`))
	}))
	defer srv.Close()

	c := newClientWithBaseURL("my-api-key", srv.URL)
	photo, ok, err := c.Search(context.Background(), "一個查無結果的關鍵字")
	if err != nil {
		t.Fatalf("want nil error for empty result, got %v", err)
	}
	if ok {
		t.Error("want ok=false")
	}
	if photo != (Photo{}) {
		t.Errorf("want zero-value Photo, got %+v", photo)
	}
}

func TestSearch_非200狀態碼時回傳錯誤(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := newClientWithBaseURL("bad-key", srv.URL)
	_, ok, err := c.Search(context.Background(), "coffee")
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if ok {
		t.Error("want ok=false")
	}
}

func TestSearch_回應JSON格式錯誤時回傳錯誤(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not valid json`))
	}))
	defer srv.Close()

	c := newClientWithBaseURL("my-api-key", srv.URL)
	_, ok, err := c.Search(context.Background(), "coffee")
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if ok {
		t.Error("want ok=false")
	}
}
