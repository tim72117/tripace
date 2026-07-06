# 條目 CLI 操作指南

> 條目寫入的完整流程說明（步驟順序、輸入規則、範例）見 `docs/ENTRY_WRITE_ORDER.md`。
> 本文件只提供對應的 CLI 指令與實作時的注意事項。

---

## CLI 指令對照

```bash
# 步驟 1：查鄰近條目推斷地區
go run ./cmd/cli entry-query -channel ch_3eea1dd7 -from "2026-06-27" -to "2026-07-01"

# 步驟 2：帶城市名查座標
go run ./cmd/cli geocode -place "宮古島希爾頓嘉悅里酒店" -n 1

# 步驟 3：寫入條目
go run ./cmd/cli entry-add \
  -channel ch_3eea1dd7 \
  -item "宿希爾頓嘉悅里酒店" \
  -location "希爾頓嘉悅里酒店" \
  -start "2026-06-29" \
  -end "2026-06-30"
```

---

## 實際操作注意事項（從模擬中歸納）

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

**若候選清單中沒有地區正確的結果，跳過 geocode，`entry-add` 時不帶 `-location`，不寫入座標。** 寫入錯誤座標比沒有座標更糟。

---

### 無地點的條目跳過 geocode

以下類型不需要 geocode，直接 `entry-add` 即可：
- 泛指活動（租車、check-in、晚餐）
- 無具體店名的事項（逛市區、超市補貨但不指定店家）
- 回國／出發等移動事件

---

## 相關文件

- `docs/ENTRY_WRITE_ORDER.md` — 條目寫入的完整流程說明、輸入規則與範例
