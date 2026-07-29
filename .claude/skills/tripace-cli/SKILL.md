---
name: tripace-cli
description: 用 tripace 自己的 CLI 工具(server/cmd/cli)透過 HTTP 存取 tripace 資料(頻道/entry/trip),不需要碰資料庫連線字串。觸發語如「查頻道」「用 cli 查 tripace」「新增 entry」「查某個頻道有哪些行程」。
---

# tripace-cli

`server/cmd/cli` 是 tripace 專案自帶的 entry/trip 操作工具，讓 Claude Code 可以直接用 HTTP 打自家 server 的 `/internal/*`、`/v1/*` API 查資料或寫資料，不需要手動組 curl、也不需要碰資料庫。

**這份 skill 只涵蓋 HTTP 模式（預設行為）。不使用、也不建議使用 `-db` 直連 PostgreSQL 模式**——直連模式需要拿到 `DATABASE_URL`，繞過了 server 的認證與業務邏輯層，不是這個 CLI 工具原本設計給日常查詢/操作用的路徑。

## 前置：登入

除了 `create-channel`、`geocode` 以外，其餘子命令都是 `/internal/*` 路由，需要先登入拿到 JWT：

```bash
cd server
go run ./cmd/cli login --web
```

會開瀏覽器走核准流程，成功後 token 存在 `os.UserConfigDir()/tripace/token`（macOS/Linux 是 `~/.config/tripace/token`），之後的指令會自動帶上，不需要重新登入。

本機另外跑 Vite dev server（`:5173`）、而 server 走 `:8080` 時，可以加 `-console http://localhost:5173` 讓核准頁面走有熱重載的 dev server：

```bash
go run ./cmd/cli login --web -console http://localhost:5173
```

`-api URL` 全域旗標可指定 server 位址（預設 `http://localhost:8080`），用於連正式環境或非預設埠的本機環境。

## 常用子命令

所有輸出皆為 JSON，方便直接解析。以下是實際存在於 `switch` 分支、已驗證可用的子命令名稱——**注意 `go run ./cmd/cli --help` 印出的說明文字本身有過時內容**（例如 help 文字寫 `record`/`update-entry`，實際指令名稱是 `entry-add`/`entry-update`；help 也沒列出 `list-channels`/`entry-delete`/`geocode`），呼叫時請以下方列表為準，不要照抄 `--help` 的文字。

```bash
# 列出所有頻道
go run ./cmd/cli list-channels

# 建立頻道（唯一不需要登入的寫入操作，用 /v1/channels，owner 是登入身分）
go run ./cmd/cli create-channel -name "頻道名稱"

# 新增 entry
go run ./cmd/cli entry-add -channel ch_xxx -title "文字" \
  [-start 'YYYY-MM-DD'] [-start-time 'HH:MM'] [-end ...] [-end-time ...] [-location ...]

# 更新 entry（只需帶要改的欄位）
go run ./cmd/cli entry-update -entry ent_xxx \
  [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] \
  [-kind stay|flight|activity|note|car|restaurant|ticket] [-detail '{"json":"字串"}']

# 刪除 entry
go run ./cmd/cli entry-delete -entry ent_xxx

# 把 entry 併進 trip（留空 -trip 會新建一個）
go run ./cmd/cli add-to-trip -entry ent_xxx [-trip trip_xxx] [-title "行程名"]

# 列出頻道底下的 trip
go run ./cmd/cli list-trips -channel ch_xxx

# 列出某個 trip 底下的 entries
go run ./cmd/cli trip-entries -channel ch_xxx -trip trip_xxx

# 刪除 trip
go run ./cmd/cli delete-trip -trip trip_xxx

# 清空頻道所有 entries（危險操作，會實際刪除資料，執行前務必跟使用者確認）
go run ./cmd/cli reset -channel ch_xxx

# 手動觸發即時推播通知（DB 直連模式才需要，HTTP 模式 server 端已自動廣播,一般不需要主動呼叫）
go run ./cmd/cli notify -channel ch_xxx

# 地點搜尋(可選擇順便把第一筆候選座標寫回某個 entry)
go run ./cmd/cli geocode -place "地點名稱" [-region tw] [-n 3] [-entry ent_xxx]
```

## 已知限制（HTTP 模式）

- **`candidates -channel ... -start ...` 在 HTTP 模式下永遠回傳空陣列**（`{"candidates": []}`），不是真的查詢結果——這是 `server/cmd/cli/http.go` 裡刻意寫死的 stub，只有 `-db` 模式才有真正的實作。HTTP 模式下不要用這個子命令來判斷「某頻道是否有資料」，得到空陣列不代表頻道真的沒有 entries。
- **沒有「列出頻道全部 entries」的子命令**。HTTP 模式只能透過 `trip-entries -channel -trip`（需要先知道 trip ID）看到已歸組進某個 trip 的 entries；還沒被 `add-to-trip` 歸組的 entries，這個 CLI 沒有對應的讀取子命令。若需要讀取頻道底下所有 entries（不論是否歸組），改用登入後的網頁介面，或請有權限的人透過該頻道的公開分享連結（`GET /v1/public/{token}`）讀取。
- `reset`/`delete-trip`/`entry-delete` 都是真的會刪除資料的操作，執行前要跟使用者確認範圍（哪個頻道/哪個 entry/trip），不要在不確定的情況下對正式環境資料執行。
