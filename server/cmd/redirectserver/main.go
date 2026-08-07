// Command redirectserver 是一支極簡的獨立進入點——唯一的工作是把所有請求
// 用 HTTP 301(永久重導向)導到 https://tripace.shuttle.tools,保留原始
// path/query string。
//
// 存在原因:app.shuttle.tools 是這個產品早期使用過的網域,後來正式網域
// 改成 tripace.shuttle.tools,但 app.shuttle.tools 的 DNS 記錄還在、也可能
// 有外部連結/書籤指向舊網址——這支服務讓那些連結能自動落地到新網址,而不是
// 連到一個已經不存在的服務或空白頁。用 301(而非 302)是因為這是永久搬遷,
// 要讓瀏覽器/搜尋引擎快取這個重導向規則、更新自己的索引指向新網址(呼應
// Google Search Console「網站已轉移」流程對 301 的要求)。
//
// 刻意獨立成一支完全不依賴 internal/store、internal/model 等主業務套件的
// 極簡 binary(不連資料庫、無任何業務邏輯)——它的職責單純到不需要,也不該
// 拖進主服務的相依鏈,對應獨立的 Dockerfile.redirect 與 Cloud Run 服務。
package main

import (
	"log"
	"net/http"
	"os"
)

// targetOrigin 是重導向的目的地——寫死而非讀環境變數,因為這支服務的
// 唯一職責就是「導到這個固定網址」,不是一個通用的可設定重導向工具,不需要
// 為了假設中的彈性增加設定面。
const targetOrigin = "https://tripace.shuttle.tools"

func main() {
	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, targetOrigin+r.URL.RequestURI(), http.StatusMovedPermanently)
	})

	log.Printf("redirectserver 啟動,監聽 %s,一律 301 導到 %s", addr, targetOrigin)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("redirectserver 啟動失敗: %v", err)
	}
}
