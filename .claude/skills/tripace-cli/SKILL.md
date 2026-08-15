---
name: tripace-cli
description: 用 tripace 自己的 CLI 工具(server/cmd/cli)透過 HTTP 存取 tripace 資料(行程/entry/地標),不需要碰資料庫連線字串。觸發語如「查行程」「用 cli 查 tripace」「新增 entry」「查某個行程有哪些項目」。
---

# tripace-cli

`server/cmd/cli` 是 tripace 專案自帶的 entry/trip 操作工具，讓 Claude Code 可以直接用 HTTP 打自家 server 的 `/internal/*`、`/v1/*` API 查資料或寫資料，不需要手動組 curl、也不需要碰資料庫。

**這個 skill 內建預先編譯好的執行檔**，位於 `/Users/caitingyu/Documents/tripace/.claude/skills/tripace-cli/bin/`。目前只實際編了本機這台機器的平台：

- `tripace-cli-darwin-arm64`

優先使用這個內建執行檔，不需要每次都重新 `go run` 編譯。呼叫時直接用完整路徑：

```bash
/Users/caitingyu/Documents/tripace/.claude/skills/tripace-cli/bin/tripace-cli-darwin-arm64 list-trips
```

**執行檔是某一個時間點的快照，`server/cmd/cli` 原始碼有更新（新增子命令、改參數）之後這個執行檔不會自動同步**——若懷疑執行檔行為跟目前原始碼對不上（例如這份文件提到的子命令執行檔不認得），用下方「備援：go run 現場編譯」重新驗證，並考慮重新編譯覆蓋這個執行檔（`cd server && GOWORK=off GOOS=darwin GOARCH=arm64 go build -o ../.claude/skills/tripace-cli/bin/tripace-cli-darwin-arm64 ./cmd/cli`）。

#### 備援：go run 現場編譯

不確定執行檔是否過時、或需要在其他平台（非 darwin/arm64）執行時，改用 `go run` 現場編譯執行，行為與內建執行檔完全一致，只是每次都要重新編譯：

**注意：本機執行需要 `GOWORK=off`**（`server` 目前未列在根目錄 `go.work` 的 workspace 模組清單裡，直接 `go run ./cmd/cli` 會報 `directory cmd\cli is contained in a module that is not one of the workspace modules`；不要執行 `go work use .` 加回去，這是刻意保持獨立模組的設定），例如 `GOWORK=off go run ./cmd/cli list-trips`。

> 以下與後續章節為了簡潔，一律直接寫 `tripace-cli list-trips`、`tripace-cli create-trip` 等指令；實際執行時請替換成上面判斷出來的內建執行檔完整路徑，或備援方案的 `GOWORK=off go run ./cmd/cli`。

**CLI 現在一律走 HTTP。原本的 `-db` 直連 PostgreSQL 模式（繞過 server 的認證與業務邏輯層）已整個移除**——所有操作都經過 server 的 HTTP API，維運性質的操作（景點區域人工建檔等）歸在 `/internal/maintenance/*` 命名空間，跟一般使用者流量、產品核心端點分開，方便從請求統計分辨流量來源。

## 前置：登入

除了 `create-trip` 以外，其餘子命令都是 `/internal/*` 路由，需要先登入拿到 JWT（`geocode` 原本不需要登入、直接在 CLI 本機用 `GOOGLE_PLACES_API_KEY` 打 Google，現已改走後端的 `/internal/maintenance/geocode`，跟其餘子命令一樣需要先登入）：

```bash
tripace-cli login --web
```

會開瀏覽器走核准流程，成功後 token 存在 `os.UserConfigDir()/tripace/token`（macOS/Linux 是 `~/.config/tripace/token`），之後的指令會自動帶上，不需要重新登入。這個 token 快取跟執行檔無關（不管用內建執行檔還是 `go run` 現場編譯都讀寫同一個路徑），不需要為了登入狀態重新編譯或切換執行方式。

本機另外跑 Vite dev server（`:5173`）、而 server 走 `:8080` 時，可以加 `-console http://localhost:5173` 讓核准頁面走有熱重載的 dev server：

```bash
tripace-cli login --web -console http://localhost:5173
```

`-api URL` 全域旗標可指定 server 位址（預設 `http://localhost:8080`），用於連正式環境或非預設埠的本機環境。

## 常用子命令

所有輸出皆為 JSON，方便直接解析。以下是 `--help` 目前印出的實際子命令（頻道/channel 已全面改名為行程/trip；早期版本的 `--help` 用過 `record`/`update-entry`/`list-channels`/`create-channel`/`-channel` 這些已淘汰名稱，若看到別處文件或記憶提到它們，一律換成下方對應的 trip 版本）。

```bash
# 列出所有行程
tripace-cli list-trips

# 建立行程（唯一不需要登入的寫入操作，用 /v1/trips，owner 是登入身分）
tripace-cli create-trip -name "行程名稱"

# 列出某行程底下所有 entry
tripace-cli trip-entries -trip trip_xxx

# 新增 entry
tripace-cli entry-add -trip trip_xxx -title "文字" \
  [-start 'YYYY-MM-DD'] [-start-time 'HH:MM'] [-end ...] [-end-time ...] [-location ...]

# 更新 entry（只需帶要改的欄位）
tripace-cli entry-update -entry ent_xxx \
  [-title ...] [-start ...] [-end ...] [-location ...] [-note ...] \
  [-kind stay|flight|activity|note|car|restaurant|ticket] [-detail '{"json":"字串"}']

# 刪除 entry
tripace-cli entry-delete -entry ent_xxx

# 清空行程所有 entries（危險操作，會實際刪除資料，執行前務必跟使用者確認）
tripace-cli reset -trip trip_xxx

# 手動觸發即時推播通知（一般不需要主動呼叫，server 端已自動廣播）
tripace-cli notify -trip trip_xxx

# 地點搜尋(可選擇順便把第一筆候選座標寫回某個 entry)
tripace-cli geocode -place "地點名稱" [-region tw] [-n 3] [-entry ent_xxx]

# 新增景點區域資料（地理輪廓底圖用）；-lat/-lng 與 -place 二擇一，
# -place 會先查該地名座標（取第一筆候選）再建檔，不需要自己先查好經緯度；
# -photo-url 未帶時後端會自動查 Pexels 補一張示意圖
tripace-cli attraction-add -name "古城區" -city "台南" -lat 22.99 -lng 120.20 -level 3
tripace-cli attraction-add -name "清水寺" -city "京都" -place "清水寺 京都" -region jp -level 4

# 列出指定城市的所有景點區域資料
tripace-cli attraction-list -city "台南"

# 列出目前已有景點區域資料的城市清單
tripace-cli attraction-cities

# 刪除一筆景點區域資料
tripace-cli attraction-delete -id lmk_xxx

# 修正一筆景點區域資料的座標（建檔時輸入錯誤時用）；-lat/-lng 與 -place 二擇一，
# 用法同 attraction-add 的座標二擇一機制
tripace-cli attraction-update -id lmk_xxx -lat 35.0116 -lng 135.7681
tripace-cli attraction-update -id lmk_xxx -place "清水寺 京都" -region jp

# 重新透過 Google Places 查詢一次地標圖片並回寫
tripace-cli attraction-update-photo -id lmk_xxx
```

`entry-add`/`entry-update` 的 `-kind` 若填 `stay`，代表這筆是住宿（飯店）項目；`-location` 填地址或飯店名稱、`-detail` 可帶額外 JSON（例如飯店資訊）。飯店本身沒有獨立的「加入行程」子命令——飯店資料是即時透過 Google Places 查詢（見 `server/internal/geo/places.go`），流程是先用 `geocode` 或前端地圖找到飯店名稱/座標，再用 `entry-add -kind stay` 把它記成一筆行程項目。

## 已知限制

- `reset`/`entry-delete`/`attraction-delete` 都是真的會刪除資料的操作，執行前要跟使用者確認範圍（哪個行程/哪個 entry/哪個地標），不要在不確定的情況下對正式環境資料執行。
- `attraction-update` 目前只支援修正座標（`-lat`/`-lng` 或 `-place`/`-region`），不支援改名稱/城市/分級等其他欄位——這幾個欄位若填錯，需要 `attraction-delete` 後重新 `attraction-add`。
- `/internal/maintenance/*`（`geocode`、`attraction-*`、`landmarks/{id}/update-photo` 的底層端點）是刻意跟 `/internal/geo/*` 分開命名空間的維運專用端點，前端產品本身不會呼叫這批路徑，只有 CLI 會用到。
- `attraction-add` 未帶 `-photo-url` 時會自動打 Pexels Search API 查一張示意圖補上（見 `server/internal/pexels`）——這不是該地點的真實照片，只是關鍵字比對到的示意圖；需要 `PEXELS_API_KEY` 環境變數，未設定時靜默略過照片查詢，不影響其餘欄位建檔。
