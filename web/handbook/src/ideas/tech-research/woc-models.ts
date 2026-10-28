import type { IdeaDoc } from '../types'

export const WOC_MODELS: IdeaDoc = {
  id: 'research-woc-models',
  group: 'tech-research',
  order: 3,
  title: 'World of ClaudeCraft:畫面模型',
  summary: '模型怎麼產生與怎麼在執行時使用:三條 GLB 產出管線(CC0 素材、Tripo AI 生成、參考圖轉程式工廠),以及 `src/render/characters/` 的角色分派、動畫狀態機、骨架合併、物件池與 LOD。',
  tags: ['外部專案', '3D 模型', 'GLB', '動畫', '資產管線'],
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '記錄時間:2026-10-28。資料來源為 `src/render/CLAUDE.md`、`src/render/characters/CLAUDE.md`,以及 `image-to-glb`、`asset-pipeline`、`blender-anim-pipeline` 三份 skill 文件。',
      ],
    },
    {
      heading: '總覽:模型全部是 GLB',
      paragraphs: [
        '執行時不再用程式拼模型,所有模型都是 GLB 檔,分目錄放在 `models/chars`、`models/creatures`、`models/weapons`、`models/props`。差別在 GLB 怎麼來;貼圖則由 `textures.ts` 在執行時用 canvas 畫,沒有圖檔。',
      ],
      table: {
        headers: ['來源', '用在哪', '工具'],
        rows: [
          ['CC0 素材包(KayKit、Quaternius)', '早期角色骨架、生物、部分道具', '直接放進 public/models/'],
          ['AI 生成(Tripo)', '武器、生物、NPC、角色皮膚', '`scripts/asset_pipeline/pipeline.mjs`'],
          ['參考圖轉程式工廠', '建築、家具、地標等靜態物件', '`scripts/assets/<asset>/model.js` 匯出 GLB'],
        ],
      },
    },
    {
      heading: '管線一:參考圖 → 程式工廠 → GLB(靜態物件)',
      bullets: [
        '確認參考圖來源與版權;AI 生成的參考圖要記錄 prompt、輸入與輸出 hash,每個上線資產在 CREDITS.md 留一列。',
        '先定預算再動工:寶箱 2,048 面 / 4 材質 / 44 KB;一般城鎮建築 2,300 到 4,400 面 / 40 到 68 KB;唯一的大地標 8,226 面 / 137 KB。',
        '寫雕塑規格並用 img2threejs 嚴格檢查;每個物件寫專用工廠:依語意命名部件、合併成 2 到 6 個材質、不嵌貼圖只用頂點色(中頻紋理由執行時共用 atlas 疊上)、底部 Y=0、X/Z 置中、正面 +Z、`Socket_*` 掛點。',
        '確定性匯出與最佳化(resample、prune、dedup、meshopt),多角度驗證剪影(正面、側面、斜 45 度、貼地低角度),不能像紙板。',
        '用測試鎖住:解析上線 GLB,固定 bytes、sha256、面數、材質數、無貼圖/動畫/蒙皮、邊界框、來源指紋。',
        '接進獨立 render 模組(`src/render/<asset>.ts`),從同一模板只複製 transform,材質一律經 `surfaceMat` 轉換。',
      ],
      note: '來源指紋:對固定檔案清單(工廠、匯出器、規格、參考圖、共用 atlas,連 pnpm-lock.yaml)算 sha256,測試即時重算並比對 GLB。改到清單裡任何檔案就必須重新匯出;只有指紋變時檔案大小應該不變,大小也變了代表有別的東西被改到。',
    },
    {
      heading: '管線二:Tripo AI 生成',
      table: {
        headers: ['需求', 'lane'],
        rows: [
          ['武器', 'weapon'],
          ['場景物件', 'prop'],
          ['生物或 NPC', 'creature'],
          ['換貼圖的職業皮膚', 'skin'],
          ['主題角色皮膚', 'skinmodel'],
          ['免費骨架綁定(套 KayKit 骨架)', 'rig-manual'],
        ],
      },
      bullets: [
        '`skinmodel` 最完整:渲染真實的職業基礎模型 → gpt-image-2 依主題重新設計(保留辨識度、Q 版比例)→ Tripo v3.1 + smart_low_poly 建模 → 套用整組 KayKit 動作(原本的 clips 設定不用改)→ 自動加上 handslot 骨頭,沿用遊戲原本的方式拿武器。',
        '先不加 `--apply` 跑一次,一定要看四個方向預覽圖與每個動作截圖;出現 T-pose 代表動作對應壞了。武器要確認 7 個職業角色都拿得正。',
        '修正時用 `--job <id>` 接續同一個 job,已付費步驟不重跑。',
        '動作預設做法是「取樣既有姿勢再混合」,不需要新依賴;做不到時才升級成無頭 Blender。',
      ],
    },
    {
      heading: '角色分派:實體對應到哪個模型',
      bullets: [
        '每個能畫的東西都是 `VISUALS` 裡的一個 `VisualDef`(`manifest.ts`,純資料,不 import Three.js、不載入)。',
        '`visualKeyFor(e)` 決定 key:玩家用 `player_<class>`;怪物先查 `MOB_KEYS[templateId]` 再退回 `FAMILY_KEYS[family]`;變身型態由 renderer 明確傳入。',
        '所有 NPC 都是玩家職業的身體:`npc_looks.ts` 每一列是一套角色創建器捏得出來的外觀,沒有 NPC 專用美術,所以 NPC 跟玩家走同一條繪製路徑,共用預熱、shader 與遠景烘焙;NPC 頭像也從活模型即時截圖,不提交圖片檔。',
      ],
    },
    {
      heading: '動畫:CharacterVisual',
      bullets: [
        '每個實體是 `SkeletonUtils` 複製出的副本,各自有一個 `AnimationMixer` 與由動作片段驅動的狀態機(`visual.ts`)。',
        '姿勢選擇邏輯在 `anim_state.ts`(不依賴 Three.js,可直接測):idle、walk、run、strafe、cast、swim、sit、jump 等。',
        '片段名稱依骨架不同(KayKit `Walking_A`、Quaternius `Gallop`),由 `ClipMap` 對應;測試逐一檢查每個名稱真的存在於上線 GLB。',
        '只有 `renderer.ts` 能驅動角色動畫:每幀組 `AnimState` 呼叫 `update()`,依 sim 事件觸發攻擊/受擊。',
        '片段是共用資料:雙持或「蓄力再放」切成兩半(`clip_split`)、同一動作中途重觸發用分身片段淡入(`clip_twin`),都是每個來源片段只做一份,絕不修改原片段。',
        '骨架權重不能掉到 0:總權重低於 1 時 SkinnedMesh 會畫出 T-pose,所以一律經 `beginAction` 啟動,另有 `scanAnimRepair` 連續 3 幀權重不足就重新驅動基本姿勢。',
        '環境動畫(例如史萊姆冒泡)用自己的時鐘循環,不進狀態機;死亡/復活只在本地狀態轉換那一刻觸發。',
      ],
    },
    {
      heading: '合併與共用(降 draw call 與 GPU 記憶體)',
      bullets: [
        '`rig_merge.ts`:把切成很多塊的身體 SkinnedMesh 合併成每種材質一個 draw call(檔頭附綁定姿勢正確性證明)。',
        '`rig_shared_skeleton.ts`:整副骨架只有一個 Skeleton 與一張 GPU 骨頭貼圖(原本 `SkeletonUtils.clone` 每個 SkinnedMesh 各建一個;模組化 GLB 有 246 個蒙皮共用一份 23 關節)。',
        'morph target 合併時補齊到所有名稱的聯集(`morph_union_core`),臉部滑桿仍依名稱驅動、只動到對應頂點。',
        '幾何是每個資產共用的快取,永遠不 dispose;染色材質用認領計數,沒人用了才釋放。',
      ],
    },
    {
      heading: '模組化身體(目前未啟用,但設計完整)',
      bullets: [
        '一個 GLB 就是部件庫:兩種基礎身體、內衣、髮型眉毛、各職業依裝備槽切好的套裝,全部共用同一副 `Rig_Medium`,不需要跨檔案比對骨架。',
        '臉型用 morph target(8 組成對滑桿);嘴巴是獨立部件,因為嘴唇凸出皮膚、張嘴是不同網格。',
        '鬍渣與短髮不是 3D 體積,而是依頭部表面即時產生的貼花(`stubble.ts`)。',
        '眉毛、眼睛、睫毛製作時投影到頭部表面,男女各一版(兩顆頭是分開雕的)。',
      ],
    },
    {
      heading: '物件池、LOD 與材質效果',
      bullets: [
        '`CharacterVisualPool`:非玩家角色消失時放進有上限的 LRU 池,不立刻釋放;玩家不進池(外觀隨裝扮變)。池的 key 只用模板身分,顏色和縮放取出時再套,否則每隻顏色不同的生物都會留下永遠用不到的紀錄。',
        '遠景 LOD:遠方角色換成烘焙好的 idle 姿勢網格(一個 draw call);中間一段保留完整骨架但降低動畫更新頻率(`pendingDt` 累積跳過的時間,動作速度不變)。',
        '套裝換色用 `armor_dye.ts` shader 層;半透明型態(靈魂、隱身、幽靈狼)共用一套開機就預先 link 的 spirit veil;暗影型態則讓所有發光材質預先內建休眠效果層,進入型態只重綁 uniform,不編新 shader。',
      ],
    },
    {
      heading: '要避免的坑',
      bullets: [
        'KayKit GLB 預設所有配件都顯示,要用 `VisualDef.show` 白名單列出要保留的節點。',
        'GLTFLoader 會清理骨頭名稱(`handslot.r` 變 `handslotr`),掛載時兩種都要試。',
        '模型載入失敗回傳 null、不丟例外,同一個 key 只記一次 log。',
      ],
    },
    {
      heading: '對 tripace 的參考',
      bullets: [
        '資產用測試鎖住:sha256 + 數量指標固定每個上線檔案。',
        '清單是純資料、載入與繪製分開(`manifest.ts` 只放資料、`assets.ts` 載入、`visual.ts` 繪製);地圖標記或圖示資源可以用同樣方式管理。',
      ],
    },
  ],
}
