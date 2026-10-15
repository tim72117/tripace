// planSimScript.ts — 進入頁面自動播放的固定劇本,純前端資料,不打任何
// 後端。原本(plan-ai-sim 分支)這份劇本活在後端
// server/internal/api/plan_sim_demo.go 的 planSimScript 變數裡,透過
// WebSocket(ws://…/public/plan-sim/ws)逐步推播給前端;那條路徑在 main
// 分支已經改成需登入、搬到別的路徑(見 planSimFakeSource.ts 的完整
// 說明)。使用者明確要求這個獨立公開頁完全離線可用、進頁面就自動全部
// 播放一次(不是可暫停/單步推進/測試按鈕觸發額外訊息的互動模擬器)——
// 把劇本本身搬到前端當一個純資料陣列,由 planSimFakeSource.ts 用
// setTimeout 自己控制節奏播放,取代原本的 WebSocket 連線。原始後端還有
// 一份 planSimTriggerActions(對話框測試按鈕觸發的額外訊息表,移除
// 祀典武廟/插入安平天后宮)——這個純展示頁不需要,不移植。
//
// 內容經過多輪使用者要求調整,目前是兩天的行程:
//   Day 1:赤崁樓→祀典大天后宮(+備註)→武廟愛玉→日安良食鳳凰卷→
//     祀典武廟(+備註)→義豐冬瓜茶→午餐候選(阿堂鹹粥/福記肉圓,見
//     stop-lunch 的完整說明)→神農街
//   Day 2:孔廟(+備註)→孔廟商圈→國立臺灣文學館→臺南市消防史料館→
//     林百貨(+備註)→小豪洲沙茶鍋(晚餐)
//
// 每一站都明確帶 day(1 或 2)——使用者明確要求「排程元件加入日的
// 概念」(見 planTimeline.ts PlanNodeData.day 的完整說明)之後,又要求
// 「跨天不用插入 section,排程元件自動新增分隔線」:原本用一串
// add_section 手動插入「上午/中午/下午/傍晚/晚餐」這種子分段標題,
// 現在全部拿掉,不再有任何子分段——分天的視覺分隔線完全交給
// toRenderList 依 day 欄位變化自動產生(見該函式的完整說明),這裡只需
// 要老實標好每一站屬於第幾天,不需要再手動插入任何 section 節點。
//
// 武廟愛玉/日安良食鳳凰卷/義豐冬瓜茶是使用者明確要求加入的三站(分別
// 對應 attractionPool.ts 新增的
// attr-wumiao-aiyu/attr-riann-fenghuangjuan/attr-yifeng-wintermelon,
// 都在祀典武廟前後、圍繞永福路周邊的小吃/飲品)。下午原本是安平古堡+
// 安平樹屋兩站,使用者明確要求「移除安平加入孔廟」,兩站整段換成孔廟
// (attr-confucius-temple),接著又要求「加入孔廟商圈」
// (attr-confucius-temple-cultural-zone,府中街一帶文創聚落)。台灣文學館/
// 消防史料館(attr-literature-museum/attr-fire-museum)是使用者明確要求
// 「吃完中飯後先到」的兩站。神農街(attr-shennong,原本就存在的假資料
// 池條目)原本排在收尾「晚上」時段,使用者要求「改為兩日遊 第一天下午
// 去神農街」後移到 Day 1。使用者接著要求「國立臺灣文學館後面都改為
// 第二天」,把台灣文學館/消防史料館/孔廟/孔廟商圈整段改成 day: 2。
// 小豪洲沙茶鍋(attr-xiaohaozhou-shacha)使用者要求「改為第二天晚餐」,
// 從 Day 1 改成 Day 2 收尾。使用者接著要求「孔廟為第二天第一個行程」,
// 孔廟+孔廟商圈兩站排到 Day 2 最前面,台灣文學館/消防史料館隨之退到
// 孔廟商圈之後。「林百貨第二天中午過後」則讓林百貨也改成 day: 2,接在
// 消防史料館之後、晚餐之前。原始版本這裡還有一段「加入後又移除」的
// 示範(祀典大天后宮加入、備註考慮拿掉、真的移除、改插入祀典武廟),
// 使用者明確要求「模擬畫面不要移除景點」,拿掉 remove_step 那一步,
// 祀典大天后宮跟祀典武廟兩站都留在行程裡,不再示範刪除。地點名稱只有
// 兩處換成 attractionPool.ts 已有的假資料池條目(不新增假資料):
//   - 「金得春捲」→「阿堂鹹粥」(attr-atang,同樣是午餐定位)
//   - 「全美戲院」→「林百貨」(attr-hayashi,同樣是下午/傍晚散策收尾)
// placeId 一律用 attractionPool.ts 的 id(而非原始的 Google Place ID)
// ——這裡的「查詢完成」是呼叫 planAiFakeDataSource.placeDetails(見該
// 檔案的完整說明),用 id 精確查找假資料池,不是真的打 Google API。

import type { PlanAction } from './AIPlanTimelinePage'

export const PLAN_SIM_SCRIPT: PlanAction[] = [
  // add_message 示範:LLM 一邊想一邊跟使用者說的話,排在第一筆 add_stop
  // 之前——忠實對齊「先說話、後新增景點」的真實節奏(見原始後端劇本
  // 註解的完整說明)。
  {
    type: 'add_message',
    id: 'msg-chikanlou-intro',
    text: '早上先從赤崁樓開始，08:30 剛好開館可以避開排隊人潮，園區不大，安排 1 小時走逛剛剛好。',
  },
  // stop-chikanlou-area——2026-10 使用者明確要求「主題點」概念:「鄰近
  // 的景點不用每個都安排時間點,而是集合的概念」。原本赤崁樓/祀典大
  // 天后宮/武廟愛玉/日安良食鳳凰卷/祀典武廟/義豐冬瓜茶是六筆獨立的
  // add_stop(各自佔用時間軸一個時間點),合併成一筆「赤崁樓周邊」主題
  // 卡,六個景點收進 children(見 planTimeline.ts PlanNodeData.children/
  // PlanThemeChild 的完整說明)——子景點不再各自帶 time/duration,只有
  // 這張主題卡本身佔用 08:30 起算的一個時間區段。duration 抓六站原本
  // 各自停留時間加總的概估值(1h + 30分 + 20分 + 15分 + 45分 + 10分 ≈
  // 3h 緩衝進步行銜接時間)。
  {
    type: 'add_stop', id: 'stop-chikanlou-area', time: '08:30', day: 1, duration: '停留 3h', kind: '景點',
    name: '赤崁樓周邊', desc: '從荷蘭時期古蹟赤崁樓出發，順遊鄰近的祀典大天后宮、武廟愛玉、日安良食鳳凰卷、祀典武廟與義豐冬瓜茶，步行距離都在 5 分鐘內。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B3A2F)', thumbIcon: '🏯',
    tags: ['08:30 開館'],
    placeId: 'attr-chikanlou',
    lat: 23.0009, lng: 120.2024,
    children: [
      {
        id: 'stop-chikanlou', name: '赤崁樓',
        desc: '荷蘭時期普羅民遮城遺址，紅磚拱廊與燕尾脊並存，是台南地標之一。',
        thumbBg: 'linear-gradient(135deg, #C4956A, #8B3A2F)', thumbIcon: '🏯',
        placeId: 'attr-chikanlou', lat: 23.0009, lng: 120.2024,
      },
      {
        id: 'stop-datianhou', name: '祀典大天后宮',
        desc: '1663年創建，原明寧靖王府邸，全台唯一官建列入祀典的媽祖廟，國定古蹟。',
        thumbBg: 'linear-gradient(135deg, #B85C4A, #8B3A2F)', thumbIcon: '⛩️',
        placeId: 'attr-datianhou', lat: 22.9966, lng: 120.2016,
      },
      {
        id: 'stop-wumiao-aiyu', name: '武廟愛玉',
        desc: '祀典武廟廟埕旁的老字號愛玉冰攤，純手工洗愛玉，酸甜檸檬愛玉是招牌。',
        thumbBg: 'linear-gradient(135deg, #C4B15A, #8B7A2F)', thumbIcon: '🍧',
        placeId: 'attr-wumiao-aiyu', lat: 23.0007, lng: 120.2025,
      },
      // stop-fenghuangjuan——2026-10 使用者明確要求「鳳凰卷也是」:原本
      // 獨立一筆 add_stop(見下方 git 歷史),併入這個主題點的子景點。
      {
        id: 'stop-fenghuangjuan', name: '日安良食鳳凰卷',
        desc: '永福路老字號糕餅鋪，鳳凰卷酥皮薄脆內餡濃郁，是府城傳統伴手禮之一。',
        thumbBg: 'linear-gradient(135deg, #D9B87D, #A67C4A)', thumbIcon: '🥐',
        placeId: 'attr-riann-fenghuangjuan', lat: 23.0008, lng: 120.2026,
      },
      // stop-wumiao/stop-wintermelon——2026-10 使用者明確要求「武廟
      // 冬瓜茶都是」:原本兩筆獨立 add_stop(見下方 git 歷史),併入這個
      // 主題點的子景點。
      {
        id: 'stop-wumiao', name: '祀典武廟',
        desc: '全台祀典關帝廟，國定古蹟，紅牆是「出磚入石」砌法代表案例。',
        thumbBg: 'linear-gradient(135deg, #C0604A, #8B3A2F)', thumbIcon: '⛩️',
        placeId: 'attr-wumiao', lat: 22.9966, lng: 120.2022,
      },
      {
        id: 'stop-wintermelon', name: '義豐冬瓜茶',
        desc: '永福路百年老店，古法熬煮冬瓜磚現煮冬瓜茶，逛廟後解渴的在地首選。',
        thumbBg: 'linear-gradient(135deg, #B8934A, #6B4A2E)', thumbIcon: '🥤',
        placeId: 'attr-yifeng-wintermelon', lat: 23.0005, lng: 120.2023,
      },
    ],
  },
  // note-reconsider——2026-10 使用者明確要求併入主題點的三則備註(原本
  // 各自掛在 stop-datianhou/stop-wumiao/stop-wintermelon 身上)合併成
  // 一則。一個節點只能有一則 note(見 planTimeline.ts NoteInfo 的完整
  // 說明:note?: NoteInfo 是單數欄位,setNoteForStop 用 updateNode 整個
  // 覆蓋——連續對同一個 id 送三則 add_note,只有最後一則會真的留下來,
  // 不是三則並存),這些站點合併成同一張主題卡後,原本三則各自獨立的
  // 備註不能繼續各自送出,改成一次寫成一段完整的提醒文字。category 選
  // 'consideration'(綜合提醒,不偏單一分類)。
  {
    type: 'add_note', id: 'note-reconsider', afterId: 'stop-chikanlou-area', category: 'consideration',
    text: '大天后宮距離赤崁樓稍近可以順路安排；週二香客較多，建議 10 點前抵達祀典武廟；中午前後日曬強烈，可以先買杯冬瓜茶消暑再繼續逛。',
  },
  // stop-lunch——2026-10 使用者明確要求「製作多個候選點的圖卡,原本的
  // 一個圖卡裡面,放入多個小格,讓使用者選要去哪裡」「播放的資料調整,
  // 阿堂鹹粥的圖卡換成多個,另外再加入一個新的食物地點」「可以都去,
  // 讓使用者選」「多個候選都會排進行程時間軸,卡片只是展示用」「可選
  // 的狀態跟地點集合是不一樣的,原本的卡片要換成是多個小格子的樣子」:
  // 原本單一地點的「阿堂鹹粥」改成候選卡(candidateCards: true,見
  // planTimeline.ts PlanNodeData.candidateCards 的完整說明)。跟既有的
  // 「主題點」(children 但 candidateCards 省略,例如孔廟+孔廟商圈合併
  // 的「孔廟周邊」)不是同一種卡片外觀——主題點是一張正常卡片(時間/
  // 名稱/描述齊全)底下再附一排子景點 chip,候選卡則是整張卡片完全
  // 不顯示 time/name/desc,直接是並列的候選格子本身(見
  // HorizontalPlanTimeline.tsx candidateCards 渲染分支的完整說明)。
  // 候選資料仍共用 children 這個既有欄位(阿堂鹹粥本身+新增的福記肉圓
  // attr-fuji-meatball,見 attractionPool.ts 該筆的完整說明),只是
  // candidateCards 這個旗標切換了卡片要用哪一種方式呈現這份資料。
  {
    type: 'add_stop', id: 'stop-lunch', time: '11:30', day: 1, duration: '停留 1h', kind: '午餐',
    name: '午餐候選', desc: '虱目魚粥與土魠魚羹的在地經典早午餐店，或是傳承多代的肉圓老店，兩個都在永福路/民族路一帶，步行距離都很近。',
    thumbBg: 'linear-gradient(135deg, #D9A97D, #C4956A)', thumbIcon: '🍚',
    placeId: 'attr-atang',
    lat: 22.9976, lng: 120.1975,
    candidateCards: true,
    children: [
      {
        id: 'stop-lunch-atang', name: '阿堂鹹粥',
        desc: '虱目魚粥與土魠魚羹的在地經典早午餐店，用餐時間常需排隊。',
        thumbBg: 'linear-gradient(135deg, #D9A97D, #C4956A)', thumbIcon: '🍚',
        placeId: 'attr-atang', lat: 22.9976, lng: 120.1975,
      },
      // farFromNext: true——2026-10 使用者明確要求「用福記肉圓做看看」
      // 示範「出現選擇時,有比較遠的行程時,要有一個標誌讓使用者知道,
      // 可能需要調整後續時間」(見 PlanThemeChild.farFromNext 的完整
      // 說明)。福記肉圓(22.9969, 120.1981)到下一站神農街(22.9987,
      // 120.1971)直線距離約 225m,比另一個候選阿堂鹹粥(22.9976,
      // 120.1975)到神農街的約 129m 遠將近一倍,適合當這個提示的示範
      // 案例。
      {
        id: 'stop-lunch-fuji', name: '福記肉圓',
        desc: '傳承多代的在地肉圓老店，外皮Q彈內餡扎實，淋上特調醬汁是台南經典小吃代表之一。',
        thumbBg: 'linear-gradient(135deg, #C97B4A, #8B4A2F)', thumbIcon: '🥟',
        placeId: 'attr-fuji-meatball', lat: 22.9969, lng: 120.1981,
        farFromNext: true,
      },
    ],
  },
  // stop-shennong——使用者明確要求「改為兩日遊 第一天下午去神農街」,
  // 原本排在收尾「晚上」時段,移到 Day 1,接在午餐之後,對應
  // attractionPool.ts 既有的 attr-shennong。
  {
    type: 'add_stop', id: 'stop-shennong', time: '13:30', day: 1, duration: '停留 2h', kind: '景點・散策',
    name: '神農街', desc: '老屋改建的文創街區，木造街屋與燈籠交錯，白天則是老屋立面與文創小店的悠閒散策路線。',
    thumbBg: 'linear-gradient(135deg, #8B3A2F, #2B2420)', thumbIcon: '🏮',
    placeId: 'attr-shennong',
    lat: 22.9987, lng: 120.1971,
  },
  // stop-confucius-area——2026-10 使用者明確要求「主題點」概念:「孔廟
  // 與孔廟商圈合併」。原本孔廟/孔廟商圈是兩筆獨立的 add_stop(對應
  // attractionPool.ts 的 attr-confucius-temple/
  // attr-confucius-temple-cultural-zone,理由見檔頭「移除安平加入孔廟」
  // 「加入孔廟商圈」的完整說明),合併成一筆「孔廟周邊」主題卡,兩個
  // 景點收進 children(見 planTimeline.ts PlanNodeData.children/
  // PlanThemeChild 的完整說明)。duration 抓兩站原本各自停留時間加總的
  // 概估值(1h + 1h ≈ 2h)。
  {
    type: 'add_stop', id: 'stop-confucius-area', time: '09:00', day: 2, duration: '停留 2h', kind: '景點',
    name: '孔廟周邊', desc: '從全台首學孔廟出發，接著逛府中街一帶的孔廟商圈文創聚落，步行距離都在 5 分鐘內。',
    thumbBg: 'linear-gradient(135deg, #8B7A2F, #4A3626)', thumbIcon: '🏛️',
    tags: ['免費開放參觀'],
    placeId: 'attr-confucius-temple',
    lat: 22.9908, lng: 120.2035,
    children: [
      {
        id: 'stop-confucius-temple', name: '孔廟',
        desc: '1665 年創建的全台首學，紅牆綠瓦與百年老樹環繞，是台南人文歷史的重要地標。',
        thumbBg: 'linear-gradient(135deg, #8B7A2F, #4A3626)', thumbIcon: '🏛️',
        placeId: 'attr-confucius-temple', lat: 22.9908, lng: 120.2035,
      },
      {
        id: 'stop-confucius-zone', name: '孔廟商圈',
        desc: '府中街一帶的文創聚落，老屋改建的選物店、手作工坊與小吃攤交錯，適合孔廟後接著散步逛街。',
        thumbBg: 'linear-gradient(135deg, #C4956A, #8B7A2F)', thumbIcon: '🛍️',
        placeId: 'attr-confucius-temple-cultural-zone', lat: 22.9902, lng: 120.2039,
      },
    ],
  },
  { type: 'add_note', id: 'note-3', afterId: 'stop-confucius-area', category: 'weather', text: '下午降雨機率 60%，園區內有不少樹蔭可以躲雨' },
  // stop-literature-museum/stop-fire-museum——使用者明確要求「吃完中飯
  // 後先到台灣文學館及台南消防史料館」,後又要求「國立臺灣文學館後面
  // 都改為第二天」,整段搬到 Day 2;現在孔廟移到最前面後,這兩站接在
  // 孔廟商圈之後。
  {
    type: 'add_stop', id: 'stop-literature-museum', time: '11:20', day: 2, duration: '停留 1h', kind: '景點',
    name: '國立臺灣文學館', desc: '原台南州廳修復再利用，紅磚拱廊與現代圓弧量體並存，常設展呈現台灣文學發展脈絡。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #4A3626)', thumbIcon: '📚',
    tags: ['免費參觀'],
    placeId: 'attr-literature-museum',
    lat: 22.9915, lng: 120.2039,
  },
  // note-literature-museum——使用者明確要求加入「天氣熱的,像是買飲料
  // 跟在室內活動」這類提醒,這則對應「室內活動避暑」的情境,排在中午
  // 前後日曬最強的時段。
  { type: 'add_note', id: 'note-literature-museum', afterId: 'stop-literature-museum', category: 'weather', text: '中午時段日曬最強，館內有冷氣可以避暑順便慢慢逛' },
  {
    type: 'add_stop', id: 'stop-fire-museum', time: '12:30', day: 2, duration: '停留 45 分', kind: '景點',
    name: '臺南市消防史料館', desc: '原台南合同廳舍消防塔，展示古董消防車與裝備，設有兒童消防體驗區。',
    thumbBg: 'linear-gradient(135deg, #8B3A2F, #2B2420)', thumbIcon: '🚒',
    tags: ['免費參觀'],
    placeId: 'attr-fire-museum',
    lat: 22.9946, lng: 120.2019,
  },
  // stop-evening——使用者明確要求「林百貨第二天中午過後」,接在消防
  // 史料館之後、晚餐之前(「全美戲院」換成 attr-hayashi——理由見檔頭
  // 說明)。
  {
    type: 'add_stop', id: 'stop-evening', time: '13:30', day: 2, duration: '停留 1h', kind: '景點・散策',
    name: '林百貨', desc: '1932 年落成的台南第一間百貨公司，戰後歷經數十年荒廢，2014 年整修重新開幕。',
    thumbBg: 'linear-gradient(135deg, #A67C52, #4A3626)', thumbIcon: '🏬',
    tags: ['頂樓神社遺跡'],
    placeId: 'attr-hayashi',
    lat: 22.9925, lng: 120.2028,
  },
  { type: 'add_note', id: 'note-4', afterId: 'stop-evening', category: 'consideration', text: '原本想排海安路，但今天週一多數店休，改到林百貨一帶' },
  // stop-dinner——使用者明確要求「小豪洲沙茶鍋改為第二天晚餐」,接在
  // 林百貨之後收尾整趟行程,對應 attractionPool.ts 新增的
  // attr-xiaohaozhou-shacha。
  {
    type: 'add_stop', id: 'stop-dinner', time: '18:00', day: 2, duration: '停留 1.5h', kind: '晚餐',
    name: '小豪洲沙茶鍋', desc: '在地老字號沙茶火鍋店，湯頭以沙茶炒香熬煮，配料新鮮實在，是台南人熟悉的晚餐選擇。',
    thumbBg: 'linear-gradient(135deg, #C0604A, #6B2E2A)', thumbIcon: '🍲',
    placeId: 'attr-xiaohaozhou-shacha',
    lat: 22.9938, lng: 120.2087,
  },
  // ===== 第三天(安平)=====
  // 2026-10 新增(使用者要求「加入第三天資料看看」):原本劇本只有兩天,
  // 無法驗證跨日過渡在 Day 2 → Day 3 是否同樣正確——那段邏輯是用
  // 「相鄰兩張卡分屬不同天」偵測交界、用 toDay > fromDay 判斷方向,
  // 理論上不寫死天數,但只有兩天的資料實際上測不到第二個交界。
  //
  // 用安平那組景點(attr-anping-*,見 attractionPool.ts)當第三天:
  // 它們本來就在 pool 裡、有真實座標,但前兩天都沒用到——市區(前兩天)
  // 跟安平(第三天)在地理上明顯分開,地圖上也看得出這是獨立的一天,
  // 不是把市區行程硬拆成三段。
  {
    type: 'add_stop', id: 'stop-anping-fort', time: '09:30', day: 3, duration: '停留 1.5h', kind: '景點',
    name: '安平古堡', desc: '1624 年荷蘭東印度公司築城據點，台江內海潟湖地形提供了天然良港。',
    thumbBg: 'linear-gradient(135deg, #7C6F5B, #2B2420)', thumbIcon: '🏰',
    tags: ['瞭望台'],
    placeId: 'attr-anping-fort',
    lat: 23.0016, lng: 120.1616,
  },
  { type: 'add_note', id: 'note-5', afterId: 'stop-anping-fort', category: 'consideration', text: '第三天移到安平，跟前兩天的市區行程分開，交通上一次移動就定位' },
  {
    type: 'add_stop', id: 'stop-anping-treehouse', time: '11:15', day: 3, duration: '停留 45 分', kind: '景點',
    name: '安平樹屋', desc: '老榕樹盤根錯節包覆廢棄倉庫，港口機能外移後被自然重新接管的見證。',
    thumbBg: 'linear-gradient(135deg, #5C6B57, #2B2420)', thumbIcon: '🌳',
    tags: ['與德記洋行聯票'],
    placeId: 'attr-anping-treehouse',
    lat: 23.0037, lng: 120.1626,
  },
  {
    type: 'add_stop', id: 'stop-anping-mazu', time: '13:30', day: 3, duration: '停留 30 分', kind: '景點',
    name: '安平天后宮', desc: '開台第一座媽祖廟，主祀鎮殿媽祖神像相傳隨鄭成功來台，廟埕保留早期安平聚落的生活紋理。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #8B3A2F)', thumbIcon: '⛩️',
    tags: ['免費入場'],
    placeId: 'attr-anping-mazu',
    lat: 22.9998, lng: 120.1642,
  },
  { type: 'done' },
]
