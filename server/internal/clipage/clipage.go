// Package clipage 是 CLI 瀏覽器登入完成後,本機 callback 伺服器回給瀏覽器的那一頁。
// tripace-cli 與 partner-cli 共用,版型是畫面正中央的標題加兩行說明(沒有按鈕、沒有外部資源),
// 色票沿用主站登入頁(web/src/home/LoginForm.css 的 paper / ink / vermilion)。
package clipage

import (
	"html/template"
	"net/http"
)

var page = template.Must(template.New("login-done").Parse(`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} | Tripace</title>
<style>
  :root { --paper: #F7F3EC; --ink: #2B2420; --ink-soft: #5A5148; --brand: #8B3A2F; }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #1c1916; --ink: #f2ece4; --ink-soft: #b8ada2; --brand: #d9826f; }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    padding: 24px 16px;
    background: var(--paper); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
    text-align: center;
  }
  main { max-width: 32rem; }
  .mark {
    width: 48px; height: 48px; margin: 0 auto 28px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    background: var(--brand); color: var(--paper); font-size: 26px; font-weight: 700;
  }
  h1 { margin: 0 0 16px; font-size: clamp(28px, 6vw, 40px); font-weight: 600; letter-spacing: 0.02em; }
  p { margin: 0; font-size: 17px; line-height: 1.7; color: var(--ink-soft); }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">T</div>
  <h1>{{.Title}}</h1>
  <p>{{.Line1}}</p>
  <p>{{.Line2}}</p>
</main>
</body>
</html>
`))

// WriteLoginDone 寫出登入結果頁。app 是 CLI 名稱(例如 "tripace-cli");ok 是 CLI 換 token 的結果
// (呼叫端要在換完之後才呼叫)。ok=false(沒帶授權碼、換 token 失敗)時提示回終端機看錯誤,不宣稱登入成功。
func WriteLoginDone(w http.ResponseWriter, app string, ok bool) {
	data := struct{ Title, Line1, Line2 string }{
		Title: "登入完成",
		Line1: app + " 已完成授權。",
		Line2: "可以關閉這個視窗,回到終端機繼續。",
	}
	if !ok {
		data.Title = "登入未完成"
		data.Line1 = app + " 沒有取得授權。"
		data.Line2 = "請回到終端機查看錯誤訊息,必要時重新執行登入。"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = page.Execute(w, data)
}
