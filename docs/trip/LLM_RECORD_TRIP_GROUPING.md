# LLM 記錄時的行程（Trip）歸組邏輯

> 本文件從條目記錄流程中拆出，只保留會實際異動 Trip 歸屬的操作
> （`add_to_trip`）。地區推斷已改用既有的 `entry_query` 查詢鄰近條目，
> 不再需要獨立查詢 Trip 的工具，詳見 `docs/ENTRY_WRITE_ORDER.md`。
>
> **狀態：trip 相關開發目前暫停。** 本文件描述的 `add_to_trip` 工具
> 目前尚未在程式碼中實作（僅為設計規劃）。

## 概述

條目（Entry）寫入後，若 `entry_add` 回傳的 `candidates`（時間重疊的既有行程列表）
不為空，LLM 需判斷該條目是否語意上屬於某個候選行程，決定是否歸入。

---

## add_to_trip — 歸入行程（選擇性）

`entry_add` 回傳的 `candidates` 若不為空，判斷該條目是否屬於某個候選行程：

- **判斷標準：語意相關**，不只是時間重疊
  - ✅ 同一趟旅程的住宿、機票、景點 → 歸入
  - ❌ 時間碰巧重疊但不同事件 → 不歸入
- 符合條件時呼叫 `add_to_trip(entryID=..., tripID=...)`
- 無候選或都不相關則跳過

---

## 範例

### 確定地點：「6/29 宿希爾頓嘉悅里酒店」

```
1. entry_add(
     item = "宿希爾頓嘉悅里酒店",
     start = "June 29",
     location = "希爾頓嘉悅里酒店"
   )
   → entryID = "ent_xxxx", candidates = []

2. candidates 為空 → 跳過 add_to_trip
```

（此範例的 `entry_query`／`geocode` 查詢部分見 `docs/ENTRY_WRITE_ORDER.md`。）

---

## 工具一覽

| 工具 | 用途 | 必要條件 |
|---|---|---|
| `add_to_trip` | 歸入行程 | candidates 不為空且語意相符 |

---

## 相關文件

- `docs/ENTRY_WRITE_ORDER.md` — 條目寫入的完整流程說明、輸入規則與範例（已不涉及 Trip）
- `docs/ENTRY_CLI_GUIDE.md` — entry_add / entry_query / geocode 的 CLI 指令對照
- `trip/LLM_TRIP_BUILD_ORDER.md` — 整趟行程的建立順序（區間事件先建、單點事件後建）
