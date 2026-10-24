# map/draw/layers(功能層)

功能層放在這裡:一個檔案一個功能層,檔名 `<name>Layer.ts`,旁邊放 `<name>Layer.test.ts`。

規則(見 `../types.ts` 檔頭):
- 匯出一個純函式 `<name>Layer(input): FeatureLayer`。**沒有 hook、沒有副作用、不碰 `google.maps`**,只把資料轉成 `Drawable[]`。
- `FeatureLayer.id` 固定且唯一(例如 `'currentLocation'`);`drawables` 的 `id` 只需要在這個功能層內唯一。
- 需要強調色等「要從地圖讀」的值,一律當作 input 傳進來(由接線的那一層用 `useAccentColor` 取得)。
- 疊放順序只用 `group`,不要自己寫 `zIndex`;數值集中在 `../zOrder.ts`。
- 沒有東西要畫時回傳 `drawables: []`,不要回傳 null。
- marker 的內容用 `createContent` 加 `contentKey`:內容沒變時 `contentKey` 要保持不變。
- marker 的 `anchor`:圓形標記(圓心就是座標)一律給 `'center'`,宿主會把 content 往下位移半個高度讓圓心對準座標;
  沒傳是 Google 預設的底部中央(圖釘語意),只有尖端在座標上的形狀才用。目前所有 marker 都是圓形,都給 `'center'`。

連線(站點之間的線)的兩個功能層 `routeLineLayer`(一段一條、只畫有交通膠囊的段、主題強調色;段的來源是
`planning/timeline/segments.ts` 的 `routeSegmentsFromTimeline`,三個入口共用)、`transitHoverLineLayer`(hover 交通膠囊的虛線)
共用兩個輔助檔,不是功能層:
- `routeArc.ts`:站點之間的弧線取樣(Web Mercator 平面上的二次貝茲,弧度與弦長成比例、一律鼓向行進方向左側、太短退回直線)。
  兩個層都用同一組參數,hover 虛線才會準確疊在連線的對應段上。
- `routeStyle.ts`:線寬、透明度、光暈(casing,group `routeCasing`,疊在所有顏色線下)、圓頭線帽、方向箭頭、圓點虛線的數值都集中在這裡。
