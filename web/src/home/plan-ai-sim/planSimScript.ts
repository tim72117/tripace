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
//     祀典武廟(+備註)→義豐冬瓜茶→阿堂鹹粥(午餐)→神農街
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
  {
    type: 'add_stop', id: 'stop-chikanlou', time: '08:30', day: 1, duration: '停留 1h', kind: '景點',
    name: '赤崁樓', desc: '荷蘭時期普羅民遮城遺址，紅磚拱廊與燕尾脊並存，是台南地標之一。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B3A2F)', thumbIcon: '🏯',
    tags: ['08:30 開館'],
    placeId: 'attr-chikanlou',
    lat: 23.0009, lng: 120.2024,
  },
  {
    type: 'add_stop', id: 'stop-datianhou', time: '09:15', day: 1, duration: '停留 30 分', kind: '景點',
    name: '祀典大天后宮', desc: '1663年創建，原明寧靖王府邸，全台唯一官建列入祀典的媽祖廟，國定古蹟。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #8B3A2F)', thumbIcon: '⛩️',
    tags: ['免費入場'],
    placeId: 'attr-datianhou',
    lat: 22.9966, lng: 120.2016,
  },
  // note-reconsider——備註掛在 stop-datianhou 自己身上。使用者明確要求
  // 模擬畫面不要移除景點:原本這裡後面接一則 remove_step 示範「AI 想了
  // 想又拿掉」,現在拿掉那一步,兩站都留在行程裡,備註文字也跟著從
  // 「考慮拿掉」改寫成單純的行程提醒,不再暗示這一站會被移除。
  { type: 'add_note', id: 'note-reconsider', afterId: 'stop-datianhou', category: 'consideration', text: '距離赤崁樓稍近，可以順路安排，時間抓緊一點' },
  // stop-wumiao-aiyu——使用者明確要求「去大天后宮後加入吃武廟愛玉」,
  // 接在大天后宮之後、祀典武廟之前,對應 attractionPool.ts 新增的
  // attr-wumiao-aiyu(武廟廟埕旁的愛玉冰攤)。
  {
    type: 'add_stop', id: 'stop-wumiao-aiyu', time: '09:50', day: 1, duration: '停留 20 分', kind: '小吃',
    name: '武廟愛玉', desc: '祀典武廟廟埕旁的老字號愛玉冰攤，純手工洗愛玉，酸甜檸檬愛玉是招牌。',
    thumbBg: 'linear-gradient(135deg, #C4B15A, #8B7A2F)', thumbIcon: '🍧',
    placeId: 'attr-wumiao-aiyu',
    lat: 23.0007, lng: 120.2025,
  },
  // stop-fenghuangjuan——使用者明確要求「接著買日安良食鳳凰卷」,接在
  // 武廟愛玉之後、祀典武廟之前,對應 attractionPool.ts 新增的
  // attr-riann-fenghuangjuan。
  {
    type: 'add_stop', id: 'stop-fenghuangjuan', time: '10:00', day: 1, duration: '停留 15 分', kind: '小吃',
    name: '日安良食鳳凰卷', desc: '永福路老字號糕餅鋪，鳳凰卷酥皮薄脆內餡濃郁，是府城傳統伴手禮之一。',
    thumbBg: 'linear-gradient(135deg, #D9B87D, #A67C4A)', thumbIcon: '🥐',
    placeId: 'attr-riann-fenghuangjuan',
    lat: 23.0008, lng: 120.2026,
  },
  {
    type: 'add_stop', id: 'stop-wumiao', time: '10:20', day: 1, duration: '停留 45 分', kind: '景點',
    name: '祀典武廟', desc: '全台祀典關帝廟，國定古蹟，紅牆是「出磚入石」砌法代表案例。',
    thumbBg: 'linear-gradient(135deg, #C0604A, #8B3A2F)', thumbIcon: '⛩️',
    tags: ['免費入場'],
    placeId: 'attr-wumiao',
    lat: 22.9966, lng: 120.2022,
  },
  { type: 'add_note', id: 'note-1', afterId: 'stop-wumiao', category: 'info', text: '週二香客較多，建議 10 點前抵達祀典武廟' },
  // stop-wintermelon——使用者明確要求「武廟逛完加入買義豐冬瓜茶」,
  // 接在祀典武廟之後、午餐之前,對應 attractionPool.ts 新增的
  // attr-yifeng-wintermelon。
  {
    type: 'add_stop', id: 'stop-wintermelon', time: '11:10', day: 1, duration: '停留 10 分', kind: '飲品',
    name: '義豐冬瓜茶', desc: '永福路百年老店，古法熬煮冬瓜磚現煮冬瓜茶，逛廟後解渴的在地首選。',
    thumbBg: 'linear-gradient(135deg, #B8934A, #6B4A2E)', thumbIcon: '🥤',
    placeId: 'attr-yifeng-wintermelon',
    lat: 23.0005, lng: 120.2023,
  },
  // note-wintermelon——使用者明確要求加入「天氣熱的,像是買飲料跟在
  // 室內活動」這類提醒,這則對應「買飲料消暑」的情境。
  { type: 'add_note', id: 'note-wintermelon', afterId: 'stop-wintermelon', category: 'weather', text: '中午前後日曬強烈，先買杯冬瓜茶消暑再繼續逛' },
  // 「金得春捲」換成 attr-atang(阿堂鹹粥)——理由見檔頭說明。
  {
    type: 'add_stop', id: 'stop-lunch', time: '11:30', day: 1, duration: '停留 1h', kind: '午餐',
    name: '阿堂鹹粥', desc: '虱目魚粥與土魠魚羹的在地經典早午餐店，用餐時間常需排隊。',
    thumbBg: 'linear-gradient(135deg, #D9A97D, #C4956A)', thumbIcon: '🍚',
    placeId: 'attr-atang',
    lat: 22.9976, lng: 120.1975,
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
  // stop-confucius-temple/stop-confucius-zone——使用者明確要求「孔廟為
  // 第二天第一個行程」,排在 Day 2 最前面(對應 attractionPool.ts 新增的
  // attr-confucius-temple/attr-confucius-temple-cultural-zone,理由見
  // 檔頭「移除安平加入孔廟」「加入孔廟商圈」的完整說明)。
  {
    type: 'add_stop', id: 'stop-confucius-temple', time: '09:00', day: 2, duration: '停留 1h', kind: '景點',
    name: '孔廟', desc: '1665 年創建的全台首學，紅牆綠瓦與百年老樹環繞，是台南人文歷史的重要地標。',
    thumbBg: 'linear-gradient(135deg, #8B7A2F, #4A3626)', thumbIcon: '🏛️',
    tags: ['免費開放參觀'],
    placeId: 'attr-confucius-temple',
    lat: 22.9908, lng: 120.2035,
  },
  { type: 'add_note', id: 'note-3', afterId: 'stop-confucius-temple', category: 'weather', text: '下午降雨機率 60%，園區內有不少樹蔭可以躲雨' },
  {
    type: 'add_stop', id: 'stop-confucius-zone', time: '10:10', day: 2, duration: '停留 1h', kind: '景點・散策',
    name: '孔廟商圈', desc: '府中街一帶的文創聚落，老屋改建的選物店、手作工坊與小吃攤交錯，適合孔廟後接著散步逛街。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B7A2F)', thumbIcon: '🛍️',
    placeId: 'attr-confucius-temple-cultural-zone',
    lat: 22.9902, lng: 120.2039,
  },
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
  { type: 'done' },
]
