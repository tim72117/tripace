# 行程寫入順序說明

以「6/29 宿希爾頓嘉悅里酒店」為實際範例，說明 LLM 處理一筆行程輸入的完整順序。

---

## 一、單筆行程的寫入順序

### 1. list_trips — 先看現有行程，推斷整體地區

在記錄任何條目之前，先查頻道現有行程，了解整體旅遊地區。

```
list_trips(channel = ch_3eea1dd7)

回傳：
- 2025 沖繩
- 2025 北海道
- 2025 宮古島  ← 與「希爾頓嘉悅里酒店」語意相關，推斷地區：宮古島
- 2025 首爾
- 2026 北歐芬蘭
- 2026 冰島
```

**推斷邏輯：** 希爾頓嘉悅里酒店（Canopy by Hilton）在日本有宮古島分館，且頻道有「2025 宮古島」行程 → 地區鎖定宮古島。

---

### 2. geocode — 帶城市名查詢座標

將推斷出的城市名加在地點前，查詢精確座標。

```
geocode(place = "宮古島希爾頓嘉悅里酒店")

回傳：
- name: Canopy by Hilton Okinawa Miyako Island Resort
- address: Kugai-550-7 Hirara, Miyakojima, Okinawa 906-0015, Japan
- lat: 24.7994493
- lng: 125.2592204
```

**為何先查座標再記錄：** 確認地點存在且正確後再寫入，避免記錄錯誤地點。

---

### 3. record_entry — 寫入條目

確認地點正確後寫入條目。

```
record_entry(
  item     = "宿希爾頓嘉悅里酒店",
  start    = "June 29",       ← 日期語詞，系統換算成 2026-06-29
  end      = "June 30",
  location = "希爾頓嘉悅里酒店"
)

回傳：
- entryID: ent_ac67259e58be
- candidates: []              ← 無時間重疊的現有行程
```

---

### 4. add_to_trip — 歸入行程（視情況）

若 `candidates` 不為空，判斷語意是否相符後歸入。

```
本例 candidates 為空 → 跳過
```

若有候選：
```
add_to_trip(
  entryID = "ent_ac67259e58be",
  tripID  = "trip_xxxxxx"     ← 選語意最相符的候選
)
```

---

## 二、多筆行程的處理順序

一次輸入多筆事項時（如「6/29 宿希爾頓、6/30 浮潛、7/1 回程機票」），依以下順序處理：

```
1. list_trips          ← 只做一次，取得整體地區資訊

逐筆處理每個事項：
  ├─ 第一筆
  │   2. geocode       ← 有 location 才做
  │   3. record_entry
  │   4. add_to_trip   ← candidates 不為空才做
  │
  ├─ 第二筆
  │   2. geocode
  │   3. record_entry
  │   4. add_to_trip
  │
  └─ 第三筆
      3. record_entry  ← 無 location，跳過 geocode
      4. add_to_trip
```

**原則：**
- `list_trips` 只在整個對話開始時呼叫一次，不重複呼叫
- 每筆事項獨立執行 geocode → record → add_to_trip
- 無 location 的條目跳過 geocode

---

## 三、新建行程 vs 歸入既有行程

| 情況 | record_entry 的 candidates | 後續動作 |
|---|---|---|
| 時間與既有行程重疊，語意相符 | 有候選 | `add_to_trip(tripID=候選ID)` |
| 時間與既有行程重疊，但不同事件 | 有候選 | 不呼叫，跳過 |
| 時間無重疊，全新行程 | 空 | `add_to_trip(tripID="", title="行程名")` 新建 |
| 無法判斷 | 有候選 | 詢問使用者確認後再歸入 |

---

## 四、實際 CLI 指令對照

```bash
# 步驟 1：查現有行程
go run ./cmd/cli list-trips -channel ch_3eea1dd7

# 步驟 2：帶城市名查座標
go run ./cmd/cli geocode -place "宮古島希爾頓嘉悅里酒店" -n 1

# 步驟 3：寫入條目
go run ./cmd/cli record \
  -channel ch_3eea1dd7 \
  -item "宿希爾頓嘉悅里酒店" \
  -location "希爾頓嘉悅里酒店" \
  -start "2026-06-29" \
  -end "2026-06-30"

# 步驟 4（有候選時）：歸入行程
go run ./cmd/cli add-to-trip -entry ent_ac67259e58be -trip trip_xxxxxx
```
go run ./cmd/cli add-to-trip -entry ent_ac67259e58be -trip trip_xxxxxx
```

---

## 五、CLI 實際操作注意事項（從模擬中歸納）

### GOOGLE_PLACES_API_KEY 需手動帶入

CLI 不會自動讀取 `.env`，geocode 指令需明確帶環境變數：

```bash
GOOGLE_PLACES_API_KEY=<key> go run ./cmd/cli geocode -place "宮古島希爾頓嘉悅里酒店" -n 1
```

key 存放於 `server/.env`，不進版控。

---

### geocode 查詢字串要帶城市名

查詢字串加上城市名可顯著提高 Google Places 回傳正確地區的機率：

```
✅ "宮古島希爾頓嘉悅里酒店"   → Canopy by Hilton Okinawa Miyako Island Resort
❌ "希爾頓嘉悅里酒店"          → 可能回傳其他城市的同名飯店
```

回傳的 `address` 欄位包含完整地址（城市、縣市、國家），可用來確認地區是否正確。若不確定，可用 `-n 3` 取多筆候選後人工選擇正確的一筆。

**若候選清單中沒有地區正確的結果，跳過 geocode，`record` 時不帶 `-location`，不寫入座標。** 寫入錯誤座標比沒有座標更糟。

---

### candidates 為空不代表不需要歸入

第二段住宿或後續單點事件 `record` 後若 `candidates` 為空，可能是因為骨架的 trip end date 尚未擴張。此時仍需手動呼叫 `add-to-trip -trip <tripID>` 強制歸入：

```bash
go run ./cmd/cli add-to-trip -entry ent_xxxxxx -trip trip_186e4fbf
```

---

### Trip 的 end date 顯示不會即時擴張

`list-trips` 回傳的 trip `end` 欄位可能不反映最新歸入的 entries 日期，但所有 entries 仍已正確歸入該 trip。可用 `trip-entries` 確認：

```bash
go run ./cmd/cli trip-entries -channel ch_3eea1dd7 -trip trip_186e4fbf
```

---

### 無地點的條目跳過 geocode

以下類型不需要 geocode，直接 `record` 即可：
- 泛指活動（租車、check-in、晚餐）
- 無具體店名的行程（逛市區、超市補貨但不指定店家）
- 回國／出發等移動事件
