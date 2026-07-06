# 條目寫入流程

## 概述

使用者在頻道發送訊息後，LLM 依序執行以下步驟，將事項記錄成條目（Entry）並補充地點座標。

> Trip（行程分組）相關開發目前暫停，本文件已不涉及 Trip 概念。地區推斷改用
> 既有的 `entry_query` 查詢鄰近條目，不依賴任何 Trip 查詢工具。
>
> 完整流程與步驟順序（entry_query → geocode → entry_add）已融入
> `server/internal/llm/assistant_agent.go` 的 `addThought` 常數，此處不再重複，
> 只保留該常數沒有的細節：條目粒度判斷、geocode 技術規格、範例、多筆處理順序。
>
> CLI 指令對照與實作注意事項見 `docs/ENTRY_CLI_GUIDE.md`。

---

## 條目粒度判斷

以**移動距離與交通時間**為切割點判斷粒度，不依事件性質或數量決定。

### 拆成多筆

需要**移動或換交通工具**才能抵達的地點，各建一筆（含 location）：

- ✅ 宿希爾頓嘉悅里酒店 → 一筆，`location = "希爾頓嘉悅里酒店"`
- ✅ 超市補貨 San-A → 一筆，`location = "San-A"`；MaxValu → 另一筆，`location = "MaxValu"`（兩地點間需移動）
- ✅ 桃園機場出發 → 一筆，`location = "桃園國際機場"`

### 合併成一筆

同一地點內的連續事項，或無法對應具體地點的事項，合併為一筆：

- ✅ 同地點內的多項活動（同一商場內逛街、買東西、吃飯）→ 合併，location 填該地點
- ✅ 移動過程（搭機、搭車、開車）→ 合併，location 留空
- ✅ 無具體地點的時間區塊（自由活動、休息、轉機等待）→ 合併，location 留空

**原則：以「是否需要移動或換交通工具」為切割點，不依事件性質或數量決定。**

---

## 步驟說明

### 步驟 1：entry_query — 查鄰近條目推斷地區

有 `location` 時，在寫入條目前先呼叫 `entry_query` 查詢時間鄰近的既有條目，從條目內容推斷整體地區。

```
entry_query(from="June 27", to="July 1")

回傳：
・[entryID=ent_xxx1] 2026-06-28 桃園機場出發
・[entryID=ent_xxx2] 2026-06-28 抵達宮古島
```

**推斷邏輯：**
- 從鄰近條目的地點/描述推斷地理位置，例如：
  - 鄰近條目提到「宮古島機場」「宮古島」→ 地區：宮古島
  - 鄰近條目提到「東京」「新宿」→ 地區：東京
- 優先參考時間上最接近該條目的既有條目
- 若無鄰近條目或無法判斷，直接用 location 原文查詢

---

### 步驟 2：geocode — 查詢地點座標

將推斷出的城市名加在 location 前面，組成查詢字串後呼叫 `geocode`。

**組合規則：**
```
geocode(place = "{城市名}" + "{location 原文}")
```

**範例：**
| location 原文 | 推斷城市 | geocode 查詢字串 |
|---|---|---|
| 希爾頓嘉悅里酒店 | 宮古島 | `宮古島希爾頓嘉悅里酒店` |
| 築地市場 | 東京 | `東京築地市場` |
| 聖誕老人村 | 芬蘭 | `芬蘭聖誕老人村` |

**回傳：**
- `name`：地點全名
- `address`：完整地址
- `lat` / `lng`：經緯度座標

**失敗處理：**
- 查詢失敗（找不到地點）→ 跳過座標，仍繼續寫入條目（不含座標）
- 無法推斷城市 → 直接用 location 原文查詢

查詢成功後，將地點名稱、地址、座標呈現給使用者。

---

### 步驟 3：entry_add — 寫入條目

呼叫 `entry_add` 將使用者輸入的事項記成條目。item/start/startTime/end/location 等
輸入欄位規則見 `assistant_agent.go` 的 `addThought` 常數，此處不再重複。

- `detail`：使用者原始輸入的補充細節（如候選店名、購買項目清單），Thought 未細述，
  規則為不省略、完整保留於此欄位（Thought 沒有的補充規則）

**回傳：**
- `entryID`：新條目的 ID

---

## 範例

### 確定地點：「6/29 宿希爾頓嘉悅里酒店」

```
1. entry_query(from="June 27", to="July 1")
   → 查到鄰近條目提到「宮古島」→ 推斷地區：宮古島

2. geocode(place = "宮古島希爾頓嘉悅里酒店")
   → 📍 Canopy by Hilton Okinawa Miyako Island Resort
   → lat: 24.7994, lng: 125.2592

3. entry_add(
     item = "宿希爾頓嘉悅里酒店",
     start = "June 29",
     end = "June 30",
     location = "希爾頓嘉悅里酒店"
   )
   → entryID = "ent_xxxx"
```

### 需移動的多地點：「6/29 超市補貨：San-A、MaxValu」

```
← 兩個地點間需移動 → 各建一筆

1a. geocode(place = "宮古島San-A") → 📍 San-A Miyakojima City

    entry_add(
      item = "超市補貨",
      start = "June 29",
      location = "San-A",
      detail = "買水果、買零食"
    )
    → entryID = "ent_yyyy1"

1b. geocode(place = "宮古島MaxValu") → 📍 MAXVALU Miyako Minami

    entry_add(
      item = "超市補貨",
      start = "June 29",
      location = "MaxValu",
      detail = "買水果、買零食"
    )
    → entryID = "ent_yyyy2"
```

### 移動段：「6/29 搭機那霸→宮古島」

```
location 為空 → 跳過 entry_query / geocode

entry_add(
  item = "搭機那霸→宮古島",
  start = "June 29",
  startTime = "14:00",
  location = ""          ← 移動過程，無單一地點
)
→ entryID = "ent_zzzz"
```

---

## 多筆條目的處理順序

一次輸入多筆事項時（如「6/29 宿希爾頓、6/30 浮潛、7/1 回程機票」），依以下順序處理：

```
逐筆處理每個事項：
  ├─ 第一筆
  │   1. entry_query   ← 有 location 才做，推斷地區
  │   2. geocode       ← 有 location 才做
  │   3. entry_add
  │
  ├─ 第二筆
  │   1. entry_query
  │   2. geocode
  │   3. entry_add
  │
  └─ 第三筆
      3. entry_add     ← 無 location，跳過 entry_query / geocode
```

**原則：**
- 每筆事項獨立執行 entry_query → geocode → entry_add
- 無 location 的條目跳過 entry_query 與 geocode

---

## 工具一覽

| 工具 | 用途 | 必要條件 |
|---|---|---|
| `entry_query` | 查鄰近條目推斷地區 | 條目有 location |
| `geocode` | 查詢座標 | 條目有 location |
| `entry_add` | 寫入條目 | 使用者輸入有可記錄事項 |

---

## 相關文件

- `server/internal/llm/assistant_agent.go` — `addThought` 常數，實際餵給 LLM 的固定順序與欄位規則
- `docs/ENTRY_CLI_GUIDE.md` — entry_add / entry_query / geocode 的 CLI 指令對照與實作注意事項
- `trip/LLM_RECORD_TRIP_GROUPING.md` — 條目與行程（Trip）的歸組邏輯（`add_to_trip`，trip 相關開發目前暫停）
- `trip/LLM_TRIP_BUILD_ORDER.md` — 整趟行程的建立順序
