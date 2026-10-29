# tools/blender——Blender 建模腳本

用 Blender(Python,無頭執行)程序化建模,匯出 GLB。腳本是模型的原始碼:改腳本、重跑,結果可重現。不屬於主網站的建置。

## 流程
```bash
cd web
# 1. 開預覽(另一個終端機):監看 tools/blender/out/,檔案更新自動重新載入
node tools/model-preview/server.mjs            # http://localhost:5190
# 2. 建模(--render 會多輸出兩張預覽 PNG,給人或 AI 看形狀用)
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/amei_teahouse.py -- tools/blender/out/amei-teahouse.glb --render
# 3. 定稿:複製到專案資產位置(out/ 不進版控)
cp tools/blender/out/amei-teahouse.glb src/island/scenes/night-jiufen/assets/amei-teahouse.glb
```

## Windows
`winget install BlenderFoundation.Blender.LTS.4.5`(已用 4.5.10 驗證 `amei_teahouse.py` 可匯出),執行檔在 `C:\Program Files\Blender Foundation\Blender 4.5lender.exe`,上面流程的 macOS 路徑換成它即可(Git Bash 用 `/c/Program Files/Blender Foundation/Blender 4.5/blender.exe`)。

## 檔案
- `kit.py`:共用工具(含 `anchor()`:放不畫幾何的命名錨點)。座標一律用 glTF/three 的(x 右、y 上、z 前,公尺,原點在腳底中心);按材質累積 bmesh、最後每個材質一個物件;形狀(方塊、斜樑、截頭錐、圓柱、橢球)自己建,不依賴 `bpy.ops`。
- `amei_teahouse.py`:阿妹茶樓。腳本內有**數字驗證**(尺寸、原點、面數、材質數),不合格就不匯出。
- `stone_steps.py`:石階地形磚,一次匯出 8 種樣式(`steps-5`、`steps-10`、`steps-landing` 中間有平台、`steps-to-landing`、`landing-to-steps`、`landing`、`turn-left`、`turn-right`),寬 3 m、階高 0.18、階深 0.36。頭尾對齊可串接:原點在入口邊中心,出口點與朝向在各自的 `.stats.json` 的 `exit`,模型內有 `Socket_bottom`/`Socket_top`/`Socket_rail_L`/`Socket_rail_R` 空節點,`.stats.json` 的 `dims` 記錄階高階深、總長總高、尾端平台起點比例。執行:`blender --background --python tools/blender/stone_steps.py -- tools/blender/out [--render] [樣式名…]`。
- `out/`:WIP 輸出(已 gitignore)。

## 約定與限制
- 自發光材質(窗光)在島上會跟日夜連動:Blender 裡的強度(2.4)載入時會換算(見 `src/island/three/glbLoader.ts`)。
- **燈籠是錨點,不是幾何**:`amei_teahouse.py` 的 `LANTERNS_AS_ANCHORS = True` 時,`lantern()` 只用 `kit.anchor()` 放一個名為 `lantern_NN` 的空節點(匯出成 GLB 裡的無網格節點),燈籠本身由島上的程式用實例畫(`src/island/three/stopLanterns.ts`:兩個 InstancedMesh、燈身發光材質隨站點亮度連動)。燈籠尺寸固定(r = 0.24、h = 0.36),要改尺寸要同步改 `stopLanterns.ts`。設成 `False` 就退回把每盞燈畫進模型(檔案會大很多)。
- 面數目前約 1.6 萬、GLB 0.86MB(gzip 約 173KB、brotli 約 97KB);沒有做 Draco / meshopt 壓縮。藤蔓叢數由 `amei_teahouse.py` 的 `VINE_DENSITY`(目前 0.15,約剩原本兩成)一次調整。
- 渲染預覽(EEVEE)是給形狀檢查用的,光線與島上不同;最終畫面以島為準。
