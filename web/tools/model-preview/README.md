# model-preview——建模即時預覽

獨立工具(不屬於主網站、不進正式建置、零新增依賴)。監看一個資料夾裡的 `.glb`,檔案一更新,瀏覽器就自動重新載入並保留目前視角——
給「Blender 腳本 → GLB」這條建模流程邊做邊看用。

## 用法
```bash
cd web
node tools/model-preview/server.mjs            # 預設監看 tools/blender/out/,埠 5190(PORT=… 可改)
node tools/model-preview/server.mjs <資料夾>    # 監看別的資料夾
```
開 http://localhost:5190 。Blender 無頭匯出到 `tools/blender/out/` 即可:
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python <腳本>.py -- tools/blender/out/<名稱>.glb
```

## 功能
- 檔案清單(新檔案出現會自動切過去)、即時更新指示(綠點 = 連線中,黃閃 = 剛重新載入)
- 視角:正面 / 側面 / 斜 45° / 低角度 / 俯視;重新載入時保留視角
- 線框、邊界框、比例人(1.7 單位,假設模型單位是公尺)
- 光照:白天 / 黃昏 / 夜晚(夜晚才看得到自發光的窗與燈)
- 資訊列:邊界框尺寸、面數、材質數

## 設計
- `server.mjs`:Node 內建 http + `fs.watch`;等檔案大小連續兩次相同才通知(匯出器分段寫入,避免讀到寫一半的 GLB);SSE 推播;只在監看資料夾與 `node_modules/three` 之內提供檔案(擋路徑穿越);只綁 127.0.0.1。
- `viewer.js`:three 從 node_modules 以 importmap 提供,不經打包。渲染風格是 three.js 的,與 Blender 的不同,但接近島裡最終看到的。
- 預覽只用來檢視形狀,不取代數字驗證(尺寸、面數、材質數)。
