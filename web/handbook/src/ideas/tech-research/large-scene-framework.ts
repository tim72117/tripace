import type { IdeaDoc } from '../types'

export const LARGE_SCENE_FRAMEWORK: IdeaDoc = {
  id: 'research-large-scene-framework',
  group: 'tech-research',
  order: 4,
  title: '3D 小島:大型場景框架(最小框架與待辦)',
  summary: '小島往大型場景方向發展,先把世界格子、場景檔案格式、烘焙、執行時切塊、串流與 LOD、陰影跟著鏡頭、效能調節器的最小框架接好;這份文件記錄每一項目前做到哪裡、之後要補什麼。',
  tags: ['3D 小島', '大型場景', '效能', '檔案格式', 'LOD', '串流'],
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '記錄時間:2026-10-29。程式在 web/src/island(純邏輯 logic/world/、渲染端 three/world/、場景資料 scenes/<id>/world/)。做法借鏡 World of ClaudeCraft(見同分類的〈前端畫面渲染〉)與業界通用規格:Unreal World Partition、Data Layers、PCG、HLOD、HISM。',
        '原則:每一項先做「介面與流程接好、預設值不改變現有畫面」的最小版本,之後逐項做細。',
      ],
    },
    {
      heading: '共用基礎:世界格子規格',
      paragraphs: ['所有系統共用同一套空間切分:世界以原點對齊、切成邊長 cellSize 的正方形格子,格子 ID 是 (ix, iz),檔名與鍵是 "ix_iz"。九份目前 cellSize = 32 m,共 16 格有內容。'],
      table: {
        headers: ['項目', '目前', '位置'],
        rows: [
          ['格子規格與換算', '完成:cellOf、cellBounds、cellsInBounds、distanceToCell', 'logic/world/grid.ts'],
          ['每格亂數種子', '完成:cellSeed(圖層種子, 格子)、cellRng;圖層種子 layerSeed(場景種子, 名稱)', 'logic/world/grid.ts'],
        ],
      },
    },
    {
      heading: '一、場景檔案格式(編輯時分檔)',
      paragraphs: ['依用途分層(類似 Data Layers)、擺放物件依空間一格一檔(類似 World Partition)。資料是 JSON,執行時只讀資料;程序化擺放的規則是 TS 程式,烘焙時才執行(類似 Unreal PCG 在編輯器生成後存檔)。'],
      table: {
        headers: ['檔案', '內容'],
        rows: [
          ['scene.json', '格式版本、格子規格、場景種子、程序化圖層清單與順序、島厚/海/河'],
          ['terrain.json', '外形、高度場(ramp/features/noise)、平台;屋排平台 y 可寫 auto'],
          ['paths.json / stops.json / camera.json / lighting.json', '步道、站點、鏡頭、光線與色票'],
          ['cells/<ix>_<iz>.json', '擺放物件,一筆一行;source: hand(手擺,烘焙保留)/ rule(規則產生,整批替換)'],
        ],
      },
      bullets: [
        '已完成:格式型別與組裝 assembleScene、格子檔驗證 validateCells、烘焙分檔 bakeCells、九份搬遷(舊 layout.ts 已刪除,組出的版面與舊版逐欄位一致)。',
        '已完成:規則改成每個圖層獨立種子(13 層),松林示範以格子為單位取種子;散落物因此重抽過一次(數量與密度相近)。',
        '已完成:新鮮度測試(scenes/night-jiufen/world.test.ts):規則重跑結果必須等於 cells/ 的 rule 部分,忘記重烤會失敗。',
      ],
    },
    {
      heading: '一、待辦',
      bullets: [
        '格式版本升級路徑:format 欄位已檢查,但還沒有 v1 → v2 的遷移函式;第一次改格式時要補。',
        '其餘圖層也改成以格子為單位取種子(目前只有松林),之後重烤一格才真的只影響那一格。',
        '依格子局部重烤:bake 加參數只重烤指定格子或指定圖層(目前一次全部)。',
        '圖層的跨格依賴:屋舍、燈帶目前依屋排平台逐條排,平台跨格時規則仍是全域執行;大場景要改成「格子 + 外圍一圈」的局部範圍。',
        '地形資料的高度圖區塊:業界大場景的地形通常存成每格一張高度圖。目前是函式型高度場(與 WoC 相同);要補「函式烘焙成高度圖」與「直接匯入高度圖」兩條路,terrain.json 預留位置。',
        'JSON 格式的結構驗證:目前靠 TS 型別與 validateCells;資料由外部工具產生時,要補欄位層級的驗證與錯誤訊息。',
        '網頁編輯器:讀寫同一份格式(擺放手擺物件、調平台、預覽烘焙結果)。業界是在 Unreal/Unity 編輯器裡做,這裡沒有圖形化編輯器。',
      ],
    },
    {
      heading: '二、執行時切塊',
      bullets: [
        '已完成:地形頂面依三角形中心點分到格子,每格一個網格與包圍球,視錐剔除可以整格略過(three/world/cellSplit.ts)。側壁沿島緣一圈,不切。',
        '已完成:散落物改用 BatchedMesh,依「材質參數 × 是否投影」分批,顏色存在每個實例上;每批一次繪製,內部逐個實例剔除(效果類似 Unreal HISM)。',
        '已完成:每格有哪些實例的對照表(cellInstances),給串流整格開關。',
      ],
    },
    {
      heading: '二、待辦',
      bullets: [
        '量測 BatchedMesh 前後的繪製呼叫數與 fps(封面、近景、探索)。BatchedMesh 需要 WEBGL_multi_draw,不支援時 three 會退回逐個繪製,要在低階裝置確認。',
        '站點建築(豎崎路 55 階等)目前是獨立網格,沒有合併;靜態部件合成一個網格可以省 40 多次繪製呼叫。',
        '燈籠光暈、粒子、站點燈籠仍關著視錐剔除(frustumCulled = false),要改成依格子分批或算正確的包圍球。',
        '縮小版(首頁 hero)也用同一個 buildScatter,但沒有格子管理器;縮小版整島可見,目前不需要。',
      ],
    },
    {
      heading: '三、串流與 LOD',
      bullets: [
        '已完成:每格的狀態判斷(logic/world/streaming.ts):載入/卸載半徑帶緩衝區、LOD 門檻帶緩衝、HLOD 距離。',
        '已完成:格子管理器(three/world/cellRuntime.ts):每幀依鏡頭焦點更新,狀態變化才動物件(Object3D.visible、BatchedMesh.setVisibleAt),LOD/HLOD 變化有通知。',
        '目前預設全部載入、全部最細(DEFAULT_STREAMING),畫面與以前相同。',
      ],
    },
    {
      heading: '三、待辦',
      bullets: [
        '真正的串流:卸載時釋放 GPU 資源與實例、載入時在背景佇列分批建立(類似 WoC 的 zone_streaming + 背景準備佇列),並用「看得到多遠的已建好地面」限制霧的範圍。',
        '格子資料的按需載入:目前 cells/*.json 用 import.meta.glob eager 一次載入;大場景改成依格子動態載入。',
        '模型 LOD:採 Unity/Unreal 常見的檔名慣例 xxx_LOD0.glb、xxx_LOD1.glb(glTF 的 MSFT_lod 擴充 three 不支援);宣告式模型可加簡化版 parts。onLod 通知時替換實例的幾何。',
        'HLOD:每格烘焙一個合併後的簡化替身,遠處用替身取代整格(onHlod 通知已接好)。',
        '地形 LOD:每格依距離用不同疏密的網格,格子邊緣掛裙邊蓋住疏密交界的裂縫(做法同 WoC 地形分塊)。',
        '依實際場景調整數值:loadRadius、unloadRadius、lodDistances、hlodDistance、cellSize。',
      ],
    },
    {
      heading: '四、陰影跟著鏡頭',
      bullets: [
        '已完成:陰影正交相機以鏡頭焦點為中心,半寬 = 鏡頭距離 × 0.8,夾在 20 m 到整島半徑之間;中心對齊陰影貼圖的像素(texel snapping),鏡頭移動時影子邊緣不閃(logic/world/shadowFrame.ts、three/lighting.ts 的 shadowAround)。',
        '已完成(同一輪前):太陽方向每 10 分鐘遊戲時間跳一次,陰影圖只在太陽跳的時候重畫,另外每 0.1 秒補畫一次讓移動的人物影子跟上。',
      ],
    },
    {
      heading: '四、待辦',
      bullets: [
        '分層陰影(Cascaded Shadow Maps):近處一張高解析度、遠處一張低解析度,大場景同時要近景細節與遠景影子時需要。',
        '只有移動物件的影子才需要頻繁重畫:靜態場景的陰影可以只在太陽跳動或範圍改變時重畫,動態物件另外處理。',
        '確認白天時旅人影子跟得上人(這次沒驗到)。',
      ],
    },
    {
      heading: '五、效能調節器',
      bullets: [
        '已完成:量測每幀時間(指數移動平均),持續太慢就降一級像素密度、持續有餘裕才升回來,切換後有冷卻(logic/world/governor.ts,做法同 WoC 的 render_budget)。目標 50 fps。',
        '等級目前只有像素密度([1, 1.25, 1.5, 2] 中不超過裝置與畫質上限的值)。',
      ],
    },
    {
      heading: '五、待辦',
      bullets: [
        '加入更多降級項目,依序:像素密度 → 關柔邊陰影(改 PCF)→ 陰影解析度 → 點光源數 → 粒子量。每一級的 shader 要預先編好,避免降級當下卡頓(WoC 的 post_shed 做法)。',
        '公平性規則:降級只能拿掉裝飾,不能藏掉使用者要看的資訊(站點標籤、燈籠亮起的演出)。',
        '在 debug 列顯示目前等級,並用正式 build(vite preview)量測,不要用開發模式的 fps 下結論。',
      ],
    },
    {
      heading: '其他待辦(效能量測後再決定)',
      bullets: [
        '先量測瓶頸:比較 ?q=low/mid/high 與 performance trace,確定是像素填充(高像素密度、4 盞點光源、柔邊陰影)還是 CPU(燈籠顏色每幀上傳、標籤投影、粒子)。陰影重畫降到約 1/6 後 fps 沒變,所以陰影不是瓶頸。',
        '每幀的 CPU 工作改成「有變動才做」:燈籠顏色只在亮度變化時上傳、標籤只在鏡頭移動時重算。',
        '大世界的浮點精度:世界超過約 10 km 時要做 floating origin(以鏡頭附近為原點重設座標)。',
      ],
    },
    {
      heading: '與業界通用規格不同的地方(已決定)',
      table: {
        headers: ['項目', '業界常見', '這裡的做法', '原因'],
        rows: [
          ['編輯工具', 'Unreal/Unity 圖形化編輯器', 'JSON + 規則程式 + 烘焙腳本', '沒有編輯器;之後做網頁編輯器讀寫同一份格式'],
          ['地形來源', '每格一張高度圖', '函式型高度場(與 WoC 相同)', '目前場景小、手調參數方便;格式預留高度圖'],
          ['模型 LOD 格式', 'glTF MSFT_lod 或引擎內建', '檔名慣例 _LOD0、_LOD1', 'three 的 GLTFLoader 不支援 MSFT_lod'],
          ['大量實例', 'Unreal HISM 等', 'three.js 的 BatchedMesh', '效果類似,但這是 three.js 特有的 API'],
        ],
      },
    },
  ],
}
