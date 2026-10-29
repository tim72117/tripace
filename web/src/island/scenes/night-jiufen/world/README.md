# night-jiufen/world——夜遊九份的場景資料

格式定義在 `src/island/logic/world/sceneFormat.ts`。單位一律是公尺(1 格 = 1 m)。

| 檔案 | 內容 | 怎麼改 |
|---|---|---|
| `scene.json` | 格式版本、格子規格(`grid.cellSize`)、場景種子、程序化圖層清單與順序、島厚/海/河 | 手改;圖層順序要和 `../rules.ts` 的 `RULE_LAYERS` 一致 |
| `terrain.json` | 島的外形、高度場(ramp、features、noise)、平台(pads) | 手改;屋排平台 `y: "auto"` 會在載入時取範圍內原地形的平均 |
| `paths.json` | 步道折線 `[x, z, 腳底高度]` 與寬度 | 手改 |
| `stops.json` | 四站的錨點 | 手改 |
| `camera.json` | 封面與各站的導覽鏡頭 | 手改 |
| `lighting.json` | 日夜關鍵時刻與色票 | 手改 |
| `cells/<ix>_<iz>.json` | 擺放物件,一格一檔,一筆一行 | `source: "hand"` 手改;`source: "rule"` 由烘焙產生,不要手改 |

改了地形、步道或 `../rules.ts` 之後要重新烘焙(否則 `../world.test.ts` 會失敗):

```
cd web
npm run island:bake -- night-jiufen
```

烘焙會整批替換 `source: "rule"` 的擺放、保留 `source: "hand"` 的。每個圖層有自己的亂數種子(`scene.json` 的
`layers.<名稱>.seed`,沒寫就由場景種子與圖層名稱推出),改一層不會讓別層重抽;要讓某一層重抽,改它的 seed。

數值來歷:2026-10 從舊的 `layout.ts`(建築約 0.64 格/m)× 1.5625 精確換算成公尺;同時改成每層獨立種子,
散落物因此重抽過一次。
