# 工作交接：地點照片漸進補圖機制已知問題（R6 未修復）

2026-09-02。`main` 分支（已推送、含 tag `v0.12.0`/`v0.12.1`）上的地點照片
漸進補圖機制已完成並發布，這份文件只記錄尚未修復的已知問題，供之後接續
處理，不再記錄分支狀態（會隨時間迅速過時，請直接查 `git log`/`git branch`
取得當下實際狀態）。

## 已知未修復問題：R6（`places.get` 限流互搶額度）

見 `docs/audit-place-photo-cost-control-2026-09.md` 的 R6 章節——
`GetPlaceDetails`（`textStale` 分支）與 `ListPlacePhotoRefs`（照片補圖
判斷）共用同一個 `"places.get"` 拒絕型限流 key，兩者若在同一次請求中
都被觸發，執行順序在前的會用光 10 秒視窗僅有的 1 次額度，導致執行順序
在後的必然被拒絕（`ErrRateLimited`），照片補圖判斷因此被跳過——不是
機率性問題，是結構性必然發生。

**已查證的推薦修法**（尚未實作）：`GetPlaceDetails` 使用的
`placeDetailsFieldMask` 本身就包含 `photos` 欄位，跟 `ListPlacePhotoRefs`
用的窄遮罩版本計費層級完全相同——`textStale` 觸發時應該直接複用這次
`GetPlaceDetails` 回應的 `details.PhotoRefs` 給照片補圖判斷用，不需要
再額外呼叫一次 `ListPlacePhotoRefs`，兩個判斷式改成共用同一次 API
呼叫結果即可解決額度衝突，同時省下一次外呼。

## 已確認正常、不需要處理的事項（本輪對話排查過，記錄避免重複排查）

- 拒絕型 `RateLimiter` 是全域共用（不分地點），這是使用者確認過的
  刻意設計，不是 bug。
- `places.photoMedia` 10 分鐘限流在同一個 process 生命週期內確認正確
  生效（用 `geo_api_call_logs` 實測驗證過）。
- `google_place_photos`／`place_pexels_photos` 兩張表的資料、URL 前綴
  格式都正確，沒有發現真正的資料寫入異常（先前懷疑的「同一時間戳寫入
  2 筆」是 `SetGooglePlacePhotos` 整批覆寫策略的正常副作用，不是併發
  漏洞）。
- 曾在 `PhotoCarousel.tsx` 試做過「Pexels 來源純文字署名」的顯示效果，
  純測試性質、非正式需求，未保留，不需要重建。

## 相關文件

- `docs/audit-place-photo-cost-control-2026-09.md`：完整成本控制稽核
  紀錄（R1-R6）。
- `CHANGELOG.md` v0.12.0／v0.12.1：這次對話已完成並發布的功能清單。
