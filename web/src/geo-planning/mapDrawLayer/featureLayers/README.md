# featureLayers

功能層放在這裡:一個檔案一個功能層,檔名 `<name>Layer.ts`,旁邊放 `<name>Layer.test.ts`。

規則(見 `../types.ts` 檔頭):
- 匯出一個純函式 `<name>Layer(input): FeatureLayer`。**沒有 hook、沒有副作用、不碰 `google.maps`**,只把資料轉成 `Drawable[]`。
- `FeatureLayer.id` 固定且唯一(例如 `'currentLocation'`);`drawables` 的 `id` 只需要在這個功能層內唯一。
- 需要強調色等「要從地圖讀」的值,一律當作 input 傳進來(由接線的那一層用 `useAccentColor` 取得)。
- 疊放順序只用 `group`,不要自己寫 `zIndex`;數值集中在 `../zOrder.ts`。
- 沒有東西要畫時回傳 `drawables: []`,不要回傳 null。
- marker 的內容用 `createContent` 加 `contentKey`:內容沒變時 `contentKey` 要保持不變。
