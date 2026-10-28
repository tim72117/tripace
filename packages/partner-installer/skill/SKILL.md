---
name: tripace-partner-cli-setup
description: 協助廣告業主/聯盟行銷夥伴透過 partner-cli 登入 Tripace 業主控制台、建立廣告活動(campaign)、新增方案內容(ad plan,支援多個出發日梯次)、管理投放頁面與狀態。當使用者想操作自己在 Tripace 上的廣告活動、詢問如何使用 partner-cli、或想批次建立/編輯方案內容時使用這個 skill。
---

# Tripace partner-cli 設定與廣告活動操作

協助廣告業主/聯盟行銷夥伴完成 Tripace 業主控制台的終端機操作：取得並登入 `partner-cli`、建立/管理廣告活動（campaign）、新增/編輯方案內容（plan）。

這支 CLI 服務的對象是**業主本人**，不是 Tripace 內部維運人員——跟業主自己也能用的網頁版控制台（`web/partner`）操作同一組資料，兩者互通，CLI 建的活動網頁上看得到，反之亦然。

## 一、取得 partner-cli 並登入

### 1. 檢查/取得 partner-cli

`partner-cli` 執行檔在安裝這個 skill 時（`npx @tripace/partner-claude-skill`）自動下載到 `${CLAUDE_SKILL_DIR}/bin/`，檔名依平台是 `partner-cli-windows-amd64.exe`、`partner-cli-darwin-amd64`、`partner-cli-darwin-arm64`、`partner-cli-linux-amd64`、`partner-cli-linux-arm64` 之一（只有目前所在平台那一個會存在，不是五個都有）。全域 PATH 上通常不會有 `partner-cli` 指令，**不要**直接執行裸指令 `partner-cli`，而是呼叫 `${CLAUDE_SKILL_DIR}/bin/` 底下對應目前平台的執行檔，例如：

```bash
"${CLAUDE_SKILL_DIR}/bin/partner-cli-linux-amd64" campaign list
```

若 `${CLAUDE_SKILL_DIR}/bin/` 底下找不到對應目前平台的執行檔（例如安裝當下這個平台沒有可下載的版本），不要嘗試執行不存在的檔案，也不要自行編譯或安裝——直接告知使用者這個 skill 目前沒有適用於他們平台的執行檔。

### 2. 登入

> 以下與後續章節為了簡潔，一律直接寫 `partner-cli login`、`partner-cli campaign list` 等指令；實際執行時請替換成上一步判斷出來的完整路徑，例如 `${CLAUDE_SKILL_DIR}/bin/partner-cli-linux-amd64 login -email ... -password ...`，而不是直接執行裸指令 `partner-cli`。

`partner-cli` 的登入身分**跟 Tripace 主站一般使用者帳號是同一套**（不是獨立的業主密碼系統）——業主必須先在 `https://tripace.io`（或本機開發環境）用 email/password 註冊過一般帳號，並由內部窗口透過 `tripace-cli partner-grant` 開通業主身分，才能用這支 CLI 操作：

**優先用瀏覽器核准登入，不要請使用者把密碼貼進對話或指令裡**：

```bash
partner-cli login -web -api https://tripace.io
```

執行後會自動開啟瀏覽器到核准頁面（若沒有自動開啟，會印出網址讓使用者手動開），使用者在瀏覽器登入並按下核准，CLI 就會收到登入憑證。整個過程密碼不會經過終端機。`login` 沒給 `-email`/`-password` 時預設就是這個流程，`-web` 可以省略。5 分鐘內沒核准會逾時，重新執行即可。

只有使用者明確要求、或環境無法開瀏覽器時，才改用帳密登入：

```bash
partner-cli login -email <email> -password <password> -api https://tripace.io
```

- `-api`：partner 控制台後端的 URL。正式環境業主控制台與主站在同一台主機，直接用 `https://tripace.io`，不需要給 `-main-api`（會自動退回等於 `-api`）。
- `-main-api`：主站登入端點（`/v1/auth/login`、`/v1/cli-auth/*`）所在的 URL。只有本機開發環境業主後端與主站跑在不同 port 時才需要分開指定，正式環境不用給。
- `-console`：核准頁面所在的前端網址，只有本機開發前端跟主站 API 不同 origin 時才需要，正式環境不用給。

**正式環境一律用 `-api https://tripace.io`。** 使用者說的是本機或測試環境時，先問清楚網址，不要自行猜測。登入時若遇到網址被轉址（301/302）的錯誤，代表網址已搬家，請改用回應中指出的新網址。

登入成功後，`partner-cli login` 會自動打一次 `/partner/api/me` 驗證這個帳號確實有業主身分：
- 如果印出業主資訊（`id`/`name`/`status` 等），代表登入與業主身分驗證都成功，可以繼續後續操作。
- 如果顯示帳號密碼錯誤，請使用者確認帳密是否正確（跟主站一般帳號共用）。
- 如果顯示「這個帳號似乎沒有業主權限」，代表帳密正確但尚未被開通業主身分，請使用者聯絡內部窗口透過 `tripace-cli partner-grant -email <email> -name <業主名稱>` 開通，不是這支 CLI 本身能自助申請的（目前沒有自助申請流程）。

## 二、管理廣告活動（campaign）

`partner-cli` 的指令樹是 `<resource> <verb>` 形式：`campaign list`/`campaign create`/`campaign update`/`campaign status`/`campaign placements`/`campaign delete`，`plan list`/`plan create`/`plan update`/`plan status`/`plan delete`，再加上 `login`/`version`。

### 1. 建立活動

```bash
partner-cli campaign create -name <活動名稱> [-placement <投放頁面slug>] [-start YYYY-MM-DD] [-end YYYY-MM-DD]
```

新建立的活動狀態固定是 `draft`（草稿），**不會**出現在任何前台頁面上，需要之後手動轉成 `active` 才會開始投放（見下方「轉換活動狀態」）。`-start`/`-end` 是檔期的起訖日期，選填——留空代表尚未指定明確檔期。`-placement` 同樣選填，留空也可以之後用 `campaign update` 補上；合法的 slug 清單見下方「查詢可投放頁面」。

成功會回傳這筆活動的完整 JSON（含系統配發的 `id`，例如 `cmp_xxxxx`），後續 `campaign status`/`plan create` 等操作都需要用到這個 `id`。

### 2. 列出活動

```bash
partner-cli campaign list
```

列出目前登入業主名下的所有活動（不分狀態），只會看到自己的活動，看不到其他業主的——這是後端強制的資料隔離，不是這支 CLI 選擇性顯示。

### 3. 修改活動基本資料（含投放頁面）

```bash
partner-cli campaign update -id <活動ID> [-name <活動名稱>] [-placement <投放頁面slug>] [-start YYYY-MM-DD] [-end YYYY-MM-DD]
```

**只會修改有給的旗標，沒給的欄位保留原值**——例如只改投放頁面就只給 `-placement`，名稱和檔期不會被動到。至少要給一個旗標。想清空某個欄位時明確傳空字串（例如 `-placement ""`）。這是設定/修改投放頁面（`placement`）的指令，不需要引導使用者到網頁版控制台操作。

### 4. 查詢可投放頁面

```bash
partner-cli campaign placements
```

回傳後端目前認得的所有合法 `placement` slug 與中文名稱（例如 `kyoto-kiyomizu` 對應「京都清水寺」）。設定 `campaign create`/`campaign update` 的 `-placement` 旗標前，建議先跑這個指令確認 slug 拼對，而不是憑記憶猜——傳入不在這份清單裡的 slug 不會報錯，但活動永遠不會被對應的前台頁面查到。

### 5. 轉換活動狀態

```bash
partner-cli campaign status -id <活動ID> -status <新狀態>
```

狀態值必須是以下其中一個：
- `draft`：草稿，不會投放，使用者還在準備素材/內容。
- `scheduled`：已確認、檔期未到，系統知道這個活動存在但還不投放。
- `active`：**正在投放**——只有這個狀態的活動，底下已發布的方案才會出現在對應的前台頁面上。
- `paused`：檔期內但手動暫停（例如素材有問題、臨時想下架）。
- `ended`：檔期已過或手動結束。

**這裡沒有自動依日期切換狀態的機制**——`active` 是完全手動控制的，即使填了 `-start`/`-end` 日期也不會自動開始/結束投放，需要使用者自己在對的時間點執行 `campaign status` 切換。協助使用者操作時，記得提醒這一點，避免使用者以為設了日期就會自動生效。

### 6. 刪除活動

```bash
partner-cli campaign delete -id <活動ID>
```

**刪除前務必跟使用者再次確認**——這是不可逆操作，且目前不會自動清空底下的方案（見下方「方案」一節），刪除活動前建議先確認底下是否還有想保留的方案內容。

## 三、管理方案內容（plan）

每個活動底下可以有多個方案，各自代表一份具體的素材/文案（例如不同梯次、不同商品）。

### 1. 建立方案

```bash
partner-cli plan create -campaign <活動ID> -title <方案標題> [-category <分類>] [方案內容旗標]
```

- `-category`：選填，自由字串，例如 `display`、`deeplink`、`group_tour`，用來分類方案性質，後端不驗證合法值。
- 方案內容（選填）有三種給法，**優先用前兩種，不要手寫 JSON 字串**（引號、`\n`、`$` 跳脫和中文轉碼都很容易出錯）：
  1. **結構化旗標**（CLI 會自己組 JSON 並檢查格式）：`-departure "日期|星期|團費"`（可重複，每個旗標一個梯次，例如 `-departure "2026-10-27|星期二|$21,900"`；星期可留空 `"2026-10-27||$21,900"`）、`-highlight "文字"`（可重複，每個旗標一行亮點）、`-days`、`-original-price`、`-desc`、`-cta-label`、`-landing-url`。含 `$`、`|` 或空白的值要加引號，bash 用單引號最單純。
  2. **`-detail-file <路徑>`**：從 UTF-8 檔案讀整份 JSON，`-` 代表從 stdin 讀。內容多或含中文時最穩，先把 JSON 寫成 UTF-8 檔案再傳路徑。Windows PowerShell 5.1 的 `>` 預設存成 UTF-16，CLI 會偵測到並提示改存 UTF-8。
  3. `-detail '<JSON字串>'`：整份 JSON 字串，與 `-detail-file` 擇一。
- 欄位名稱與格式必須照下一節「detail 欄位的正確格式」，不要自行發明欄位名稱。CLI 會檢查型別（例如 `price` 給純數字會被拒絕）並對未知欄位印出警告。
- CLI 與後端都會拒絕含亂碼字元（U+FFFD）的文字，避免中文被 shell 轉錯碼後默默存進去。遇到這個錯誤時，改用 `-detail-file` 或請使用者到網頁版控制台輸入。

新建立的方案狀態固定是 `draft`，一樣要手動轉成 `published` 才會顯示在前台（見「轉換方案狀態」）。

### 2. detail 欄位的正確格式

`detail` 對應網頁版控制台（`web/partner`）表單收集的同一組欄位，前台頁面（`SponsoredPlanCard` 元件）會依這個形狀解析渲染。完整欄位如下：

```json
{
  "departures": [
    { "date": "2026-12-18", "weekday": "星期五", "price": "$32,900" },
    { "date": "2027-01-10", "weekday": "星期日", "price": "$29,900" }
  ],
  "days": "5",
  "originalPrice": "$35,900",
  "highlights": "花海美景｜大阪璀璨花海\n嵐山觀光｜嵐山小火車\n古都名寺｜清水寺＋京都一晚",
  "desc": "小樽運河、白色戀人工廠、二世谷滑雪初體驗，含三餐溫泉飯店。",
  "ctaLabel": "立即報名",
  "landingUrl": "https://example.com/tours/hokkaido-powder-5d"
}
```

- `departures`：**陣列**，每個元素是一個出發日梯次（`date`/`weekday`/`price` 皆為字串）。同一條行程若有多個出發日各自不同報價，就在這個陣列裡列出多筆——這是真實旅行社行程常見的情境（同一行程、多個梯次、各自報價），不要誤以為一個方案只能有一個出發日。
- `price` 務必填**帶格式的字串**（例如 `"$32,900"`），**不要填純數字**（例如 `32900`）——前台不會自動幫數字加千分位或幣別符號，填純數字會直接原樣顯示成 `32900`，體驗很差。
- `highlights`：**單一字串**，不是陣列，用換行字元 `\n` 分隔每一行亮點，前台會依換行拆成逐項清單並加上 ✓ 符號。
- `landingUrl`：若要讓方案卡片顯示「可點擊的 CTA 按鈕」，這個欄位必須有值；沒有填的話，即使填了 `ctaLabel` 也不會顯示任何按鈕（因為沒有連結可以點）。
- 所有欄位皆為選填——沒有要用到的欄位可以完全省略，不需要填空字串佔位。

**要手寫 JSON 字串（`-detail`）時要特別注意跳脫**：在 shell 指令列傳遞含雙引號的 JSON 字串時，依照使用者的作業系統/shell（bash 用單引號包整個字串最單純，PowerShell 需要額外處理雙引號跳脫），先確認他們在用哪種終端機再給出對應的引號寫法。能用結構化旗標或 `-detail-file` 就不要走這條路。

### 3. 列出某活動底下的方案

```bash
partner-cli plan list -campaign <活動ID>
```

### 4. 更新既有方案

```bash
partner-cli plan update -id <方案ID> [-title <方案標題>] [-category <分類>] [方案內容旗標]
```

**只會修改有給的旗標，沒給的欄位保留原值**，至少要給一個旗標。方案內容旗標的行為：
- 結構化旗標只覆蓋有給的欄位，其他欄位保留。例如 `plan update -id <方案ID> -desc "新說明"` 只改說明，梯次、亮點、價格都不動。
- `-departure` 一旦出現，就用這次給的全部梯次**取代**現有的所有梯次（要保留舊梯次就要一併重新給）；`-highlight` 同理。
- 給 `-detail`/`-detail-file` 則**整份取代**現有內容，沒寫進去的欄位會消失。
- 給空字串（例如 `-desc ""`）會移除該欄位。
- 若現有內容本身已含亂碼，只改其他欄位會被擋下並提示，這時用 `-detail-file` 整份重新提供。

成功時回傳更新後的完整方案物件，不需要再另外跑 `plan list` 確認。

### 5. 轉換方案狀態

```bash
partner-cli plan status -id <方案ID> -status <draft|published>
```

只有 `published` 狀態、且所屬活動是 `active` 狀態，方案才會出現在對應的前台頁面上——兩個條件缺一不可。協助使用者除錯「為什麼我的方案沒有顯示在網頁上」時，依序檢查：
1. 方案本身的 `status` 是否為 `published`（用 `plan list` 確認）。
2. 所屬活動的 `status` 是否為 `active`（用 `campaign list` 確認）。
3. 活動是否有設定正確的投放頁面（`placement`）——用 `campaign placements` 查出合法 slug，再用 `campaign update -id <活動ID> -placement <slug>` 修正（只會改投放頁面，名稱和檔期不變）。

### 6. 刪除方案

```bash
partner-cli plan delete -id <方案ID>
```

同樣是不可逆操作，操作前跟使用者確認。

## 四、版本查詢

```bash
partner-cli version
```

印出目前這支執行檔的版本（對應 release 的 tag，例如 `partner-cli-v0.1.0`）。若使用者懷疑手上的版本過舊、或想確認是否有新版可用，可以搭配安裝器的 `npx tripace-partner-cli-setup version`（比對本機已裝版本與 GitHub 最新 release）與 `npx tripace-partner-cli-setup upgrade`（重新下載新版）——這兩個是安裝器層級的指令，不是 `partner-cli` 本身的子指令，不要混淆。

## 完整流程總覽

1. 判斷目前平台，呼叫安裝時已下載到 `${CLAUDE_SKILL_DIR}/bin/partner-cli-<os>-<arch>[.exe]` 的執行檔；若目前平台沒有對應版本，告知使用者此 skill 目前沒有對應執行檔，不要自行編譯或安裝。
2. 確認使用者已經有 Tripace 一般帳號、且已被內部窗口開通業主身分（`tripace-cli partner-grant`）——這不是 `partner-cli` 能自助完成的前置條件。
3. 執行 `partner-cli login -web -api https://tripace.io` 登入，確認回傳業主資訊而非錯誤訊息。
4. 執行 `partner-cli campaign create -name ...` 建立活動，記下回傳的 `id`。
5. 執行 `partner-cli plan create -campaign <活動ID> -title ... -departure "日期|星期|團費" -highlight "..." ...` 建立方案（優先用結構化旗標或 `-detail-file`，欄位格式見第三節「detail 欄位的正確格式」），團費用帶格式字串、多個梯次就重複 `-departure`。
6. 方案內容確認無誤後，執行 `partner-cli plan status -id <方案ID> -status published` 發布。
7. 執行 `partner-cli campaign status -id <活動ID> -status active` 啟用活動——方案要出現在前台，活動跟方案兩者的狀態都要到位（`active` + `published`），缺一不可。
8. 若方案沒有出現在前台頁面，依序檢查方案狀態、活動狀態、活動的投放頁面（`placement`，用 `campaign placements` 查合法清單、`campaign update` 設定）三項。
9. 需要調整方案內容時用 `plan update`（只改有給的旗標，沒給的保留）；需要下架時把對應的 `campaign status`/`plan status` 改回非 `active`/`published` 的狀態，而非直接刪除（除非使用者明確要求永久移除）。
